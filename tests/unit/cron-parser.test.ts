import { describe, expect, test } from "bun:test";
import { parseScheduledJobDefinition } from "../../src/cron/parser";

describe("parseScheduledJobDefinition", () => {
  test("parses a daily scheduled job", () => {
    expect(
      parseScheduledJobDefinition({
        sourcePath: "/tmp/cronjobs/daily-summary.json",
        raw: {
          id: "daily-summary",
          time: "09:00",
          action: {
            type: "message",
            prompt: "Summarize the latest workspace changes.",
          },
        },
      }),
    ).toEqual({
      id: "daily-summary",
      sourcePath: "/tmp/cronjobs/daily-summary.json",
      date: null,
      time: "09:00",
      hour: 9,
      minute: 0,
      disabled: false,
      action: {
        type: "message",
        prompt: "Summarize the latest workspace changes.",
      },
    });
  });

  test("parses a one-shot scheduled job", () => {
    expect(
      parseScheduledJobDefinition({
        sourcePath: "/tmp/cronjobs/launch-reminder.json",
        raw: {
          id: "launch-reminder",
          date: "2027-07-12",
          time: "16:00",
          disabled: true,
          action: {
            type: "message",
            prompt: "Prepare the launch day checklist.",
          },
        },
      }),
    ).toEqual({
      id: "launch-reminder",
      sourcePath: "/tmp/cronjobs/launch-reminder.json",
      date: "2027-07-12",
      time: "16:00",
      hour: 16,
      minute: 0,
      disabled: true,
      action: {
        type: "message",
        prompt: "Prepare the launch day checklist.",
      },
    });
  });

  test("rejects a missing id", () => {
    expect(() =>
      parseScheduledJobDefinition({
        sourcePath: "/tmp/cronjobs/bad.json",
        raw: {
          time: "09:00",
          action: {
            type: "message",
            prompt: "hello",
          },
        },
      }),
    ).toThrow("id must be a non-empty string");
  });

  test("rejects an invalid time", () => {
    expect(() =>
      parseScheduledJobDefinition({
        sourcePath: "/tmp/cronjobs/bad.json",
        raw: {
          id: "bad-time",
          time: "25:00",
          action: {
            type: "message",
            prompt: "hello",
          },
        },
      }),
    ).toThrow("time must be in HH:mm format");
  });

  test("rejects an invalid date", () => {
    expect(() =>
      parseScheduledJobDefinition({
        sourcePath: "/tmp/cronjobs/bad.json",
        raw: {
          id: "bad-date",
          date: "2027-13-40",
          time: "16:00",
          action: {
            type: "message",
            prompt: "hello",
          },
        },
      }),
    ).toThrow("date must be in YYYY-MM-DD format");
  });

  test("rejects a missing action prompt", () => {
    expect(() =>
      parseScheduledJobDefinition({
        sourcePath: "/tmp/cronjobs/bad.json",
        raw: {
          id: "missing-prompt",
          time: "16:00",
          action: {
            type: "message",
          },
        },
      }),
    ).toThrow("action.prompt must be a non-empty string");
  });

  test("rejects an unsupported action type", () => {
    expect(() =>
      parseScheduledJobDefinition({
        sourcePath: "/tmp/cronjobs/bad.json",
        raw: {
          id: "bad-action",
          time: "16:00",
          action: {
            type: "shell",
            prompt: "hello",
          },
        },
      }),
    ).toThrow('action.type must be "message"');
  });
});
