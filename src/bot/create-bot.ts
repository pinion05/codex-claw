import path from "node:path";
import type { Bot, Context } from "grammy";
import {
  TelegramBundleCollector,
  buildTelegramBundleCollectorKey,
  type TelegramBundle,
  type TelegramBundleCollectorScheduler,
} from "../files/telegram-bundle-collector";
import type {
  TelegramFailedAttachment,
  TelegramMessageAttachmentInput,
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
type TelegramDocumentAttachmentDescriptor = {
  kind: "document";
  fileId: string;
  fileName?: string;
  mimeType?: string | null;
};
type TelegramPhotoAttachmentDescriptor = {
  kind: "photo";
  fileId: string;
  width: number;
  height: number;
  fallbackName: string;
};
type TelegramAttachmentDescriptor =
  | TelegramDocumentAttachmentDescriptor
  | TelegramPhotoAttachmentDescriptor;
type TelegramAttachmentCollectorInput = {
  chatId: number;
  messageId: number;
  mediaGroupId?: string | null;
  caption?: string | null;
  attachments: TelegramAttachmentDescriptor[];
};

export type BotTextInput = {
  chatId: bigint;
  text: string;
  startTyping?: StartTyping;
  reply: Reply;
};

type BotPromptInput = {
  chatId: bigint;
  prompt: string;
  startTyping?: StartTyping;
  reply: Reply;
};

export type DownloadedTelegramFile = {
  bytes: Uint8Array;
  filePath: string;
  mimeType?: string | null;
};

export type TelegramAttachmentBundleInput = {
  chatId: number;
  messageId: number;
  mediaGroupId?: string | null;
  caption?: string | null;
  attachments: TelegramMessageAttachmentInput[];
  failedAttachments?: TelegramFailedAttachment[];
};

export type CreateBotHandlersDeps = {
  getStatusMessage: (chatId: bigint) => Promise<string>;
  resetSession: (chatId: bigint) => Promise<ResetSessionResult>;
  abortRun: (chatId: bigint) => Promise<AbortRunResult>;
  runTurn: (
    chatId: bigint,
    prompt: string,
  ) => Promise<{
    summary?: string | null;
  }>;
  prepareAttachments?: (input: TelegramAttachmentBundleInput) => Promise<string>;
  downloadTelegramFile?: (fileId: string) => Promise<DownloadedTelegramFile>;
  attachmentCollectorScheduler?: TelegramBundleCollectorScheduler;
  attachmentCollectorQuietPeriodMs?: number;
};

export function createBotHandlers(deps: CreateBotHandlersDeps) {
  async function runPrompt(
    chatId: bigint,
    prompt: string,
    replyAfterStoppingTyping: (value: string) => Promise<void>,
  ): Promise<void> {
    try {
      const result = await deps.runTurn(chatId, prompt);
      await replyAfterStoppingTyping(formatRunCompletedMessage(result.summary ?? null));
    } catch (error) {
      if (isAbortError(error)) {
        await replyAfterStoppingTyping(formatRunAbortedMessage());
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      await replyAfterStoppingTyping(formatRunFailedMessage(message));
    }
  }

  async function onPrompt({
    chatId,
    prompt,
    startTyping,
    reply,
  }: BotPromptInput): Promise<void> {
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
      await runPrompt(chatId, prompt, replyAfterStoppingTyping);
    } finally {
      await stopTypingOnce();
    }
  }

  return {
    async onText({ chatId, text, startTyping, reply }: BotTextInput): Promise<void> {
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
        const command = parseCommand(text);

        if (command) {
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
            case "abort": {
              await replyAfterStoppingTyping(formatAbortMessage(await deps.abortRun(chatId)));
              return;
            }
          }
        }

        await runPrompt(chatId, text, replyAfterStoppingTyping);
      } finally {
        await stopTypingOnce();
      }
    },
    onPrompt,
  };
}

export function registerBotHandlers(bot: Bot<Context>, deps: CreateBotHandlersDeps) {
  const handlers = createBotHandlers(deps);

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

  if (deps.prepareAttachments) {
    const attachmentContexts = new Map<string, Omit<BotPromptInput, "prompt">>();
    let immediateAttachmentContext: Omit<BotPromptInput, "prompt"> | null = null;
    const downloadTelegramFile =
      deps.downloadTelegramFile ?? createTelegramFileDownloader(bot as Bot<Context>);
    const collector = new TelegramBundleCollector<TelegramAttachmentDescriptor>({
      quietPeriodMs: deps.attachmentCollectorQuietPeriodMs ?? 200,
      scheduler: deps.attachmentCollectorScheduler ?? createTimeoutScheduler(),
      onFinalize: async (bundle) => {
        const context = resolveAttachmentContext(bundle, attachmentContexts, immediateAttachmentContext);

        if (!context) {
          return;
        }

        if (bundle.mediaGroupId) {
          attachmentContexts.delete(buildTelegramBundleCollectorKey(bundle.chatId, bundle.mediaGroupId));
        }

        await processFinalizedAttachmentBundle(
          bundle,
          context,
          handlers.onPrompt,
          deps.prepareAttachments,
          downloadTelegramFile,
        );
      },
    });

    bot.on("message:document", async (ctx) => {
      try {
        const input = createDocumentBundleInput(
          normalizeChatId(ctx.chat.id),
          ctx.message as TelegramDocumentMessage,
        );
        const context = createPromptContext(ctx);

        if (input.mediaGroupId) {
          const key = buildTelegramBundleCollectorKey(input.chatId, input.mediaGroupId);
          attachmentContexts.set(key, attachmentContexts.get(key) ?? context);
          const result = await collector.collect(input);

          if (result.kind === "ignored") {
            attachmentContexts.delete(key);
          }

          return;
        }

        immediateAttachmentContext = context;

        try {
          await collector.collect(input);
        } finally {
          immediateAttachmentContext = null;
        }
      } catch (error) {
        if (error instanceof AttachmentPreparationError) {
          return;
        }

        await ctx.reply(formatRunFailedMessage(getErrorMessage(error)));
      }
    });

    bot.on("message:photo", async (ctx) => {
      try {
        const input = createPhotoBundleInput(
          normalizeChatId(ctx.chat.id),
          ctx.message as TelegramPhotoMessage,
        );
        const context = createPromptContext(ctx);

        if (input.mediaGroupId) {
          const key = buildTelegramBundleCollectorKey(input.chatId, input.mediaGroupId);
          attachmentContexts.set(key, attachmentContexts.get(key) ?? context);
          const result = await collector.collect(input);

          if (result.kind === "ignored") {
            attachmentContexts.delete(key);
          }

          return;
        }

        immediateAttachmentContext = context;

        try {
          await collector.collect(input);
        } finally {
          immediateAttachmentContext = null;
        }
      } catch (error) {
        if (error instanceof AttachmentPreparationError) {
          return;
        }

        await ctx.reply(formatRunFailedMessage(getErrorMessage(error)));
      }
    });
  }

  return handlers;
}

function buildHelpMessage(): string {
  return ["Send a prompt to run Codex.", "Available commands: /start /status /reset /abort /help"].join(
    "\n",
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function createPromptContext(ctx: Context): Omit<BotPromptInput, "prompt"> {
  const chatId = ctx.chat?.id;

  if (chatId == null) {
    throw new Error("Telegram context is missing chat");
  }

  return {
    chatId: BigInt(String(chatId)),
    startTyping: () =>
      createTypingHeartbeat({
        sendTyping: async () => {
          await ctx.replyWithChatAction("typing");
        },
      }),
    reply: async (value) => {
      await ctx.reply(value);
    },
  };
}

function createTimeoutScheduler(): TelegramBundleCollectorScheduler {
  return {
    schedule(callback, delayMs) {
      const handle = setTimeout(() => {
        Promise.resolve(callback()).catch(() => undefined);
      }, delayMs);

      handle.unref?.();
      return handle;
    },
    cancel(handle) {
      clearTimeout(handle as Timer);
    },
  };
}

function createTelegramFileDownloader(bot: Bot<Context>) {
  return async (fileId: string): Promise<DownloadedTelegramFile> => {
    const file = await bot.api.getFile(fileId);

    if (!file.file_path) {
      throw new Error(`Telegram file ${fileId} is missing file_path`);
    }

    const response = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`);

    if (!response.ok) {
      throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      filePath: file.file_path,
      mimeType: null,
    };
  };
}

function createDocumentBundleInput(
  chatId: number,
  message: TelegramDocumentMessage,
): TelegramAttachmentCollectorInput {
  return {
    chatId,
    messageId: message.message_id,
    mediaGroupId: message.media_group_id ?? null,
    caption: message.caption ?? null,
    attachments: [
      {
        kind: "document",
        fileId: message.document.file_id,
        fileName: message.document.file_name,
        mimeType: message.document.mime_type ?? null,
      },
    ],
  };
}

function createPhotoBundleInput(
  chatId: number,
  message: TelegramPhotoMessage,
): TelegramAttachmentCollectorInput {
  const largestPhoto = pickLargestPhoto(message.photo);

  if (!largestPhoto) {
    throw new Error("Telegram photo message had no variants");
  }

  return {
    chatId,
    messageId: message.message_id,
    mediaGroupId: message.media_group_id ?? null,
    caption: message.caption ?? null,
    attachments: [
      {
        kind: "photo",
        fileId: largestPhoto.file_id,
        width: largestPhoto.width,
        height: largestPhoto.height,
        fallbackName: `${largestPhoto.file_id}.jpg`,
      },
    ],
  };
}

function resolveAttachmentContext(
  bundle: TelegramBundle<TelegramAttachmentDescriptor>,
  attachmentContexts: Map<string, Omit<BotPromptInput, "prompt">>,
  immediateAttachmentContext: Omit<BotPromptInput, "prompt"> | null,
): Omit<BotPromptInput, "prompt"> | null {
  if (!bundle.mediaGroupId) {
    return immediateAttachmentContext;
  }

  return attachmentContexts.get(buildTelegramBundleCollectorKey(bundle.chatId, bundle.mediaGroupId)) ?? null;
}

function normalizeChatId(chatId: number | bigint): number {
  return Number(chatId);
}

async function processFinalizedAttachmentBundle(
  bundle: TelegramBundle<TelegramAttachmentDescriptor>,
  context: Omit<BotPromptInput, "prompt">,
  onPrompt: (input: BotPromptInput) => Promise<void>,
  prepareAttachments:
    | ((input: TelegramAttachmentBundleInput) => Promise<string>)
    | undefined,
  downloadTelegramFile: (fileId: string) => Promise<DownloadedTelegramFile>,
): Promise<void> {
  try {
    const preparedBundle = await materializePreparedAttachmentBundle(bundle, downloadTelegramFile);
    const prompt = await prepareAttachments?.({
      chatId: preparedBundle.chatId,
      messageId: preparedBundle.messageId,
      mediaGroupId: preparedBundle.mediaGroupId,
      caption: preparedBundle.caption,
      attachments: preparedBundle.attachments,
      failedAttachments: preparedBundle.failedAttachments,
    });

    if (!prompt) {
      return;
    }

    void onPrompt({
      chatId: context.chatId,
      prompt,
      startTyping: context.startTyping,
      reply: context.reply,
    }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await context.reply(formatRunFailedMessage(message));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await context.reply(formatRunFailedMessage(message));
    throw new AttachmentPreparationError(message, error);
  }
}

async function materializePreparedAttachmentBundle(
  bundle: TelegramBundle<TelegramAttachmentDescriptor>,
  downloadTelegramFile: (fileId: string) => Promise<DownloadedTelegramFile>,
): Promise<TelegramAttachmentBundleInput> {
  const resolvedEntries = await Promise.all(
    bundle.attachments.map(async (descriptor) => {
      try {
        if (descriptor.kind === "document") {
          const file = await downloadTelegramFile(descriptor.fileId);

          return {
            attachment: {
              kind: "document" as const,
              name: resolveAttachmentName(descriptor.fileName, file.filePath, "document.bin"),
              bytes: file.bytes,
              mimeType: descriptor.mimeType ?? file.mimeType ?? null,
            },
            failedAttachment: null,
          };
        }

        const file = await downloadTelegramFile(descriptor.fileId);
        const name = resolveAttachmentName(undefined, file.filePath, descriptor.fallbackName);

        return {
          attachment: {
            kind: "photo" as const,
            name,
            variants: [
              {
                name,
                width: descriptor.width,
                height: descriptor.height,
                bytes: file.bytes,
                mimeType: file.mimeType ?? "image/jpeg",
              },
            ],
          },
          failedAttachment: null,
        };
      } catch (error) {
        return {
          attachment: null,
          failedAttachment: {
            name:
              descriptor.kind === "document"
                ? resolveAttachmentName(
                    descriptor.fileName,
                    descriptor.fileName ?? "",
                    "document.bin",
                  )
                : resolveAttachmentName(undefined, descriptor.fallbackName, "photo.jpg"),
            reason: getErrorMessage(error),
          },
        };
      }
    }),
  );

  const attachments: TelegramMessageAttachmentInput[] = [];
  const failedAttachments: TelegramFailedAttachment[] = [];

  for (const [index, entry] of resolvedEntries.entries()) {
    const attachmentIndex = index + 1;

    if (entry.attachment) {
      attachments.push({
        ...entry.attachment,
        index: attachmentIndex,
      });
    }

    if (entry.failedAttachment) {
      failedAttachments.push({
        ...entry.failedAttachment,
        index: attachmentIndex,
      });
    }
  }

  return {
    chatId: bundle.chatId,
    messageId: bundle.messageId,
    mediaGroupId: bundle.mediaGroupId,
    caption: bundle.caption,
    attachments,
    failedAttachments,
  };
}

function resolveAttachmentName(
  preferredName: string | undefined,
  filePath: string,
  fallbackName: string,
): string {
  const basename = path.posix.basename(filePath.replaceAll("\\", "/"));
  return preferredName?.trim() || basename || fallbackName;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pickLargestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize | null {
  if (photos.length === 0) {
    return null;
  }

  return photos.reduce((largest, current) =>
    current.width * current.height > largest.width * largest.height ? current : largest,
  );
}

class AttachmentPreparationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AttachmentPreparationError";
  }
}

type TelegramDocumentMessage = {
  message_id: number;
  media_group_id?: string;
  caption?: string;
  document: {
    file_id: string;
    file_name?: string;
    mime_type?: string | null;
  };
};

type TelegramPhotoSize = {
  file_id: string;
  width: number;
  height: number;
};

type TelegramPhotoMessage = {
  message_id: number;
  media_group_id?: string;
  caption?: string;
  photo: TelegramPhotoSize[];
};
