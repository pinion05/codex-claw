import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type RunLogPayload = {
  chatId: string;
  prompt: string;
  threadId: string | null;
  summary: string | null;
  touchedPaths: string[];
  startedAt: string;
  completedAt: string;
  status: "completed" | "failed";
  error: { message: string } | null;
};

export type CronLogPayload = {
  jobId: string;
  phase: "execution" | "delivery" | "skip";
  status: "completed" | "failed" | "skipped";
  reason?: string;
  chatId: string | null;
  threadId: string | null;
  error: { message: string } | null;
  loggedAt: string;
};

export type RunLogger = {
  writeRunLog: (payload: RunLogPayload) => Promise<string>;
  writeCronLog?: (payload: WriteCronLogInput) => Promise<void>;
};

export type WriteRunLogInput = RunLogPayload & {
  workspaceDir: string;
};

export type WriteCronLogInput = {
  jobId: string;
  phase: "execution" | "delivery" | "skip";
  status: "completed" | "failed" | "skipped";
  reason?: string;
  chatId?: bigint | string | null;
  threadId?: string | null;
  error?: string | null;
  loggedAt?: string;
};

function toDatePathParts(timestamp: string) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");

  return { year, month, day };
}

async function writeWorkspaceLog(
  workspaceDir: string,
  timestamp: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const { year, month, day } = toDatePathParts(timestamp);
  const directory = path.join(workspaceDir, "logs", year, month, day);
  const safeTimestamp = timestamp.replaceAll(":", "-");
  const filePath = path.join(directory, `${safeTimestamp}-${randomUUID()}.json`);

  await mkdir(directory, { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2));

  return filePath;
}

export async function writeRunLog({
  workspaceDir,
  completedAt,
  ...payload
}: WriteRunLogInput): Promise<string> {
  return writeWorkspaceLog(workspaceDir, completedAt, {
    ...payload,
    completedAt,
  });
}

export async function writeCronLog({
  workspaceDir,
  loggedAt = new Date().toISOString(),
  jobId,
  phase,
  status,
  reason,
  chatId,
  threadId,
  error,
}: WriteCronLogInput & { workspaceDir: string }): Promise<void> {
  await writeWorkspaceLog(workspaceDir, loggedAt, {
    jobId,
    phase,
    status,
    reason,
    chatId: chatId === undefined ? null : String(chatId),
    threadId: threadId ?? null,
    error: error === undefined || error === null ? null : { message: error },
    loggedAt,
  });
}

export function createRunLogger(workspaceDir: string): RunLogger {
  return {
    writeRunLog(payload) {
      return writeRunLog({
        workspaceDir,
        ...payload,
      });
    },
    writeCronLog(payload) {
      return writeCronLog({
        workspaceDir,
        ...payload,
      });
    },
  };
}
