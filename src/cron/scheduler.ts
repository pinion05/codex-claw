import type { ScheduledJobSpec } from "./types";

type ScheduledJobRunner = () => Promise<void>;

type RegisteredJob = {
  spec: ScheduledJobSpec;
  run: ScheduledJobRunner;
};

function getMinuteKey(spec: ScheduledJobSpec, date: Date): string {
  return `${spec.id}:${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

function matchesScheduledMinute(spec: ScheduledJobSpec, date: Date): boolean {
  if (spec.disabled) {
    return false;
  }

  if (spec.hour !== date.getHours() || spec.minute !== date.getMinutes()) {
    return false;
  }

  if (spec.date === null) {
    return true;
  }

  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return spec.date === `${year}-${month}-${day}`;
}

export function createScheduledJobScheduler() {
  const jobs = new Map<string, RegisteredJob>();
  const executedMinuteKeys = new Set<string>();

  return {
    getDueJobs(specs: ScheduledJobSpec[], now = new Date()): ScheduledJobSpec[] {
      const due: ScheduledJobSpec[] = [];

      for (const spec of specs) {
        if (!matchesScheduledMinute(spec, now)) {
          continue;
        }

        const minuteKey = getMinuteKey(spec, now);

        if (executedMinuteKeys.has(minuteKey)) {
          continue;
        }

        executedMinuteKeys.add(minuteKey);
        due.push(spec);
      }

      return due;
    },
    upsert(spec: ScheduledJobSpec, run: ScheduledJobRunner): void {
      jobs.set(spec.id, { spec, run });
    },
    remove(jobId: string): void {
      jobs.delete(jobId);
    },
    listJobIds(): string[] {
      return [...jobs.keys()].sort((left, right) => left.localeCompare(right));
    },
    async tick(now = new Date()): Promise<void> {
      const dueJobs = this.getDueJobs(
        [...jobs.values()].map((entry) => entry.spec),
        now,
      );

      for (const spec of dueJobs) {
        const registered = jobs.get(spec.id);

        if (!registered) {
          continue;
        }

        await registered.run();
      }
    },
    stopAll(): void {
      jobs.clear();
      executedMinuteKeys.clear();
    },
  };
}
