import { describe, expect, mock, test } from "bun:test";
import { createCodexClient } from "../../src/codex/codex-client";

describe("createCodexClient", () => {
  test("starts a thread when no thread exists", async () => {
    const startedThread = { id: "thread_new" };
    const startThread = mock(() => Promise.resolve(startedThread));
    const runPrompt = mock(() =>
      Promise.resolve({ summary: "done", touchedPaths: [] }),
    );
    const client = createCodexClient({
      startThread,
      resumeThread: mock(),
      runPrompt,
    });

    const result = await client.runTurn({ threadId: null, prompt: "hello" });

    expect(startThread).toHaveBeenCalled();
    expect(runPrompt).toHaveBeenCalledWith(startedThread, "hello", {
      signal: undefined,
    });
    expect(result.threadId).toBe("thread_new");
  });

  test("resumes an existing thread when threadId is provided", async () => {
    const startThread = mock(() => Promise.resolve({ id: "thread_new" }));
    const resumedThread = { id: "thread_existing" };
    const resumeThread = mock(() => Promise.resolve(resumedThread));
    const runPrompt = mock(() =>
      Promise.resolve({
        summary: "continued",
        touchedPaths: ["src/codex/codex-client.ts"],
      }),
    );
    const client = createCodexClient({ startThread, resumeThread, runPrompt });

    const result = await client.runTurn({
      threadId: "thread_existing",
      prompt: "continue",
    });

    expect(startThread).not.toHaveBeenCalled();
    expect(resumeThread).toHaveBeenCalledWith("thread_existing");
    expect(runPrompt).toHaveBeenCalledWith(resumedThread, "continue", {
      signal: undefined,
    });
    expect(result).toEqual({
      threadId: "thread_existing",
      summary: "continued",
      touchedPaths: ["src/codex/codex-client.ts"],
    });
  });

  test("normalizes invalid sdk results into the internal result shape", async () => {
    const startThread = mock(() => Promise.resolve({ id: "thread_new" }));
    const runPrompt = mock(() =>
      Promise.resolve({
        summary: null,
        touchedPaths: ["src/codex/codex-client.ts", null, 42],
      }),
    );
    const client = createCodexClient({
      startThread,
      resumeThread: mock(),
      runPrompt,
    });

    const result = await client.runTurn({ threadId: null, prompt: "hello" });

    expect(result).toEqual({
      threadId: "thread_new",
      summary: "",
      touchedPaths: ["src/codex/codex-client.ts"],
    });
  });

  test("preserves a recovered thread id when a new thread fails after starting", async () => {
    const startedThread = { id: null as string | null };
    const runPrompt = mock(async (thread: { id: string | null }) => {
      thread.id = "thread_recovered";
      throw new Error("codex failed");
    });
    const client = createCodexClient({
      startThread: mock(() => Promise.resolve(startedThread)),
      resumeThread: mock(),
      runPrompt,
    });

    try {
      await client.runTurn({ threadId: null, prompt: "hello" });
      expect.unreachable("Expected runTurn to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error & { threadId?: string }).threadId).toBe("thread_recovered");
    }
  });

  test("marks aborted turns with AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createCodexClient({
      startThread: mock(() => Promise.resolve({ id: "thread_new" })),
      resumeThread: mock(),
      runPrompt: mock(async () => {
        throw new Error("child exited with signal SIGTERM");
      }),
    });

    try {
      await client.runTurn({
        threadId: null,
        prompt: "hello",
        signal: controller.signal,
      });
      expect.unreachable("Expected runTurn to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("AbortError");
      expect((error as Error).message).toBe("Run aborted.");
    }
  });
});
