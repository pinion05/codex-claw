import { detectScheduledJobDefinitions } from "./detector";
import { createScheduledJobInjector } from "./injector";
import { parseScheduledJobDefinition } from "./parser";
import { createScheduledJobScheduler } from "./scheduler";
import type { ScheduledJobIssue, ScheduledJobSpec } from "./types";
import { disableScheduledJobDefinition } from "./workspace";

type RefreshReport = {
  registered: string[];
  skippedDisabled: string[];
  errors: ScheduledJobIssue[];
};

type TimerHandle = ReturnType<typeof setInterval>;

function createEmptyRefreshReport(): RefreshReport {
  return {
    registered: [],
    skippedDisabled: [],
    errors: [],
  };
}

function isExpiredOneShotJob(spec: ScheduledJobSpec, now: Date): boolean {
  if (spec.date === null || spec.disabled) {
    return false;
  }

  const [year, month, day] = spec.date.split("-").map((part) => Number(part));
  const scheduledMinuteEndsAt = new Date(year, month - 1, day, spec.hour, spec.minute, 59, 999);

  return now.getTime() > scheduledMinuteEndsAt.getTime();
}

export function createCronRuntime({
  codexClawHomeDir,
  dispatchPrompt,
  codex,
  onBackgroundError,
  scheduler = createScheduledJobScheduler(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  intervalMs = 60_000,
}: {
  codexClawHomeDir?: string;
  workspaceDir?: string;
  dispatchPrompt?: (prompt: string) => Promise<void>;
  codex?: {
    runTurn: (request: { threadId: string | null; prompt: string }) => Promise<unknown>;
  };
  onBackgroundError?: (error: unknown) => void;
  scheduler?: ReturnType<typeof createScheduledJobScheduler>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  intervalMs?: number;
}) {
  const dispatch =
    dispatchPrompt ??
    (async (prompt: string) => {
      if (!codex) {
        throw new Error("createCronRuntime requires either dispatchPrompt or codex");
      }

      await codex.runTurn({
        threadId: null,
        prompt,
      });
    });
  const reportBackgroundError =
    onBackgroundError ??
    ((error: unknown) => {
      console.error("[codex-claw] cron background tick failed", error);
    });
  const injector = createScheduledJobInjector({
    scheduler,
    createRunner: (spec) => async () => {
      await dispatch(spec.action.prompt);

      if (spec.date !== null) {
        await disableScheduledJobDefinition(spec.sourcePath);
      }
    },
  });
  let timer: TimerHandle | null = null;

  async function loadSpecs(): Promise<{ specs: ScheduledJobSpec[]; errors: ScheduledJobIssue[] }> {
    const detected = await detectScheduledJobDefinitions({ codexClawHomeDir });
    const specs: ScheduledJobSpec[] = [];
    const errors = [...detected.errors];

    for (const definition of detected.definitions) {
      try {
        specs.push(parseScheduledJobDefinition(definition));
      } catch (error) {
        errors.push({
          sourcePath: definition.sourcePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      specs,
      errors,
    };
  }

  async function refresh(now = new Date()): Promise<RefreshReport> {
    const loaded = await loadSpecs();
    const activeSpecs: ScheduledJobSpec[] = [];
    const errors = [...loaded.errors];

    for (const spec of loaded.specs) {
      if (isExpiredOneShotJob(spec, now)) {
        errors.push({
          sourcePath: spec.sourcePath,
          message: `Scheduled one-shot job "${spec.id}" has expired`,
        });
        continue;
      }

      activeSpecs.push(spec);
    }

    const injected = injector.reconcile(activeSpecs);

    return {
      registered: injected.registered,
      skippedDisabled: injected.skippedDisabled,
      errors: [...errors, ...injected.errors],
    };
  }

  async function tick(now = new Date()): Promise<RefreshReport> {
    const report = await refresh(now);
    await scheduler.tick(now);
    return report;
  }

  async function start(): Promise<RefreshReport> {
    const now = new Date();
    let report = createEmptyRefreshReport();

    try {
      report = await refresh(now);
    } catch (error) {
      reportBackgroundError(error);
    }

    try {
      await scheduler.tick(now);
    } catch (error) {
      reportBackgroundError(error);
    }

    timer = setIntervalFn(() => {
      void tick().catch(reportBackgroundError);
    }, intervalMs);

    return report;
  }

  function stop(): void {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }

    scheduler.stopAll();
  }

  return {
    syncNow: refresh,
    refresh,
    tick,
    start,
    stop,
    getRegisteredJobIds: () => scheduler.listJobIds(),
  };
}
