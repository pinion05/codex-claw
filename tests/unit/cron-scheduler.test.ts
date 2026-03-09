import { describe, expect, test } from "bun:test";
import { createScheduledJobScheduler } from "../../src/cron/scheduler";
import type { ScheduledJobSpec } from "../../src/cron/types";

function createJob(overrides: Partial<ScheduledJobSpec> & Pick<ScheduledJobSpec, "id">): ScheduledJobSpec {
  return {
    id: overrides.id,
    sourcePath: overrides.sourcePath ?? `/tmp/cronjobs/${overrides.id}.json`,
    date: overrides.date ?? null,
    time: overrides.time ?? "09:00",
    hour: overrides.hour ?? 9,
    minute: overrides.minute ?? 0,
    disabled: overrides.disabled ?? false,
    action: overrides.action ?? {
      type: "message",
      prompt: `run ${overrides.id}`,
    },
  };
}

describe("createScheduledJobScheduler", () => {
  test("returns a daily job when the local minute matches", () => {
    const scheduler = createScheduledJobScheduler();
    const dueJobs = scheduler.getDueJobs([createJob({ id: "daily-summary" })], new Date(2027, 6, 11, 9, 0, 0));

    expect(dueJobs.map((job) => job.id)).toEqual(["daily-summary"]);
  });

  test("returns a one-shot job only at the matching local date and minute", () => {
    const scheduler = createScheduledJobScheduler();
    const job = createJob({
      id: "launch-reminder",
      date: "2027-07-12",
      time: "16:00",
      hour: 16,
      minute: 0,
    });

    expect(scheduler.getDueJobs([job], new Date(2027, 6, 12, 16, 0, 0)).map((item) => item.id)).toEqual([
      "launch-reminder",
    ]);
    expect(scheduler.getDueJobs([job], new Date(2027, 6, 12, 16, 1, 0))).toEqual([]);
    expect(scheduler.getDueJobs([job], new Date(2027, 6, 11, 16, 0, 0))).toEqual([]);
  });

  test("does not re-run the same job twice in the same minute", () => {
    const scheduler = createScheduledJobScheduler();
    const job = createJob({ id: "daily-summary" });
    const currentMinute = new Date(2027, 6, 11, 9, 0, 10);

    expect(scheduler.getDueJobs([job], currentMinute).map((item) => item.id)).toEqual(["daily-summary"]);
    expect(scheduler.getDueJobs([job], new Date(2027, 6, 11, 9, 0, 50))).toEqual([]);
  });

  test("does not perform catch-up runs for missed schedules", () => {
    const scheduler = createScheduledJobScheduler();
    const job = createJob({ id: "daily-summary" });

    expect(scheduler.getDueJobs([job], new Date(2027, 6, 11, 9, 1, 0))).toEqual([]);
  });

  test("ignores disabled jobs", () => {
    const scheduler = createScheduledJobScheduler();
    const job = createJob({ id: "disabled-job", disabled: true });

    expect(scheduler.getDueJobs([job], new Date(2027, 6, 11, 9, 0, 0))).toEqual([]);
  });
});
