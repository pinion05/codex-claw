import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileSessionStore } from "../../src/session/session-store";
import { createRunLogger } from "../../src/runtime/logging";
import { runAgentTurn } from "../../src/runtime/run-agent-turn";

describe("runAgentTurn", () => {
  test("persists session state and writes a dated JSON log on success", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-run-agent-turn-"));
    const codex = {
      runTurn: mock(async () => ({
        threadId: "thread_1",
        summary: "done",
        touchedPaths: ["/tmp/demo.txt"],
      })),
    };

    try {
      const store = new FileSessionStore(workspaceDir);
      const result = await runAgentTurn({
        chatId: 123n,
        prompt: "do the thing",
        store,
        codex,
        logger: createRunLogger(workspaceDir),
      });
      const session = await store.getOrCreate(123n);
      const completedAt = new Date(session.lastCompletedAt!);
      const expectedLogDir = path.join(
        workspaceDir,
        "logs",
        completedAt.getUTCFullYear().toString().padStart(4, "0"),
        (completedAt.getUTCMonth() + 1).toString().padStart(2, "0"),
        completedAt.getUTCDate().toString().padStart(2, "0"),
      );
      const logFile = result.logFile;
      const logEntry = JSON.parse(readFileSync(logFile, "utf8")) as Record<string, unknown>;

      expect(result.summary).toBe("done");
      expect(path.dirname(logFile)).toBe(expectedLogDir);
      expect(path.basename(logFile)).not.toContain(":");
      expect(session).toMatchObject({
        chatId: "123",
        threadId: "thread_1",
        isRunning: false,
        lastSummary: "done",
        logFile,
      });
      expect(logEntry).toMatchObject({
        chatId: "123",
        prompt: "do the thing",
        threadId: "thread_1",
        summary: "done",
        touchedPaths: ["/tmp/demo.txt"],
        status: "completed",
        error: null,
      });
      expect(logEntry.completedAt).toBe(session.lastCompletedAt);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("rejects when the session is already running", async () => {
    const store = {
      getOrCreate: mock(async () => ({
        chatId: "123",
        threadId: "thread_1",
        isRunning: true,
        lastStartedAt: "2026-03-07T00:00:00.000Z",
        lastCompletedAt: null,
        lastSummary: null,
        logFile: null,
      })),
      save: mock(async () => undefined),
    };
    const codex = {
      runTurn: mock(async () => ({
        threadId: "thread_2",
        summary: "done",
        touchedPaths: [],
      })),
    };
    const writeRunLog = mock(async () => "/tmp/log.json");

    await expect(
      runAgentTurn({
        chatId: 123n,
        prompt: "do the thing",
        store,
        codex,
        logger: { writeRunLog },
      }),
    ).rejects.toThrow("Session for chat 123 is already running");

    expect(store.save).not.toHaveBeenCalled();
    expect(codex.runTurn).not.toHaveBeenCalled();
    expect(writeRunLog).not.toHaveBeenCalled();
  });

  test("rejects a second in-process turn for the same chat while the first is running", async () => {
    let releaseFirstTurn!: () => void;
    const firstTurnStarted = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    let continueFirstTurn!: () => void;
    const firstTurnCanFinish = new Promise<void>((resolve) => {
      continueFirstTurn = resolve;
    });
    const store = {
      getOrCreate: mock(async () => ({
        chatId: "123",
        threadId: null,
        isRunning: false,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastSummary: null,
        logFile: null,
      })),
      save: mock(async () => undefined),
    };
    let codexCalls = 0;
    const codex = {
      runTurn: mock(async () => {
        codexCalls += 1;

        if (codexCalls > 1) {
          throw new Error("second codex call should not happen");
        }

        releaseFirstTurn();
        await firstTurnCanFinish;

        return {
          threadId: "thread_1",
          summary: "done",
          touchedPaths: [],
        };
      }),
    };
    const logger = { writeRunLog: mock(async () => "/tmp/log.json") };

    const firstTurn = runAgentTurn({
      chatId: 123n,
      prompt: "do the thing",
      store,
      codex,
      logger,
    });
    await firstTurnStarted;

    await expect(
      runAgentTurn({
        chatId: 123n,
        prompt: "do the thing again",
        store,
        codex,
        logger,
      }),
    ).rejects.toThrow("Session for chat 123 is already running");

    continueFirstTurn();

    await expect(firstTurn).resolves.toMatchObject({
      threadId: "thread_1",
      summary: "done",
    });
    expect(codex.runTurn).toHaveBeenCalledTimes(1);
  });

  test("clears running state and rethrows when codex fails", async () => {
    const saved: unknown[] = [];
    const store = {
      getOrCreate: mock(async () => ({
        chatId: "123",
        threadId: "thread_1",
        isRunning: false,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastSummary: "previous",
        logFile: null,
      })),
      save: mock(async (value) => {
        saved.push(value);
      }),
    };
    const codex = {
      runTurn: mock(async () => {
        throw new Error("codex failed");
      }),
    };
    const writeRunLog = mock(async () => "/tmp/failure.json");

    await expect(
      runAgentTurn({
        chatId: 123n,
        prompt: "do the thing",
        store,
        codex,
        logger: { writeRunLog },
      }),
    ).rejects.toThrow("codex failed");

    expect(saved.length).toBe(2);
    expect(saved[1]).toMatchObject({
      chatId: "123",
      threadId: "thread_1",
      isRunning: false,
      lastSummary: "previous",
      logFile: "/tmp/failure.json",
    });
    expect(writeRunLog).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "123",
        threadId: "thread_1",
        status: "failed",
        error: { message: "codex failed" },
      }),
    );
  });

  test("persists a recovered thread id when the first turn fails after thread creation", async () => {
    const saved: unknown[] = [];
    const store = {
      getOrCreate: mock(async () => ({
        chatId: "123",
        threadId: null,
        isRunning: false,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastSummary: null,
        logFile: null,
      })),
      save: mock(async (value) => {
        saved.push(value);
      }),
    };
    const codex = {
      runTurn: mock(async () => {
        const error = new Error("codex failed");
        (error as Error & { threadId?: string }).threadId = "thread_recovered";
        throw error;
      }),
    };
    const writeRunLog = mock(async () => "/tmp/failure.json");

    await expect(
      runAgentTurn({
        chatId: 123n,
        prompt: "do the thing",
        store,
        codex,
        logger: { writeRunLog },
      }),
    ).rejects.toThrow("codex failed");

    expect(saved[saved.length - 1]).toMatchObject({
      chatId: "123",
      threadId: "thread_recovered",
      isRunning: false,
      logFile: "/tmp/failure.json",
    });
    expect(writeRunLog).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread_recovered",
      }),
    );
  });

  test("clears running state and rethrows when log writing fails after codex succeeds", async () => {
    const saved: unknown[] = [];
    const store = {
      getOrCreate: mock(async () => ({
        chatId: "123",
        threadId: null,
        isRunning: false,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastSummary: null,
        logFile: null,
      })),
      save: mock(async (value) => {
        saved.push(value);
      }),
    };
    const codex = {
      runTurn: mock(async () => ({
        threadId: "thread_1",
        summary: "done",
        touchedPaths: ["/tmp/demo.txt"],
      })),
    };
    const writeRunLog = mock(async () => {
      throw new Error("log failed");
    });

    await expect(
      runAgentTurn({
        chatId: 123n,
        prompt: "do the thing",
        store,
        codex,
        logger: { writeRunLog },
      }),
    ).rejects.toThrow("log failed");

    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(saved[saved.length - 1]).toMatchObject({
      chatId: "123",
      threadId: "thread_1",
      isRunning: false,
      lastSummary: "done",
      logFile: null,
    });
  });

  test("clears running state and rethrows when saving log metadata fails after codex succeeds", async () => {
    const saved: unknown[] = [];
    let saveCalls = 0;
    const store = {
      getOrCreate: mock(async () => ({
        chatId: "123",
        threadId: null,
        isRunning: false,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastSummary: null,
        logFile: null,
      })),
      save: mock(async (value) => {
        saveCalls += 1;
        saved.push(value);

        if (saveCalls === 3) {
          throw new Error("save failed");
        }
      }),
    };
    const codex = {
      runTurn: mock(async () => ({
        threadId: "thread_1",
        summary: "done",
        touchedPaths: ["/tmp/demo.txt"],
      })),
    };
    const writeRunLog = mock(async () => "/tmp/log.json");

    await expect(
      runAgentTurn({
        chatId: 123n,
        prompt: "do the thing",
        store,
        codex,
        logger: { writeRunLog },
      }),
    ).rejects.toThrow("save failed");

    expect(saved.length).toBeGreaterThanOrEqual(4);
    expect(saved[saved.length - 1]).toMatchObject({
      chatId: "123",
      threadId: "thread_1",
      isRunning: false,
      lastSummary: "done",
      logFile: "/tmp/log.json",
    });
  });
});
