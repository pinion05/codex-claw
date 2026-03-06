import { describe, expect, mock, test } from "bun:test";
import { createBotHandlers } from "../../src/bot/create-bot";

describe("createBotHandlers", () => {
  test("routes /status to the formatter and normal text to the runtime", async () => {
    const replies: string[] = [];
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => {}),
      abortRun: mock(async () => {}),
      runTurn: mock(async () => ({ summary: "done" })),
    });

    await handlers.onText({
      chatId: 123n,
      text: "/status",
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    await handlers.onText({
      chatId: 123n,
      text: "hello",
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(replies[0]).toBe("idle");
    expect(replies[1]).toContain("done");
  });

  test("keeps control commands unavailable until task 8", async () => {
    const replies: string[] = [];
    const resetSession = mock(async () => {});
    const abortRun = mock(async () => ({ ok: true }));
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

    expect(replies[0].toLowerCase()).toContain("not available");
    expect(replies[1].toLowerCase()).toContain("not available");
    expect(resetSession).not.toHaveBeenCalled();
    expect(abortRun).not.toHaveBeenCalled();
    expect(runTurn).not.toHaveBeenCalled();
  });

  test("help only advertises commands that are ready", async () => {
    const replies: string[] = [];
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => {}),
      abortRun: mock(async () => {}),
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
    expect(replies[0]).not.toContain("/reset");
    expect(replies[0]).not.toContain("/abort");
  });
});
