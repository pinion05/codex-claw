import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentSession } from "./session-types";

export class FileSessionStore {
  private readonly sessionPath: string;

  constructor(private readonly workspaceDir: string) {
    this.sessionPath = path.join(workspaceDir, "state", "session.json");
  }

  async getOrCreate(chatId: bigint): Promise<AgentSession> {
    const session = await this.read();

    if (session) {
      return session;
    }

    const emptySession = this.createEmptySession(chatId);
    await this.save(emptySession);
    return emptySession;
  }

  async save(session: AgentSession): Promise<void> {
    await mkdir(path.dirname(this.sessionPath), { recursive: true });
    await writeFile(this.sessionPath, JSON.stringify(session, null, 2));
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
      return JSON.parse(content) as AgentSession;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
