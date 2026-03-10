import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentSession } from "./session-types";

export class FileSessionStore {
  private readonly sessionPath: string;

  constructor(private readonly workspaceDir: string) {
    this.sessionPath = path.join(workspaceDir, "state", "session.json");
  }

  async getOrCreate(chatId: bigint): Promise<AgentSession> {
    const session = await this.read();
    const requestedChatId = chatId.toString();

    if (session) {
      if (session.chatId !== requestedChatId) {
        throw new Error(
          `Stored session chatId ${session.chatId} does not match requested chatId ${requestedChatId}`,
        );
      }

      return session;
    }

    const emptySession = this.createEmptySession(chatId);
    await this.save(emptySession);
    return emptySession;
  }

  async readCurrentSession(): Promise<AgentSession | null> {
    return this.read();
  }

  async save(session: AgentSession): Promise<void> {
    const directory = path.dirname(this.sessionPath);
    const tempPath = path.join(directory, `${path.basename(this.sessionPath)}.${randomUUID()}.tmp`);

    await mkdir(directory, { recursive: true });

    try {
      await writeFile(tempPath, JSON.stringify(session, null, 2));
      await rename(tempPath, this.sessionPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }

  async reset(chatId: bigint): Promise<void> {
    await this.save(this.createEmptySession(chatId));
  }

  private createEmptySession(chatId: bigint): AgentSession {
    return {
      chatId: chatId.toString(),
      threadId: null,
      isRunning: false,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastSummary: null,
      logFile: null,
    };
  }

  private async read(): Promise<AgentSession | null> {
    try {
      const content = await readFile(this.sessionPath, "utf8");
      const parsed = JSON.parse(content) as unknown;
      return parseAgentSession(parsed, this.sessionPath);
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      if (error instanceof SyntaxError) {
        throw new Error(`Invalid session file at ${this.sessionPath}: failed to parse JSON`);
      }

      if (error instanceof InvalidSessionFileError) {
        throw error;
      }

      throw error;
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function parseAgentSession(value: unknown, sessionPath: string): AgentSession {
  if (!isAgentSession(value)) {
    throw new InvalidSessionFileError(
      `Invalid session file at ${sessionPath}: expected AgentSession shape`,
    );
  }

  return value;
}

function isAgentSession(value: unknown): value is AgentSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Record<string, unknown>;

  return (
    typeof session.chatId === "string" &&
    isNullableString(session.threadId) &&
    typeof session.isRunning === "boolean" &&
    isNullableString(session.lastStartedAt) &&
    isNullableString(session.lastCompletedAt) &&
    isNullableString(session.lastSummary) &&
    isNullableString(session.logFile)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

class InvalidSessionFileError extends Error {}
