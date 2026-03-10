import { afterEach, describe, expect, mock, test } from "bun:test";
import { createBotHandlers, registerBotHandlers } from "../../src/bot/create-bot";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

  test("stops typing before replying on attachment success", async () => {
    const events: string[] = [];
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      prepareAttachmentPrompt: mock(async () => ({ prompt: "attachment prompt" })),
      runTurn: mock(async () => ({ summary: "done" })),
    });

    await handlers.onAttachmentMessage({
      chatId: 123n,
      messageId: 16,
      caption: "review attachment",
      attachments: [
        {
          kind: "document",
          name: "report.txt",
          download: async () => new TextEncoder().encode("body"),
        },
      ],
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

  test("document + caption triggers one runTurn with the prepared prompt", async () => {
    const replies: string[] = [];
    const prepareAttachmentPrompt = mock(
      async (_input: {
        chatId: number;
        messageId: number;
        caption?: string | null;
        attachments: unknown[];
        failedAttachments: unknown[];
      }) => ({ prompt: "document prompt" }),
    );
    const runTurn = mock(async (_chatId: bigint, _prompt: string) => ({ summary: "done" }));
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      prepareAttachmentPrompt,
      runTurn,
    });

    await handlers.onAttachmentMessage({
      chatId: 123n,
      messageId: 10,
      caption: "please review",
      attachments: [
        {
          kind: "document",
          name: "report.txt",
          mimeType: "text/plain",
          download: async () => new TextEncoder().encode("document body"),
        },
      ],
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(prepareAttachmentPrompt).toHaveBeenCalledTimes(1);
    expect(prepareAttachmentPrompt).toHaveBeenCalledWith({
      chatId: 123,
      messageId: 10,
      caption: "please review",
      attachments: [
        {
          kind: "document",
          name: "report.txt",
          mimeType: "text/plain",
          bytes: new TextEncoder().encode("document body"),
        },
      ],
      failedAttachments: [],
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "document prompt");
    expect(replies).toEqual(["done"]);
  });

  test("photo + caption triggers one runTurn with only the largest variant", async () => {
    const prepareAttachmentPrompt = mock(
      async (_input: {
        chatId: number;
        messageId: number;
        caption?: string | null;
        attachments: unknown[];
        failedAttachments: unknown[];
      }) => ({ prompt: "photo prompt" }),
    );
    const runTurn = mock(async (_chatId: bigint, _prompt: string) => ({ summary: "done" }));
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      prepareAttachmentPrompt,
      runTurn,
    });

    await handlers.onAttachmentMessage({
      chatId: 123n,
      messageId: 11,
      caption: "inspect photo",
      attachments: [
        {
          kind: "photo",
          name: "telegram-photo.jpg",
          variants: [
            {
              name: "small.jpg",
              width: 320,
              height: 200,
              mimeType: "image/jpeg",
              download: async () => new TextEncoder().encode("small"),
            },
            {
              name: "large.jpg",
              width: 1280,
              height: 720,
              mimeType: "image/jpeg",
              download: async () => new TextEncoder().encode("large"),
            },
          ],
        },
      ],
      reply: async () => undefined,
    });

    expect(prepareAttachmentPrompt).toHaveBeenCalledTimes(1);
    expect(prepareAttachmentPrompt).toHaveBeenCalledWith({
      chatId: 123,
      messageId: 11,
      caption: "inspect photo",
      attachments: [
        {
          kind: "photo",
          name: "telegram-photo.jpg",
          variants: [
            {
              name: "large.jpg",
              width: 1280,
              height: 720,
              mimeType: "image/jpeg",
              bytes: new TextEncoder().encode("large"),
            },
          ],
        },
      ],
      failedAttachments: [],
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "photo prompt");
  });

  test("calls runTurn even when partial attachment failure metadata is present", async () => {
    const prepareAttachmentPrompt = mock(
      async (_input: {
        chatId: number;
        messageId: number;
        caption?: string | null;
        attachments: unknown[];
        failedAttachments: { name: string; reason: string }[];
      }) => ({ prompt: "mixed prompt" }),
    );
    const runTurn = mock(async (_chatId: bigint, _prompt: string) => ({ summary: "done" }));
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      prepareAttachmentPrompt,
      runTurn,
    });

    await handlers.onAttachmentMessage({
      chatId: 123n,
      messageId: 12,
      caption: "mixed upload",
      attachments: [
        {
          kind: "document",
          name: "ok.txt",
          download: async () => new TextEncoder().encode("ok"),
        },
        {
          kind: "document",
          name: "broken.txt",
          download: async () => {
            throw new Error("download failed");
          },
        },
      ],
      reply: async () => undefined,
    });

    expect(prepareAttachmentPrompt).toHaveBeenCalledTimes(1);
    expect(prepareAttachmentPrompt.mock.calls[0]?.[0]).toEqual({
      chatId: 123,
      messageId: 12,
      caption: "mixed upload",
      attachments: [
        {
          kind: "document",
          name: "ok.txt",
          bytes: new TextEncoder().encode("ok"),
        },
      ],
      failedAttachments: [{ name: "broken.txt", reason: "download failed" }],
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "mixed prompt");
  });

  test("calls runTurn when all attachments failed but a caption exists", async () => {
    const prepareAttachmentPrompt = mock(
      async (_input: {
        chatId: number;
        messageId: number;
        caption?: string | null;
        attachments: unknown[];
        failedAttachments: { name: string; reason: string }[];
      }) => ({ prompt: "caption-only prompt" }),
    );
    const runTurn = mock(async (_chatId: bigint, _prompt: string) => ({ summary: "done" }));
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      prepareAttachmentPrompt,
      runTurn,
    });

    await handlers.onAttachmentMessage({
      chatId: 123n,
      messageId: 13,
      caption: "still continue",
      attachments: [
        {
          kind: "document",
          name: "broken.txt",
          download: async () => {
            throw new Error("download failed");
          },
        },
      ],
      reply: async () => undefined,
    });

    expect(prepareAttachmentPrompt).toHaveBeenCalledTimes(1);
    expect(prepareAttachmentPrompt).toHaveBeenCalledWith({
      chatId: 123,
      messageId: 13,
      caption: "still continue",
      attachments: [],
      failedAttachments: [{ name: "broken.txt", reason: "download failed" }],
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "caption-only prompt");
  });

  test("replies with a failure and skips runTurn when bundle preparation throws", async () => {
    const replies: string[] = [];
    const prepareAttachmentPrompt = mock(async (_input: {
      chatId: number;
      messageId: number;
      caption?: string | null;
      attachments: unknown[];
      failedAttachments: unknown[];
    }) => {
      throw new Error("disk full");
    });
    const runTurn = mock(async (_chatId: bigint, _prompt: string) => ({ summary: "done" }));
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      prepareAttachmentPrompt,
      runTurn,
    });

    await handlers.onAttachmentMessage({
      chatId: 123n,
      messageId: 14,
      caption: "please retry",
      attachments: [
        {
          kind: "document",
          name: "report.txt",
          download: async () => new TextEncoder().encode("body"),
        },
      ],
      reply: async (value: string) => {
        replies.push(value);
      },
    });

    expect(prepareAttachmentPrompt).toHaveBeenCalledTimes(1);
    expect(runTurn).not.toHaveBeenCalled();
    expect(replies).toEqual(["Failed to prepare attachment bundle: disk full"]);
  });

  test("does not re-inject attachment context into a later plain text follow-up", async () => {
    const prepareAttachmentPrompt = mock(
      async (_input: {
        chatId: number;
        messageId: number;
        caption?: string | null;
        attachments: unknown[];
        failedAttachments: unknown[];
      }) => ({ prompt: "bundle prompt" }),
    );
    const runTurn = mock(async (_chatId: bigint, _prompt: string) => ({ summary: "done" }));
    const handlers = createBotHandlers({
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      prepareAttachmentPrompt,
      runTurn,
    });

    await handlers.onAttachmentMessage({
      chatId: 123n,
      messageId: 15,
      caption: "review this",
      attachments: [
        {
          kind: "document",
          name: "report.txt",
          download: async () => new TextEncoder().encode("body"),
        },
      ],
      reply: async () => undefined,
    });

    await handlers.onText({
      chatId: 123n,
      text: "follow up question",
      reply: async () => undefined,
    });

    expect(prepareAttachmentPrompt).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(runTurn.mock.calls[0]).toEqual([123n, "bundle prompt"]);
    expect(runTurn.mock.calls[1]).toEqual([123n, "follow up question"]);
  });
});

describe("registerBotHandlers", () => {
  test("coalesces a photo media group into one prepared prompt", async () => {
    const listeners = new Map<string, (ctx: any) => Promise<void>>();
    const prepareAttachmentPrompt = mock(async (input) => {
      expect(input.caption).toBe("album caption");
      expect(input.attachments).toHaveLength(2);
      expect(input.attachments[0]?.kind).toBe("photo");
      expect(input.attachments[1]?.kind).toBe("photo");

      return { prompt: "album prompt" };
    });
    const runTurn = mock(async () => ({ summary: "done" }));
    const timers: Array<() => void> = [];
    const activeTimers = new Set<number>();
    const bot = {
      token: "telegram-token",
      on(event: string, handler: (ctx: any) => Promise<void>) {
        listeners.set(event, handler);
        return this;
      },
    } as any;

    globalThis.fetch = mock(async (url: string | URL | Request) => ({
      ok: true,
      arrayBuffer: async () =>
        new TextEncoder().encode(String(url).includes("file-1") ? "photo-1" : "photo-2").buffer,
    })) as unknown as typeof fetch;

    registerBotHandlers(
      bot,
      {
        getStatusMessage: mock(async () => "idle"),
        resetSession: mock(async () => ({ ok: true as const })),
        abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
        prepareAttachmentPrompt,
        runTurn,
      },
      {
        mediaGroupDebounceMs: 0,
        setTimeoutFn: (callback) => {
          const id = timers.push(callback) - 1;
          activeTimers.add(id);
          return id as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeoutFn: (handle) => {
          activeTimers.delete(Number(handle));
        },
      },
    );

    const onPhoto = listeners.get("message:photo");
    expect(onPhoto).toBeDefined();

    await onPhoto?.(createPhotoContext({
      messageId: 20,
      mediaGroupId: "album-1",
      caption: "album caption",
      fileId: "file-1",
      fileUniqueId: "unique-1",
    }));
    await onPhoto?.(createPhotoContext({
      messageId: 21,
      mediaGroupId: "album-1",
      fileId: "file-2",
      fileUniqueId: "unique-2",
    }));

    expect(prepareAttachmentPrompt).toHaveBeenCalledTimes(0);
    expect(runTurn).toHaveBeenCalledTimes(0);

    for (const [id, callback] of timers.entries()) {
      if (activeTimers.has(id)) {
        callback();
      }
    }

    await flushAsyncWork();

    expect(prepareAttachmentPrompt).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "album prompt");
  });

  test("passes download failures through failedAttachments for document messages", async () => {
    const listeners = new Map<string, (ctx: any) => Promise<void>>();
    const prepareAttachmentPrompt = mock(async (input) => {
      expect(input.attachments).toEqual([]);
      expect(input.failedAttachments).toEqual([
        {
          name: "broken.json",
          reason: "telegram file path missing",
        },
      ]);

      return { prompt: "failed download prompt" };
    });
    const runTurn = mock(async () => ({ summary: "done" }));
    const replies: string[] = [];
    const bot = {
      token: "telegram-token",
      on(event: string, handler: (ctx: any) => Promise<void>) {
        listeners.set(event, handler);
        return this;
      },
    } as any;

    registerBotHandlers(bot, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      prepareAttachmentPrompt,
      runTurn,
    });

    const onDocument = listeners.get("message:document");
    expect(onDocument).toBeDefined();

    await onDocument?.(createDocumentContext({
      messageId: 30,
      caption: "keep going",
      fileName: "broken.json",
      fileId: "broken-file",
      reply: async (value: string) => {
        replies.push(value);
      },
      apiGetFile: async () => ({}),
    }));

    expect(prepareAttachmentPrompt).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "failed download prompt");
    expect(replies).toEqual(["done"]);
  });
});

function createPhotoContext({
  messageId,
  mediaGroupId,
  caption,
  fileId,
  fileUniqueId,
}: {
  messageId: number;
  mediaGroupId?: string;
  caption?: string;
  fileId: string;
  fileUniqueId: string;
}) {
  return {
    chat: { id: 123 },
    message: {
      message_id: messageId,
      media_group_id: mediaGroupId,
      caption,
      photo: [
        {
          file_id: fileId,
          file_unique_id: fileUniqueId,
          width: 640,
          height: 480,
        },
      ],
    },
    api: {
      getFile: async (requestedFileId: string) => ({
        file_path: `photos/${requestedFileId}.jpg`,
      }),
    },
    replyWithChatAction: async () => undefined,
    reply: async () => undefined,
  };
}

function createDocumentContext({
  messageId,
  caption,
  fileName,
  fileId,
  reply,
  apiGetFile,
}: {
  messageId: number;
  caption?: string;
  fileName: string;
  fileId: string;
  reply: (value: string) => Promise<void>;
  apiGetFile: (fileId: string) => Promise<Record<string, unknown>>;
}) {
  return {
    chat: { id: 123 },
    message: {
      message_id: messageId,
      caption,
      document: {
        file_id: fileId,
        file_unique_id: "document-unique",
        file_name: fileName,
        mime_type: "application/json",
      },
    },
    api: {
      getFile: apiGetFile,
    },
    replyWithChatAction: async () => undefined,
    reply,
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Bun.sleep(0);
}
