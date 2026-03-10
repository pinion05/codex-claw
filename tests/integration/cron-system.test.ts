import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCronRuntime } from "../../src/cron/runtime";

describe("createCronRuntime one-shot flow", () => {
  test("disables a one-shot job after successful execution", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-system-"));
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");
    const sourcePath = path.join(cronjobsDir, "launch-reminder.json");

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      await Bun.write(
        sourcePath,
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

      await runtime.tick(new Date(2027, 6, 12, 16, 0, 0));

      expect(JSON.parse(readFileSync(sourcePath, "utf8")).disabled).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("keeps a one-shot job enabled when dispatch fails", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-system-"));
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");
    const sourcePath = path.join(cronjobsDir, "launch-reminder.json");
    const dispatchPrompt = mock(async () => {
      throw new Error("dispatch failed");
    });

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      await Bun.write(
        sourcePath,
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
        dispatchPrompt,
      });

      await expect(runtime.tick(new Date(2027, 6, 12, 16, 0, 0))).rejects.toThrow("dispatch failed");
      expect(JSON.parse(readFileSync(sourcePath, "utf8")).disabled).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("retries a failed one-shot again within the same minute and disables it after success", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-system-"));
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");
    const sourcePath = path.join(cronjobsDir, "launch-reminder.json");
    const dispatchPrompt = mock(async () => {
      if (dispatchPrompt.mock.calls.length === 1) {
        throw new Error("dispatch failed");
      }
    });

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      await Bun.write(
        sourcePath,
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
        dispatchPrompt,
      });

      await expect(runtime.tick(new Date(2027, 6, 12, 16, 0, 0))).rejects.toThrow("dispatch failed");
      await expect(runtime.tick(new Date(2027, 6, 12, 16, 0, 30))).resolves.toEqual({
        registered: [],
        skippedDisabled: [],
        errors: [],
      });
      expect(dispatchPrompt).toHaveBeenCalledTimes(2);
      expect(JSON.parse(readFileSync(sourcePath, "utf8")).disabled).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("keeps a one-shot disabled when delivery fails after codex success", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-system-"));
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");
    const sourcePath = path.join(cronjobsDir, "launch-reminder.json");
    const runTurn = mock(async () => ({
      threadId: "thread_1",
      summary: "done",
      touchedPaths: [],
    }));
    const deliverCronResult = mock(async () => {
      throw new Error("delivery failed");
    });

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      await Bun.write(
        sourcePath,
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
        codex: { runTurn },
        resolveCronTargetChatId: async () => 123n,
        isInteractiveRunActive: async () => false,
        deliverCronResult,
      });

      await expect(runtime.tick(new Date(2027, 6, 12, 16, 0, 0))).resolves.toEqual({
        registered: ["launch-reminder"],
        skippedDisabled: [],
        errors: [],
      });
      await expect(runtime.tick(new Date(2027, 6, 12, 16, 0, 30))).resolves.toEqual({
        registered: [],
        skippedDisabled: ["launch-reminder"],
        errors: [],
      });

      expect(runTurn).toHaveBeenCalledTimes(1);
      expect(deliverCronResult).toHaveBeenCalledTimes(1);
      expect(JSON.parse(readFileSync(sourcePath, "utf8")).disabled).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
