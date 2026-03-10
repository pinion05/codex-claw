import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCronRuntime } from "../../src/cron/runtime";
import { createRuntimeDeps } from "../../src/runtime/create-runtime-deps";

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
  test("starts the cron runtime with the shared Codex client and narrow cron helpers", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-deps-"));
    let cronArgs:
      | {
          resolveCronTargetChatId: () => Promise<bigint | null>;
          isInteractiveRunActive: () => Promise<boolean>;
          deliverCronResult: (chatId: bigint, text: string) => Promise<void>;
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
          isInteractiveRunActive: expect.any(Function),
          deliverCronResult: expect.any(Function),
          logCronExecution: expect.any(Function),
        }),
      );

      await expect(cronArgs?.resolveCronTargetChatId()).resolves.toBe(123n);
      await expect(cronArgs?.isInteractiveRunActive()).resolves.toBe(false);

      await cronArgs?.deliverCronResult(123n, "cron result");
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

  test("recovers stale persisted running state before gating cron delivery", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-deps-"));
    let cronArgs:
      | {
          isInteractiveRunActive: () => Promise<boolean>;
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

      await expect(cronArgs?.isInteractiveRunActive()).resolves.toBe(false);

      const persistedSession = JSON.parse(
        readFileSync(path.join(workspaceDir, "state", "session.json"), "utf8"),
      ) as Record<string, unknown>;

      expect(persistedSession.isRunning).toBe(false);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
