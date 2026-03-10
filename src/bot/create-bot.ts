import type { Bot, Context } from "grammy";
import type {
  TelegramDocumentAttachmentInput,
  TelegramFailedAttachment,
  TelegramMessageAttachmentInput,
  TelegramPhotoAttachmentInput,
  TelegramPhotoVariantInput,
} from "../files/telegram-message-bundle";
import type { AbortRunResult, ResetSessionResult } from "../runtime/agent-runtime";
import { parseCommand } from "./commands";
import {
  formatAbortMessage,
  formatResetMessage,
  formatRunAbortedMessage,
  formatRunCompletedMessage,
  formatRunFailedMessage,
} from "./formatters";
import { createTypingHeartbeat } from "./typing-heartbeat";

type Reply = (value: string) => Promise<void> | void;
type StopTyping = (() => Promise<void> | void) | void;
type StartTyping = () => Promise<StopTyping> | StopTyping;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export type BotTextInput = {
  chatId: bigint;
  text: string;
  startTyping?: StartTyping;
  reply: Reply;
};

type DownloadAttachment = () => Promise<Uint8Array>;

export type BotDocumentAttachmentInput = {
  kind: "document";
  name: string;
  mimeType?: string | null;
  download: DownloadAttachment;
};

export type BotPhotoVariantInput = {
  name: string;
  width: number;
  height: number;
  mimeType?: string | null;
  download: DownloadAttachment;
};

export type BotPhotoAttachmentInput = {
  kind: "photo";
  name: string;
  variants: BotPhotoVariantInput[];
};

export type BotAttachmentInput = BotDocumentAttachmentInput | BotPhotoAttachmentInput;

export type BotAttachmentMessageInput = {
  chatId: bigint;
  messageId: number;
  caption?: string | null;
  attachments: BotAttachmentInput[];
  startTyping?: StartTyping;
  reply: Reply;
};

export type PrepareAttachmentPromptInput = {
  chatId: number;
  messageId: number;
  caption?: string | null;
  attachments: TelegramMessageAttachmentInput[];
  failedAttachments: TelegramFailedAttachment[];
};

export type CreateBotHandlersDeps = {
  getStatusMessage: (chatId: bigint) => Promise<string>;
  resetSession: (chatId: bigint) => Promise<ResetSessionResult>;
  abortRun: (chatId: bigint) => Promise<AbortRunResult>;
  prepareAttachmentPrompt?: (
    input: PrepareAttachmentPromptInput,
  ) => Promise<{
    prompt: string;
  }>;
  runTurn: (
    chatId: bigint,
    prompt: string,
  ) => Promise<{
    summary?: string | null;
  }>;
};

type RegisterBotHandlersOptions = {
  mediaGroupDebounceMs?: number;
  setTimeoutFn?: (callback: () => void, delayMs: number) => TimeoutHandle;
  clearTimeoutFn?: (handle: TimeoutHandle) => void;
};

type PendingPhotoMediaGroup = {
  chatId: bigint;
  messageId: number;
  caption?: string | null;
  attachments: BotPhotoAttachmentInput[];
  startTyping?: StartTyping;
  reply: Reply;
  timer: TimeoutHandle | null;
};

export function createBotHandlers(deps: CreateBotHandlersDeps) {
  return {
    async onText({ chatId, text, startTyping, reply }: BotTextInput): Promise<void> {
      const command = parseCommand(text);

      if (command) {
        return withTyping(startTyping, reply, async (replyAfterStoppingTyping) => {
          switch (command.name) {
            case "start":
            case "help":
              await replyAfterStoppingTyping(buildHelpMessage());
              return;
            case "status":
              await replyAfterStoppingTyping(await deps.getStatusMessage(chatId));
              return;
            case "reset":
              await replyAfterStoppingTyping(formatResetMessage(await deps.resetSession(chatId)));
              return;
            case "abort":
              await replyAfterStoppingTyping(formatAbortMessage(await deps.abortRun(chatId)));
              return;
          }
        });
      }

      await runPromptAndReply({
        chatId,
        prompt: text,
        startTyping,
        reply,
        runTurn: deps.runTurn,
      });
    },

    async onAttachmentMessage({
      chatId,
      messageId,
      caption,
      attachments,
      startTyping,
      reply,
    }: BotAttachmentMessageInput): Promise<void> {
      await withTyping(startTyping, reply, async (replyAfterStoppingTyping) => {
        const prepareAttachmentPrompt = deps.prepareAttachmentPrompt;

        if (!prepareAttachmentPrompt) {
          await replyAfterStoppingTyping("Attachment handling is not configured.");
          return;
        }

        const preparedAttachments: TelegramMessageAttachmentInput[] = [];
        const failedAttachments: TelegramFailedAttachment[] = [];

        for (const attachment of attachments) {
          if (attachment.kind === "document") {
            await prepareDocumentAttachment(attachment, preparedAttachments, failedAttachments);
            continue;
          }

          await preparePhotoAttachment(attachment, preparedAttachments, failedAttachments);
        }

        let prompt: string;

        try {
          const prepared = await prepareAttachmentPrompt({
            chatId: toNumberChatId(chatId),
            messageId,
            caption,
            attachments: preparedAttachments,
            failedAttachments,
          });

          prompt = prepared.prompt;
        } catch (error) {
          await replyAfterStoppingTyping(formatAttachmentPrepareFailedMessage(error));
          return;
        }

        await runPromptAndReply({
          chatId,
          prompt,
          startTyping: undefined,
          reply,
          runTurn: deps.runTurn,
          replyAfterStoppingTyping,
        });
      });
    },
  };
}

export function registerBotHandlers(
  bot: Bot<Context>,
  deps: CreateBotHandlersDeps,
  options: RegisterBotHandlersOptions = {},
) {
  const handlers = createBotHandlers(deps);
  const pendingPhotoMediaGroups = new Map<string, PendingPhotoMediaGroup>();
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const mediaGroupDebounceMs = options.mediaGroupDebounceMs ?? 150;

  bot.on("message:text", async (ctx) => {
    await handlers.onText({
      chatId: BigInt(String(ctx.chat.id)),
      text: ctx.message.text,
      startTyping: () =>
        createTypingHeartbeat({
          sendTyping: async () => {
            await ctx.replyWithChatAction("typing");
          },
        }),
      reply: async (value) => {
        await ctx.reply(value);
      },
    });
  });

  bot.on("message:document", async (ctx) => {
    const document = ctx.message.document;

    await handlers.onAttachmentMessage({
      chatId: BigInt(String(ctx.chat.id)),
      messageId: ctx.message.message_id,
      caption: ctx.message.caption,
      attachments: [
        {
          kind: "document",
          name: document.file_name ?? `document-${document.file_unique_id}`,
          mimeType: document.mime_type,
          download: () => downloadTelegramFile(bot.token, ctx, document.file_id),
        },
      ],
      startTyping: () =>
        createTypingHeartbeat({
          sendTyping: async () => {
            await ctx.replyWithChatAction("typing");
          },
        }),
      reply: async (value) => {
        await ctx.reply(value);
      },
    });
  });

  bot.on("message:photo", async (ctx) => {
    const largestPhoto = pickLargestTelegramPhoto(ctx.message.photo);
    const photoAttachment: BotPhotoAttachmentInput = {
      kind: "photo",
      name: buildTelegramPhotoName(ctx.message.message_id, largestPhoto?.file_unique_id),
      variants: largestPhoto
        ? [
            {
              name: buildTelegramPhotoName(ctx.message.message_id, largestPhoto.file_unique_id),
              width: largestPhoto.width,
              height: largestPhoto.height,
              mimeType: "image/jpeg",
              download: () => downloadTelegramFile(bot.token, ctx, largestPhoto.file_id),
            },
          ]
        : [],
    };
    const mediaGroupId = ctx.message.media_group_id;

    if (!mediaGroupId) {
      await handlers.onAttachmentMessage({
        chatId: BigInt(String(ctx.chat.id)),
        messageId: ctx.message.message_id,
        caption: ctx.message.caption,
        attachments: [photoAttachment],
        startTyping: () =>
          createTypingHeartbeat({
            sendTyping: async () => {
              await ctx.replyWithChatAction("typing");
            },
          }),
        reply: async (value) => {
          await ctx.reply(value);
        },
      });
      return;
    }

    queuePhotoMediaGroupAttachment({
      mediaGroupId,
      attachment: photoAttachment,
      chatId: BigInt(String(ctx.chat.id)),
      messageId: ctx.message.message_id,
      caption: ctx.message.caption,
      startTyping: () =>
        createTypingHeartbeat({
          sendTyping: async () => {
            await ctx.replyWithChatAction("typing");
          },
        }),
      reply: async (value) => {
        await ctx.reply(value);
      },
      handlers,
      pendingPhotoMediaGroups,
      mediaGroupDebounceMs,
      setTimeoutFn,
      clearTimeoutFn,
    });
  });

  return handlers;
}

async function runPromptAndReply({
  chatId,
  prompt,
  startTyping,
  reply,
  runTurn,
  replyAfterStoppingTyping,
}: {
  chatId: bigint;
  prompt: string;
  startTyping?: StartTyping;
  reply: Reply;
  runTurn: CreateBotHandlersDeps["runTurn"];
  replyAfterStoppingTyping?: (value: string) => Promise<void>;
}): Promise<void> {
  await withTyping(startTyping, reply, async (localReplyAfterStoppingTyping) => {
    const sendReply = replyAfterStoppingTyping ?? localReplyAfterStoppingTyping;

    try {
      const result = await runTurn(chatId, prompt);
      await sendReply(formatRunCompletedMessage(result.summary ?? null));
    } catch (error) {
      if (isAbortError(error)) {
        await sendReply(formatRunAbortedMessage());
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      await sendReply(formatRunFailedMessage(message));
    }
  });
}

async function withTyping(
  startTyping: StartTyping | undefined,
  reply: Reply,
  fn: (replyAfterStoppingTyping: (value: string) => Promise<void>) => Promise<void>,
): Promise<void> {
  const stopTyping = await startTyping?.();
  let typingStopped = false;

  const stopTypingOnce = async () => {
    if (typingStopped) {
      return;
    }

    typingStopped = true;
    await stopTyping?.();
  };

  const replyAfterStoppingTyping = async (value: string) => {
    await stopTypingOnce();
    await reply(value);
  };

  try {
    await fn(replyAfterStoppingTyping);
  } finally {
    await stopTypingOnce();
  }
}

async function prepareDocumentAttachment(
  attachment: BotDocumentAttachmentInput,
  preparedAttachments: TelegramMessageAttachmentInput[],
  failedAttachments: TelegramFailedAttachment[],
): Promise<void> {
  try {
    preparedAttachments.push({
      kind: "document",
      name: attachment.name,
      mimeType: attachment.mimeType,
      bytes: await attachment.download(),
    } satisfies TelegramDocumentAttachmentInput);
  } catch (error) {
    failedAttachments.push({
      name: attachment.name,
      reason: getFailureReason(error),
    });
  }
}

async function preparePhotoAttachment(
  attachment: BotPhotoAttachmentInput,
  preparedAttachments: TelegramMessageAttachmentInput[],
  failedAttachments: TelegramFailedAttachment[],
): Promise<void> {
  const largestVariant = pickLargestDownloadablePhotoVariant(attachment.variants);

  if (!largestVariant) {
    failedAttachments.push({
      name: attachment.name,
      reason: "photo has no variants",
    });
    return;
  }

  try {
    preparedAttachments.push({
      kind: "photo",
      name: attachment.name,
      variants: [
        {
          name: largestVariant.name,
          width: largestVariant.width,
          height: largestVariant.height,
          mimeType: largestVariant.mimeType,
          bytes: await largestVariant.download(),
        },
      ],
    } satisfies TelegramPhotoAttachmentInput);
  } catch (error) {
    failedAttachments.push({
      name: attachment.name,
      reason: getFailureReason(error),
    });
  }
}

function pickLargestDownloadablePhotoVariant(
  variants: BotPhotoVariantInput[],
): BotPhotoVariantInput | null {
  if (variants.length === 0) {
    return null;
  }

  return variants.reduce((largest, current) =>
    current.width * current.height > largest.width * largest.height ? current : largest,
  );
}

function pickLargestTelegramPhoto(
  photos: Array<{
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
  }>,
):
  | {
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
    }
  | null {
  if (photos.length === 0) {
    return null;
  }

  return photos.reduce((largest, current) =>
    current.width * current.height > largest.width * largest.height ? current : largest,
  );
}

function queuePhotoMediaGroupAttachment({
  mediaGroupId,
  attachment,
  chatId,
  messageId,
  caption,
  startTyping,
  reply,
  handlers,
  pendingPhotoMediaGroups,
  mediaGroupDebounceMs,
  setTimeoutFn,
  clearTimeoutFn,
}: {
  mediaGroupId: string;
  attachment: BotPhotoAttachmentInput;
  chatId: bigint;
  messageId: number;
  caption?: string | null;
  startTyping?: StartTyping;
  reply: Reply;
  handlers: ReturnType<typeof createBotHandlers>;
  pendingPhotoMediaGroups: Map<string, PendingPhotoMediaGroup>;
  mediaGroupDebounceMs: number;
  setTimeoutFn: (callback: () => void, delayMs: number) => TimeoutHandle;
  clearTimeoutFn: (handle: TimeoutHandle) => void;
}): void {
  const key = `${chatId.toString()}:${mediaGroupId}`;
  const pendingGroup =
    pendingPhotoMediaGroups.get(key) ??
    ({
      chatId,
      messageId,
      caption,
      attachments: [],
      startTyping,
      reply,
      timer: null,
    } satisfies PendingPhotoMediaGroup);

  pendingGroup.attachments.push(attachment);

  if (!pendingGroup.caption && caption) {
    pendingGroup.caption = caption;
  }

  if (messageId < pendingGroup.messageId) {
    pendingGroup.messageId = messageId;
  }

  if (pendingGroup.timer !== null) {
    clearTimeoutFn(pendingGroup.timer);
  }

  pendingGroup.timer = setTimeoutFn(() => {
    pendingPhotoMediaGroups.delete(key);
    void handlers.onAttachmentMessage({
      chatId: pendingGroup.chatId,
      messageId: pendingGroup.messageId,
      caption: pendingGroup.caption,
      attachments: pendingGroup.attachments,
      startTyping: pendingGroup.startTyping,
      reply: pendingGroup.reply,
    });
  }, mediaGroupDebounceMs);

  pendingPhotoMediaGroups.set(key, pendingGroup);
}

async function downloadTelegramFile(
  token: string,
  ctx: Context,
  fileId: string,
): Promise<Uint8Array> {
  const file = await ctx.api.getFile(fileId);

  if (!file.file_path) {
    throw new Error("telegram file path missing");
  }

  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);

  if (!response.ok) {
    throw new Error(`telegram download failed (${response.status})`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function buildTelegramPhotoName(messageId: number, fileUniqueId?: string): string {
  return fileUniqueId ? `photo-${fileUniqueId}.jpg` : `photo-${messageId}.jpg`;
}

function formatAttachmentPrepareFailedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return `Failed to prepare attachment bundle: ${message}`;
}

function getFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function toNumberChatId(chatId: bigint): number {
  const value = Number(chatId);

  if (!Number.isSafeInteger(value)) {
    throw new Error(`chat id ${chatId} is not a safe integer`);
  }

  return value;
}

function buildHelpMessage(): string {
  return ["Send a prompt to run Codex.", "Available commands: /status /reset /abort /help"].join(
    "\n",
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
