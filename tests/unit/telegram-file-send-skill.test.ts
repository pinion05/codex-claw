import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  mock.restore();
});

async function loadSkillModule() {
  return import(
    `../../assets/skills/codex-claw-telegram-file-send/scripts/send-file.js?test=${Date.now()}-${Math.random()}`
  );
}

describe("codex-claw Telegram file-send skill", () => {
  test("fails when the input file path is missing", async () => {
    const { runSendFileCli } = await loadSkillModule();
    const stderr: string[] = [];

    await expect(
      runSendFileCli([], {
        stderr: (value: string) => {
          stderr.push(value);
        },
      }),
    ).resolves.toBe(1);

    expect(stderr.join("\n")).toContain("Usage: bun");
  });

  test("fails when the input file does not exist", async () => {
    const { runSendFileCli } = await loadSkillModule();
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-file-send-skill-"));
    const stderr: string[] = [];

    try {
      const missingPath = path.join(root, "missing.txt");

      await expect(
        runSendFileCli([missingPath], {
          codexClawHomeDir: root,
          stderr: (value: string) => {
            stderr.push(value);
          },
        }),
      ).resolves.toBe(1);

      expect(stderr.join("\n")).toContain(`File does not exist: ${missingPath}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails when the Telegram bot token is missing", async () => {
    const { runSendFileCli } = await loadSkillModule();
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-file-send-skill-"));
    const stderr: string[] = [];

    try {
      const filePath = path.join(root, "artifact.txt");
      mkdirSync(path.join(root, "workspace", "state"), { recursive: true });
      writeFileSync(filePath, "artifact");
      writeFileSync(
        path.join(root, "workspace", "state", "session.json"),
        JSON.stringify({
          chatId: "123",
          threadId: "thread_1",
          isRunning: false,
          lastStartedAt: null,
          lastCompletedAt: null,
          lastSummary: null,
          logFile: null,
        }),
      );

      await expect(
        runSendFileCli([filePath], {
          codexClawHomeDir: root,
          stderr: (value: string) => {
            stderr.push(value);
          },
        }),
      ).resolves.toBe(1);

      expect(stderr.join("\n")).toContain("Telegram bot token is not configured");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails when there is no active persisted session", async () => {
    const { runSendFileCli } = await loadSkillModule();
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-file-send-skill-"));
    const stderr: string[] = [];

    try {
      const filePath = path.join(root, "artifact.txt");
      writeFileSync(filePath, "artifact");
      writeFileSync(
        path.join(root, "local-config.json"),
        JSON.stringify({
          telegramBotToken: "telegram-token",
        }),
      );

      await expect(
        runSendFileCli([filePath], {
          codexClawHomeDir: root,
          stderr: (value: string) => {
            stderr.push(value);
          },
        }),
      ).resolves.toBe(1);

      expect(stderr.join("\n")).toContain("No active codex-claw Telegram session found");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uploads the file to Telegram as a document for the active chat", async () => {
    const { runSendFileCli } = await loadSkillModule();
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-file-send-skill-"));
    const stdout: string[] = [];
    const fetchMock = mock(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));

    try {
      const filePath = path.join(root, "artifact.txt");
      mkdirSync(path.join(root, "workspace", "state"), { recursive: true });
      writeFileSync(filePath, "artifact-body");
      writeFileSync(
        path.join(root, "local-config.json"),
        JSON.stringify({
          telegramBotToken: "telegram-token",
        }),
      );
      writeFileSync(
        path.join(root, "workspace", "state", "session.json"),
        JSON.stringify({
          chatId: "123",
          threadId: "thread_1",
          isRunning: false,
          lastStartedAt: null,
          lastCompletedAt: null,
          lastSummary: null,
          logFile: null,
        }),
      );

      await expect(
        runSendFileCli([filePath], {
          codexClawHomeDir: root,
          fetch: fetchMock,
          stdout: (value: string) => {
            stdout.push(value);
          },
        }),
      ).resolves.toBe(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.telegram.org/bottelegram-token/sendDocument");

      const requestInit = fetchMock.mock.calls[0]?.[1];
      expect(requestInit?.method).toBe("POST");
      expect(requestInit?.body).toBeInstanceOf(FormData);

      const body = requestInit?.body as FormData;
      expect(body.get("chat_id")).toBe("123");

      const document = body.get("document");
      expect(document).toBeInstanceOf(File);
      expect((document as File).name).toBe("artifact.txt");
      expect(await (document as File).text()).toBe("artifact-body");
      expect(stdout.join("\n")).toContain("Sent artifact.txt to chat 123");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
