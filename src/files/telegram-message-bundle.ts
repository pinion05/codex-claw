import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type TelegramAttachmentKind = "document" | "photo";

export type TelegramMessageAttachment = {
  index: number;
  kind: TelegramAttachmentKind;
  name: string;
  path: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

export type TelegramFailedAttachment = {
  index: number;
  name: string;
  reason: string;
};

export type TelegramMessageBundle = {
  version: 2;
  chatId: number;
  messageId: number;
  mediaGroupId?: string | null;
  caption?: string | null;
  attachments: TelegramMessageAttachment[];
  failedAttachments: TelegramFailedAttachment[];
};

export type TelegramAttachmentBytes = ArrayBuffer | Uint8Array;

export type TelegramDocumentAttachmentInput = {
  index?: number;
  kind: "document";
  name: string;
  bytes: TelegramAttachmentBytes;
  mimeType?: string | null;
};

export type TelegramPhotoVariantInput = {
  name: string;
  width: number;
  height: number;
  bytes: TelegramAttachmentBytes;
  mimeType?: string | null;
};

export type TelegramPhotoAttachmentInput = {
  index?: number;
  kind: "photo";
  name: string;
  variants: TelegramPhotoVariantInput[];
};

export type TelegramMessageAttachmentInput =
  | TelegramDocumentAttachmentInput
  | TelegramPhotoAttachmentInput;

export type SaveTelegramMessageBundleInput = {
  workspaceDir: string;
  chatId: number;
  messageId: number;
  mediaGroupId?: string | null;
  caption?: string | null;
  attachments: TelegramMessageAttachmentInput[];
  failedAttachments?: TelegramFailedAttachment[];
};

export type SavedTelegramMessageBundle = {
  bundleDir: string;
  bundleJsonPath: string;
  bundle: TelegramMessageBundle;
};

const DEFAULT_REQUEST =
  "The user uploaded Telegram attachments. Review the saved files and continue with the appropriate next step.";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]+/g;
const TELEGRAM_MESSAGE_BUNDLE_VERSION = 2;

export function getTelegramMessageBundleDirectory(
  workspaceDir: string,
  chatId: number,
  messageId: number,
): string {
  return path.join(workspaceDir, "inbox", String(chatId), String(messageId));
}

export async function saveTelegramMessageBundle(
  input: SaveTelegramMessageBundleInput,
): Promise<SavedTelegramMessageBundle> {
  const bundleDir = getTelegramMessageBundleDirectory(
    input.workspaceDir,
    input.chatId,
    input.messageId,
  );
  let stagingDir: string;

  try {
    stagingDir = await createTelegramMessageBundleStagingDirectory(
      input.workspaceDir,
      input.chatId,
      input.messageId,
    );
  } catch (error) {
    if (error instanceof TelegramMessageBundleAlreadyExistsError) {
      return error.savedBundle;
    }

    throw error;
  }

  const bundleJsonPath = path.join(bundleDir, "bundle.json");

  try {
    const attachments: TelegramMessageAttachment[] = [];
    const failedAttachments: TelegramFailedAttachment[] = (input.failedAttachments ?? []).map(
      (attachment) => ({
        index: attachment.index,
        name: sanitizeTelegramAttachmentName(
          attachment.name,
          `attachment-${String(attachment.index)}`,
        ),
        reason: attachment.reason,
      }),
    );

    for (const [index, attachment] of input.attachments.entries()) {
      const attachmentIndex = attachment.index ?? index + 1;

      try {
        attachments.push(await saveAttachment(stagingDir, bundleDir, attachmentIndex, attachment));
      } catch (error) {
        if (error instanceof TelegramMessageBundleStorageError) {
          throw error.cause ?? error;
        }

        failedAttachments.push({
          index: attachmentIndex,
          name: sanitizeTelegramAttachmentName(
            attachment.name,
            attachment.kind === "photo" ? "photo.jpg" : "document.bin",
          ),
          reason: getFailureReason(error),
        });
      }
    }

    const bundle: TelegramMessageBundle = {
      version: TELEGRAM_MESSAGE_BUNDLE_VERSION,
      chatId: input.chatId,
      messageId: input.messageId,
      mediaGroupId: input.mediaGroupId ?? null,
      caption: input.caption ?? null,
      attachments,
      failedAttachments,
    };
    await writeTelegramMessageBundleJson(path.join(stagingDir, "bundle.json"), bundle);
    await mkdir(path.dirname(bundleDir), { recursive: true });
    const publishedBundle = await publishTelegramMessageBundle(stagingDir, bundleDir, bundleJsonPath, bundle);

    return publishedBundle;
  } catch (error) {
    await cleanupTelegramMessageBundleStagingDirectory(stagingDir);
    throw error;
  }
}

export async function writeTelegramMessageBundleJson(
  bundleJsonPath: string,
  bundle: TelegramMessageBundle,
): Promise<void> {
  const temporaryPath =
    `${bundleJsonPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;

  await writeFile(temporaryPath, JSON.stringify(bundle, null, 2));
  await rename(temporaryPath, bundleJsonPath);
}

export function composeTelegramMessageBundlePrompt(bundle: TelegramMessageBundle): string {
  const sections = [
    ["User caption", composeCaptionSection(bundle.caption)],
    ["Attachments", composeAttachmentsSection(bundle.attachments)],
    ["Failed attachments", composeFailedAttachmentsSection(bundle.failedAttachments)],
  ];

  return sections.map(([title, body]) => `${title}\n${body}`).join("\n\n");
}

function composeCaptionSection(caption?: string | null): string {
  const normalizedCaption = caption?.trim();

  if (!normalizedCaption) {
    return DEFAULT_REQUEST;
  }

  return normalizedCaption;
}

function composeAttachmentsSection(attachments: TelegramMessageAttachment[]): string {
  if (attachments.length === 0) {
    return "None";
  }

  return [...attachments]
    .sort((left, right) => left.index - right.index)
    .map((attachment) => {
      const lines = [
        `${attachment.index}. [${attachment.kind}] ${attachment.name}`,
        `Path: ${attachment.path}`,
      ];

      if (attachment.mimeType) {
        lines.push(`MIME type: ${attachment.mimeType}`);
      }

      if (attachment.sizeBytes != null) {
        lines.push(`Size: ${attachment.sizeBytes} bytes`);
      }

      return lines.join("\n");
    })
    .join("\n");
}

function composeFailedAttachmentsSection(failedAttachments: TelegramFailedAttachment[]): string {
  if (failedAttachments.length === 0) {
    return "None";
  }

  return [...failedAttachments]
    .sort((left, right) => left.index - right.index)
    .map((attachment) => `${attachment.index}. ${attachment.name} - ${attachment.reason}`)
    .join("\n");
}

async function saveAttachment(
  storageDir: string,
  publishedDir: string,
  index: number,
  attachment: TelegramMessageAttachmentInput,
): Promise<TelegramMessageAttachment> {
  if (attachment.kind === "document") {
    return saveDocumentAttachment(storageDir, publishedDir, index, attachment);
  }

  return savePhotoAttachment(storageDir, publishedDir, index, attachment);
}

async function saveDocumentAttachment(
  storageDir: string,
  publishedDir: string,
  index: number,
  attachment: TelegramDocumentAttachmentInput,
): Promise<TelegramMessageAttachment> {
  const bytes = toUint8Array(attachment.bytes);
  const sanitizedName = sanitizeTelegramAttachmentName(attachment.name, "document.bin");
  const storedFilename = buildStoredFilename(index, sanitizedName);
  const filePath = path.join(storageDir, storedFilename);

  try {
    await writeFile(filePath, bytes);
  } catch (error) {
    throw new TelegramMessageBundleStorageError(getFailureReason(error), error);
  }

  return {
    index,
    kind: "document",
    name: sanitizedName,
    path: path.join(publishedDir, storedFilename),
    mimeType: attachment.mimeType ?? null,
    sizeBytes: bytes.byteLength,
  };
}

async function savePhotoAttachment(
  storageDir: string,
  publishedDir: string,
  index: number,
  attachment: TelegramPhotoAttachmentInput,
): Promise<TelegramMessageAttachment> {
  const largestVariant = pickLargestPhotoVariant(attachment.variants);

  if (!largestVariant) {
    throw new Error("photo has no variants");
  }

  const bytes = toUint8Array(largestVariant.bytes);
  const sanitizedName = sanitizeTelegramAttachmentName(attachment.name, "photo.jpg");
  const storedFilename = buildStoredFilename(index, sanitizedName);
  const filePath = path.join(storageDir, storedFilename);

  try {
    await writeFile(filePath, bytes);
  } catch (error) {
    throw new TelegramMessageBundleStorageError(getFailureReason(error), error);
  }

  return {
    index,
    kind: "photo",
    name: sanitizedName,
    path: path.join(publishedDir, storedFilename),
    mimeType: largestVariant.mimeType ?? null,
    sizeBytes: bytes.byteLength,
  };
}

async function createTelegramMessageBundleStagingDirectory(
  workspaceDir: string,
  chatId: number,
  messageId: number,
): Promise<string> {
  const inboxDir = path.join(workspaceDir, "inbox");
  const bundleDir = getTelegramMessageBundleDirectory(workspaceDir, chatId, messageId);

  const existingBundle = await tryReadExistingTelegramMessageBundle(bundleDir);

  if (existingBundle) {
    throw new TelegramMessageBundleAlreadyExistsError(bundleDir, existingBundle);
  }

  await mkdir(inboxDir, { recursive: true });

  const stagingDir = path.join(
    inboxDir,
    `.telegram-message-bundle-${chatId}-${messageId}-${randomUUID()}.staging`,
  );

  await mkdir(stagingDir);
  return stagingDir;
}

async function tryReadExistingTelegramMessageBundle(
  bundleDir: string,
): Promise<SavedTelegramMessageBundle | null> {
  try {
    await stat(bundleDir);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }

  const bundleJsonPath = path.join(bundleDir, "bundle.json");
  const bundle = JSON.parse(await readFile(bundleJsonPath, "utf8")) as TelegramMessageBundle;

  return {
    bundleDir,
    bundleJsonPath,
    bundle,
  };
}

async function publishTelegramMessageBundle(
  stagingDir: string,
  bundleDir: string,
  bundleJsonPath: string,
  bundle: TelegramMessageBundle,
): Promise<SavedTelegramMessageBundle> {
  try {
    await rename(stagingDir, bundleDir);
    return {
      bundleDir,
      bundleJsonPath,
      bundle,
    };
  } catch (error) {
    if (isBundlePublishConflictError(error)) {
      const existingBundle = await tryReadExistingTelegramMessageBundle(bundleDir);

      if (existingBundle) {
        await cleanupTelegramMessageBundleStagingDirectory(stagingDir);
        return existingBundle;
      }

      throw new Error(`Telegram message bundle already exists at ${bundleDir}`);
    }

    throw error;
  }
}

async function cleanupTelegramMessageBundleStagingDirectory(stagingDir: string): Promise<void> {
  try {
    await rm(stagingDir, { force: true, recursive: true });
  } catch {}
}

function pickLargestPhotoVariant(
  variants: TelegramPhotoVariantInput[],
): TelegramPhotoVariantInput | null {
  if (variants.length === 0) {
    return null;
  }

  return variants.reduce((largest, current) =>
    current.width * current.height > largest.width * largest.height ? current : largest,
  );
}

export function sanitizeTelegramAttachmentName(name: string, fallbackName: string): string {
  const safeName = path.posix
    .basename(name.replaceAll("\\", "/"))
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    safeName.length === 0 ||
    safeName === "." ||
    safeName === ".." ||
    safeName.replace(/[.\s]+/g, "").length === 0
  ) {
    return fallbackName;
  }

  return safeName;
}

function buildStoredFilename(index: number, safeName: string): string {
  return `${index}-${safeName}`;
}

function toUint8Array(bytes: TelegramAttachmentBytes): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function getFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isBundlePublishConflictError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY")
  );
}

class TelegramMessageBundleStorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TelegramMessageBundleStorageError";
  }
}

class TelegramMessageBundleAlreadyExistsError extends Error {
  constructor(
    readonly bundleDir: string,
    readonly savedBundle: SavedTelegramMessageBundle,
  ) {
    super(`Telegram message bundle already exists at ${bundleDir}`);
    this.name = "TelegramMessageBundleAlreadyExistsError";
  }
}
