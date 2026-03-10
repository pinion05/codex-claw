import type { CreateBotHandlersDeps } from "../bot/create-bot";
import { formatStatusMessage } from "../bot/formatters";
import type { AppConfig } from "../config";
import { createCronRuntime } from "../cron/runtime";
import { createSdkRuntimeClient } from "../codex/sdk-runtime-client";
import { resolveCodexClawHomeDir } from "../lib/paths";
import { FileSessionStore } from "../session/session-store";
import { createAgentRuntime } from "./agent-runtime";
import { createRunLogger } from "./logging";

export type RuntimeDeps = CreateBotHandlersDeps & {
  startBackgroundServices: () => Promise<void>;
  stopBackgroundServices: () => void;
  startCronRuntime: () => Promise<void>;
  stopCronRuntime: () => void;
};

type SendTelegramMessage = (chatId: bigint, text: string) => Promise<void>;

type CronExecutionEvent = {
  jobId: string;
  phase: "execution" | "delivery" | "skip";
  status: "completed" | "failed" | "skipped";
  chatId?: bigint | null;
  threadId?: string | null;
  error?: string | null;
};

type CronRuntimeWiringArgs = Parameters<typeof createCronRuntime>[0] & {
  resolveCronTargetChatId: () => Promise<bigint | null>;
  isInteractiveRunActive: () => Promise<boolean>;
  deliverCronResult: SendTelegramMessage;
  logCronExecution: (event: CronExecutionEvent) => Promise<void> | void;
};

export function createRuntimeDeps(
  config: AppConfig,
  overrides: {
    createSdkRuntimeClientFn?: typeof createSdkRuntimeClient;
    createCronRuntimeFn?: typeof createCronRuntime;
  } = {},
  integrations: {
    sendTelegramMessage?: SendTelegramMessage;
  } = {},
): RuntimeDeps {
  const store = new FileSessionStore(config.workspaceDir);
  const codex = (overrides.createSdkRuntimeClientFn ?? createSdkRuntimeClient)(
    config.openAiApiKey,
    config.workspaceDir,
  );
  const logger = createRunLogger(config.workspaceDir);
  const runtime = createAgentRuntime({
    store,
    codex,
    logger,
  });
  const cronRuntimeArgs: CronRuntimeWiringArgs = {
    codexClawHomeDir: resolveCodexClawHomeDir(),
    workspaceDir: config.workspaceDir,
    codex,
    resolveCronTargetChatId: async () => {
      const session = await store.readCurrentSession();

      if (!session) {
        return null;
      }

      return BigInt(session.chatId);
    },
    isInteractiveRunActive: async () => (await store.readCurrentSession())?.isRunning ?? false,
    deliverCronResult: async (chatId, text) => {
      await integrations.sendTelegramMessage?.(chatId, text);
    },
    logCronExecution: async (_event) => undefined,
  };
  const cronRuntime = (overrides.createCronRuntimeFn ?? createCronRuntime)(cronRuntimeArgs);
  let cronStarted = false;

  const startCronRuntime = async () => {
    if (cronStarted) {
      return;
    }

    await cronRuntime.start();
    cronStarted = true;
  };

  const stopCronRuntime = () => {
    if (!cronStarted) {
      return;
    }

    cronRuntime.stop();
    cronStarted = false;
  };

  return {
    getStatusMessage: async (chatId) => formatStatusMessage(await runtime.getSession(chatId)),
    resetSession: async (chatId) => runtime.resetSession(chatId),
    abortRun: async (chatId) => runtime.abortRun(chatId),
    runTurn: async (chatId, prompt) => runtime.runTurn(chatId, prompt),
    startBackgroundServices: startCronRuntime,
    stopBackgroundServices: stopCronRuntime,
    startCronRuntime,
    stopCronRuntime,
  };
}
