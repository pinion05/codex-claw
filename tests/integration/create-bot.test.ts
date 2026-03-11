import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TelegramBundleCollectorScheduler } from "../../src/files/telegram-bundle-collector";
import { createBotHandlers, registerBotHandlers } from "../../src/bot/create-bot";
import { createRuntimeDeps } from "../../src/runtime/create-runtime-deps";

afterEach(() => {
  mock.restore();
});

class FakeScheduler implements TelegramBundleCollectorScheduler {
  private nextHandle = 1;
  private readonly tasks = new Map<number, () => Promise<void> | void>();

  schedule(callback: () => Promise<void> | void, _delayMs: number): number {
    const handle = this.nextHandle++;
    this.tasks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.tasks.delete(handle);
  }

  async runNext(): Promise<void> {
    const nextHandle = this.tasks.keys().next().value;

    if (nextHandle == null) {
      throw new Error("No scheduled task to run");
    }

    const callback = this.tasks.get(nextHandle);

    if (!callback) {
      throw new Error(`Scheduled task ${String(nextHandle)} was missing`);
    }

    this.tasks.delete(nextHandle);
    await callback();
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

type FakeContext = {
  chat: { id: number };
  message: Record<string, unknown>;
  api: {
    getFile: ReturnType<typeof mock>;
  };
  reply: ReturnType<typeof mock>;
  replyWithChatAction: ReturnType<typeof mock>;
};

class FakeBot {
  readonly token = "test-token";
  private readonly handlers = new Map<string, Array<(ctx: FakeContext) => Promise<void>>>();

  on(filter: string, handler: (ctx: FakeContext) => Promise<void>) {
    const current = this.handlers.get(filter) ?? [];
    current.push(handler);
    this.handlers.set(filter, current);
  }

  async dispatch(filter: string, ctx: FakeContext): Promise<void> {
    const handlers = this.handlers.get(filter) ?? [];

    for (const handler of handlers) {
      await handler(ctx);
    }
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createDocumentContext(options: {
  chatId?: number;
  messageId: number;
  caption?: string;
  mediaGroupId?: string;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  replies?: string[];
}) {
  const replies = options.replies ?? [];
  const fileId = options.fileId ?? `document-${options.messageId}`;

  return {
    chat: { id: options.chatId ?? 123 },
    message: {
      message_id: options.messageId,
      media_group_id: options.mediaGroupId,
      caption: options.caption,
      document: {
        file_id: fileId,
        file_name: options.fileName ?? "report.txt",
        mime_type: options.mimeType ?? "text/plain",
      },
    },
    api: {
      getFile: mock(async () => ({
        file_path: `documents/${fileId}.txt`,
      })),
    },
    reply: mock(async (value: string) => {
      replies.push(value);
    }),
    replyWithChatAction: mock(async () => undefined),
  } satisfies FakeContext;
}

function createPhotoContext(options: {
  chatId?: number;
  messageId: number;
  caption?: string;
  mediaGroupId?: string;
  replies?: string[];
  fileIdPrefix?: string;
}) {
  const replies = options.replies ?? [];
  const fileIdPrefix = options.fileIdPrefix ?? `photo-${options.messageId}`;

  return {
    chat: { id: options.chatId ?? 123 },
    message: {
      message_id: options.messageId,
      media_group_id: options.mediaGroupId,
      caption: options.caption,
      photo: [
        {
          file_id: `${fileIdPrefix}-small`,
          width: 320,
          height: 180,
        },
        {
          file_id: `${fileIdPrefix}-large`,
          width: 1280,
          height: 720,
        },
      ],
    },
    api: {
      getFile: mock(async () => ({
        file_path: `photos/${fileIdPrefix}.jpg`,
      })),
    },
    reply: mock(async (value: string) => {
      replies.push(value);
    }),
    replyWithChatAction: mock(async () => undefined),
  } satisfies FakeContext;
}

function createTextContext(options: {
  chatId?: number;
  text: string;
  messageId?: number;
  replyToMessage?: Record<string, unknown>;
  replies?: string[];
}) {
  const replies = options.replies ?? [];

  return {
    chat: { id: options.chatId ?? 123 },
    message: {
      message_id: options.messageId ?? 1,
      text: options.text,
      reply_to_message: options.replyToMessage,
    },
    api: {
      getFile: mock(async () => ({
        file_path: "",
      })),
    },
    reply: mock(async (value: string) => {
      replies.push(value);
    }),
    replyWithChatAction: mock(async () => undefined),
  } satisfies FakeContext;
}

function createReplyAuthor(options: {
  firstName?: string;
  lastName?: string;
  username?: string;
}) {
  return {
    first_name: options.firstName,
    last_name: options.lastName,
    username: options.username,
  };
}

function createRepliedTextMessage(options: {
  messageId: number;
  text: string;
  date?: number;
  from?: Record<string, unknown>;
}) {
  return {
    message_id: options.messageId,
    text: options.text,
    date: options.date,
    from: options.from,
  };
}

function createRepliedDocumentMessage(options: {
  messageId: number;
  caption?: string;
  date?: number;
  from?: Record<string, unknown>;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
}) {
  return {
    message_id: options.messageId,
    caption: options.caption,
    date: options.date,
    from: options.from,
    document: {
      file_id: options.fileId ?? `document-${options.messageId}`,
      file_name: options.fileName ?? "report.pdf",
      mime_type: options.mimeType ?? "application/pdf",
    },
  };
}

function createRepliedPhotoMessage(options: {
  messageId: number;
  mediaGroupId?: string;
  caption?: string;
  date?: number;
  from?: Record<string, unknown>;
  fileIdPrefix?: string;
}) {
  const fileIdPrefix = options.fileIdPrefix ?? `photo-${options.messageId}`;

  return {
    message_id: options.messageId,
    media_group_id: options.mediaGroupId,
    caption: options.caption,
    date: options.date,
    from: options.from,
    photo: [
      {
        file_id: `${fileIdPrefix}-small`,
        width: 320,
        height: 180,
      },
      {
        file_id: `${fileIdPrefix}-large`,
        width: 1280,
        height: 720,
      },
    ],
  };
}

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
});

describe("registerBotHandlers", () => {
  test("text replies prepend structured reply context to the prompt", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
    });

    await bot.dispatch(
      "message:text",
      createTextContext({
        messageId: 501,
        text: "What changed?",
        replyToMessage: createRepliedTextMessage({
          messageId: 500,
          text: "Summarize yesterday's report.",
          date: 1_710_000_000,
          from: createReplyAuthor({
            firstName: "Alice",
            username: "alice",
          }),
        }),
        replies,
      }),
    );

    expect(runTurn).toHaveBeenCalledTimes(1);
    const prompt = (runTurn.mock.calls as unknown[][])[0]?.[1] as string;
    expect(prompt).toContain("Reply context");
    expect(prompt).toContain("- messageId: 500");
    expect(prompt).toContain("- author: Alice (@alice)");
    expect(prompt).toContain("- sentAt: 2024-03-09T16:00:00.000Z");
    expect(prompt).toContain("- text: Summarize yesterday's report.");
    expect(prompt).toContain("Current user message");
    expect(prompt).toContain("What changed?");
    expect(replies).toEqual(["done"]);
  });

  test("document replies include locally known attachment paths when the bundle exists", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const runTurn = mock(async () => ({ summary: "done" }));
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-reply-context-"));
    const previousWorkspaceDir = process.env.CODEX_WORKSPACE_DIR;

    try {
      process.env.CODEX_WORKSPACE_DIR = workspaceDir;
      mkdirSync(path.join(workspaceDir, "inbox", "123", "900"), { recursive: true });
      writeFileSync(
        path.join(workspaceDir, "inbox", "123", "900", "bundle.json"),
        JSON.stringify({
          version: 2,
          chatId: 123,
          messageId: 900,
          mediaGroupId: null,
          caption: "Original document caption",
          attachments: [
            {
              index: 1,
              kind: "document",
              name: "report.pdf",
              path: path.join(workspaceDir, "inbox", "123", "900", "1-report.pdf"),
              mimeType: "application/pdf",
            },
          ],
          failedAttachments: [],
        }),
      );

      registerBotHandlers(bot as never, {
        getStatusMessage: mock(async () => "idle"),
        resetSession: mock(async () => ({ ok: true as const })),
        abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
        runTurn,
      });

      await bot.dispatch(
        "message:text",
        createTextContext({
          messageId: 901,
          text: "Compare this with the new draft.",
          replyToMessage: createRepliedDocumentMessage({
            messageId: 900,
            caption: "Please review the attached draft.",
            from: createReplyAuthor({
              firstName: "Bob",
            }),
            fileName: "report.pdf",
            mimeType: "application/pdf",
          }),
          replies,
        }),
      );

      expect(runTurn).toHaveBeenCalledTimes(1);
      const prompt = (runTurn.mock.calls as unknown[][])[0]?.[1] as string;
      expect(prompt).toContain("Reply context");
      expect(prompt).toContain("- messageId: 900");
      expect(prompt).toContain("- author: Bob");
      expect(prompt).toContain("- caption: Please review the attached draft.");
      expect(prompt).toContain("- attachment 1: [document] report.pdf");
      expect(prompt).toContain(
        `- attachment 1 path: ${path.join(workspaceDir, "inbox", "123", "900", "1-report.pdf")}`,
      );
      expect(prompt).toContain("Current user message");
      expect(prompt).toContain("Compare this with the new draft.");
      expect(replies).toEqual(["done"]);
    } finally {
      if (previousWorkspaceDir === undefined) {
        delete process.env.CODEX_WORKSPACE_DIR;
      } else {
        process.env.CODEX_WORKSPACE_DIR = previousWorkspaceDir;
      }

      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("photo replies stay best-effort when no local bundle metadata exists", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const runTurn = mock(async () => ({ summary: "done" }));
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-reply-context-missing-"));
    const previousWorkspaceDir = process.env.CODEX_WORKSPACE_DIR;

    try {
      process.env.CODEX_WORKSPACE_DIR = workspaceDir;

      registerBotHandlers(bot as never, {
        getStatusMessage: mock(async () => "idle"),
        resetSession: mock(async () => ({ ok: true as const })),
        abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
        runTurn,
      });

      await bot.dispatch(
        "message:text",
        createTextContext({
          messageId: 951,
          text: "Can you extract the text?",
          replyToMessage: createRepliedPhotoMessage({
            messageId: 950,
            caption: "Screenshot from the meeting",
          }),
          replies,
        }),
      );

      expect(runTurn).toHaveBeenCalledTimes(1);
      const prompt = (runTurn.mock.calls as unknown[][])[0]?.[1] as string;
      expect(prompt).toContain("Reply context");
      expect(prompt).toContain("- messageId: 950");
      expect(prompt).toContain("- caption: Screenshot from the meeting");
      expect(prompt).toContain("- attachment 1: [photo]");
      expect(prompt).not.toContain("attachment 1 path:");
      expect(prompt).toContain("Current user message");
      expect(prompt).toContain("Can you extract the text?");
      expect(replies).toEqual(["done"]);
    } finally {
      if (previousWorkspaceDir === undefined) {
        delete process.env.CODEX_WORKSPACE_DIR;
      } else {
        process.env.CODEX_WORKSPACE_DIR = previousWorkspaceDir;
      }

      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("album replies recover locally known attachment paths through the media group id", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const runTurn = mock(async () => ({ summary: "done" }));
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-reply-context-album-"));
    const previousWorkspaceDir = process.env.CODEX_WORKSPACE_DIR;

    try {
      process.env.CODEX_WORKSPACE_DIR = workspaceDir;
      mkdirSync(path.join(workspaceDir, "inbox", "123", "900"), { recursive: true });
      writeFileSync(
        path.join(workspaceDir, "inbox", "123", "900", "bundle.json"),
        JSON.stringify({
          version: 2,
          chatId: 123,
          messageId: 900,
          mediaGroupId: "album-1",
          caption: "Album caption",
          attachments: [
            {
              index: 1,
              kind: "photo",
              name: "photo-900.jpg",
              path: path.join(workspaceDir, "inbox", "123", "900", "1-photo-900.jpg"),
              mimeType: "image/jpeg",
            },
          ],
          failedAttachments: [],
        }),
      );

      registerBotHandlers(bot as never, {
        getStatusMessage: mock(async () => "idle"),
        resetSession: mock(async () => ({ ok: true as const })),
        abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
        runTurn,
      });

      await bot.dispatch(
        "message:text",
        createTextContext({
          messageId: 952,
          text: "Use the replied photo as context.",
          replyToMessage: createRepliedPhotoMessage({
            messageId: 901,
            mediaGroupId: "album-1",
            caption: "Album caption",
          }),
          replies,
        }),
      );

      expect(runTurn).toHaveBeenCalledTimes(1);
      const prompt = (runTurn.mock.calls as unknown[][])[0]?.[1] as string;
      expect(prompt).toContain("- messageId: 901");
      expect(prompt).toContain("- caption: Album caption");
      expect(prompt).toContain("- attachment 1: [photo] photo-900.jpg");
      expect(prompt).toContain(
        `- attachment 1 path: ${path.join(workspaceDir, "inbox", "123", "900", "1-photo-900.jpg")}`,
      );
      expect(replies).toEqual(["done"]);
    } finally {
      if (previousWorkspaceDir === undefined) {
        delete process.env.CODEX_WORKSPACE_DIR;
      } else {
        process.env.CODEX_WORKSPACE_DIR = previousWorkspaceDir;
      }

      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("document messages prepare attachments and run one turn", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const prepareAttachments = mock(async (_input: unknown) => "prepared document prompt");
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments,
      downloadTelegramFile: mock(async () => ({
        bytes: new TextEncoder().encode("document body"),
        filePath: "downloads/report.txt",
        mimeType: "text/plain",
      })),
    });

    await bot.dispatch(
      "message:document",
      createDocumentContext({
        messageId: 200,
        caption: "review the document",
        replies,
      }),
    );

    const preparedInput = prepareAttachments.mock.calls[0]?.[0];

    expect(prepareAttachments).toHaveBeenCalledTimes(1);
    expect(preparedInput).toMatchObject({
      chatId: 123,
      messageId: 200,
      mediaGroupId: null,
      caption: "review the document",
      attachments: [
        {
          kind: "document",
          name: "report.txt",
          mimeType: "text/plain",
        },
      ],
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "prepared document prompt");
    expect(replies).toEqual(["done"]);
  });

  test("document messages do not resolve before the attachment run finishes", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const runTurn = createDeferred<{ summary: string }>();
    let dispatchResolved = false;

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn: mock(async () => runTurn.promise),
      prepareAttachments: mock(async () => "prepared document prompt"),
      downloadTelegramFile: mock(async () => ({
        bytes: new TextEncoder().encode("document body"),
        filePath: "downloads/report.txt",
        mimeType: "text/plain",
      })),
    });

    const dispatchPromise = bot
      .dispatch(
        "message:document",
        createDocumentContext({
          messageId: 205,
          caption: "review the document",
          replies,
        }),
      )
      .then(() => {
        dispatchResolved = true;
      });

    await flushAsyncWork();

    expect(dispatchResolved).toBeFalse();
    expect(replies).toEqual([]);

    runTurn.resolve({ summary: "done" });
    await dispatchPromise;

    expect(dispatchResolved).toBeTrue();
    expect(replies).toEqual(["done"]);
  });

  test("single photo messages prepare attachments and run one turn", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const prepareAttachments = mock(async (_input: unknown) => "prepared photo prompt");
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments,
      downloadTelegramFile: mock(async () => ({
        bytes: new TextEncoder().encode("photo body"),
        filePath: "downloads/album-item.jpg",
        mimeType: "image/jpeg",
      })),
    });

    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 201,
        caption: "look at this",
        replies,
      }),
    );

    const preparedInput = prepareAttachments.mock.calls[0]?.[0];

    expect(prepareAttachments).toHaveBeenCalledTimes(1);
    expect(preparedInput).toMatchObject({
      chatId: 123,
      messageId: 201,
      mediaGroupId: null,
      caption: "look at this",
      attachments: [
        {
          kind: "photo",
          name: "album-item.jpg",
          variants: [
            {
              name: "album-item.jpg",
              width: 1280,
              height: 720,
              mimeType: "image/jpeg",
            },
          ],
        },
      ],
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "prepared photo prompt");
    expect(replies).toEqual(["done"]);
  });

  test("photo albums coalesce into one prepared run", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const scheduler = new FakeScheduler();
    const prepareAttachments = mock(async (_input: unknown) => "prepared album prompt");
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments,
      downloadTelegramFile: mock(async (fileId: string) => ({
        bytes: new TextEncoder().encode(fileId),
        filePath: `downloads/${fileId}.jpg`,
        mimeType: "image/jpeg",
      })),
      attachmentCollectorScheduler: scheduler,
      attachmentCollectorQuietPeriodMs: 25,
    });

    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 300,
        mediaGroupId: "album-1",
        replies,
        fileIdPrefix: "album-first",
      }),
    );
    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 301,
        mediaGroupId: "album-1",
        caption: "album caption",
        replies,
        fileIdPrefix: "album-second",
      }),
    );

    expect(prepareAttachments).not.toHaveBeenCalled();
    expect(runTurn).not.toHaveBeenCalled();

    await scheduler.runNext();
    await flushAsyncWork();

    const preparedInput = prepareAttachments.mock.calls[0]?.[0] as
      | { attachments?: unknown[] }
      | undefined;

    expect(prepareAttachments).toHaveBeenCalledTimes(1);
    expect(preparedInput).toMatchObject({
      chatId: 123,
      messageId: 300,
      mediaGroupId: "album-1",
      caption: "album caption",
    });
    expect(preparedInput?.attachments).toHaveLength(2);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "prepared album prompt");
    expect(replies).toEqual(["done"]);
  });

  test("album finalization does not resolve before the attachment run finishes", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const scheduler = new FakeScheduler();
    const runTurn = createDeferred<{ summary: string }>();
    let finalizeResolved = false;

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn: mock(async () => runTurn.promise),
      prepareAttachments: mock(async () => "prepared album prompt"),
      downloadTelegramFile: mock(async (fileId: string) => ({
        bytes: new TextEncoder().encode(fileId),
        filePath: `downloads/${fileId}.jpg`,
        mimeType: "image/jpeg",
      })),
      attachmentCollectorScheduler: scheduler,
      attachmentCollectorQuietPeriodMs: 25,
    });

    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 320,
        mediaGroupId: "album-awaits-run",
        replies,
        fileIdPrefix: "album-first",
      }),
    );
    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 321,
        mediaGroupId: "album-awaits-run",
        caption: "album caption",
        replies,
        fileIdPrefix: "album-second",
      }),
    );

    const finalizePromise = scheduler.runNext().then(() => {
      finalizeResolved = true;
    });

    await flushAsyncWork();

    expect(finalizeResolved).toBeFalse();
    expect(replies).toEqual([]);

    runTurn.resolve({ summary: "done" });
    await finalizePromise;

    expect(finalizeResolved).toBeTrue();
    expect(replies).toEqual(["done"]);
  });

  test("album identity and attachment ordering follow the lowest message id even when arrival and download order differ", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const scheduler = new FakeScheduler();
    const prepareAttachments = mock(async (_input: unknown) => "prepared ordered album prompt");
    const runTurn = mock(async () => ({ summary: "done" }));
    const firstDownload = createDeferred<{
      bytes: Uint8Array;
      filePath: string;
      mimeType: string;
    }>();

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments,
      downloadTelegramFile: mock(async (fileId: string) => {
        if (fileId === "album-first-large") {
          return firstDownload.promise;
        }

        return {
          bytes: new TextEncoder().encode(fileId),
          filePath: `downloads/${fileId}.jpg`,
          mimeType: "image/jpeg",
        };
      }),
      attachmentCollectorScheduler: scheduler,
      attachmentCollectorQuietPeriodMs: 25,
    });

    const firstDispatch = bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 311,
        mediaGroupId: "album-message-order",
        replies,
        fileIdPrefix: "album-first",
      }),
    );

    await Promise.resolve();

    const secondDispatch = bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 310,
        mediaGroupId: "album-message-order",
        caption: "message id order wins",
        replies,
        fileIdPrefix: "album-second",
      }),
    );

    await secondDispatch;

    expect(prepareAttachments).not.toHaveBeenCalled();
    expect(runTurn).not.toHaveBeenCalled();

    firstDownload.resolve({
      bytes: new TextEncoder().encode("album-first-large"),
      filePath: "downloads/album-first-large.jpg",
      mimeType: "image/jpeg",
    });

    await firstDispatch;
    await scheduler.runNext();
    await flushAsyncWork();

    const preparedInput = prepareAttachments.mock.calls[0]?.[0] as
      | { messageId?: number; attachments?: Array<{ name?: string }> }
      | undefined;

    expect(prepareAttachments).toHaveBeenCalledTimes(1);
    expect(preparedInput).toMatchObject({
      chatId: 123,
      messageId: 310,
      mediaGroupId: "album-message-order",
      caption: "message id order wins",
    });
    expect(preparedInput?.attachments).toEqual([
      expect.objectContaining({ name: "album-second-large.jpg" }),
      expect.objectContaining({ name: "album-first-large.jpg" }),
    ]);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "prepared ordered album prompt");
    expect(replies).toEqual(["done"]);
  });

  test("single document download failures still run with failed attachment metadata when caption exists", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const prepareAttachments = mock(async (_input: unknown) => "prepared failed document prompt");
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments,
      downloadTelegramFile: mock(async () => {
        throw new Error("download exploded");
      }),
    });

    await bot.dispatch(
      "message:document",
      createDocumentContext({
        messageId: 302,
        caption: "review what failed",
        fileName: "report.txt",
        replies,
      }),
    );

    const preparedInput = prepareAttachments.mock.calls[0]?.[0];

    expect(prepareAttachments).toHaveBeenCalledTimes(1);
    expect(preparedInput).toMatchObject({
      chatId: 123,
      messageId: 302,
      mediaGroupId: null,
      caption: "review what failed",
      attachments: [],
      failedAttachments: [
        {
          index: 1,
          name: "report.txt",
          reason: "download exploded",
        },
      ],
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "prepared failed document prompt");
    expect(replies).toEqual(["done"]);
  });

  test("photo albums keep successful attachments and failed attachment metadata in one coalesced run", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const scheduler = new FakeScheduler();
    const prepareAttachments = mock(async (_input: unknown) => "prepared partial album prompt");
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments,
      downloadTelegramFile: mock(async (fileId: string) => {
        if (fileId.includes("second")) {
          throw new Error("album download exploded");
        }

        return {
          bytes: new TextEncoder().encode(fileId),
          filePath: `downloads/${fileId}.jpg`,
          mimeType: "image/jpeg",
        };
      }),
      attachmentCollectorScheduler: scheduler,
      attachmentCollectorQuietPeriodMs: 25,
    });

    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 303,
        mediaGroupId: "album-partial",
        replies,
        fileIdPrefix: "album-first",
      }),
    );
    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 304,
        mediaGroupId: "album-partial",
        caption: "album caption survives",
        replies,
        fileIdPrefix: "album-second",
      }),
    );

    expect(prepareAttachments).not.toHaveBeenCalled();
    expect(runTurn).not.toHaveBeenCalled();

    await scheduler.runNext();
    await flushAsyncWork();

    const preparedInput = prepareAttachments.mock.calls[0]?.[0];

    expect(prepareAttachments).toHaveBeenCalledTimes(1);
    expect(preparedInput).toMatchObject({
      chatId: 123,
      messageId: 303,
      mediaGroupId: "album-partial",
      caption: "album caption survives",
      attachments: [
        {
          kind: "photo",
          name: "album-first-large.jpg",
        },
      ],
      failedAttachments: [
        {
          index: 2,
          name: "album-second-large.jpg",
          reason: "album download exploded",
        },
      ],
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "prepared partial album prompt");
    expect(replies).toEqual(["done"]);
  });

  test("all failed album downloads still run when a caption exists", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const scheduler = new FakeScheduler();
    const prepareAttachments = mock(async (_input: unknown) => "prepared failed album prompt");
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments,
      downloadTelegramFile: mock(async () => {
        throw new Error("album unavailable");
      }),
      attachmentCollectorScheduler: scheduler,
      attachmentCollectorQuietPeriodMs: 25,
    });

    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 305,
        mediaGroupId: "album-all-failed",
        replies,
        fileIdPrefix: "failed-first",
      }),
    );
    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 306,
        mediaGroupId: "album-all-failed",
        caption: "caption only still runs",
        replies,
        fileIdPrefix: "failed-second",
      }),
    );

    await scheduler.runNext();
    await flushAsyncWork();

    const preparedInput = prepareAttachments.mock.calls[0]?.[0];

    expect(prepareAttachments).toHaveBeenCalledTimes(1);
    expect(preparedInput).toMatchObject({
      chatId: 123,
      messageId: 305,
      mediaGroupId: "album-all-failed",
      caption: "caption only still runs",
      attachments: [],
      failedAttachments: [
        {
          index: 1,
          name: "failed-first-large.jpg",
          reason: "album unavailable",
        },
        {
          index: 2,
          name: "failed-second-large.jpg",
          reason: "album unavailable",
        },
      ],
    });
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "prepared failed album prompt");
    expect(replies).toEqual(["done"]);
  });

  test("all failed attachment downloads still run with the default request when no caption exists", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const prepareAttachments = mock(async (_input: unknown) => "prepared failed upload prompt");
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments,
      downloadTelegramFile: mock(async () => {
        throw new Error("download exploded");
      }),
    });

    await bot.dispatch(
      "message:document",
      createDocumentContext({
        messageId: 307,
        fileName: "report.txt",
        replies,
      }),
    );

    expect(prepareAttachments).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledWith(123n, "prepared failed upload prompt");
    expect(replies).toEqual(["done"]);
  });

  test("late album arrivals reply with an explicit skipped notice after the first finalized run", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const scheduler = new FakeScheduler();
    const prepareAttachments = mock(async (_input: unknown) => "prepared album prompt");
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments,
      downloadTelegramFile: mock(async (fileId: string) => ({
        bytes: new TextEncoder().encode(fileId),
        filePath: `downloads/${fileId}.jpg`,
        mimeType: "image/jpeg",
      })),
      attachmentCollectorScheduler: scheduler,
      attachmentCollectorQuietPeriodMs: 25,
    });

    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 400,
        mediaGroupId: "album-2",
        replies,
        fileIdPrefix: "album-start",
      }),
    );

    await scheduler.runNext();

    await bot.dispatch(
      "message:photo",
      createPhotoContext({
        messageId: 401,
        mediaGroupId: "album-2",
        replies,
        fileIdPrefix: "album-late",
      }),
    );

    expect(prepareAttachments).toHaveBeenCalledTimes(1);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(replies).toEqual([
      "done",
      "This album item arrived too late and was skipped. Please resend the full album if you want me to process it.",
    ]);
  });

  test("prepare failures reply with an error and skip runTurn", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const runTurn = mock(async () => ({ summary: "done" }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments: mock(async () => {
        throw new Error("prepare exploded");
      }),
      downloadTelegramFile: mock(async () => ({
        bytes: new TextEncoder().encode("document body"),
        filePath: "downloads/report.txt",
        mimeType: "text/plain",
      })),
    });

    await bot.dispatch(
      "message:document",
      createDocumentContext({
        messageId: 500,
        replies,
      }),
    );

    expect(runTurn).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("prepare exploded");
  });

  test("plain text follow-ups do not re-inject prior bundles", async () => {
    const bot = new FakeBot();
    const replies: string[] = [];
    const runTurn = mock(async (_chatId: bigint, prompt: string) => ({
      summary: `handled:${prompt}`,
    }));

    registerBotHandlers(bot as never, {
      getStatusMessage: mock(async () => "idle"),
      resetSession: mock(async () => ({ ok: true as const })),
      abortRun: mock(async () => ({ ok: false as const, reason: "not-running" as const })),
      runTurn,
      prepareAttachments: mock(async () => "prepared bundle prompt"),
      downloadTelegramFile: mock(async () => ({
        bytes: new TextEncoder().encode("document body"),
        filePath: "downloads/report.txt",
        mimeType: "text/plain",
      })),
    });

    await bot.dispatch(
      "message:document",
      createDocumentContext({
        messageId: 600,
        replies,
      }),
    );
    await bot.dispatch(
      "message:text",
      createTextContext({
        text: "follow-up question",
        replies,
      }),
    );

    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(runTurn.mock.calls).toEqual([
      [123n, "prepared bundle prompt"],
      [123n, "follow-up question"],
    ]);
    expect(replies).toEqual(["handled:prepared bundle prompt", "handled:follow-up question"]);
  });

  test("runtime prepare path writes bundle.json with the same failed attachment metadata shown in the prompt", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-prepare-"));

    try {
      const deps = createRuntimeDeps({
        telegramBotToken: null,
        openAiApiKey: "test-key",
        workspaceDir,
      });

      const prompt = await deps.prepareAttachments?.({
        chatId: 123,
        messageId: 900,
        mediaGroupId: "album-runtime",
        caption: "runtime merge check",
        attachments: [
          {
            index: 2,
            kind: "document",
            name: "report.txt",
            bytes: new TextEncoder().encode("ok"),
            mimeType: "text/plain",
          },
        ],
        failedAttachments: [
          {
            index: 1,
            name: "missing.txt",
            reason: "download failed",
          },
        ],
      });

      const bundleJson = JSON.parse(
        readFileSync(path.join(workspaceDir, "inbox", "123", "900", "bundle.json"), "utf8"),
      );

      expect(prompt).toContain("2. [document] report.txt");
      expect(prompt).toContain("1. missing.txt - download failed");
      expect(bundleJson).toMatchObject({
        version: 2,
        chatId: 123,
        messageId: 900,
        mediaGroupId: "album-runtime",
        caption: "runtime merge check",
        attachments: [
          {
            index: 2,
            name: "report.txt",
          },
        ],
        failedAttachments: [
          {
            index: 1,
            name: "missing.txt",
            reason: "download failed",
          },
        ],
      });
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
