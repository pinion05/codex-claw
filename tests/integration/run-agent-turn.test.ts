import { describe, expect, mock, test } from "bun:test";
import { runAgentTurn } from "../../src/runtime/run-agent-turn";

describe("runAgentTurn", () => {
  test("marks the session running, calls codex, then saves the summary", async () => {
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

    const result = await runAgentTurn({
      chatId: 123n,
      prompt: "do the thing",
      store,
      codex,
      logger: { writeRunLog: mock(async () => "/tmp/log.json") },
    });

    expect(result.summary).toBe("done");
    expect(saved.length).toBeGreaterThan(1);
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

  test("clears running state when log writing fails", async () => {
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

    expect(saved.length).toBe(2);
    expect(saved[1]).toMatchObject({
      chatId: "123",
      threadId: "thread_1",
      isRunning: false,
      lastSummary: "done",
      logFile: null,
    });
  });
});
