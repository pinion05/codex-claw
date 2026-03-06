import { describe, expect, mock, test } from "bun:test";
import { createBotHandlers } from "../../src/bot/create-bot";

describe("createBotHandlers", () => {
  test("routes /status to the formatter and normal text to the runtime", async () => {
    const replies: string[] = [];
    const stopTyping = mock(() => undefined);
    const startTyping = mock(async () => stopTyping);
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn: mock(async () => ({ summary: "done" })),
    });

    await handlers.onText({
      chatId: 123n,
      text: "/status",
      startTyping,
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    await handlers.onText({
      chatId: 123n,
      text: "hello",
      startTyping,
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(replies[0]).toBe("idle");
    expect(replies[1]).toContain("done");
    expect(startTyping).toHaveBeenCalledTimes(2);
    expect(stopTyping).toHaveBeenCalledTimes(2);
  });

  test("formats control commands with explicit feedback", async () => {
    const replies: string[] = [];
    const resetSession = mock(async () => ({ ok: false as const, reason: "running" as const }));
    const abortRun = mock(async () => ({ ok: true as const, alreadyRequested: false }));
    const runTurn = mock(async () => ({ summary: "done" }));
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession,
      abortRun,
      runTurn,
    });

    await handlers.onText({
      chatId: 123n,
      text: "/reset",
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    await handlers.onText({
      chatId: 123n,
      text: "/abort",
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(replies[0]).toContain("use /abort first");
    expect(replies[1]).toContain("Abort requested");
    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(abortRun).toHaveBeenCalledTimes(1);
    expect(runTurn).not.toHaveBeenCalled();
  });

  test("reports when /abort recovers a stale persisted run state", async () => {
    const replies: string[] = [];
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(
        async () =>
          ({
            ok: true as const,
            alreadyRequested: false as const,
            recoveredStale: true as const,
          }),
      ),
      runTurn: mock(async () => ({ summary: "done" })),
    });

    await handlers.onText({
      chatId: 123n,
      text: "/abort",
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(replies).toEqual(["Recovered stale running state. No live run was active."]);
  });

  test("help advertises the available control commands", async () => {
    const replies: string[] = [];
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn: mock(async () => ({ summary: "done" })),
    });

    await handlers.onText({
      chatId: 123n,
      text: "/help",
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(replies[0]).toContain("/status");
    expect(replies[0]).toContain("/reset");
    expect(replies[0]).toContain("/abort");
  });

  test("replies with an explicit aborted message when the runtime aborts", async () => {
    const replies: string[] = [];
    const stopTyping = mock(() => undefined);
    const startTyping = mock(async () => stopTyping);
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: true as const, alreadyRequested: false })),
      runTurn: mock(async () => {
        const error = new Error("Run aborted.");
        error.name = "AbortError";
        throw error;
      }),
    });

    await handlers.onText({
      chatId: 123n,
      text: "hello",
      startTyping,
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(replies).toEqual(["Run aborted."]);
    expect(startTyping).toHaveBeenCalledTimes(1);
    expect(stopTyping).toHaveBeenCalledTimes(1);
  });
});
