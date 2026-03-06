import type { AgentSession } from "../session/session-types";

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
  const detail = collapseInline(summary);

  if (detail.length === 0) {
    return "Run completed.";
  }

  return `Run completed. Summary: ${detail}`;
}

export function formatRunFailedMessage(error: string): string {
  const detail = collapseInline(error);

  if (detail.length === 0) {
    return "Run failed.";
  }

  return `Run failed. Error: ${detail}`;
}

function collapseInline(value?: string | null): string {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}
