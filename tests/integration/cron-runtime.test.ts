import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCronRuntime } from "../../src/cron/runtime";

function createTempCodexClawHome(prefix: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));

  return {
    root,
    codexClawHomeDir: path.join(root, ".codex-claw"),
  };
}

describe("createCronRuntime dispatch", () => {
  test("dispatches matching jobs through the provided prompt runner", async () => {
    const { root, codexClawHomeDir } = createTempCodexClawHome("codex-claw-cron-runtime-");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");
    const dispatchPrompt = mock(async (_prompt: string) => undefined);

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
        dispatchPrompt,
      });

      await runtime.tick(new Date(2026, 2, 10, 9, 0, 0));

      expect(dispatchPrompt).toHaveBeenCalledTimes(1);
      expect(dispatchPrompt).toHaveBeenCalledWith("Summarize the latest workspace changes.");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("routes background tick failures into the configured error sink", async () => {
    const { root, codexClawHomeDir } = createTempCodexClawHome("codex-claw-cron-runtime-");
    let intervalCallback: (() => void) | undefined;
    let tickCount = 0;
    const onBackgroundError = mock((_error: unknown) => undefined);
    const scheduler = {
      upsert() {},
      remove() {},
      listJobIds() {
        return [];
      },
      async tick() {
        tickCount += 1;

        if (tickCount === 1) {
          return;
        }

        throw new Error("background tick failed");
      },
      stopAll() {},
      getDueJobs() {
        return [];
      },
    };

    try {
      const runtime = createCronRuntime({
        codexClawHomeDir,
        scheduler,
        dispatchPrompt: async () => undefined,
        setIntervalFn: ((callback: () => void) => {
          intervalCallback = callback;
          return 1 as unknown as ReturnType<typeof setInterval>;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
        onBackgroundError,
      });

      await runtime.start();
      intervalCallback?.();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(onBackgroundError).toHaveBeenCalledTimes(1);
      expect(onBackgroundError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("does not fail startup when the initial scheduler tick fails", async () => {
    const { root, codexClawHomeDir } = createTempCodexClawHome("codex-claw-cron-runtime-");
    let intervalCallback: (() => void) | undefined;
    const onBackgroundError = mock((_error: unknown) => undefined);
    const scheduler = {
      upsert() {},
      remove() {},
      listJobIds() {
        return [];
      },
      async tick() {
        throw new Error("initial tick failed");
      },
      stopAll() {},
      getDueJobs() {
        return [];
      },
    };

    try {
      const runtime = createCronRuntime({
        codexClawHomeDir,
        scheduler,
        dispatchPrompt: async () => undefined,
        setIntervalFn: ((callback: () => void) => {
          intervalCallback = callback;
          return 1 as unknown as ReturnType<typeof setInterval>;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
        onBackgroundError,
      });

      await expect(runtime.start()).resolves.toEqual({
        registered: [],
        skippedDisabled: [],
        errors: [],
      });
      expect(intervalCallback).toBeDefined();
      expect(onBackgroundError).toHaveBeenCalledTimes(1);
      expect(onBackgroundError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("does not fail startup when the initial refresh fails", async () => {
    const { root } = createTempCodexClawHome("codex-claw-cron-runtime-");
    const blockingFile = path.join(root, "not-a-directory");
    let intervalCallback: (() => void) | undefined;
    const onBackgroundError = mock((_error: unknown) => undefined);

    try {
      await Bun.write(blockingFile, "blocked");

      const runtime = createCronRuntime({
        codexClawHomeDir: blockingFile,
        dispatchPrompt: async () => undefined,
        setIntervalFn: ((callback: () => void) => {
          intervalCallback = callback;
          return 1 as unknown as ReturnType<typeof setInterval>;
        }) as typeof setInterval,
        clearIntervalFn: (() => undefined) as typeof clearInterval,
        onBackgroundError,
      });

      await expect(runtime.start()).resolves.toEqual({
        registered: [],
        skippedDisabled: [],
        errors: [],
      });
      expect(intervalCallback).toBeDefined();
      expect(onBackgroundError).toHaveBeenCalledTimes(1);
      expect(onBackgroundError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
