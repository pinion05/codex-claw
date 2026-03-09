import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  test("starts the cron runtime with the shared Codex client", async () => {
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
    const createCronRuntimeFn = mock(() => ({
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
    }));

    const deps = createRuntimeDeps(
      {
        telegramBotToken: null,
        openAiApiKey: null,
        workspaceDir: "/tmp/codex-claw-workspace",
      },
      {
        createSdkRuntimeClientFn: () => ({ runTurn }),
        createCronRuntimeFn,
      },
    );

    await deps.startCronRuntime();

    expect(createCronRuntimeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir: "/tmp/codex-claw-workspace",
        codex: { runTurn },
      }),
    );
    expect(start).toHaveBeenCalledTimes(1);

    deps.stopCronRuntime();

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
