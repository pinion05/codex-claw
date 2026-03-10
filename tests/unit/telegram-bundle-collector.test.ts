import { describe, expect, test } from "bun:test";
import {
  TelegramBundleCollector,
  type TelegramBundleCollectorScheduler,
} from "../../src/files/telegram-bundle-collector";

type AttachmentDescriptor = {
  kind: "photo" | "document";
  fileId: string;
};

class FakeScheduler implements TelegramBundleCollectorScheduler {
  private nextHandle = 1;
  private readonly tasks = new Map<number, () => Promise<void> | void>();

  schedule(callback: () => Promise<void> | void, _delayMs: number): number {
    const handle = this.nextHandle++;
    this.tasks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.tasks.delete(handle);
  }

  async runNext(): Promise<void> {
    const nextHandle = this.tasks.keys().next().value;

    if (nextHandle == null) {
      throw new Error("No scheduled task to run");
    }

    const callback = this.tasks.get(nextHandle);

    if (!callback) {
      throw new Error(`Scheduled task ${String(nextHandle)} was missing`);
    }

    this.tasks.delete(nextHandle);
    await callback();
  }

  get size(): number {
    return this.tasks.size;
  }
}

function createPhoto(fileId: string): AttachmentDescriptor {
  return {
    kind: "photo",
    fileId,
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

describe("TelegramBundleCollector", () => {
  test("non-group updates finalize immediately", async () => {
    const scheduler = new FakeScheduler();
    const finalizedBundles: Array<{ messageId: number }> = [];
    const collector = new TelegramBundleCollector<AttachmentDescriptor>({
      quietPeriodMs: 250,
      scheduler,
      onFinalize(bundle) {
        finalizedBundles.push({ messageId: bundle.messageId });
      },
    });

    const result = await collector.collect({
      chatId: 100,
      messageId: 200,
      attachments: [createPhoto("photo-1")],
    });

    expect(result.kind).toBe("finalized");
    expect(result.bundle.state).toBe("completed");
    expect(result.bundle.mediaGroupId).toBeNull();
    expect(result.bundle.attachments).toEqual([createPhoto("photo-1")]);
    expect(finalizedBundles).toEqual([{ messageId: 200 }]);
    expect(scheduler.size).toBe(0);
  });

  test("same media group updates coalesce into one bundle", async () => {
    const scheduler = new FakeScheduler();
    const finalizedBundles: Array<{ attachments: AttachmentDescriptor[] }> = [];
    const collector = new TelegramBundleCollector<AttachmentDescriptor>({
      quietPeriodMs: 250,
      scheduler,
      onFinalize(bundle) {
        finalizedBundles.push({ attachments: bundle.attachments });
      },
    });

    const firstResult = await collector.collect({
      chatId: 100,
      messageId: 200,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-1")],
    });
    const secondResult = await collector.collect({
      chatId: 100,
      messageId: 201,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-2")],
    });

    expect(firstResult.kind).toBe("collecting");
    expect(secondResult.kind).toBe("collecting");
    expect(secondResult.bundle.state).toBe("collecting");
    expect(secondResult.bundle.attachments).toEqual([
      createPhoto("photo-1"),
      createPhoto("photo-2"),
    ]);
    expect(collector.getState(100, "album-1")).toBe("collecting");
    expect(scheduler.size).toBe(1);

    await scheduler.runNext();

    expect(finalizedBundles).toEqual([
      {
        attachments: [createPhoto("photo-1"), createPhoto("photo-2")],
      },
    ]);
    expect(collector.getState(100, "album-1")).toBe("completed");
  });

  test("uses the lowest message id as the bundle id", async () => {
    const scheduler = new FakeScheduler();
    const finalizedBundles: Array<{ messageId: number }> = [];
    const collector = new TelegramBundleCollector<AttachmentDescriptor>({
      quietPeriodMs: 250,
      scheduler,
      onFinalize(bundle) {
        finalizedBundles.push({ messageId: bundle.messageId });
      },
    });

    await collector.collect({
      chatId: 100,
      messageId: 205,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-1")],
    });
    await collector.collect({
      chatId: 100,
      messageId: 200,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-2")],
    });

    await scheduler.runNext();

    expect(finalizedBundles).toEqual([{ messageId: 200 }]);
  });

  test("later caption fills a missing caption before finalizing", async () => {
    const scheduler = new FakeScheduler();
    const finalizedBundles: Array<{ caption: string | null }> = [];
    const collector = new TelegramBundleCollector<AttachmentDescriptor>({
      quietPeriodMs: 250,
      scheduler,
      onFinalize(bundle) {
        finalizedBundles.push({ caption: bundle.caption });
      },
    });

    await collector.collect({
      chatId: 100,
      messageId: 200,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-1")],
    });

    const result = await collector.collect({
      chatId: 100,
      messageId: 201,
      mediaGroupId: "album-1",
      caption: "later caption",
      attachments: [createPhoto("photo-2")],
    });

    expect(result.kind).toBe("collecting");
    expect(result.bundle.caption).toBe("later caption");

    await scheduler.runNext();

    expect(finalizedBundles).toEqual([{ caption: "later caption" }]);
  });

  test("late arrivals after completion are ignored deterministically", async () => {
    const scheduler = new FakeScheduler();
    const finalizedBundles: Array<{ attachments: AttachmentDescriptor[] }> = [];
    const collector = new TelegramBundleCollector<AttachmentDescriptor>({
      quietPeriodMs: 250,
      scheduler,
      onFinalize(bundle) {
        finalizedBundles.push({ attachments: bundle.attachments });
      },
    });

    await collector.collect({
      chatId: 100,
      messageId: 200,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-1")],
    });

    await scheduler.runNext();

    const result = await collector.collect({
      chatId: 100,
      messageId: 201,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-2")],
    });

    expect(result).toMatchObject({
      kind: "ignored",
      reason: "completed",
    });
    expect(finalizedBundles).toEqual([
      {
        attachments: [createPhoto("photo-1")],
      },
    ]);
  });

  test("late arrivals stay ignored while finalization is still in flight", async () => {
    const scheduler = new FakeScheduler();
    const finalize = createDeferred<void>();
    const collector = new TelegramBundleCollector<AttachmentDescriptor>({
      quietPeriodMs: 250,
      scheduler,
      tombstoneTtlMs: 10,
      onFinalize: async () => {
        await finalize.promise;
      },
    });

    await collector.collect({
      chatId: 100,
      messageId: 200,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-1")],
    });

    const finalizing = scheduler.runNext();
    await Promise.resolve();

    expect(collector.getState(100, "album-1")).toBe("finalizing");
    expect(scheduler.size).toBe(0);

    const lateArrival = await collector.collect({
      chatId: 100,
      messageId: 201,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-2")],
    });

    expect(lateArrival).toMatchObject({
      kind: "ignored",
      reason: "finalizing",
    });

    finalize.resolve();
    await finalizing;

    expect(collector.getState(100, "album-1")).toBe("completed");
    expect(scheduler.size).toBe(1);
  });

  test("completed entries keep a tombstone until cleanup and then allow reuse", async () => {
    const scheduler = new FakeScheduler();
    const collector = new TelegramBundleCollector<AttachmentDescriptor>({
      quietPeriodMs: 250,
      scheduler,
    });

    await collector.collect({
      chatId: 100,
      messageId: 200,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-1")],
    });

    await scheduler.runNext();

    expect(collector.getState(100, "album-1")).toBe("completed");
    expect(scheduler.size).toBe(1);

    const lateArrival = await collector.collect({
      chatId: 100,
      messageId: 201,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-2")],
    });

    expect(lateArrival).toMatchObject({
      kind: "ignored",
      reason: "completed",
    });

    await scheduler.runNext();

    expect(collector.getState(100, "album-1")).toBeNull();

    const reusedKey = await collector.collect({
      chatId: 100,
      messageId: 202,
      mediaGroupId: "album-1",
      attachments: [createPhoto("photo-3")],
    });

    expect(reusedKey.kind).toBe("collecting");
    expect(reusedKey.bundle.attachments).toEqual([createPhoto("photo-3")]);
  });

  test("processing failures keep a failed tombstone until cleanup and then allow reuse", async () => {
    const scheduler = new FakeScheduler();
    const collector = new TelegramBundleCollector<AttachmentDescriptor>({
      quietPeriodMs: 250,
      scheduler,
      onFinalize() {
        throw new Error("finalize exploded");
      },
    });

    await collector.collect({
      chatId: 100,
      messageId: 300,
      mediaGroupId: "album-failed",
      attachments: [createPhoto("photo-1")],
    });

    await scheduler.runNext();

    expect(collector.getState(100, "album-failed")).toBe("failed");
    expect(scheduler.size).toBe(1);

    const lateArrival = await collector.collect({
      chatId: 100,
      messageId: 301,
      mediaGroupId: "album-failed",
      attachments: [createPhoto("photo-2")],
    });

    expect(lateArrival).toMatchObject({
      kind: "ignored",
      reason: "failed",
    });

    await scheduler.runNext();

    expect(collector.getState(100, "album-failed")).toBeNull();

    const reusedKey = await collector.collect({
      chatId: 100,
      messageId: 302,
      mediaGroupId: "album-failed",
      attachments: [createPhoto("photo-3")],
    });

    expect(reusedKey.kind).toBe("collecting");
    expect(reusedKey.bundle.attachments).toEqual([createPhoto("photo-3")]);
  });
});
