import type { ScheduledJobIssue, ScheduledJobSpec } from "./types";

type Scheduler = {
  upsert: (spec: ScheduledJobSpec, run: () => Promise<void>) => void;
  remove: (jobId: string) => void;
};

type ReconcileScheduledJobsArgs = {
  currentJobs: Map<string, ScheduledJobSpec>;
  nextSpecs: ScheduledJobSpec[];
};

type ReconcileScheduledJobsResult = {
  activeJobs: ScheduledJobSpec[];
  registered: ScheduledJobSpec[];
  updated: ScheduledJobSpec[];
  removed: string[];
  skippedDisabled: ScheduledJobSpec[];
  errors: ScheduledJobIssue[];
};

function buildSignature(spec: ScheduledJobSpec): string {
  return JSON.stringify(spec);
}

export function reconcileScheduledJobs({
  currentJobs,
  nextSpecs,
}: ReconcileScheduledJobsArgs): ReconcileScheduledJobsResult {
  const grouped = new Map<string, ScheduledJobSpec[]>();

  for (const spec of nextSpecs) {
    const bucket = grouped.get(spec.id) ?? [];
    bucket.push(spec);
    grouped.set(spec.id, bucket);
  }

  const activeJobs: ScheduledJobSpec[] = [];
  const registered: ScheduledJobSpec[] = [];
  const updated: ScheduledJobSpec[] = [];
  const removed: string[] = [];
  const skippedDisabled: ScheduledJobSpec[] = [];
  const errors: ScheduledJobIssue[] = [];
  const nextById = new Map<string, ScheduledJobSpec>();

  for (const [jobId, specs] of grouped) {
    if (specs.length > 1) {
      for (const spec of specs) {
        errors.push({
          sourcePath: spec.sourcePath,
          message: `Duplicate scheduled job id "${jobId}" detected`,
        });
      }
      continue;
    }

    const [spec] = specs;

    if (spec.disabled) {
      skippedDisabled.push(spec);
      continue;
    }

    nextById.set(spec.id, spec);
    activeJobs.push(spec);

    const previous = currentJobs.get(spec.id);

    if (!previous) {
      registered.push(spec);
      continue;
    }

    if (buildSignature(previous) !== buildSignature(spec)) {
      updated.push(spec);
    }
  }

  for (const jobId of currentJobs.keys()) {
    if (!nextById.has(jobId)) {
      removed.push(jobId);
    }
  }

  activeJobs.sort((left, right) => left.id.localeCompare(right.id));
  registered.sort((left, right) => left.id.localeCompare(right.id));
  updated.sort((left, right) => left.id.localeCompare(right.id));
  skippedDisabled.sort((left, right) => left.id.localeCompare(right.id));
  removed.sort((left, right) => left.localeCompare(right));

  return {
    activeJobs,
    registered,
    updated,
    removed,
    skippedDisabled,
    errors,
  };
}

export function createScheduledJobInjector({
  scheduler,
  createRunner = () => async () => undefined,
}: {
  scheduler: Scheduler;
  createRunner?: (spec: ScheduledJobSpec) => () => Promise<void>;
}) {
  const registry = new Map<string, ScheduledJobSpec>();

  return {
    reconcile(specs: ScheduledJobSpec[]) {
      const result = reconcileScheduledJobs({
        currentJobs: registry,
        nextSpecs: specs,
      });

      for (const jobId of result.removed) {
        scheduler.remove(jobId);
        registry.delete(jobId);
      }

      for (const spec of result.skippedDisabled) {
        if (registry.has(spec.id)) {
          scheduler.remove(spec.id);
          registry.delete(spec.id);
        }
      }

      for (const spec of [...result.registered, ...result.updated]) {
        scheduler.upsert(spec, createRunner(spec));
        registry.set(spec.id, spec);
      }

      return {
        registered: result.registered.map((spec) => spec.id),
        skippedDisabled: result.skippedDisabled.map((spec) => spec.id),
        errors: result.errors,
      };
    },
  };
}
