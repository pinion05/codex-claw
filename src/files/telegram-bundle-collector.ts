export type TelegramBundleCollectorState =
  | "collecting"
  | "finalizing"
  | "completed"
  | "failed";

export interface TelegramBundleCollectorScheduler {
  schedule(callback: () => Promise<void> | void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export type TelegramBundleCollectorInput<TAttachment> = {
  chatId: number;
  messageId: number;
  mediaGroupId?: string | null;
  caption?: string | null;
  attachments: TAttachment[];
};

export type TelegramBundle<TAttachment> = {
  chatId: number;
  messageId: number;
  mediaGroupId: string | null;
  caption: string | null;
  attachments: TAttachment[];
  state: TelegramBundleCollectorState;
};

export type TelegramBundleCollectorResult<TAttachment> =
  | {
      kind: "collecting";
      bundle: TelegramBundle<TAttachment>;
    }
  | {
      kind: "finalized";
      bundle: TelegramBundle<TAttachment>;
    }
  | {
      kind: "ignored";
      reason: Extract<TelegramBundleCollectorState, "completed" | "finalizing" | "failed">;
      bundle: TelegramBundle<TAttachment>;
    };

type TelegramBundleCollectorOptions<TAttachment> = {
  quietPeriodMs: number;
  scheduler: TelegramBundleCollectorScheduler;
  onFinalize?: (bundle: TelegramBundle<TAttachment>) => Promise<void> | void;
  tombstoneTtlMs?: number;
};

type InternalBundleEntry<TAttachment> = {
  key: string;
  chatId: number;
  mediaGroupId: string;
  caption: string | null;
  groups: AttachmentGroup<TAttachment>[];
  state: TelegramBundleCollectorState;
  handle?: unknown;
};

type AttachmentGroup<TAttachment> = {
  messageId: number;
  sequence: number;
  attachments: TAttachment[];
};

export class TelegramBundleCollector<TAttachment> {
  private readonly quietPeriodMs: number;
  private readonly tombstoneTtlMs: number;
  private readonly scheduler: TelegramBundleCollectorScheduler;
  private readonly onFinalize?: (bundle: TelegramBundle<TAttachment>) => Promise<void> | void;
  private readonly entries = new Map<string, InternalBundleEntry<TAttachment>>();
  private nextSequence = 1;

  constructor(options: TelegramBundleCollectorOptions<TAttachment>) {
    this.quietPeriodMs = options.quietPeriodMs;
    this.tombstoneTtlMs = options.tombstoneTtlMs ?? Math.max(options.quietPeriodMs * 5, 5_000);
    this.scheduler = options.scheduler;
    this.onFinalize = options.onFinalize;
  }

  async collect(
    input: TelegramBundleCollectorInput<TAttachment>,
  ): Promise<TelegramBundleCollectorResult<TAttachment>> {
    const mediaGroupId = normalizeMediaGroupId(input.mediaGroupId);

    if (!mediaGroupId) {
      return this.finalizeImmediate(input);
    }

    const key = buildTelegramBundleCollectorKey(input.chatId, mediaGroupId);
    const existingEntry = this.entries.get(key);

    if (existingEntry) {
      if (existingEntry.state !== "collecting") {
        return {
          kind: "ignored",
          reason: existingEntry.state,
          bundle: toBundle(existingEntry),
        };
      }

      mergeIntoEntry(existingEntry, input, this.nextSequence++);
      this.scheduleFinalize(existingEntry);

      return {
        kind: "collecting",
        bundle: toBundle(existingEntry),
      };
    }

    const entry: InternalBundleEntry<TAttachment> = {
      key,
      chatId: input.chatId,
      mediaGroupId,
      caption: normalizeCaption(input.caption),
      groups: [toAttachmentGroup(input, this.nextSequence++)],
      state: "collecting",
    };

    this.entries.set(key, entry);
    this.scheduleFinalize(entry);

    return {
      kind: "collecting",
      bundle: toBundle(entry),
    };
  }

  getState(chatId: number, mediaGroupId: string): TelegramBundleCollectorState | null {
    const entry = this.entries.get(buildTelegramBundleCollectorKey(chatId, mediaGroupId));
    return entry?.state ?? null;
  }

  private async finalizeImmediate(
    input: TelegramBundleCollectorInput<TAttachment>,
  ): Promise<TelegramBundleCollectorResult<TAttachment>> {
    const finalizingBundle: TelegramBundle<TAttachment> = {
      chatId: input.chatId,
      messageId: input.messageId,
      mediaGroupId: null,
      caption: normalizeCaption(input.caption),
      attachments: [...input.attachments],
      state: "finalizing",
    };

    try {
      const finalizedBundle = {
        ...finalizingBundle,
        state: "completed" as const,
      };

      await this.onFinalize?.(finalizedBundle);

      return {
        kind: "finalized",
        bundle: finalizedBundle,
      };
    } catch (error) {
      throw error;
    }
  }

  private scheduleFinalize(entry: InternalBundleEntry<TAttachment>): void {
    if (entry.handle !== undefined) {
      this.scheduler.cancel(entry.handle);
    }

    entry.handle = this.scheduler.schedule(() => {
      return this.finalizeCollectedEntry(entry.key);
    }, this.quietPeriodMs);
  }

  private async finalizeCollectedEntry(key: string): Promise<void> {
    const entry = this.entries.get(key);

    if (!entry || entry.state !== "collecting") {
      return;
    }

    entry.handle = undefined;
    entry.state = "finalizing";

    const finalizedBundle = {
      ...toBundle(entry),
      state: "completed" as const,
    };

    entry.state = "completed";
    this.scheduleCleanup(entry);

    try {
      await this.onFinalize?.(finalizedBundle);
    } catch {
      // Collection is already finalized at this point. Processing failures are
      // surfaced by the caller and should not reopen the bundle.
    }
  }

  private scheduleCleanup(entry: InternalBundleEntry<TAttachment>): void {
    entry.handle = this.scheduler.schedule(() => {
      const currentEntry = this.entries.get(entry.key);

      if (currentEntry !== entry) {
        return;
      }

      if (currentEntry.state === "collecting" || currentEntry.state === "finalizing") {
        return;
      }

      currentEntry.handle = undefined;
      this.entries.delete(entry.key);
    }, this.tombstoneTtlMs);
  }
}

export function buildTelegramBundleCollectorKey(chatId: number, mediaGroupId: string): string {
  return `${chatId}:${mediaGroupId}`;
}

function mergeIntoEntry<TAttachment>(
  entry: InternalBundleEntry<TAttachment>,
  input: TelegramBundleCollectorInput<TAttachment>,
  sequence: number,
): void {
  entry.groups.push(toAttachmentGroup(input, sequence));

  if (entry.caption !== null) {
    return;
  }

  const nextCaption = normalizeCaption(input.caption);

  if (nextCaption !== null) {
    entry.caption = nextCaption;
  }
}

function normalizeMediaGroupId(mediaGroupId?: string | null): string | null {
  const normalizedMediaGroupId = mediaGroupId?.trim();
  return normalizedMediaGroupId ? normalizedMediaGroupId : null;
}

function normalizeCaption(caption?: string | null): string | null {
  const normalizedCaption = caption?.trim();
  return normalizedCaption ? normalizedCaption : null;
}

function toBundle<TAttachment>(
  entry: Pick<
    InternalBundleEntry<TAttachment>,
    "chatId" | "mediaGroupId" | "caption" | "groups" | "state"
  >,
): TelegramBundle<TAttachment> {
  const orderedGroups = [...entry.groups].sort(
    (left, right) => left.messageId - right.messageId || left.sequence - right.sequence,
  );

  return {
    chatId: entry.chatId,
    messageId: orderedGroups[0]?.messageId ?? 0,
    mediaGroupId: entry.mediaGroupId,
    caption: entry.caption,
    attachments: orderedGroups.flatMap((group) => group.attachments),
    state: entry.state,
  };
}

function toAttachmentGroup<TAttachment>(
  input: TelegramBundleCollectorInput<TAttachment>,
  sequence: number,
): AttachmentGroup<TAttachment> {
  return {
    messageId: input.messageId,
    sequence,
    attachments: [...input.attachments],
  };
}
