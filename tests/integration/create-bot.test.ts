import { describe, expect, mock, test } from "bun:test";
import { createBotHandlers, registerBotHandlers } from "../../src/bot/create-bot";

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

  test("stops typing before sending the reply message", async () => {
    const events: string[] = [];
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn: mock(async () => ({ summary: "done" })),
    });

    await handlers.onText({
      chatId: 123n,
      text: "hello",
      startTyping: async () => {
        events.push("start");

        return async () => {
          events.push("stop");
        };
      },
      reply: async (value: string) => {
        events.push(`reply:${value}`);
      },
    });

    expect(events).toEqual(["start", "stop", "reply:done"]);
  });

  test("runs a synthesized prompt directly through the shared prompt path", async () => {
    const replies: string[] = [];
    const runTurn = mock(async (_chatId: bigint, prompt: string) => ({ summary: prompt }));
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
    });

    await handlers.onPrompt({
      chatId: 123n,
      prompt: "document prompt",
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(runTurn).toHaveBeenCalledWith(123n, "document prompt");
    expect(replies[0]).toContain("document prompt");
  });

  test("registers document uploads and forwards the synthesized prompt to the runtime", async () => {
    const replies: string[] = [];
    const handlers = {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn: mock(async () => ({ summary: "done" })),
    };
    const receiveIncomingDocument = mock(async () => ({
      prompt: "document prompt",
    }));
    const listeners = new Map<string, (ctx: any) => Promise<void>>();
    const bot = {
      on(filter: string, handler: (ctx: any) => Promise<void>) {
        listeners.set(filter, handler);
        return this;
      },
    };

    registerBotHandlers(bot as never, handlers, {
      receiveIncomingDocument,
    });

    await listeners.get("message:document")?.({
      chat: { id: 123 },
      message: {
        caption: "summarize this",
        document: {
          file_id: "file_1",
          file_name: "report.pdf",
          file_size: 12,
          mime_type: "application/pdf",
        },
      },
      getFile: async () => ({
        file_path: "documents/file_1.pdf",
      }),
      replyWithChatAction: async () => undefined,
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(receiveIncomingDocument).toHaveBeenCalledWith({
      chatId: 123n,
      caption: "summarize this",
      document: {
        fileId: "file_1",
        fileName: "report.pdf",
        fileSize: 12,
        mimeType: "application/pdf",
      },
      getFile: expect.any(Function),
    });
    expect(handlers.runTurn).toHaveBeenCalledWith(123n, "document prompt");
    expect(replies[0]).toContain("done");
  });
});
