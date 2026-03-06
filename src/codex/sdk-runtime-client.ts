import { Codex, type Thread, type ThreadItem, type ThreadOptions } from "@openai/codex-sdk";
import { createCodexClient } from "./codex-client";

type RuntimeThread = {
  id: string | null;
  thread: Thread;
};

export function createSdkRuntimeClient(apiKey: string | null, workingDirectory: string) {
  const sdk = apiKey ? new Codex({ apiKey }) : new Codex();
  const threadOptions: ThreadOptions = {
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
    workingDirectory,
    skipGitRepoCheck: true,
    networkAccessEnabled: true,
  };

  return createCodexClient<RuntimeThread>({
    startThread: async () => ({
      id: null,
      thread: sdk.startThread(threadOptions),
    }),
    resumeThread: async (threadId) => ({
      id: threadId,
      thread: sdk.resumeThread(threadId, threadOptions),
    }),
    runPrompt: async (runtimeThread, prompt, { signal }) => {
      try {
        const turn = await runtimeThread.thread.run(prompt, { signal });

        return {
          summary: turn.finalResponse,
          touchedPaths: collectTouchedPaths(turn.items),
        };
      } finally {
        syncThreadId(runtimeThread);
      }
    },
  });
}

function syncThreadId(runtimeThread: RuntimeThread): void {
  const threadId = runtimeThread.thread.id;

  if (typeof threadId === "string" && threadId.trim().length > 0) {
    runtimeThread.id = threadId;
  }
}

function collectTouchedPaths(items: ThreadItem[]): string[] {
  const touchedPaths = new Set<string>();

  for (const item of items) {
    if (item.type !== "file_change" || item.status !== "completed") {
      continue;
    }

    for (const change of item.changes) {
      touchedPaths.add(change.path);
    }
  }

  return [...touchedPaths];
}
