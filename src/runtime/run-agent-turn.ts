import { getThreadIdFromError } from "../codex/codex-client";
import type { CodexRunRequest, CodexRunResult } from "../codex/codex-types";
import type { AgentSession } from "../session/session-types";
import type { RunLogger } from "./logging";

const runningChats = new Set<string>();

type SessionStore = {
  getOrCreate: (chatId: bigint) => Promise<AgentSession>;
  save: (session: AgentSession) => Promise<void>;
};

type CodexClient = {
  runTurn: (request: CodexRunRequest) => Promise<CodexRunResult>;
};

export type RunAgentTurnArgs = {
  chatId: bigint;
  prompt: string;
  store: SessionStore;
  codex: CodexClient;
  logger: RunLogger;
  signal?: AbortSignal;
};

export type RunAgentTurnResult = CodexRunResult & {
  logFile: string;
};

export async function runAgentTurn({
  chatId,
  prompt,
  store,
  codex,
  logger,
  signal,
}: RunAgentTurnArgs): Promise<RunAgentTurnResult> {
  const chatKey = chatId.toString();

  if (runningChats.has(chatKey)) {
    throw new Error(`Session for chat ${chatKey} is already running`);
  }

  runningChats.add(chatKey);

  try {
    const session = await store.getOrCreate(chatId);
    if (session.isRunning) {
      throw new Error(`Session for chat ${session.chatId} is already running`);
    }

    const startedAt = new Date().toISOString();
    const runningSession: AgentSession = {
      ...session,
      isRunning: true,
      lastStartedAt: startedAt,
    };

    await store.save(runningSession);

    let result: CodexRunResult;

    try {
      result = await codex.runTurn({
        threadId: session.threadId,
        prompt,
        signal,
      });
    } catch (error) {
      const completedAt = new Date().toISOString();
      const recoveredThreadId = getThreadIdFromError(error) ?? session.threadId;
      let logFile = runningSession.logFile;

      try {
        logFile = await logger.writeRunLog({
          chatId: session.chatId,
          prompt,
          threadId: recoveredThreadId,
          summary: null,
          touchedPaths: [],
          startedAt,
          completedAt,
          status: "failed",
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } catch {
        logFile = runningSession.logFile;
      }

      await store.save({
        ...runningSession,
        isRunning: false,
        threadId: recoveredThreadId,
        lastSummary: session.lastSummary,
        lastCompletedAt: completedAt,
        logFile,
      });

      throw error;
    }

    const completedAt = new Date().toISOString();
    const completedSession: AgentSession = {
      ...runningSession,
      isRunning: false,
      threadId: result.threadId,
      lastSummary: result.summary,
      lastCompletedAt: completedAt,
    };
    let logFile = completedSession.logFile;

    try {
      await store.save(completedSession);

      logFile = await logger.writeRunLog({
        chatId: session.chatId,
        prompt,
        threadId: result.threadId,
        summary: result.summary,
        touchedPaths: result.touchedPaths,
        startedAt,
        completedAt,
        status: "completed",
        error: null,
      });

      await store.save({
        ...completedSession,
        logFile,
      });

      return {
        ...result,
        logFile,
      };
    } catch (error) {
      await saveSessionBestEffort(store, {
        ...completedSession,
        logFile,
      });
      throw error;
    }
  } finally {
    runningChats.delete(chatKey);
  }
}

async function saveSessionBestEffort(store: SessionStore, session: AgentSession): Promise<void> {
  try {
    await store.save(session);
  } catch {
    // Cleanup must not hide the original error.
  }
}
