import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const TELEGRAM_DOCUMENT_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

type TelegramApiFile = {
  file_path?: string | null;
};

export type IncomingTelegramDocument = {
  caption?: string | null;
  fileId: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
};

export type ReceiveTelegramDocumentArgs = {
  botToken: string;
  chatId: bigint;
  document: IncomingTelegramDocument;
  fetchFn?: typeof fetch;
  getFile: () => Promise<TelegramApiFile>;
  now?: Date;
  workspaceDir: string;
};

export type ReceivedTelegramDocument = {
  prompt: string;
  savedPath: string;
};

export function resolveTelegramInboxDir(workspaceDir: string, chatId: bigint): string {
  return path.join(workspaceDir, "inbox", chatId.toString());
}

export async function receiveTelegramDocument({
  botToken,
  chatId,
  document,
  fetchFn = fetch,
  getFile,
  now = new Date(),
  workspaceDir,
}: ReceiveTelegramDocumentArgs): Promise<ReceivedTelegramDocument> {
  const fileSize = normalizeOptionalNumber(document.fileSize);

  if (fileSize !== null && fileSize > TELEGRAM_DOCUMENT_DOWNLOAD_LIMIT_BYTES) {
    throw new Error("Document exceeds the 20 MB Telegram download limit.");
  }

  const file = await getFile();
  const remoteFilePath = normalizeNonEmptyString(file.file_path);

  if (remoteFilePath === null) {
    throw new Error("Telegram did not return a downloadable file path.");
  }

  const inboxDir = resolveTelegramInboxDir(workspaceDir, chatId);
  const savedPath = path.join(inboxDir, buildSavedFileName(document.fileName, now));
  const response = await fetchFn(
    new URL(`https://api.telegram.org/file/bot${botToken}/${remoteFilePath}`),
  );

  if (!response.ok) {
    throw new Error(`Telegram download failed with status ${response.status}.`);
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer());

  await mkdir(inboxDir, { recursive: true });
  await writeFile(savedPath, fileBuffer);

  return {
    savedPath,
    prompt: buildTelegramDocumentPrompt({
      caption: normalizeNonEmptyString(document.caption),
      fileId: document.fileId,
      fileName: normalizeNonEmptyString(document.fileName),
      fileSize,
      mimeType: normalizeNonEmptyString(document.mimeType),
      savedPath,
    }),
  };
}

function buildSavedFileName(fileName: string | null | undefined, now: Date): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  const safeBaseName = sanitizeFileName(fileName);

  return `${timestamp}-${safeBaseName}`;
}

function sanitizeFileName(fileName: string | null | undefined): string {
  const normalized = normalizeNonEmptyString(fileName);

  if (normalized === null) {
    return "telegram-document.bin";
  }

  return path.basename(normalized).replace(/[^A-Za-z0-9._-]/g, "_");
}

function normalizeOptionalNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildTelegramDocumentPrompt(input: {
  caption: string | null;
  fileId: string;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  savedPath: string;
}): string {
  const lines = [
    "A Telegram user uploaded a document for this chat.",
    `Saved file path: ${input.savedPath}`,
    `Telegram file id: ${input.fileId}`,
  ];

  if (input.fileName) {
    lines.push(`Original file name: ${input.fileName}`);
  }

  if (input.mimeType) {
    lines.push(`MIME type: ${input.mimeType}`);
  }

  if (input.fileSize !== null) {
    lines.push(`File size: ${input.fileSize} bytes`);
  }

  if (input.caption) {
    lines.push(`User caption: ${input.caption}`);
  } else {
    lines.push("User caption: (none)");
  }

  lines.push("Use the saved local file as input for this request.");

  return lines.join("\n");
}
