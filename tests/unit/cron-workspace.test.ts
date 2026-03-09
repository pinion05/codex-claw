import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  disableScheduledJobDefinition,
  ensureCronjobsDirectory,
  resolveCronjobsDirectory,
} from "../../src/cron/workspace";

describe("cron workspace", () => {
  test("resolves the fixed cronjobs directory under ~/.codex-claw", () => {
    expect(resolveCronjobsDirectory("/tmp/codex-claw-home")).toBe("/tmp/codex-claw-home/cronjobs");
  });

  test("creates the cronjobs directory when missing", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-workspace-"));
    const homeDir = path.join(root, ".codex-claw");

    try {
      const directory = await ensureCronjobsDirectory(homeDir);

      expect(directory).toBe(path.join(homeDir, "cronjobs"));
      expect(statSync(directory).isDirectory()).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("marks a one-shot job definition as disabled", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-workspace-"));

    try {
      const cronjobsDir = path.join(root, ".codex-claw", "cronjobs");
      const sourcePath = path.join(cronjobsDir, "launch-reminder.json");
      mkdirSync(cronjobsDir, { recursive: true });

      await Bun.write(
        sourcePath,
        JSON.stringify(
          {
            id: "launch-reminder",
            date: "2027-07-12",
            time: "16:00",
            action: {
              type: "message",
              prompt: "Prepare the launch day checklist.",
            },
          },
          null,
          2,
        ),
      );

      await disableScheduledJobDefinition(sourcePath);

      expect(JSON.parse(readFileSync(sourcePath, "utf8"))).toEqual({
        id: "launch-reminder",
        date: "2027-07-12",
        time: "16:00",
        disabled: true,
        action: {
          type: "message",
          prompt: "Prepare the launch day checklist.",
        },
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
