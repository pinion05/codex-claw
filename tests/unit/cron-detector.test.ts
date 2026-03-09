import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectScheduledJobDefinitions } from "../../src/cron/detector";

describe("detectScheduledJobDefinitions", () => {
  test("detects only json definitions in stable path order", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-detector-"));
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      await Bun.write(
        path.join(cronjobsDir, "b.json"),
        JSON.stringify({ id: "b", time: "09:00", action: { type: "message", prompt: "b" } }),
      );
      await Bun.write(
        path.join(cronjobsDir, "a.json"),
        JSON.stringify({ id: "a", time: "10:00", action: { type: "message", prompt: "a" } }),
      );
      writeFileSync(path.join(cronjobsDir, "notes.txt"), "ignore me");

      const result = await detectScheduledJobDefinitions({ codexClawHomeDir });

      expect(result.errors).toEqual([]);
      expect(result.definitions).toEqual([
        {
          sourcePath: path.join(cronjobsDir, "a.json"),
          raw: { id: "a", time: "10:00", action: { type: "message", prompt: "a" } },
        },
        {
          sourcePath: path.join(cronjobsDir, "b.json"),
          raw: { id: "b", time: "09:00", action: { type: "message", prompt: "b" } },
        },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("surfaces invalid json and unreadable files as per-file errors", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-cron-detector-"));
    const codexClawHomeDir = path.join(root, ".codex-claw");
    const cronjobsDir = path.join(codexClawHomeDir, "cronjobs");
    const unreadablePath = path.join(cronjobsDir, "unreadable.json");

    try {
      mkdirSync(cronjobsDir, { recursive: true });
      writeFileSync(path.join(cronjobsDir, "broken.json"), "{not-json");
      writeFileSync(unreadablePath, JSON.stringify({ id: "hidden" }));
      chmodSync(unreadablePath, 0o000);

      const result = await detectScheduledJobDefinitions({ codexClawHomeDir });

      expect(result.definitions).toEqual([]);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toEqual([
        expect.objectContaining({
          sourcePath: path.join(cronjobsDir, "broken.json"),
          message: expect.stringContaining("failed to parse JSON"),
        }),
        expect.objectContaining({
          sourcePath: unreadablePath,
          message: expect.stringContaining("failed to read file"),
        }),
      ]);
    } finally {
      if (existsSync(unreadablePath)) {
        chmodSync(unreadablePath, 0o644);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });
});
