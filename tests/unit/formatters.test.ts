import { describe, expect, test } from "bun:test";
import { formatStatusMessage } from "../../src/bot/formatters";

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
