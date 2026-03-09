import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCronRuntime } from "../../src/cron/runtime";

describe("createCronRuntime one-shot flow", () => {
  test("disables a one-shot job after successful execution", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-system-"));
    const cronjobsDir = path.join(root, ".codex-claw", "cronjobs");
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
        codexClawHomeDir: root,
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
    const cronjobsDir = path.join(root, ".codex-claw", "cronjobs");
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
        codexClawHomeDir: root,
        dispatchPrompt,
      });

      await expect(runtime.tick(new Date(2027, 6, 12, 16, 0, 0))).rejects.toThrow("dispatch failed");
      expect(JSON.parse(readFileSync(sourcePath, "utf8")).disabled).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
