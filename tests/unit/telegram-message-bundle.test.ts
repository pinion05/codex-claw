import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  composeTelegramMessageBundlePrompt,
  getTelegramMessageBundleDirectory,
  saveTelegramMessageBundle,
  type TelegramFailedAttachment,
  type TelegramMessageAttachment,
  type TelegramMessageBundle,
} from "../../src/files/telegram-message-bundle";

function createAttachment(overrides?: Partial<TelegramMessageAttachment>): TelegramMessageAttachment {
  return {
    kind: "document",
    name: "report.json",
    path: "/tmp/report.json",
    mimeType: "application/json",
    sizeBytes: 128,
    ...overrides,
  };
}

function createFailedAttachment(
  overrides?: Partial<TelegramFailedAttachment>,
): TelegramFailedAttachment {
  return {
    name: "broken.png",
    reason: "download failed",
    ...overrides,
  };
}

function createBundle(overrides?: Partial<TelegramMessageBundle>): TelegramMessageBundle {
  return {
    chatId: 100,
    messageId: 200,
    caption: "이 파일 검토해줘",
    attachments: [createAttachment()],
    failedAttachments: [],
    ...overrides,
  };
}

describe("composeTelegramMessageBundlePrompt", () => {
  test("uses the caption as the main request and lists attachments in a structured block", () => {
    const prompt = composeTelegramMessageBundlePrompt(createBundle());

    expect(prompt).toContain("User caption");
    expect(prompt).toContain("이 파일 검토해줘");
    expect(prompt).toContain("Attachments");
    expect(prompt).toContain("1. [document] report.json");
    expect(prompt).toContain("Path: /tmp/report.json");
    expect(prompt).toContain("MIME type: application/json");
    expect(prompt).toContain("Size: 128 bytes");
  });

  test("lists failed attachments separately with name and reason", () => {
    const prompt = composeTelegramMessageBundlePrompt(
      createBundle({
        failedAttachments: [createFailedAttachment()],
      }),
    );

    expect(prompt).toContain("Failed attachments");
    expect(prompt).toContain("1. broken.png - download failed");
  });

  test("uses a short default request when the caption is absent", () => {
    const prompt = composeTelegramMessageBundlePrompt(
      createBundle({
        caption: null,
        attachments: [
          createAttachment({
            kind: "photo",
            name: "telegram-photo.jpg",
            path: "/tmp/photo.jpg",
            mimeType: "image/jpeg",
          }),
        ],
      }),
    );

    expect(prompt).toContain("User caption");
    expect(prompt).toContain(
      "The user uploaded Telegram attachments. Review the saved files and continue with the appropriate next step.",
    );
    expect(prompt).toContain("1. [photo] telegram-photo.jpg");
  });

  test("always includes all required sections even when lists are empty", () => {
    const prompt = composeTelegramMessageBundlePrompt(
      createBundle({
        attachments: [],
        failedAttachments: [],
      }),
    );

    expect(prompt).toContain("User caption");
    expect(prompt).toContain("Attachments");
    expect(prompt).toContain("Failed attachments");
    expect(prompt).toContain("None");
  });
});

describe("getTelegramMessageBundleDirectory", () => {
  test("uses the inbox/chat/message path shape", () => {
    expect(getTelegramMessageBundleDirectory("/tmp/workspace", 777, 888)).toBe(
      path.join("/tmp/workspace", "inbox", "777", "888"),
    );
  });
});

describe("saveTelegramMessageBundle", () => {
  test("writes bundle.json and document attachments into the message bundle directory", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));

    try {
      const result = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 42,
        messageId: 99,
        caption: "please review",
        attachments: [
          {
            kind: "document",
            name: "report.txt",
            mimeType: "text/plain",
            bytes: new TextEncoder().encode("document body"),
          },
        ],
      });

      expect(result.bundleDir).toBe(path.join(workspaceDir, "inbox", "42", "99"));
      expect(statSync(result.bundleDir).isDirectory()).toBe(true);
      expect(result.bundle.attachments).toHaveLength(1);
      expect(result.bundle.failedAttachments).toHaveLength(0);

      const savedAttachment = result.bundle.attachments[0];
      expect(savedAttachment?.name).toBe("report.txt");
      expect(savedAttachment?.kind).toBe("document");
      expect(readFileSync(savedAttachment!.path, "utf8")).toBe("document body");

      const savedBundle = JSON.parse(
        readFileSync(path.join(result.bundleDir, "bundle.json"), "utf8"),
      ) as TelegramMessageBundle;

      expect(savedBundle.messageId).toBe(99);
      expect(savedBundle.caption).toBe("please review");
      expect(savedBundle.attachments).toHaveLength(1);
      expect(savedBundle.failedAttachments).toHaveLength(0);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("stores only the largest photo resolution for a photo attachment", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));

    try {
      const result = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 7,
        messageId: 8,
        attachments: [
          {
            kind: "photo",
            name: "telegram-photo.jpg",
            variants: [
              {
                name: "small.jpg",
                width: 320,
                height: 200,
                bytes: new TextEncoder().encode("small"),
                mimeType: "image/jpeg",
              },
              {
                name: "large.jpg",
                width: 1280,
                height: 720,
                bytes: new TextEncoder().encode("large"),
                mimeType: "image/jpeg",
              },
            ],
          },
        ],
      });

      expect(result.bundle.attachments).toHaveLength(1);
      expect(result.bundle.failedAttachments).toHaveLength(0);
      expect(result.bundle.attachments[0]?.name).toBe("telegram-photo.jpg");
      expect(result.bundle.attachments[0]?.kind).toBe("photo");
      expect(readFileSync(result.bundle.attachments[0]!.path, "utf8")).toBe("large");
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("keeps successful files and records failure metadata when some attachments cannot be stored", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));

    try {
      const result = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 10,
        messageId: 11,
        caption: "mixed upload",
        attachments: [
          {
            kind: "document",
            name: "ok.txt",
            bytes: new TextEncoder().encode("ok"),
          },
          {
            kind: "photo",
            name: "broken-photo.jpg",
            variants: [],
          },
        ],
      });

      expect(result.bundle.attachments).toHaveLength(1);
      expect(result.bundle.failedAttachments).toEqual([
        {
          name: "broken-photo.jpg",
          reason: "photo has no variants",
        },
      ]);
      expect(readFileSync(result.bundle.attachments[0]!.path, "utf8")).toBe("ok");

      const savedBundle = JSON.parse(
        readFileSync(path.join(result.bundleDir, "bundle.json"), "utf8"),
      ) as TelegramMessageBundle;

      expect(savedBundle.attachments).toHaveLength(1);
      expect(savedBundle.failedAttachments).toEqual([
        {
          name: "broken-photo.jpg",
          reason: "photo has no variants",
        },
      ]);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("sanitizes stored filenames and metadata names derived from attachment names", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));

    try {
      const result = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 12,
        messageId: 13,
        attachments: [
          {
            kind: "document",
            name: "bad\nname.txt",
            bytes: new TextEncoder().encode("document body"),
          },
          {
            kind: "document",
            name: " \r\n\t ",
            bytes: new TextEncoder().encode("fallback body"),
          },
        ],
      });

      expect(result.bundle.attachments).toHaveLength(2);
      expect(result.bundle.attachments[0]?.name).toBe("bad name.txt");
      expect(path.basename(result.bundle.attachments[0]!.path)).toBe("1-bad name.txt");
      expect(result.bundle.attachments[1]?.name).toBe("document.bin");
      expect(path.basename(result.bundle.attachments[1]!.path)).toBe("2-document.bin");

      const savedBundle = JSON.parse(
        readFileSync(path.join(result.bundleDir, "bundle.json"), "utf8"),
      ) as TelegramMessageBundle;

      expect(savedBundle.attachments[0]?.name).toBe("bad name.txt");
      expect(savedBundle.attachments[1]?.name).toBe("document.bin");
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
