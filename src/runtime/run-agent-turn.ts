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
};

export type RunAgentTurnResult = CodexRunResult & {
  logFile: string | null;
};

export async function runAgentTurn({
  chatId,
  prompt,
  store,
  codex,
  logger,
}: RunAgentTurnArgs): Promise<RunAgentTurnResult> {
  const chatKey = chatId.toString();

  if (runningChats.has(chatKey)) {
    throw new Error(`Session for chat ${chatKey} is already running`);
  }

  runningChats.add(chatKey);

  try {
    const session = await store.getOrCreate(chatId);
    let nextThreadId = session.threadId;
    let nextSummary = session.lastSummary;
    let logSummary: string | null = null;
    let touchedPaths: string[] = [];

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

    try {
      const result = await codex.runTurn({
        threadId: session.threadId,
        prompt,
      });
      nextThreadId = result.threadId;
      nextSummary = result.summary;
      logSummary = result.summary;
      touchedPaths = result.touchedPaths;
      const completedAt = new Date().toISOString();
      const completedSession: AgentSession = {
        ...runningSession,
        isRunning: false,
        threadId: result.threadId,
        lastSummary: result.summary,
        lastCompletedAt: completedAt,
      };

      await store.save(completedSession);

      let logFile = completedSession.logFile;

      try {
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

        try {
          await store.save({
            ...completedSession,
            logFile,
          });
        } catch {
          // Best-effort log file persistence must not fail the turn.
        }
      } catch {
        logFile = completedSession.logFile;
      }

      return {
        ...result,
        logFile,
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      let logFile = runningSession.logFile;

      try {
        logFile = await logger.writeRunLog({
          chatId: session.chatId,
          prompt,
          threadId: nextThreadId,
          summary: logSummary,
          touchedPaths,
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
        threadId: nextThreadId,
        lastSummary: nextSummary,
        lastCompletedAt: completedAt,
        logFile,
      });

      throw error;
    }
  } finally {
    runningChats.delete(chatKey);
  }
}
