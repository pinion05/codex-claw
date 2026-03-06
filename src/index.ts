import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Codex, type Thread, type ThreadItem, type ThreadOptions } from "@openai/codex-sdk";
import { Bot } from "grammy";
import { registerBotHandlers } from "./bot/create-bot";
import { formatStatusMessage } from "./bot/formatters";
import { loadConfig } from "./config";
import { createCodexClient } from "./codex/codex-client";
import { createRunLogger } from "./runtime/logging";
import { runAgentTurn } from "./runtime/run-agent-turn";
import { FileSessionStore } from "./session/session-store";

type RuntimeThread = {
  id: string;
  thread: Thread;
};

export async function main(): Promise<void> {
  const config = loadConfig();

  await ensureWorkspaceDirectories(config.workspaceDir);

  const store = new FileSessionStore(config.workspaceDir);
  const codex = createSdkCodexClient(config.openAiApiKey, config.workspaceDir);
  const logger = createRunLogger(config.workspaceDir);
  const bot = new Bot(config.telegramBotToken);

  registerBotHandlers(bot, {
    getStatusMessage: async (chatId) => formatStatusMessage(await store.getOrCreate(chatId)),
    resetSession: async (chatId) => {
      await store.reset(chatId);
    },
    abortRun: async () => ({
      ok: false,
      message: "Abort is not available for in-flight Codex turns yet. Use /reset after the current run finishes.",
    }),
    runTurn: async (chatId, prompt) =>
      runAgentTurn({
        chatId,
        prompt,
        store,
        codex,
        logger,
      }),
  });

  await bot.start();
}

async function ensureWorkspaceDirectories(workspaceDir: string): Promise<void> {
  await Promise.all(
    [workspaceDir, path.join(workspaceDir, "state"), path.join(workspaceDir, "logs")].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  );
}

function createSdkCodexClient(apiKey: string, workingDirectory: string) {
  const sdk = new Codex({ apiKey });
  const threadOptions: ThreadOptions = {
    approvalPolicy: "never",
    workingDirectory,
    skipGitRepoCheck: true,
  };

  return createCodexClient({
    startThread: async () => ({
      id: "",
      thread: sdk.startThread(threadOptions),
    }),
    resumeThread: async (threadId) => ({
      id: threadId,
      thread: sdk.resumeThread(threadId, threadOptions),
    }),
    runPrompt: async (thread, prompt) => {
      const runtimeThread = thread as RuntimeThread;
      const turn = await runtimeThread.thread.run(prompt);

      runtimeThread.id = runtimeThread.thread.id ?? runtimeThread.id;

      if (runtimeThread.id.length === 0) {
        throw new Error("Codex thread id was unavailable after the turn completed");
      }

      return {
        summary: turn.finalResponse,
        touchedPaths: collectTouchedPaths(turn.items),
      };
    },
  });
}

function collectTouchedPaths(items: ThreadItem[]): string[] {
  const touchedPaths = new Set<string>();

  for (const item of items) {
    if (item.type !== "file_change" || item.status !== "completed") {
      continue;
    }

    for (const change of item.changes) {
      touchedPaths.add(change.path);
    }
  }

  return [...touchedPaths];
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
