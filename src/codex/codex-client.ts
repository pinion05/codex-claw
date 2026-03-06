import type { CodexRunRequest, CodexRunResult } from "./codex-types";

type CodexThread = {
  id: string;
};

type CodexPromptResult = {
  summary: string;
  touchedPaths: string[];
};

type CodexClientDeps = {
  startThread: () => Promise<CodexThread>;
  resumeThread: (threadId: string) => Promise<CodexThread>;
  runPrompt: (thread: CodexThread, prompt: string) => Promise<CodexPromptResult>;
};

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
        summary: result.summary,
        touchedPaths: result.touchedPaths,
      };
    },
  };
}
