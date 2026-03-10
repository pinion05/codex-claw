import type { CreateBotHandlersDeps } from "../bot/create-bot";
import type { TelegramMessageBundle } from "../files/telegram-message-bundle";
import {
  composeTelegramMessageBundlePrompt,
  sanitizeTelegramAttachmentName,
  saveTelegramMessageBundle,
  writeTelegramMessageBundleJson,
} from "../files/telegram-message-bundle";
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
  reason?: string;
  chatId?: bigint | null;
  threadId?: string | null;
  error?: string | null;
};

type CronRuntimeWiringArgs = Parameters<typeof createCronRuntime>[0] & {
  resolveCronTargetChatId: () => Promise<bigint | null>;
  isInteractiveRunActive: () => Promise<boolean>;
  deliverCronResult?: SendTelegramMessage;
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
  const readCronTargetSession = async () => {
    try {
      return await store.readCurrentSession();
    } catch {
      return null;
    }
  };
  const parseCronTargetChatId = (chatId: string): bigint | null => {
    try {
      return BigInt(chatId);
    } catch {
      return null;
    }
  };
  const cronRuntimeArgs: CronRuntimeWiringArgs = {
    codexClawHomeDir: resolveCodexClawHomeDir(),
    workspaceDir: config.workspaceDir,
    codex,
    resolveCronTargetChatId: async () => {
      const session = await readCronTargetSession();

      if (!session) {
        return null;
      }

      return parseCronTargetChatId(session.chatId);
    },
    isInteractiveRunActive: async () => {
      const session = await readCronTargetSession();

      if (!session) {
        return false;
      }

      const chatId = parseCronTargetChatId(session.chatId);

      if (chatId === null) {
        return false;
      }

      return (await runtime.getSession(chatId)).isRunning;
    },
    logCronExecution: async (event) => {
      await logger.writeCronLog?.(event);
    },
    ...(integrations.sendTelegramMessage
      ? {
          deliverCronResult: async (chatId, text) => {
            await integrations.sendTelegramMessage?.(chatId, text);
          },
        }
      : {}),
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
  const prepareAttachmentPrompt: NonNullable<CreateBotHandlersDeps["prepareAttachmentPrompt"]> =
    async (input) => {
      const savedBundle = await saveTelegramMessageBundle({
        workspaceDir: config.workspaceDir,
        chatId: input.chatId,
        messageId: input.messageId,
        caption: input.caption,
        attachments: input.attachments,
      });
      const failedAttachments = [
        ...savedBundle.bundle.failedAttachments,
        ...input.failedAttachments.map((attachment) => ({
          ...attachment,
          name: sanitizeTelegramAttachmentName(attachment.name, "attachment"),
        })),
      ];
      const mergedBundle: TelegramMessageBundle =
        failedAttachments.length === savedBundle.bundle.failedAttachments.length
          ? savedBundle.bundle
          : {
              ...savedBundle.bundle,
              failedAttachments,
            };

      if (mergedBundle !== savedBundle.bundle) {
        await writeTelegramMessageBundleJson(savedBundle.bundleJsonPath, mergedBundle);
      }

      return {
        prompt: composeTelegramMessageBundlePrompt(mergedBundle),
      };
    };

  return {
    getStatusMessage: async (chatId) => formatStatusMessage(await runtime.getSession(chatId)),
    resetSession: async (chatId) => runtime.resetSession(chatId),
    abortRun: async (chatId) => runtime.abortRun(chatId),
    prepareAttachmentPrompt,
    runTurn: async (chatId, prompt) => runtime.runTurn(chatId, prompt),
    startBackgroundServices: startCronRuntime,
    stopBackgroundServices: stopCronRuntime,
    startCronRuntime,
    stopCronRuntime,
  };
}
