export type CodexRunRequest = {
  threadId: string | null;
  prompt: string;
};

export type CodexRunResult = {
  threadId: string;
  summary: string;
  touchedPaths: string[];
};
