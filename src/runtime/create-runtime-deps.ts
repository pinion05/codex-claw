import { Bot } from "grammy";
import type { CreateBotHandlersDeps } from "../bot/create-bot";
import { formatStatusMessage } from "../bot/formatters";
import type { AppConfig } from "../config";
import { createSdkRuntimeClient } from "../codex/sdk-runtime-client";
import { FileSessionStore } from "../session/session-store";
import { createRunLogger } from "./logging";
import { runAgentTurn } from "./run-agent-turn";

export type RuntimeDeps = {
  bot: Bot;
  handlers: CreateBotHandlersDeps;
};

export function createRuntimeDeps(config: AppConfig): RuntimeDeps {
  const store = new FileSessionStore(config.workspaceDir);
  const codex = createSdkRuntimeClient(config.openAiApiKey, config.workspaceDir);
  const logger = createRunLogger(config.workspaceDir);
  const bot = new Bot(config.telegramBotToken);

  return {
    bot,
    handlers: {
      getStatusMessage: async (chatId) => formatStatusMessage(await store.getOrCreate(chatId)),
      runTurn: async (chatId, prompt) =>
        runAgentTurn({
          chatId,
          prompt,
          store,
          codex,
          logger,
        }),
    },
  };
}
