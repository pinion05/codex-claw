import type { Bot, Context } from "grammy";
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

export type BotPromptInput = {
  chatId: bigint;
  prompt: string;
  startTyping?: StartTyping;
  reply: Reply;
};

export type BotTextInput = {
  chatId: bigint;
  text: string;
  startTyping?: StartTyping;
  reply: Reply;
};

export type BotDocumentReceiveInput = {
  caption: string | null;
  chatId: bigint;
  document: {
    fileId: string;
    fileName: string | null;
    fileSize: number | null;
    mimeType: string | null;
  };
  getFile: () => Promise<{ file_path?: string | null }>;
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
};

export function createBotHandlers(deps: CreateBotHandlersDeps) {
  return {
    async onPrompt({ chatId, prompt, startTyping, reply }: BotPromptInput): Promise<void> {
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
      } finally {
        await stopTypingOnce();
      }
    },
    async onText({ chatId, text, startTyping, reply }: BotTextInput): Promise<void> {
      const command = parseCommand(text);

      if (command) {
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
        } finally {
          await stopTypingOnce();
        }
      }

      await this.onPrompt({
        chatId,
        prompt: text,
        startTyping,
        reply,
      });
    },
  };
}

export function registerBotHandlers(
  bot: Bot<Context>,
  deps: CreateBotHandlersDeps,
  options: {
    receiveIncomingDocument?: (
      input: BotDocumentReceiveInput,
    ) => Promise<{
      prompt: string;
    }>;
  } = {},
) {
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

  bot.on("message:document", async (ctx) => {
    const chatId = BigInt(String(ctx.chat.id));

    if (!options.receiveIncomingDocument) {
      await ctx.reply("Document uploads are not configured.");
      return;
    }

    try {
      const receivedDocument = await options.receiveIncomingDocument({
        chatId,
        caption: ctx.message.caption ?? null,
        document: {
          fileId: ctx.message.document.file_id,
          fileName: ctx.message.document.file_name ?? null,
          fileSize: ctx.message.document.file_size ?? null,
          mimeType: ctx.message.document.mime_type ?? null,
        },
        getFile: async () => ctx.getFile(),
      });

      await handlers.onPrompt({
        chatId,
        prompt: receivedDocument.prompt,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Could not receive the document: ${message}`);
    }
  });

  return handlers;
}

function buildHelpMessage(): string {
  return [
    "Send a prompt to run Codex.",
    "You can also upload a Telegram document to save it into the workspace inbox and pass it to Codex.",
    "Available commands: /status /reset /abort /help",
  ].join("\n");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
