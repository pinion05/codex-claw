import { describe, expect, test } from "bun:test";
import { reconcileScheduledJobs } from "../../src/cron/injector";
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

describe("reconcileScheduledJobs", () => {
  test("registers added jobs and skips disabled ones", () => {
    const result = reconcileScheduledJobs({
      currentJobs: new Map(),
      nextSpecs: [createJob({ id: "daily-summary" }), createJob({ id: "disabled-job", disabled: true })],
    });

    expect(result.activeJobs.map((job) => job.id)).toEqual(["daily-summary"]);
    expect(result.registered.map((job) => job.id)).toEqual(["daily-summary"]);
    expect(result.updated).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.skippedDisabled.map((job) => job.id)).toEqual(["disabled-job"]);
    expect(result.errors).toEqual([]);
  });

  test("updates changed jobs and removes deleted jobs", () => {
    const currentJobs = new Map<string, ScheduledJobSpec>([
      ["daily-summary", createJob({ id: "daily-summary", time: "09:00", hour: 9 })],
      ["obsolete", createJob({ id: "obsolete", time: "10:00", hour: 10 })],
    ]);

    const result = reconcileScheduledJobs({
      currentJobs,
      nextSpecs: [createJob({ id: "daily-summary", time: "11:00", hour: 11 })],
    });

    expect(result.activeJobs.map((job) => `${job.id}:${job.time}`)).toEqual(["daily-summary:11:00"]);
    expect(result.registered).toEqual([]);
    expect(result.updated.map((job) => job.id)).toEqual(["daily-summary"]);
    expect(result.removed).toEqual(["obsolete"]);
    expect(result.skippedDisabled).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("rejects duplicate ids for the same reconciliation cycle", () => {
    const result = reconcileScheduledJobs({
      currentJobs: new Map(),
      nextSpecs: [createJob({ id: "daily-summary" }), createJob({ id: "daily-summary", time: "10:00", hour: 10 })],
    });

    expect(result.activeJobs).toEqual([]);
    expect(result.registered).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.skippedDisabled).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({
      sourcePath: "/tmp/cronjobs/daily-summary.json",
    });
    expect(result.errors[1]).toMatchObject({
      sourcePath: "/tmp/cronjobs/daily-summary.json",
    });
    expect(result.errors.every((error) => error.message.includes('Duplicate scheduled job id "daily-summary"'))).toBe(
      true,
    );
  });
});
