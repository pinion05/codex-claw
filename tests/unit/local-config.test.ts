import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalConfigStore } from "../../src/config/local-config";

describe("createLocalConfigStore", () => {
  test("returns an empty config when the file does not exist", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-local-config-"));

    try {
      const store = createLocalConfigStore(path.join(root, "local-config.json"));

      await expect(store.read()).resolves.toEqual({
        telegramBotToken: null,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("persists the telegram bot token across reads", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-local-config-"));

    try {
      const store = createLocalConfigStore(path.join(root, "local-config.json"));

      await store.write({
        telegramBotToken: "stored-token",
      });

      await expect(store.read()).resolves.toEqual({
        telegramBotToken: "stored-token",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
