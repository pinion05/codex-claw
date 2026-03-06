import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgentRuntime } from "../../src/runtime/agent-runtime";
import { createRunLogger } from "../../src/runtime/logging";
import { FileSessionStore } from "../../src/session/session-store";

describe("createAgentRuntime control flow", () => {
  test("blocks reset while a run is active and aborts through the shared signal", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-controls-"));
    const store = new FileSessionStore(workspaceDir);
    let observedSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const codex = {
      runTurn: mock(
        async ({ signal }: { signal?: AbortSignal }) =>
          await new Promise<{
            threadId: string;
            summary: string;
            touchedPaths: string[];
          }>((_, reject) => {
            observedSignal = signal;
            markStarted();

            signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("Run aborted.");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      ),
    };
    const runtime = createAgentRuntime({
      store,
      codex,
      logger: createRunLogger(workspaceDir),
    });

    try {
      const runPromise = runtime.runTurn(123n, "long task");
      await started;

      expect(await runtime.resetSession(123n)).toEqual({
        ok: false,
        reason: "running",
      });

      expect(await runtime.abortRun(123n)).toEqual({
        ok: true,
        alreadyRequested: false,
      });
      expect(observedSignal?.aborted).toBe(true);

      expect(await runtime.abortRun(123n)).toEqual({
        ok: true,
        alreadyRequested: true,
      });

      await expect(runPromise).rejects.toThrow("Run aborted.");
      expect(await runtime.resetSession(123n)).toEqual({ ok: true });
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("recovers a stale persisted running state when no in-memory run exists", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-stale-run-"));
    const store = new FileSessionStore(workspaceDir);
    const codex = {
      runTurn: mock(async () => ({
        threadId: "thread_recovered",
        summary: "done after recovery",
        touchedPaths: [],
      })),
    };
    const runtime = createAgentRuntime({
      store,
      codex,
      logger: createRunLogger(workspaceDir),
    });

    try {
      await store.save({
        chatId: "123",
        threadId: "thread_1",
        isRunning: true,
        lastStartedAt: "2026-03-07T00:00:00.000Z",
        lastCompletedAt: "2026-03-06T23:59:00.000Z",
        lastSummary: "previous summary",
        logFile: null,
      });

      expect(await runtime.abortRun(123n)).toEqual({
        ok: true,
        alreadyRequested: false,
        recoveredStale: true,
      });

      expect(await runtime.getSession(123n)).toMatchObject({
        chatId: "123",
        threadId: "thread_1",
        isRunning: false,
        lastSummary: "previous summary",
      });

      expect(await runtime.resetSession(123n)).toEqual({ ok: true });

      await expect(runtime.runTurn(123n, "hello again")).resolves.toMatchObject({
        threadId: "thread_recovered",
        summary: "done after recovery",
      });
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
