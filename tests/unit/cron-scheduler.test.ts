import { describe, expect, mock, test } from "bun:test";
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

  test("does not re-run the same job twice in the same minute", async () => {
    const scheduler = createScheduledJobScheduler();
    const job = createJob({ id: "daily-summary" });
    const run = mock(async () => undefined);
    scheduler.upsert(job, run);

    await scheduler.tick(new Date(2027, 6, 11, 9, 0, 50));
    await scheduler.tick(new Date(2027, 6, 11, 9, 0, 55));

    expect(run).toHaveBeenCalledTimes(1);
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

  test("continues running other due jobs when one job fails", async () => {
    const scheduler = createScheduledJobScheduler();
    const firstRun = mock(async () => {
      throw new Error("first failed");
    });
    const secondRun = mock(async () => undefined);

    scheduler.upsert(createJob({ id: "first-job" }), firstRun);
    scheduler.upsert(createJob({ id: "second-job" }), secondRun);

    await expect(scheduler.tick(new Date(2027, 6, 11, 9, 0, 0))).rejects.toThrow("first failed");
    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  test("retries a failed job again within the same minute", async () => {
    const scheduler = createScheduledJobScheduler();
    const run = mock(async () => {
      if (run.mock.calls.length === 1) {
        throw new Error("temporary failure");
      }
    });

    scheduler.upsert(createJob({ id: "retry-job" }), run);

    await expect(scheduler.tick(new Date(2027, 6, 11, 9, 0, 0))).rejects.toThrow("temporary failure");
    await expect(scheduler.tick(new Date(2027, 6, 11, 9, 0, 30))).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("does not start the same job twice while the first run is still in flight", async () => {
    const scheduler = createScheduledJobScheduler();
    let releaseFirstRun: (() => void) | undefined;
    const firstRunFinished = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    const run = mock(async () => {
      await firstRunFinished;
    });

    scheduler.upsert(createJob({ id: "in-flight-job" }), run);

    const firstTick = scheduler.tick(new Date(2027, 6, 11, 9, 0, 0));
    await Promise.resolve();
    const secondTick = scheduler.tick(new Date(2027, 6, 11, 9, 0, 15));
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(1);

    releaseFirstRun?.();
    await expect(firstTick).resolves.toBeUndefined();
    await expect(secondTick).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
