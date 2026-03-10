import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  promises as actualFsPromises,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  composeTelegramMessageBundlePrompt,
  saveTelegramMessageBundle,
  type TelegramFailedAttachment,
  type TelegramMessageAttachment,
  type TelegramMessageBundle,
} from "../../src/files/telegram-message-bundle";

function createAttachment(
  overrides?: Partial<TelegramMessageAttachment>,
): TelegramMessageAttachment {
  return {
    index: 1,
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
    index: 2,
    name: "broken.png",
    reason: "download failed",
    ...overrides,
  };
}

function createBundle(overrides?: Partial<TelegramMessageBundle>): TelegramMessageBundle {
  return {
    version: 2,
    chatId: 100,
    messageId: 200,
    mediaGroupId: "album-1",
    caption: "이 파일 검토해줘",
    attachments: [createAttachment()],
    failedAttachments: [],
    ...overrides,
  };
}

type TelegramMessageBundleModule = typeof import("../../src/files/telegram-message-bundle");

afterEach(() => {
  mock.restore();
});

async function loadTelegramMessageBundleModule(): Promise<TelegramMessageBundleModule> {
  return import(`../../src/files/telegram-message-bundle.ts?test=${Date.now()}-${Math.random()}`);
}

async function loadTelegramMessageBundleModuleWithFsOverrides(
  overrides: Partial<typeof actualFsPromises>,
): Promise<TelegramMessageBundleModule> {
  mock.module("node:fs/promises", async () => {
    return {
      ...actualFsPromises,
      ...overrides,
    };
  });

  const module = await loadTelegramMessageBundleModule();
  mock.restore();
  return module;
}

async function loadTelegramMessageBundleModuleWithWriteFailure(
  shouldFail: (targetPath: string) => boolean,
  message: string,
): Promise<TelegramMessageBundleModule> {
  return loadTelegramMessageBundleModuleWithFsOverrides({
    writeFile: async (
      targetPath: Parameters<typeof actualFsPromises.writeFile>[0],
      data: Parameters<typeof actualFsPromises.writeFile>[1],
      options?: Parameters<typeof actualFsPromises.writeFile>[2],
    ) => {
      if (shouldFail(String(targetPath))) {
        throw new Error(message);
      }

      return actualFsPromises.writeFile(targetPath, data, options);
    },
  });
}

function expectNoStagingResidue(workspaceDir: string) {
  const inboxDir = path.join(workspaceDir, "inbox");

  if (!existsSync(inboxDir)) {
    return;
  }

  expect(readdirSync(inboxDir).filter((entry) => entry.endsWith(".staging"))).toEqual([]);
}

describe("saveTelegramMessageBundle", () => {
  test("writes bundle metadata v2 including mediaGroupId", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));

    try {
      const result = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 42,
        messageId: 99,
        mediaGroupId: "media-group-42",
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

      expect(result.bundle.version).toBe(2);
      expect(result.bundle.mediaGroupId).toBe("media-group-42");

      const savedBundle = JSON.parse(
        readFileSync(path.join(result.bundleDir, "bundle.json"), "utf8"),
      ) as TelegramMessageBundle;

      expect(savedBundle.version).toBe(2);
      expect(savedBundle.mediaGroupId).toBe("media-group-42");
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("keeps original order indexes on successful attachment metadata", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));

    try {
      const result = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 42,
        messageId: 100,
        attachments: [
          {
            kind: "document",
            name: "first.txt",
            bytes: new TextEncoder().encode("first"),
          },
          {
            kind: "photo",
            name: "second.jpg",
            variants: [
              {
                name: "second-large.jpg",
                width: 1280,
                height: 720,
                bytes: new TextEncoder().encode("second"),
                mimeType: "image/jpeg",
              },
            ],
          },
          {
            kind: "document",
            name: "third.txt",
            bytes: new TextEncoder().encode("third"),
          },
        ],
      });

      expect(result.bundle.attachments.map((attachment) => attachment.index)).toEqual([1, 2, 3]);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("keeps original order indexes on failed attachment metadata", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));

    try {
      const result = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 42,
        messageId: 101,
        attachments: [
          {
            kind: "document",
            name: "first.txt",
            bytes: new TextEncoder().encode("first"),
          },
          {
            kind: "photo",
            name: "broken-second.jpg",
            variants: [],
          },
          {
            kind: "document",
            name: "third.txt",
            bytes: new TextEncoder().encode("third"),
          },
          {
            kind: "photo",
            name: "broken-fourth.jpg",
            variants: [],
          },
        ],
      });

      expect(result.bundle.attachments.map((attachment) => attachment.index)).toEqual([1, 3]);
      expect(result.bundle.failedAttachments.map((attachment) => attachment.index)).toEqual([
        2, 4,
      ]);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("publishes only the final bundle directory and leaves no staging residue", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));

    try {
      const result = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 77,
        messageId: 501,
        caption: "ship it",
        attachments: [
          {
            kind: "document",
            name: "artifact.txt",
            bytes: new TextEncoder().encode("artifact"),
          },
        ],
      });

      expect(existsSync(result.bundleDir)).toBe(true);
      expect(existsSync(result.bundleJsonPath)).toBe(true);
      expectNoStagingResidue(workspaceDir);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("reuses the existing final bundle when the same messageId is delivered again", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));

    try {
      const firstResult = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 90,
        messageId: 504,
        caption: "first",
        attachments: [
          {
            kind: "document",
            name: "artifact.txt",
            bytes: new TextEncoder().encode("first artifact"),
          },
        ],
      });

      const secondResult = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 90,
        messageId: 504,
        caption: "second",
        attachments: [
          {
            kind: "document",
            name: "artifact.txt",
            bytes: new TextEncoder().encode("second artifact"),
          },
        ],
      });

      const savedBundle = JSON.parse(readFileSync(firstResult.bundleJsonPath, "utf8")) as {
        caption: string | null;
      };

      expect(secondResult.bundle).toEqual(firstResult.bundle);
      expect(savedBundle.caption).toBe("first");
      expectNoStagingResidue(workspaceDir);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("reuses the winner bundle when publish hits an EEXIST race", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));
    const bundleDir = path.join(workspaceDir, "inbox", "90", "700");
    const bundleJsonPath = path.join(bundleDir, "bundle.json");
    const winnerBundle = createBundle({
      chatId: 90,
      messageId: 700,
      caption: "winner",
      attachments: [
        createAttachment({
          name: "winner.txt",
          path: path.join(bundleDir, "1-winner.txt"),
          mimeType: "text/plain",
          sizeBytes: 6,
        }),
      ],
      failedAttachments: [],
    });

    try {
      const { saveTelegramMessageBundle } = await loadTelegramMessageBundleModuleWithFsOverrides({
        rename: async (
          fromPath: Parameters<typeof actualFsPromises.rename>[0],
          toPath: Parameters<typeof actualFsPromises.rename>[1],
        ) => {
          if (
            String(toPath) === bundleDir &&
            String(fromPath).includes(".telegram-message-bundle-")
          ) {
            await actualFsPromises.mkdir(bundleDir, { recursive: true });
            await actualFsPromises.writeFile(bundleJsonPath, JSON.stringify(winnerBundle, null, 2));
            const error = new Error("bundle already exists") as NodeJS.ErrnoException;
            error.code = "EEXIST";
            throw error;
          }

          return actualFsPromises.rename(fromPath, toPath);
        },
      });

      const result = await saveTelegramMessageBundle({
        workspaceDir,
        chatId: 90,
        messageId: 700,
        caption: "loser",
        attachments: [
          {
            kind: "document",
            name: "loser.txt",
            bytes: new TextEncoder().encode("loser"),
          },
        ],
      });

      expect(result.bundle).toEqual(winnerBundle);
      expectNoStagingResidue(workspaceDir);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("aborts publish and leaves no final bundle directory when attachment write fails", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));
    const { saveTelegramMessageBundle } = await loadTelegramMessageBundleModuleWithWriteFailure(
      (targetPath) => !path.basename(targetPath).startsWith("bundle.json."),
      "forced attachment write failure",
    );
    const bundleDir = path.join(workspaceDir, "inbox", "88", "502");

    try {
      await expect(
        saveTelegramMessageBundle({
          workspaceDir,
          chatId: 88,
          messageId: 502,
          attachments: [
            {
              kind: "document",
              name: "artifact.txt",
              bytes: new TextEncoder().encode("artifact"),
            },
          ],
        }),
      ).rejects.toThrow("forced attachment write failure");

      expect(existsSync(bundleDir)).toBe(false);
      expectNoStagingResidue(workspaceDir);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("aborts publish and leaves no final bundle directory when manifest write fails", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-telegram-bundle-"));
    const { saveTelegramMessageBundle } = await loadTelegramMessageBundleModuleWithWriteFailure(
      (targetPath) => path.basename(targetPath).startsWith("bundle.json."),
      "forced manifest write failure",
    );
    const bundleDir = path.join(workspaceDir, "inbox", "89", "503");

    try {
      await expect(
        saveTelegramMessageBundle({
          workspaceDir,
          chatId: 89,
          messageId: 503,
          attachments: [
            {
              kind: "document",
              name: "artifact.txt",
              bytes: new TextEncoder().encode("artifact"),
            },
          ],
        }),
      ).rejects.toThrow("forced manifest write failure");

      expect(existsSync(bundleDir)).toBe(false);
      expectNoStagingResidue(workspaceDir);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});

describe("composeTelegramMessageBundlePrompt", () => {
  test("keeps the caption-first contract while showing explicit attachment ordering", () => {
    const prompt = composeTelegramMessageBundlePrompt(
      createBundle({
        attachments: [
          createAttachment({
            index: 2,
            kind: "photo",
            name: "second.jpg",
            path: "/tmp/second.jpg",
            mimeType: "image/jpeg",
          }),
          createAttachment({
            index: 4,
            name: "fourth.txt",
            path: "/tmp/fourth.txt",
            mimeType: "text/plain",
          }),
        ],
        failedAttachments: [
          createFailedAttachment({
            index: 1,
            name: "first.jpg",
            reason: "download failed",
          }),
          createFailedAttachment({
            index: 3,
            name: "third.jpg",
            reason: "download failed",
          }),
        ],
      }),
    );

    expect(prompt).toMatch(/^User caption\n이 파일 검토해줘\n\nAttachments\n/m);
    expect(prompt).toContain("2. [photo] second.jpg");
    expect(prompt).toContain("4. [document] fourth.txt");
    expect(prompt).toContain("1. first.jpg - download failed");
    expect(prompt).toContain("3. third.jpg - download failed");

    expect(prompt.indexOf("User caption")).toBeLessThan(prompt.indexOf("Attachments"));
    expect(prompt.indexOf("Attachments")).toBeLessThan(prompt.indexOf("Failed attachments"));
  });
});
