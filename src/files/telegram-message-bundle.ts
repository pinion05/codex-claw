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
  const stagingDir = await createTelegramMessageBundleStagingDirectory(
    input.workspaceDir,
    input.chatId,
    input.messageId,
  );

  const bundleJsonPath = path.join(bundleDir, "bundle.json");

  try {
    const attachments: TelegramMessageAttachment[] = [];
    const failedAttachmentsWereReported = input.failedAttachments !== undefined;
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
    const publishedBundle = await publishTelegramMessageBundle(
      stagingDir,
      bundleDir,
      bundleJsonPath,
      bundle,
      failedAttachmentsWereReported,
    );

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

  try {
    await rename(temporaryPath, bundleJsonPath);
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch {}

    throw error;
  }
}

export function composeTelegramMessageBundlePrompt(bundle: TelegramMessageBundle): string {
  const normalizedBundle = normalizeTelegramMessageBundle(bundle);
  const sections = [
    ["User caption", composeCaptionSection(normalizedBundle.caption)],
    ["Attachments", composeAttachmentsSection(normalizedBundle.attachments)],
    ["Failed attachments", composeFailedAttachmentsSection(normalizedBundle.failedAttachments)],
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
  const bundle = await materializeSavedTelegramMessageBundle(
    normalizeTelegramMessageBundle(JSON.parse(await readFile(bundleJsonPath, "utf8"))),
  );

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
  failedAttachmentsWereReported: boolean,
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
        const healPlan = createTelegramMessageBundleHealPlan(existingBundle.bundle, bundle, {
          failedAttachmentsWereReported,
        });

        if (healPlan.improved) {
          await applyTelegramMessageBundleHealPlan({
            stagingDir,
            bundleDir,
            bundleJsonPath,
            candidateBundle: bundle,
            healPlan,
          });
          await cleanupTelegramMessageBundleStagingDirectory(stagingDir);

          return {
            bundleDir,
            bundleJsonPath,
            bundle: healPlan.bundle,
          };
        }

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

async function materializeSavedTelegramMessageBundle(
  bundle: TelegramMessageBundle,
): Promise<TelegramMessageBundle> {
  const attachments: TelegramMessageAttachment[] = [];
  const failedAttachments = new Map(
    bundle.failedAttachments.map((attachment) => [attachment.index, attachment]),
  );

  for (const attachment of bundle.attachments) {
    try {
      await stat(attachment.path);
      attachments.push(attachment);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      failedAttachments.set(attachment.index, {
        index: attachment.index,
        name: attachment.name,
        reason: "stored attachment missing from disk",
      });
    }
  }

  for (const attachment of attachments) {
    failedAttachments.delete(attachment.index);
  }

  return {
    ...bundle,
    attachments,
    failedAttachments: [...failedAttachments.values()].sort((left, right) => left.index - right.index),
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

function normalizeTelegramMessageBundle(bundle: unknown): TelegramMessageBundle {
  const record = expectRecord(bundle, "Telegram message bundle");

  return {
    version: TELEGRAM_MESSAGE_BUNDLE_VERSION,
    chatId: expectNumber(record.chatId, "Telegram message bundle.chatId"),
    messageId: expectNumber(record.messageId, "Telegram message bundle.messageId"),
    mediaGroupId: normalizeOptionalString(record.mediaGroupId),
    caption: normalizeOptionalString(record.caption),
    attachments: normalizeTelegramMessageAttachments(record.attachments),
    failedAttachments: normalizeTelegramFailedAttachments(record.failedAttachments),
  };
}

function normalizeTelegramMessageAttachments(value: unknown): TelegramMessageAttachment[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Telegram message bundle.attachments must be an array");
  }

  return value
    .map((attachment, index) => normalizeTelegramMessageAttachment(attachment, index))
    .sort((left, right) => left.index - right.index);
}

function normalizeTelegramMessageAttachment(
  attachment: unknown,
  index: number,
): TelegramMessageAttachment {
  const record = expectRecord(attachment, `Telegram message bundle.attachments[${index}]`);
  const kind = record.kind;

  if (kind !== "document" && kind !== "photo") {
    throw new Error(
      `Telegram message bundle.attachments[${index}].kind must be "document" or "photo"`,
    );
  }

  return {
    index: expectNumber(
      record.index,
      `Telegram message bundle.attachments[${index}].index`,
    ),
    kind,
    name: expectString(
      record.name,
      `Telegram message bundle.attachments[${index}].name`,
    ),
    path: expectString(
      record.path,
      `Telegram message bundle.attachments[${index}].path`,
    ),
    mimeType: normalizeOptionalString(record.mimeType),
    sizeBytes: normalizeOptionalNumber(record.sizeBytes),
  };
}

function normalizeTelegramFailedAttachments(value: unknown): TelegramFailedAttachment[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Telegram message bundle.failedAttachments must be an array");
  }

  return value
    .map((attachment, index) => normalizeTelegramFailedAttachment(attachment, index))
    .sort((left, right) => left.index - right.index);
}

function normalizeTelegramFailedAttachment(
  attachment: unknown,
  index: number,
): TelegramFailedAttachment {
  const record = expectRecord(attachment, `Telegram message bundle.failedAttachments[${index}]`);

  return {
    index: expectNumber(
      record.index,
      `Telegram message bundle.failedAttachments[${index}].index`,
    ),
    name: expectString(
      record.name,
      `Telegram message bundle.failedAttachments[${index}].name`,
    ),
    reason: expectString(
      record.reason,
      `Telegram message bundle.failedAttachments[${index}].reason`,
    ),
  };
}

type TelegramMessageBundleHealPlan = {
  bundle: TelegramMessageBundle;
  improved: boolean;
  candidateAttachmentIndexesToPersist: number[];
  supersededAttachmentPathsToDelete: string[];
};

function createTelegramMessageBundleHealPlan(
  existingBundle: TelegramMessageBundle,
  candidateBundle: TelegramMessageBundle,
  options: {
    failedAttachmentsWereReported: boolean;
  },
): TelegramMessageBundleHealPlan {
  const existingAttachments = new Map(existingBundle.attachments.map((attachment) => [
    attachment.index,
    attachment,
  ]));
  const candidateAttachments = new Map(candidateBundle.attachments.map((attachment) => [
    attachment.index,
    attachment,
  ]));
  const existingFailures = new Map(existingBundle.failedAttachments.map((attachment) => [
    attachment.index,
    attachment,
  ]));
  const candidateFailures = new Map(candidateBundle.failedAttachments.map((attachment) => [
    attachment.index,
    attachment,
  ]));
  const candidateAttachmentIndexesToPersist = new Set<number>();
  const supersededAttachmentPathsToDelete = new Set<string>();
  const mergedAttachments: TelegramMessageAttachment[] = [];
  const attachmentIndexes = new Set([
    ...existingAttachments.keys(),
    ...candidateAttachments.keys(),
  ]);

  for (const attachmentIndex of [...attachmentIndexes].sort((left, right) => left - right)) {
    const existingAttachment = existingAttachments.get(attachmentIndex);
    const candidateAttachment = candidateAttachments.get(attachmentIndex);

    if (!existingAttachment && candidateAttachment) {
      mergedAttachments.push(candidateAttachment);
      candidateAttachmentIndexesToPersist.add(attachmentIndex);
      continue;
    }

    if (!candidateAttachment && existingAttachment) {
      mergedAttachments.push(existingAttachment);
      continue;
    }

    if (!existingAttachment || !candidateAttachment) {
      continue;
    }

    if (shouldPreferCandidateAttachment(existingAttachment, candidateAttachment)) {
      mergedAttachments.push(candidateAttachment);
      candidateAttachmentIndexesToPersist.add(attachmentIndex);
      supersededAttachmentPathsToDelete.add(existingAttachment.path);

      continue;
    }

    mergedAttachments.push(existingAttachment);
  }

  const successfulAttachmentIndexes = new Set(mergedAttachments.map((attachment) => attachment.index));
  const mergedFailedAttachments: TelegramFailedAttachment[] = [];
  const failureIndexes = options.failedAttachmentsWereReported
    ? new Set(candidateFailures.keys())
    : new Set([...existingFailures.keys(), ...candidateFailures.keys()]);

  for (const attachmentIndex of [...failureIndexes].sort((left, right) => left - right)) {
    if (successfulAttachmentIndexes.has(attachmentIndex)) {
      continue;
    }

    const existingFailure = existingFailures.get(attachmentIndex);
    const candidateFailure = candidateFailures.get(attachmentIndex);

    if (!existingFailure && candidateFailure) {
      mergedFailedAttachments.push(candidateFailure);
      continue;
    }

    if (!options.failedAttachmentsWereReported && existingFailure) {
      mergedFailedAttachments.push(existingFailure);
      continue;
    }

    if (existingFailure && candidateFailure) {
      mergedFailedAttachments.push(existingFailure);
      continue;
    }
  }

  const mergedBundle: TelegramMessageBundle = {
    version: TELEGRAM_MESSAGE_BUNDLE_VERSION,
    chatId: existingBundle.chatId,
    messageId: existingBundle.messageId,
    mediaGroupId: pickPreferredOptionalString(existingBundle.mediaGroupId, candidateBundle.mediaGroupId),
    caption: pickPreferredOptionalString(existingBundle.caption, candidateBundle.caption),
    attachments: mergedAttachments,
    failedAttachments: mergedFailedAttachments,
  };

  return {
    bundle: mergedBundle,
    improved: JSON.stringify(mergedBundle) !== JSON.stringify(existingBundle),
    candidateAttachmentIndexesToPersist: [...candidateAttachmentIndexesToPersist].sort(
      (left, right) => left - right,
    ),
    supersededAttachmentPathsToDelete: [...supersededAttachmentPathsToDelete].sort(),
  };
}

function shouldPreferCandidateAttachment(
  existingAttachment: TelegramMessageAttachment,
  candidateAttachment: TelegramMessageAttachment,
): boolean {
  return (
    existingAttachment.mimeType == null &&
      candidateAttachment.mimeType != null ||
    existingAttachment.sizeBytes == null &&
      candidateAttachment.sizeBytes != null
  );
}

async function applyTelegramMessageBundleHealPlan(input: {
  stagingDir: string;
  bundleDir: string;
  bundleJsonPath: string;
  candidateBundle: TelegramMessageBundle;
  healPlan: TelegramMessageBundleHealPlan;
}): Promise<void> {
  const candidateAttachments = new Map(input.candidateBundle.attachments.map((attachment) => [
    attachment.index,
    attachment,
  ]));
  const rollbackDir = path.join(
    path.dirname(input.bundleDir),
    `.telegram-message-bundle-heal-${path.basename(input.bundleDir)}-${randomUUID()}.rollback`,
  );

  await mkdir(rollbackDir);

  try {
    for (const filePath of input.healPlan.supersededAttachmentPathsToDelete) {
      await rename(
        path.join(input.bundleDir, path.basename(filePath)),
        path.join(rollbackDir, path.basename(filePath)),
      );
    }

    for (const attachmentIndex of input.healPlan.candidateAttachmentIndexesToPersist) {
      const attachment = candidateAttachments.get(attachmentIndex);

      if (!attachment) {
        continue;
      }

      await rename(
        path.join(input.stagingDir, path.basename(attachment.path)),
        path.join(input.bundleDir, path.basename(attachment.path)),
      );
    }

    await writeTelegramMessageBundleJson(input.bundleJsonPath, input.healPlan.bundle);
  } catch (error) {
    await rollbackTelegramMessageBundleHeal({
      bundleDir: input.bundleDir,
      rollbackDir,
      stagingDir: input.stagingDir,
      candidateBundle: input.candidateBundle,
      healPlan: input.healPlan,
    });
    throw error;
  }

  await rm(rollbackDir, { force: true, recursive: true });
}

async function rollbackTelegramMessageBundleHeal(input: {
  bundleDir: string;
  rollbackDir: string;
  stagingDir: string;
  candidateBundle: TelegramMessageBundle;
  healPlan: TelegramMessageBundleHealPlan;
}): Promise<void> {
  const candidateAttachments = new Map(input.candidateBundle.attachments.map((attachment) => [
    attachment.index,
    attachment,
  ]));

  for (const attachmentIndex of input.healPlan.candidateAttachmentIndexesToPersist) {
    const attachment = candidateAttachments.get(attachmentIndex);

    if (!attachment) {
      continue;
    }

    await moveFileIfExists(
      path.join(input.bundleDir, path.basename(attachment.path)),
      path.join(input.stagingDir, path.basename(attachment.path)),
    );
  }

  for (const filePath of input.healPlan.supersededAttachmentPathsToDelete) {
    await moveFileIfExists(
      path.join(input.rollbackDir, path.basename(filePath)),
      path.join(input.bundleDir, path.basename(filePath)),
    );
  }

  await rm(input.rollbackDir, { force: true, recursive: true });
}

async function moveFileIfExists(fromPath: string, toPath: string): Promise<void> {
  try {
    await rename(fromPath, toPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }

  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickPreferredOptionalString(
  existingValue: string | null | undefined,
  candidateValue: string | null | undefined,
): string | null {
  const normalizedExisting = normalizeOptionalString(existingValue);

  if (normalizedExisting?.trim()) {
    return normalizedExisting;
  }

  const normalizedCandidate = normalizeOptionalString(candidateValue);
  return normalizedCandidate?.trim() ? normalizedCandidate : null;
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
