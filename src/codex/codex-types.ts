export type CodexRunRequest = {
  threadId: string | null;
  prompt: string;
  signal?: AbortSignal;
};

export type CodexRunResult = {
  threadId: string;
  summary: string;
  touchedPaths: string[];
};
