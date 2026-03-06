import type { Bot, Context } from "grammy";
import { parseCommand } from "./commands";
import { formatRunCompletedMessage, formatRunFailedMessage } from "./formatters";

type Reply = (value: string) => Promise<void> | void;

export type BotTextInput = {
  chatId: bigint;
  text: string;
  reply: Reply;
};

export type AbortRunResult =
  | void
  | {
      ok: boolean;
      message?: string;
    };

export type CreateBotHandlersDeps = {
  getStatusMessage: (chatId: bigint) => Promise<string>;
  resetSession: (chatId: bigint) => Promise<void>;
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
    async onText({ chatId, text, reply }: BotTextInput): Promise<void> {
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
            await deps.resetSession(chatId);
            await reply("Session reset.");
            return;
          case "abort": {
            const result = await deps.abortRun(chatId);
            await reply(resolveAbortMessage(result));
            return;
          }
        }
      }

      try {
        const result = await deps.runTurn(chatId, text);
        await reply(formatRunCompletedMessage(result.summary ?? null));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await reply(formatRunFailedMessage(message));
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
      reply: async (value) => {
        await ctx.reply(value);
      },
    });
  });

  return handlers;
}

function buildHelpMessage(): string {
  return ["Send a prompt to run Codex.", "Commands: /status /reset /abort /help"].join("\n");
}

function resolveAbortMessage(result: AbortRunResult): string {
  if (result && typeof result === "object") {
    if (result.message && result.message.trim().length > 0) {
      return result.message;
    }

    return result.ok ? "Abort requested." : "Unable to abort the current run.";
  }

  return "Abort requested.";
}
