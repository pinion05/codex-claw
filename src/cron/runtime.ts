import { detectScheduledJobDefinitions } from "./detector";
import { createScheduledJobInjector } from "./injector";
import { parseScheduledJobDefinition } from "./parser";
import { createScheduledJobScheduler } from "./scheduler";
import type { ScheduledJobIssue, ScheduledJobSpec } from "./types";
import { disableScheduledJobDefinition } from "./workspace";
import { formatCronCompletedMessage } from "../bot/formatters";

type RefreshReport = {
  registered: string[];
  skippedDisabled: string[];
  errors: ScheduledJobIssue[];
};

type CronDispatchResult = {
  summary: string | null;
  threadId: string | null;
};

type CronExecutionEvent = {
  jobId: string;
  phase: "execution" | "delivery" | "skip";
  status: "completed" | "failed" | "skipped";
  reason?: string;
  chatId?: bigint | null;
  threadId?: string | null;
  error?: string | null;
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
  resolveCronTargetChatId,
  // Backward-compatible no-op: interactive runs no longer gate cron execution.
  isInteractiveRunActive: _isInteractiveRunActive,
  deliverCronResult,
  logCronExecution,
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
  resolveCronTargetChatId?: () => Promise<bigint | null>;
  isInteractiveRunActive?: () => Promise<boolean>;
  deliverCronResult?: (chatId: bigint, text: string) => Promise<void>;
  logCronExecution?: (event: CronExecutionEvent) => Promise<void> | void;
  onBackgroundError?: (error: unknown) => void;
  scheduler?: ReturnType<typeof createScheduledJobScheduler>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  intervalMs?: number;
}) {
  const reportBackgroundError =
    onBackgroundError ??
    ((error: unknown) => {
      console.error("[codex-claw] cron background tick failed", error);
    });
  const dispatchWithCodex = async (prompt: string): Promise<CronDispatchResult> => {
    if (dispatchPrompt) {
      await dispatchPrompt(prompt);
      return {
        summary: null,
        threadId: null,
      };
    }

    if (!codex) {
      throw new Error("createCronRuntime requires either dispatchPrompt or codex");
    }

    const result = await codex.runTurn({
      threadId: null,
      prompt,
    });

    return normalizeCronDispatchResult(result);
  };
  const dispatchCronPrompt = async (prompt: string): Promise<CronDispatchResult> => {
    if (dispatchPrompt) {
      await dispatchPrompt(prompt);
      return {
        summary: null,
        threadId: null,
      };
    }

    if (!codex) {
      throw new Error("createCronRuntime requires either dispatchPrompt or codex");
    }

    return dispatchWithCodex(prompt);
  };
  const logCronEvent = async (event: CronExecutionEvent) => {
    try {
      await logCronExecution?.(event);
    } catch (error) {
      reportBackgroundError(error);
    }
  };
  const injector = createScheduledJobInjector({
    scheduler,
    createRunner: (spec) => async () => {
      const targetChatId = resolveCronTargetChatId ? await resolveCronTargetChatId() : undefined;

      if (targetChatId === null) {
        await logCronEvent({
          jobId: spec.id,
          phase: "skip",
          status: "skipped",
          reason: "no-target-chat",
        });
        return;
      }

      let result: CronDispatchResult;

      try {
        result = await dispatchCronPrompt(spec.action.prompt);
      } catch (error) {
        await logCronEvent({
          jobId: spec.id,
          phase: "execution",
          status: "failed",
          chatId: targetChatId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      await logCronEvent({
        jobId: spec.id,
        phase: "execution",
        status: "completed",
        chatId: targetChatId,
        threadId: result.threadId,
      });

      if (spec.date !== null) {
        await disableScheduledJobDefinition(spec.sourcePath);
      }

      if (targetChatId === undefined || !deliverCronResult) {
        return;
      }

      try {
        await deliverCronResult(targetChatId, formatCronCompletedMessage(result.summary));
        await logCronEvent({
          jobId: spec.id,
          phase: "delivery",
          status: "completed",
          chatId: targetChatId,
          threadId: result.threadId,
        });
      } catch (error) {
        await logCronEvent({
          jobId: spec.id,
          phase: "delivery",
          status: "failed",
          chatId: targetChatId,
          threadId: result.threadId,
          error: error instanceof Error ? error.message : String(error),
        });
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

function normalizeCronDispatchResult(value: unknown): CronDispatchResult {
  if (!value || typeof value !== "object") {
    return {
      summary: null,
      threadId: null,
    };
  }

  const result = value as Record<string, unknown>;

  return {
    summary: typeof result.summary === "string" ? result.summary : null,
    threadId: typeof result.threadId === "string" ? result.threadId : null,
  };
}
