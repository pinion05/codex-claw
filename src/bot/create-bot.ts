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
  resetSession?: (chatId: bigint) => Promise<void>;
  abortRun?: (chatId: bigint) => Promise<AbortRunResult>;
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
          case "abort": {
            await reply(buildUnavailableCommandMessage(command.name));
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
  return ["Send a prompt to run Codex.", "Available commands: /status /help"].join("\n");
}

function buildUnavailableCommandMessage(commandName: "reset" | "abort"): string {
  return `/${commandName} is not available yet. Use /status while agent control commands are still being wired.`;
}
