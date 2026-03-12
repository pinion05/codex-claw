import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntimeDeps } from "../../src/runtime/create-runtime-deps";
import { createCronRuntime } from "../../src/cron/runtime";

describe("createCronRuntime loading", () => {
  test("detects, parses, and injects enabled scheduled jobs", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-loader-"));
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      await Bun.write(
        path.join(cronjobsDir, "daily-summary.json"),
        JSON.stringify({
          id: "daily-summary",
          time: "09:00",
          action: {
            type: "message",
            prompt: "Summarize the latest workspace changes.",
          },
        }),
      );

      const runtime = createCronRuntime({
        codexClawHomeDir,
        dispatchPrompt: async () => undefined,
      });

      const report = await runtime.refresh();

      expect(report.registered).toEqual(["daily-summary"]);
      expect(report.skippedDisabled).toEqual([]);
      expect(report.errors).toEqual([]);
      expect(runtime.getRegisteredJobIds()).toEqual(["daily-summary"]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("surfaces expired one-shot jobs instead of registering them", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-loader-"));
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      await Bun.write(
        path.join(cronjobsDir, "launch-reminder.json"),
        JSON.stringify({
          id: "launch-reminder",
          date: "2027-07-12",
          time: "16:00",
          action: {
            type: "message",
            prompt: "Prepare the launch day checklist.",
          },
        }),
      );

      const runtime = createCronRuntime({
        codexClawHomeDir,
        dispatchPrompt: async () => undefined,
      });

      const report = await runtime.refresh(new Date(2027, 6, 12, 16, 1, 0));

      expect(report.registered).toEqual([]);
      expect(report.skippedDisabled).toEqual([]);
      expect(report.errors).toEqual([
        {
          sourcePath: path.join(cronjobsDir, "launch-reminder.json"),
          message: 'Scheduled one-shot job "launch-reminder" has expired',
        },
      ]);
      expect(runtime.getRegisteredJobIds()).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("createRuntimeDeps cron wiring", () => {
  test("runs a real cron runtime through createRuntimeDeps even when the persisted session is active", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-deps-e2e-"));
    const workspaceDir = path.join(root, "workspace");
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");
    const runTurn = mock(async () => ({
      threadId: "thread_1",
      summary: "done",
      touchedPaths: [],
    }));
    const sendTelegramMessage = mock(async (_chatId: bigint, _text: string) => undefined);
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      mkdirSync(path.join(workspaceDir, "state"), { recursive: true });
      await Bun.write(
        path.join(workspaceDir, "state", "session.json"),
        JSON.stringify({
          chatId: "123",
          threadId: "thread_live",
          isRunning: true,
          lastStartedAt: null,
          lastCompletedAt: null,
          lastSummary: null,
          logFile: null,
        }),
      );
      await Bun.write(
        path.join(cronjobsDir, "daily-summary.json"),
        JSON.stringify({
          id: "daily-summary",
          time,
          action: {
            type: "message",
            prompt: "Summarize the latest workspace changes.",
          },
        }),
      );

      const deps = createRuntimeDeps(
        {
          telegramBotToken: null,
          openAiApiKey: null,
          workspaceDir,
        },
        {
          createSdkRuntimeClientFn: () => ({ runTurn }),
          createCronRuntimeFn: (options) =>
            createCronRuntime({
              ...options,
              codexClawHomeDir,
            }),
        },
        {
          sendTelegramMessage,
        },
      );

      await deps.startCronRuntime();
      deps.stopCronRuntime();

      expect(runTurn).toHaveBeenCalledWith({
        threadId: null,
        prompt: "Summarize the latest workspace changes.",
      });
      expect(sendTelegramMessage).toHaveBeenCalledWith(123n, "done");

      const yearDir = readdirSync(path.join(workspaceDir, "logs"))[0];
      const monthDir = readdirSync(path.join(workspaceDir, "logs", yearDir!))[0];
      const dayDir = readdirSync(path.join(workspaceDir, "logs", yearDir!, monthDir!))[0];
      const logDir = path.join(workspaceDir, "logs", yearDir!, monthDir!, dayDir!);
      const entries = readdirSync(logDir).map((fileName) =>
        JSON.parse(readFileSync(path.join(logDir, fileName), "utf8")) as Record<string, unknown>,
      );

      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            jobId: "daily-summary",
            phase: "execution",
            status: "completed",
            chatId: "123",
            threadId: "thread_1",
          }),
          expect.objectContaining({
            jobId: "daily-summary",
            phase: "delivery",
            status: "completed",
            chatId: "123",
            threadId: "thread_1",
          }),
        ]),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("runs cron on the shared codex client while an interactive run is still in flight", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-deps-e2e-"));
    const workspaceDir = path.join(root, "workspace");
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");
    const interactivePrompt = "Continue the live interactive task.";
    const cronPrompt = "Summarize the latest workspace changes.";
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    let releaseInteractiveRun: (() => void) | undefined;
    let markInteractiveStarted: (() => void) | undefined;
    const interactiveStarted = new Promise<void>((resolve) => {
      markInteractiveStarted = resolve;
    });
    const interactiveBlocked = new Promise<void>((resolve) => {
      releaseInteractiveRun = resolve;
    });
    const runTurn = mock(
      async ({ threadId, prompt }: { threadId: string | null; prompt: string }) => {
        if (threadId === "thread_live" && prompt === interactivePrompt) {
          markInteractiveStarted?.();
          await interactiveBlocked;
          return {
            threadId: "thread_live",
            summary: "interactive done",
            touchedPaths: [],
          };
        }

        if (threadId === null && prompt === cronPrompt) {
          return {
            threadId: "thread_cron",
            summary: "cron done",
            touchedPaths: [],
          };
        }

        throw new Error(`Unexpected runTurn request: ${JSON.stringify({ threadId, prompt })}`);
      },
    );
    const sendTelegramMessage = mock(async (_chatId: bigint, _text: string) => undefined);

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      mkdirSync(path.join(workspaceDir, "state"), { recursive: true });
      await Bun.write(
        path.join(workspaceDir, "state", "session.json"),
        JSON.stringify({
          chatId: "123",
          threadId: "thread_live",
          isRunning: false,
          lastStartedAt: null,
          lastCompletedAt: null,
          lastSummary: null,
          logFile: null,
        }),
      );
      await Bun.write(
        path.join(cronjobsDir, "daily-summary.json"),
        JSON.stringify({
          id: "daily-summary",
          time,
          action: {
            type: "message",
            prompt: cronPrompt,
          },
        }),
      );

      const deps = createRuntimeDeps(
        {
          telegramBotToken: null,
          openAiApiKey: null,
          workspaceDir,
        },
        {
          createSdkRuntimeClientFn: () => ({ runTurn }),
          createCronRuntimeFn: (options) =>
            createCronRuntime({
              ...options,
              codexClawHomeDir,
            }),
        },
        {
          sendTelegramMessage,
        },
      );

      const liveTurnPromise = deps.runTurn(123n, interactivePrompt);
      await interactiveStarted;

      const runningSession = JSON.parse(
        readFileSync(path.join(workspaceDir, "state", "session.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(runningSession.isRunning).toBe(true);

      await deps.startCronRuntime();
      deps.stopCronRuntime();

      expect(runTurn).toHaveBeenCalledWith({
        threadId: "thread_live",
        prompt: interactivePrompt,
        signal: expect.any(AbortSignal),
      });
      expect(runTurn).toHaveBeenCalledWith({
        threadId: null,
        prompt: cronPrompt,
      });
      expect(sendTelegramMessage).toHaveBeenCalledWith(123n, "cron done");

      releaseInteractiveRun?.();
      await expect(liveTurnPromise).resolves.toMatchObject({
        threadId: "thread_live",
        summary: "interactive done",
      });

      const completedSession = JSON.parse(
        readFileSync(path.join(workspaceDir, "state", "session.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(completedSession.isRunning).toBe(false);
      expect(completedSession.threadId).toBe("thread_live");
      expect(completedSession.lastSummary).toBe("interactive done");
    } finally {
      releaseInteractiveRun?.();
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("starts the cron runtime with the shared Codex client and narrow cron helpers", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-deps-"));
    let cronArgs:
      | {
          resolveCronTargetChatId: () => Promise<bigint | null>;
          deliverCronResult?: (chatId: bigint, text: string) => Promise<void>;
          logCronExecution: (event: Record<string, unknown>) => Promise<void>;
        }
      | undefined;
    const start = mock(async () => ({
      registered: [],
      skippedDisabled: [],
      errors: [],
    }));
    const stop = mock(() => undefined);
    const runTurn = mock(async () => ({
      threadId: "thread_1",
      summary: "done",
      touchedPaths: [],
    }));
    const sendTelegramMessage = mock(async (_chatId: bigint, _text: string) => undefined);
    const createCronRuntimeFn = mock((options) => {
      cronArgs = options;

      return {
      syncNow: mock(async () => ({
        registered: [],
        skippedDisabled: [],
        errors: [],
      })),
      refresh: mock(async () => ({
        registered: [],
        skippedDisabled: [],
        errors: [],
      })),
      tick: mock(async () => ({
        registered: [],
        skippedDisabled: [],
        errors: [],
      })),
      start,
      stop,
      getRegisteredJobIds: mock(() => []),
      };
    });

    try {
      mkdirSync(path.join(workspaceDir, "state"), { recursive: true });
      await Bun.write(
        path.join(workspaceDir, "state", "session.json"),
        JSON.stringify({
          chatId: "123",
          threadId: "thread_1",
          isRunning: true,
          lastStartedAt: "2026-03-10T00:00:00.000Z",
          lastCompletedAt: null,
          lastSummary: "running",
          logFile: null,
        }),
      );

      const deps = createRuntimeDeps(
        {
          telegramBotToken: null,
          openAiApiKey: null,
          workspaceDir,
        },
        {
          createSdkRuntimeClientFn: () => ({ runTurn }),
          createCronRuntimeFn,
        },
        {
          sendTelegramMessage,
        },
      );

      await deps.startCronRuntime();

      expect(createCronRuntimeFn).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceDir,
          codex: { runTurn },
          resolveCronTargetChatId: expect.any(Function),
          deliverCronResult: expect.any(Function),
          logCronExecution: expect.any(Function),
        }),
      );

      await expect(cronArgs?.resolveCronTargetChatId()).resolves.toBe(123n);
      expect("isInteractiveRunActive" in (cronArgs ?? {})).toBe(false);

      expect(cronArgs?.deliverCronResult).toBeDefined();
      await cronArgs!.deliverCronResult!(123n, "cron result");
      expect(sendTelegramMessage).toHaveBeenCalledWith(123n, "cron result");

      await cronArgs?.logCronExecution({
        jobId: "daily-summary",
        phase: "skip",
        status: "skipped",
        reason: "no-target-chat",
        chatId: null,
        threadId: null,
        error: null,
      });

      const yearDir = readdirSync(path.join(workspaceDir, "logs"))[0];
      const monthDir = readdirSync(path.join(workspaceDir, "logs", yearDir!))[0];
      const dayDir = readdirSync(path.join(workspaceDir, "logs", yearDir!, monthDir!))[0];
      const logDir = path.join(workspaceDir, "logs", yearDir!, monthDir!, dayDir!);
      const logFile = readdirSync(logDir)[0];
      const entry = JSON.parse(readFileSync(path.join(logDir, logFile!), "utf8")) as Record<string, unknown>;

      expect(entry).toMatchObject({
        jobId: "daily-summary",
        phase: "skip",
        status: "skipped",
        reason: "no-target-chat",
        chatId: null,
        threadId: null,
        error: null,
      });

      expect(start).toHaveBeenCalledTimes(1);

      deps.stopCronRuntime();

      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("treats malformed persisted sessions as missing cron targets", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-deps-"));
    let cronArgs:
      | {
          resolveCronTargetChatId: () => Promise<bigint | null>;
        }
      | undefined;
    const createCronRuntimeFn = mock((options) => {
      cronArgs = options;

      return {
        syncNow: mock(async () => ({
          registered: [],
          skippedDisabled: [],
          errors: [],
        })),
        refresh: mock(async () => ({
          registered: [],
          skippedDisabled: [],
          errors: [],
        })),
        tick: mock(async () => ({
          registered: [],
          skippedDisabled: [],
          errors: [],
        })),
        start: mock(async () => ({
          registered: [],
          skippedDisabled: [],
          errors: [],
        })),
        stop: mock(() => undefined),
        getRegisteredJobIds: mock(() => []),
      };
    });

    try {
      mkdirSync(path.join(workspaceDir, "state"), { recursive: true });
      await Bun.write(
        path.join(workspaceDir, "state", "session.json"),
        JSON.stringify({
          chatId: "not-a-bigint",
          threadId: "thread_1",
          isRunning: true,
          lastStartedAt: "2026-03-10T00:00:00.000Z",
          lastCompletedAt: null,
          lastSummary: "running",
          logFile: null,
        }),
      );

      const deps = createRuntimeDeps(
        {
          telegramBotToken: null,
          openAiApiKey: null,
          workspaceDir,
        },
        {
          createSdkRuntimeClientFn: () => ({
            runTurn: mock(async () => ({
              threadId: "thread_1",
              summary: "done",
              touchedPaths: [],
            })),
          }),
          createCronRuntimeFn,
        },
      );

      await deps.startCronRuntime();

      await expect(cronArgs?.resolveCronTargetChatId()).resolves.toBeNull();
      expect("isInteractiveRunActive" in (cronArgs ?? {})).toBe(false);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("omits the cron delivery hook when no Telegram sender is wired", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-deps-"));
    let cronArgs:
      | {
          deliverCronResult?: (chatId: bigint, text: string) => Promise<void>;
        }
      | undefined;
    const createCronRuntimeFn = mock((options) => {
      cronArgs = options;

      return {
        syncNow: mock(async () => ({
          registered: [],
          skippedDisabled: [],
          errors: [],
        })),
        refresh: mock(async () => ({
          registered: [],
          skippedDisabled: [],
          errors: [],
        })),
        tick: mock(async () => ({
          registered: [],
          skippedDisabled: [],
          errors: [],
        })),
        start: mock(async () => ({
          registered: [],
          skippedDisabled: [],
          errors: [],
        })),
        stop: mock(() => undefined),
        getRegisteredJobIds: mock(() => []),
      };
    });

    try {
      const deps = createRuntimeDeps(
        {
          telegramBotToken: null,
          openAiApiKey: null,
          workspaceDir,
        },
        {
          createSdkRuntimeClientFn: () => ({
            runTurn: mock(async () => ({
              threadId: "thread_1",
              summary: "done",
              touchedPaths: [],
            })),
          }),
          createCronRuntimeFn,
        },
      );

      await deps.startCronRuntime();

      expect(cronArgs?.deliverCronResult).toBeUndefined();
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
