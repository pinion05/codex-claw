import type { CodexRunRequest, CodexRunResult } from "./codex-types";

type CodexThread = {
  id: string;
};

type CodexPromptResult = {
  summary?: unknown;
  touchedPaths?: unknown;
};

type CodexClientDeps = {
  startThread: () => Promise<CodexThread>;
  resumeThread: (threadId: string) => Promise<CodexThread>;
  runPrompt: (thread: CodexThread, prompt: string) => Promise<CodexPromptResult>;
};

function normalizeSummary(summary: unknown): string {
  return typeof summary === "string" ? summary : "";
}

function normalizeTouchedPaths(touchedPaths: unknown): string[] {
  if (!Array.isArray(touchedPaths)) {
    return [];
  }

  return touchedPaths.filter((path): path is string => typeof path === "string");
}

export function createCodexClient({
  startThread,
  resumeThread,
  runPrompt,
}: CodexClientDeps) {
  return {
    async runTurn({ threadId, prompt }: CodexRunRequest): Promise<CodexRunResult> {
      const thread =
        threadId === null ? await startThread() : await resumeThread(threadId);
      const result = await runPrompt(thread, prompt);

      return {
        threadId: thread.id,
        summary: normalizeSummary(result.summary),
        touchedPaths: normalizeTouchedPaths(result.touchedPaths),
      };
    },
  };
}
