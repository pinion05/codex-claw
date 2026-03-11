import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getTelegramMessageBundleDirectory } from "../files/telegram-message-bundle";
import { resolveWorkspaceDir } from "../lib/paths";

type Env = Record<string, string | undefined>;

type ReplyAuthor = {
  first_name?: string;
  last_name?: string;
  username?: string;
};

type ReplyDocument = {
  file_name?: string;
  mime_type?: string | null;
};

type ReplyPhoto = {
  file_id?: string;
  width?: number;
  height?: number;
};

export type ReplyMessage = {
  message_id?: number;
  media_group_id?: string;
  date?: number;
  from?: ReplyAuthor;
  text?: string;
  caption?: string;
  document?: ReplyDocument;
  photo?: ReplyPhoto[];
};

type ReplyAttachmentContext = {
  kind: "document" | "photo";
  name: string;
  path?: string;
};

type ReplyBundleAttachmentRecord = {
  kind?: unknown;
  name?: unknown;
  path?: unknown;
};

type ReplyBundleRecord = {
  attachments?: unknown;
};

export async function buildPromptWithReplyContext(input: {
  chatId: number;
  messageText: string;
  replyToMessage?: ReplyMessage | null;
  env?: Env;
}): Promise<string> {
  const replyToMessage = input.replyToMessage;

  if (!replyToMessage) {
    return input.messageText;
  }

  const lines: string[] = [];

  if (typeof replyToMessage.message_id === "number") {
    lines.push(`- messageId: ${replyToMessage.message_id}`);
  }

  const author = formatReplyAuthor(replyToMessage.from);

  if (author) {
    lines.push(`- author: ${author}`);
  }

  const sentAt = formatReplySentAt(replyToMessage.date);

  if (sentAt) {
    lines.push(`- sentAt: ${sentAt}`);
  }

  const text = normalizeReplyText(replyToMessage.text);

  if (text) {
    lines.push(`- text: ${text}`);
  }

  const caption = normalizeReplyText(replyToMessage.caption);

  if (caption) {
    lines.push(`- caption: ${caption}`);
  }

  const attachments = await resolveReplyAttachments({
    chatId: input.chatId,
    replyToMessage,
    env: input.env ?? process.env,
  });

  for (const [index, attachment] of attachments.entries()) {
    const attachmentIndex = index + 1;
    lines.push(`- attachment ${attachmentIndex}: [${attachment.kind}] ${attachment.name}`);

    if (attachment.path) {
      lines.push(`- attachment ${attachmentIndex} path: ${attachment.path}`);
    }
  }

  if (lines.length === 0) {
    return input.messageText;
  }

  return ["Reply context", ...lines, "", "Current user message", input.messageText].join("\n");
}

async function resolveReplyAttachments(input: {
  chatId: number;
  replyToMessage: ReplyMessage;
  env: Env;
}): Promise<ReplyAttachmentContext[]> {
  const bundleAttachments = await loadReplyBundleAttachments(input);

  if (bundleAttachments.length > 0) {
    return bundleAttachments;
  }

  if (input.replyToMessage.document) {
    return [
      {
        kind: "document",
        name: normalizeReplyText(input.replyToMessage.document.file_name) ?? "document",
      },
    ];
  }

  if (Array.isArray(input.replyToMessage.photo) && input.replyToMessage.photo.length > 0) {
    const largestPhoto = pickLargestPhoto(input.replyToMessage.photo);

    return [
      {
        kind: "photo",
        name: normalizeReplyText(largestPhoto?.file_id) ?? "photo",
      },
    ];
  }

  return [];
}

async function loadReplyBundleAttachments(input: {
  chatId: number;
  replyToMessage: ReplyMessage;
  env: Env;
}): Promise<ReplyAttachmentContext[]> {
  try {
    const workspaceDir = resolveWorkspaceDir(input.env);
    const bundle = await loadReplyBundleRecord(workspaceDir, input.chatId, input.replyToMessage);

    if (!bundle || !Array.isArray(bundle.attachments)) {
      return [];
    }

    return bundle.attachments.flatMap((attachment) => {
      const record = attachment as ReplyBundleAttachmentRecord;

      if (record.kind !== "document" && record.kind !== "photo") {
        return [];
      }

      const name = normalizeReplyText(record.name) ?? (record.kind === "photo" ? "photo" : "document");
      const attachmentPath = normalizeReplyText(record.path);

      return [
        {
          kind: record.kind,
          name,
          ...(attachmentPath ? { path: attachmentPath } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

async function loadReplyBundleRecord(
  workspaceDir: string,
  chatId: number,
  replyToMessage: ReplyMessage,
): Promise<ReplyBundleRecord | null> {
  if (typeof replyToMessage.message_id === "number") {
    const directBundle = await readReplyBundleJson(
      path.join(
        getTelegramMessageBundleDirectory(workspaceDir, chatId, replyToMessage.message_id),
        "bundle.json",
      ),
    );

    if (directBundle) {
      return directBundle;
    }
  }

  const mediaGroupId = normalizeReplyText(replyToMessage.media_group_id);

  if (!mediaGroupId) {
    return null;
  }

  return findReplyBundleByMediaGroupId(workspaceDir, chatId, mediaGroupId);
}

async function findReplyBundleByMediaGroupId(
  workspaceDir: string,
  chatId: number,
  mediaGroupId: string,
): Promise<ReplyBundleRecord | null> {
  const inboxDir = path.join(workspaceDir, "inbox", String(chatId));
  const entries = await readdir(inboxDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const bundle = await readReplyBundleJson(path.join(inboxDir, entry.name, "bundle.json"));

    if (normalizeReplyText((bundle as { mediaGroupId?: unknown } | null)?.mediaGroupId) === mediaGroupId) {
      return bundle;
    }
  }

  return null;
}

async function readReplyBundleJson(bundleJsonPath: string): Promise<ReplyBundleRecord | null> {
  try {
    return JSON.parse(await readFile(bundleJsonPath, "utf8")) as ReplyBundleRecord;
  } catch {
    return null;
  }
}

function formatReplyAuthor(author: ReplyAuthor | undefined): string | null {
  if (!author) {
    return null;
  }

  const name = [author.first_name, author.last_name]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const username = author.username?.trim();

  if (name && username) {
    return `${name} (@${username})`;
  }

  if (name) {
    return name;
  }

  if (username) {
    return `@${username}`;
  }

  return null;
}

function formatReplySentAt(date: number | undefined): string | null {
  if (typeof date !== "number" || !Number.isFinite(date)) {
    return null;
  }

  return new Date(date * 1000).toISOString();
}

function normalizeReplyText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function pickLargestPhoto(photos: ReplyPhoto[]): ReplyPhoto | null {
  if (photos.length === 0) {
    return null;
  }

  return photos.reduce((largest, current) =>
    (current.width ?? 0) * (current.height ?? 0) > (largest.width ?? 0) * (largest.height ?? 0)
      ? current
      : largest,
  );
}
