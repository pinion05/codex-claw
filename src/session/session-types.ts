export type AgentSession = {
  chatId: string;
  threadId: string | null;
  isRunning: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastSummary: string | null;
  logFile: string | null;
};
