import { describe, expect, test } from "bun:test";
import {
  formatCronCompletedMessage,
  formatRunCompletedMessage,
  formatRunFailedMessage,
  formatRunStartedMessage,
  formatStatusMessage,
} from "../../src/bot/formatters";

describe("formatStatusMessage", () => {
  test("shows thread and run state in user-friendly text", () => {
    const text = formatStatusMessage({
      threadId: "thread_1",
      isRunning: false,
      lastSummary: "last run ok",
    });

    expect(text).toContain("thread_1");
    expect(text).toContain("idle");
    expect(text).toContain("last run ok");
  });
});

describe("run lifecycle formatters", () => {
  test("shows when a run starts", () => {
    const text = formatRunStartedMessage("thread_1");

    expect(text).toContain("Run started");
    expect(text).toContain("thread_1");
  });

  test("preserves multiline summaries for completion text", () => {
    expect(formatRunCompletedMessage("done\n\nwith follow-up details")).toBe(
      "done\n\nwith follow-up details",
    );
  });

  test("shows NULL when the completion summary is empty", () => {
    expect(formatRunCompletedMessage(null)).toBe("NULL");
  });

  test("shows a friendly fallback when the cron completion summary is empty", () => {
    expect(formatCronCompletedMessage(null)).toBe("Cron run completed.");
  });

  test("preserves multiline errors in failure text", () => {
    expect(formatRunFailedMessage("boom\n  at task.ts:1\n  at worker.ts:2")).toBe(
      "Run failed. Error:\nboom\n  at task.ts:1\n  at worker.ts:2",
    );
  });
});
