import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileSessionStore } from "../../src/session/session-store";

let root = "";

beforeEach(() => {
  if (root) rmSync(root, { force: true, recursive: true });
  root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-session-"));
});

describe("FileSessionStore", () => {
  test("creates an empty session when none exists", async () => {
    const store = new FileSessionStore(root);
    const session = await store.getOrCreate(123n);
    expect(session.chatId).toBe("123");
    expect(session.threadId).toBeNull();
    expect(session.isRunning).toBe(false);
  });

  test("persists updates across reads", async () => {
    const store = new FileSessionStore(root);
    await store.save({
      chatId: "123",
      threadId: "thread_1",
      isRunning: true,
      lastSummary: "working",
      lastStartedAt: "2026-03-06T00:00:00.000Z",
      lastCompletedAt: null,
      logFile: null,
    });
    const session = await store.getOrCreate(123n);
    expect(session.threadId).toBe("thread_1");
    expect(session.isRunning).toBe(true);
  });
});
