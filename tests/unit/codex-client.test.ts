import { describe, expect, mock, test } from "bun:test";
import { createCodexClient } from "../../src/codex/codex-client";

describe("createCodexClient", () => {
  test("starts a thread when no thread exists", async () => {
    const startThread = mock(() => Promise.resolve({ id: "thread_new" }));
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
    expect(runPrompt).toHaveBeenCalledWith(resumedThread, "continue");
    expect(result).toEqual({
      threadId: "thread_existing",
      summary: "continued",
      touchedPaths: ["src/codex/codex-client.ts"],
    });
  });
});
