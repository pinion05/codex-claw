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

export type RunLogger = {
  writeRunLog: (payload: RunLogPayload) => Promise<string>;
};

export type WriteRunLogInput = RunLogPayload & {
  workspaceDir: string;
};

export async function writeRunLog({
  workspaceDir,
  completedAt,
  ...payload
}: WriteRunLogInput): Promise<string> {
  const completedDate = new Date(completedAt);
  const year = completedDate.getUTCFullYear().toString().padStart(4, "0");
  const month = (completedDate.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = completedDate.getUTCDate().toString().padStart(2, "0");
  const directory = path.join(workspaceDir, "logs", year, month, day);
  const safeTimestamp = completedAt.replaceAll(":", "-");
  const filePath = path.join(directory, `${safeTimestamp}-${randomUUID()}.json`);

  await mkdir(directory, { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        ...payload,
        completedAt,
      },
      null,
      2,
    ),
  );

  return filePath;
}

export function createRunLogger(workspaceDir: string): RunLogger {
  return {
    writeRunLog(payload) {
      return writeRunLog({
        workspaceDir,
        ...payload,
      });
    },
  };
}
