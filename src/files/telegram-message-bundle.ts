import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type TelegramAttachmentKind = "document" | "photo";

export type TelegramMessageAttachment = {
  kind: TelegramAttachmentKind;
  name: string;
  path: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

export type TelegramFailedAttachment = {
  name: string;
  reason: string;
};

export type TelegramMessageBundle = {
  chatId: number;
  messageId: number;
  caption?: string | null;
  attachments: TelegramMessageAttachment[];
  failedAttachments: TelegramFailedAttachment[];
};

export type TelegramAttachmentBytes = ArrayBuffer | Uint8Array;

export type TelegramDocumentAttachmentInput = {
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
  caption?: string | null;
  attachments: TelegramMessageAttachmentInput[];
};

export type SavedTelegramMessageBundle = {
  bundleDir: string;
  bundleJsonPath: string;
  bundle: TelegramMessageBundle;
};

const DEFAULT_REQUEST =
  "The user uploaded Telegram attachments. Review the saved files and continue with the appropriate next step.";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]+/g;

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
  await mkdir(bundleDir, { recursive: true });

  const attachments: TelegramMessageAttachment[] = [];
  const failedAttachments: TelegramFailedAttachment[] = [];

  for (const [index, attachment] of input.attachments.entries()) {
    try {
      attachments.push(await saveAttachment(bundleDir, index, attachment));
    } catch (error) {
      failedAttachments.push({
        name: sanitizeTelegramAttachmentName(
          attachment.name,
          attachment.kind === "photo" ? "photo.jpg" : "document.bin",
        ),
        reason: getFailureReason(error),
      });
    }
  }

  const bundle: TelegramMessageBundle = {
    chatId: input.chatId,
    messageId: input.messageId,
    caption: input.caption ?? null,
    attachments,
    failedAttachments,
  };
  const bundleJsonPath = path.join(bundleDir, "bundle.json");

  await writeTelegramMessageBundleJson(bundleJsonPath, bundle);

  return {
    bundleDir,
    bundleJsonPath,
    bundle,
  };
}

export async function writeTelegramMessageBundleJson(
  bundleJsonPath: string,
  bundle: TelegramMessageBundle,
): Promise<void> {
  const temporaryPath = `${bundleJsonPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;

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

  return attachments
    .map((attachment, index) => {
      const lines = [
        `${index + 1}. [${attachment.kind}] ${attachment.name}`,
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

  return failedAttachments
    .map((attachment, index) => `${index + 1}. ${attachment.name} - ${attachment.reason}`)
    .join("\n");
}

async function saveAttachment(
  bundleDir: string,
  index: number,
  attachment: TelegramMessageAttachmentInput,
): Promise<TelegramMessageAttachment> {
  if (attachment.kind === "document") {
    return saveDocumentAttachment(bundleDir, index, attachment);
  }

  return savePhotoAttachment(bundleDir, index, attachment);
}

async function saveDocumentAttachment(
  bundleDir: string,
  index: number,
  attachment: TelegramDocumentAttachmentInput,
): Promise<TelegramMessageAttachment> {
  const bytes = toUint8Array(attachment.bytes);
  const sanitizedName = sanitizeTelegramAttachmentName(attachment.name, "document.bin");
  const filePath = path.join(bundleDir, buildStoredFilename(index, sanitizedName));

  await writeFile(filePath, bytes);

  return {
    kind: "document",
    name: sanitizedName,
    path: filePath,
    mimeType: attachment.mimeType ?? null,
    sizeBytes: bytes.byteLength,
  };
}

async function savePhotoAttachment(
  bundleDir: string,
  index: number,
  attachment: TelegramPhotoAttachmentInput,
): Promise<TelegramMessageAttachment> {
  const largestVariant = pickLargestPhotoVariant(attachment.variants);

  if (!largestVariant) {
    throw new Error("photo has no variants");
  }

  const bytes = toUint8Array(largestVariant.bytes);
  const sanitizedName = sanitizeTelegramAttachmentName(attachment.name, "photo.jpg");
  const filePath = path.join(bundleDir, buildStoredFilename(index, sanitizedName));

  await writeFile(filePath, bytes);

  return {
    kind: "photo",
    name: sanitizedName,
    path: filePath,
    mimeType: largestVariant.mimeType ?? null,
    sizeBytes: bytes.byteLength,
  };
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
  const safeName = path
    .posix
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
  return `${index + 1}-${safeName}`;
}

function toUint8Array(bytes: TelegramAttachmentBytes): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function getFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
