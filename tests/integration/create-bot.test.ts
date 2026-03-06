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
});
