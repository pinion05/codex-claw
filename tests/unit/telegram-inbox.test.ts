import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  receiveTelegramDocument,
  resolveTelegramInboxDir,
  TELEGRAM_DOCUMENT_DOWNLOAD_LIMIT_BYTES,
} from "../../src/files/telegram-inbox";

describe("telegram inbox", () => {
  test("saves an incoming Telegram document into the workspace inbox and builds a prompt", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-inbox-"));

    try {
      const result = await receiveTelegramDocument({
        workspaceDir,
        chatId: 123n,
        botToken: "token-123",
        document: {
          fileId: "file_1",
          fileName: "report final.pdf",
          fileSize: 12,
          mimeType: "application/pdf",
          caption: "요약해줘",
        },
        getFile: async () => ({
          file_path: "documents/file_1.pdf",
        }),
        fetchFn: mock(
          async (_url: string | URL | Request) =>
            new Response("hello world", {
              status: 200,
            }),
        ) as unknown as typeof fetch,
        now: new Date("2026-03-10T04:15:16.000Z"),
      });

      expect(result.savedPath.startsWith(resolveTelegramInboxDir(workspaceDir, 123n))).toBe(true);
      expect(path.basename(result.savedPath)).toBe("20260310T041516Z-file_1-report_final.pdf");
      expect(statSync(result.savedPath).isFile()).toBe(true);
      expect(readFileSync(result.savedPath, "utf8")).toBe("hello world");
      expect(result.prompt).toContain("Saved file path:");
      expect(result.prompt).toContain(result.savedPath);
      expect(result.prompt).toContain("Original file name: report final.pdf");
      expect(result.prompt).toContain("MIME type: application/pdf");
      expect(result.prompt).toContain("File size: 12 bytes");
      expect(result.prompt).toContain("User caption: 요약해줘");
      expect(result.prompt).toContain("Use the saved local file as input");
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("rejects a document that exceeds the Telegram download limit", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-inbox-"));
    const getFile = mock(async () => ({
      file_path: "documents/file_oversized.pdf",
    }));

    try {
      await expect(
        receiveTelegramDocument({
          workspaceDir,
          chatId: 123n,
          botToken: "token-123",
          document: {
            fileId: "file_oversized",
            fileName: "oversized.pdf",
            fileSize: TELEGRAM_DOCUMENT_DOWNLOAD_LIMIT_BYTES + 1,
            mimeType: "application/pdf",
          },
          getFile,
        }),
      ).rejects.toThrow("Document exceeds the 20 MB Telegram download limit.");

      expect(getFile).not.toHaveBeenCalled();
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("rejects when Telegram does not return a downloadable file path", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-inbox-"));

    try {
      await expect(
        receiveTelegramDocument({
          workspaceDir,
          chatId: 123n,
          botToken: "token-123",
          document: {
            fileId: "file_missing_path",
            fileName: "report.pdf",
          },
          getFile: async () => ({}),
        }),
      ).rejects.toThrow("Telegram did not return a downloadable file path.");
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("rejects when Telegram file download returns a non-success status", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-inbox-"));

    try {
      await expect(
        receiveTelegramDocument({
          workspaceDir,
          chatId: 123n,
          botToken: "token-123",
          document: {
            fileId: "file_failed_download",
            fileName: "report.pdf",
          },
          getFile: async () => ({
            file_path: "documents/file_failed_download.pdf",
          }),
          fetchFn: mock(
            async (_url: string | URL | Request) =>
              new Response("not found", {
                status: 404,
              }),
          ) as unknown as typeof fetch,
        }),
      ).rejects.toThrow("Telegram download failed with status 404.");
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
