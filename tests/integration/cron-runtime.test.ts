import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCronRuntime } from "../../src/cron/runtime";

describe("createCronRuntime dispatch", () => {
  test("dispatches matching jobs through the provided prompt runner", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-runtime-"));
    const cronjobsDir = path.join(root, ".codex-claw", "cronjobs");
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
        codexClawHomeDir: root,
        dispatchPrompt,
      });

      await runtime.tick(new Date(2026, 2, 10, 9, 0, 0));

      expect(dispatchPrompt).toHaveBeenCalledTimes(1);
      expect(dispatchPrompt).toHaveBeenCalledWith("Summarize the latest workspace changes.");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
