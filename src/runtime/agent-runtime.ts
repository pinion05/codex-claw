import type { CodexRunRequest, CodexRunResult } from "../codex/codex-types";
import type { AgentSession } from "../session/session-types";
import type { RunLogger } from "./logging";
import { runAgentTurn, type RunAgentTurnResult } from "./run-agent-turn";

type SessionStore = {
  getOrCreate: (chatId: bigint) => Promise<AgentSession>;
  save: (session: AgentSession) => Promise<void>;
  reset: (chatId: bigint) => Promise<void>;
};

type CodexClient = {
  runTurn: (request: CodexRunRequest) => Promise<CodexRunResult>;
};

export type ResetSessionResult = { ok: true } | { ok: false; reason: "running" };

export type AbortRunResult =
  | { ok: true; alreadyRequested: boolean; recoveredStale?: boolean }
  | { ok: false; reason: "not-running" };

type CreateAgentRuntimeArgs = {
  store: SessionStore;
  codex: CodexClient;
  logger: RunLogger;
};

export function createAgentRuntime({ store, codex, logger }: CreateAgentRuntimeArgs) {
  const activeRuns = new Map<string, AbortController>();

  async function recoverStaleSession(
    chatId: bigint,
    options?: { ignoreActiveRun?: boolean },
  ): Promise<{ session: AgentSession; recovered: boolean }> {
    const chatKey = chatId.toString();
    const session = await store.getOrCreate(chatId);

    if (!session.isRunning) {
      return { session, recovered: false };
    }

    if (activeRuns.has(chatKey) && !options?.ignoreActiveRun) {
      return { session, recovered: false };
    }

    const recoveredSession: AgentSession = {
      ...session,
      isRunning: false,
    };

    await store.save(recoveredSession);
    return { session: recoveredSession, recovered: true };
  }

  return {
    async getSession(chatId: bigint): Promise<AgentSession> {
      return (await recoverStaleSession(chatId)).session;
    },
    async runTurn(chatId: bigint, prompt: string): Promise<RunAgentTurnResult> {
      const chatKey = chatId.toString();

      if (activeRuns.has(chatKey)) {
        throw new Error(`Session for chat ${chatKey} is already running`);
      }

      const controller = new AbortController();
      activeRuns.set(chatKey, controller);

      try {
        await recoverStaleSession(chatId, { ignoreActiveRun: true });

        return await runAgentTurn({
          chatId,
          prompt,
          store,
          codex,
          logger,
          signal: controller.signal,
        });
      } finally {
        if (activeRuns.get(chatKey) === controller) {
          activeRuns.delete(chatKey);
        }
      }
    },
    async resetSession(chatId: bigint): Promise<ResetSessionResult> {
      const chatKey = chatId.toString();

      if (activeRuns.has(chatKey)) {
        return { ok: false, reason: "running" };
      }

      const session = (await recoverStaleSession(chatId)).session;

      if (session.isRunning) {
        return { ok: false, reason: "running" };
      }

      await store.reset(chatId);
      return { ok: true };
    },
    async abortRun(chatId: bigint): Promise<AbortRunResult> {
      const chatKey = chatId.toString();
      const controller = activeRuns.get(chatKey);

      if (!controller) {
        const { recovered } = await recoverStaleSession(chatId);

        if (recovered) {
          return {
            ok: true,
            alreadyRequested: false,
            recoveredStale: true,
          };
        }

        return { ok: false, reason: "not-running" };
      }

      const alreadyRequested = controller.signal.aborted;

      if (!alreadyRequested) {
        controller.abort();
      }

      return {
        ok: true,
        alreadyRequested,
      };
    },
  };
}
