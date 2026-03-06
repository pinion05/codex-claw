import type { AgentSession } from "../session/session-types";
import type { AbortRunResult, ResetSessionResult } from "../runtime/agent-runtime";

type StatusMessageInput = Pick<AgentSession, "threadId" | "isRunning" | "lastSummary">;

export function formatStatusMessage({
  threadId,
  isRunning,
  lastSummary,
}: StatusMessageInput): string {
  const lines = [`Thread: ${threadId ?? "not started"}`, `State: ${isRunning ? "running" : "idle"}`];

  if (lastSummary && lastSummary.trim().length > 0) {
    lines.push(`Last: ${lastSummary.trim()}`);
  }

  return lines.join("\n");
}

export function formatRunStartedMessage(threadId: string): string {
  return [`Run started.`, `Thread: ${threadId}`].join("\n");
}

export function formatRunCompletedMessage(summary?: string | null): string {
  const detail = preserveLineBreaks(summary);

  if (detail.length === 0) {
    return "NULL";
  }

  return detail;
}

export function formatRunAbortedMessage(): string {
  return "Run aborted.";
}

export function formatRunFailedMessage(error: string): string {
  const detail = preserveLineBreaks(error);

  if (detail.length === 0) {
    return "Run failed.";
  }

  return `Run failed. Error:\n${detail}`;
}

export function formatResetMessage(result: ResetSessionResult): string {
  if (result.ok) {
    return "Session reset.";
  }

  return "A run is still active. Wait for it to finish or use /abort first.";
}

export function formatAbortMessage(result: AbortRunResult): string {
  if (!result.ok) {
    return "No run is currently active.";
  }

  if (result.recoveredStale) {
    return "Recovered stale running state. No live run was active.";
  }

  if (result.alreadyRequested) {
    return "Abort already requested. Waiting for the current turn to stop.";
  }

  return "Abort requested. Waiting for the current turn to stop.";
}

function preserveLineBreaks(value?: string | null): string {
  if (!value) {
    return "";
  }

  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}
