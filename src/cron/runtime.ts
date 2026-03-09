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

export function createCronRuntime({
  codexClawHomeDir,
  dispatchPrompt,
  codex,
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

  async function refresh(): Promise<RefreshReport> {
    const loaded = await loadSpecs();
    const injected = injector.reconcile(loaded.specs);

    return {
      registered: injected.registered,
      skippedDisabled: injected.skippedDisabled,
      errors: [...loaded.errors, ...injected.errors],
    };
  }

  async function tick(now = new Date()): Promise<RefreshReport> {
    const report = await refresh();
    await scheduler.tick(now);
    return report;
  }

  async function start(): Promise<RefreshReport> {
    const report = await tick();

    timer = setIntervalFn(() => {
      void tick();
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
