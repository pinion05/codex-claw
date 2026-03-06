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

export type BotTextInput = {
  chatId: bigint;
  text: string;
  startTyping?: StartTyping;
  reply: Reply;
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
    async onText({ chatId, text, startTyping, reply }: BotTextInput): Promise<void> {
      const stopTyping = await startTyping?.();

      try {
        const command = parseCommand(text);

        if (command) {
          switch (command.name) {
            case "start":
            case "help":
              await reply(buildHelpMessage());
              return;
            case "status":
              await reply(await deps.getStatusMessage(chatId));
              return;
            case "reset":
              await reply(formatResetMessage(await deps.resetSession(chatId)));
              return;
            case "abort": {
              await reply(formatAbortMessage(await deps.abortRun(chatId)));
              return;
            }
          }
        }

        try {
          const result = await deps.runTurn(chatId, text);
          await reply(formatRunCompletedMessage(result.summary ?? null));
        } catch (error) {
          if (isAbortError(error)) {
            await reply(formatRunAbortedMessage());
            return;
          }

          const message = error instanceof Error ? error.message : String(error);
          await reply(formatRunFailedMessage(message));
        }
      } finally {
        await stopTyping?.();
      }
    },
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

  return handlers;
}

function buildHelpMessage(): string {
  return ["Send a prompt to run Codex.", "Available commands: /status /reset /abort /help"].join(
    "\n",
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
