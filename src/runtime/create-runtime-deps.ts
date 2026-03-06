import type { CreateBotHandlersDeps } from "../bot/create-bot";
import { formatStatusMessage } from "../bot/formatters";
import type { AppConfig } from "../config";
import { createSdkRuntimeClient } from "../codex/sdk-runtime-client";
import { FileSessionStore } from "../session/session-store";
import { createAgentRuntime } from "./agent-runtime";
import { createRunLogger } from "./logging";

export function createRuntimeDeps(config: AppConfig): CreateBotHandlersDeps {
  const store = new FileSessionStore(config.workspaceDir);
  const codex = createSdkRuntimeClient(config.openAiApiKey, config.workspaceDir);
  const logger = createRunLogger(config.workspaceDir);
  const runtime = createAgentRuntime({
    store,
    codex,
    logger,
  });

  return {
    getStatusMessage: async (chatId) => formatStatusMessage(await runtime.getSession(chatId)),
    resetSession: async (chatId) => runtime.resetSession(chatId),
    abortRun: async (chatId) => runtime.abortRun(chatId),
    runTurn: async (chatId, prompt) => runtime.runTurn(chatId, prompt),
  };
}
