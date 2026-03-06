import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileSessionStore } from "../../src/session/session-store";

let root = "";

beforeEach(() => {
  if (root) rmSync(root, { force: true, recursive: true });
  root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-session-"));
});

function sessionFile() {
  return path.join(root, "state", "session.json");
}

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

  test("reset clears a persisted session", async () => {
    const store = new FileSessionStore(root);
    await store.save({
      chatId: "123",
      threadId: "thread_1",
      isRunning: true,
      lastSummary: "working",
      lastStartedAt: "2026-03-06T00:00:00.000Z",
      lastCompletedAt: "2026-03-06T01:00:00.000Z",
      logFile: "/tmp/session.log",
    });

    await store.reset(123n);

    const session = await store.getOrCreate(123n);
    expect(session).toEqual({
      chatId: "123",
      threadId: null,
      isRunning: false,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastSummary: null,
      logFile: null,
    });
  });

  test("rejects a stored session for a different chat", async () => {
    const store = new FileSessionStore(root);
    await store.save({
      chatId: "123",
      threadId: "thread_1",
      isRunning: false,
      lastSummary: null,
      lastStartedAt: null,
      lastCompletedAt: null,
      logFile: null,
    });

    await expect(store.getOrCreate(456n)).rejects.toThrow(
      "Stored session chatId 123 does not match requested chatId 456",
    );
  });

  test("throws a targeted error when the stored session file is invalid", async () => {
    mkdirSync(path.dirname(sessionFile()), { recursive: true });
    writeFileSync(sessionFile(), JSON.stringify({ chatId: "123", threadId: null }));

    const store = new FileSessionStore(root);

    await expect(store.getOrCreate(123n)).rejects.toThrow("Invalid session file");
  });
});
