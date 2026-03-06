import { describe, expect, mock, test } from "bun:test";
import { createTypingHeartbeat } from "../../src/bot/typing-heartbeat";

describe("createTypingHeartbeat", () => {
  test("sends typing immediately, repeats on the configured interval, and stops cleanly", async () => {
    const sendTyping = mock(async () => undefined);
    let nextTimerId = 0;
    const scheduled = new Map<number, () => void>();
    const timers = {
      setInterval(callback: () => void, delay: number) {
        expect(delay).toBe(4000);
        const timerId = ++nextTimerId;
        scheduled.set(timerId, callback);
        return timerId;
      },
      clearInterval(timerId: number) {
        scheduled.delete(timerId);
      },
    };

    const stopTyping = createTypingHeartbeat({
      sendTyping,
      intervalMs: 4000,
      timers,
    });

    await Promise.resolve();
    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(scheduled.size).toBe(1);

    scheduled.values().next().value?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(sendTyping).toHaveBeenCalledTimes(2);

    stopTyping();
    expect(scheduled.size).toBe(0);
  });

  test("swallows chat action errors so the main request can continue", async () => {
    const sendTyping = mock(async () => {
      throw new Error("telegram unavailable");
    });
    const stopTyping = createTypingHeartbeat({
      sendTyping,
      intervalMs: 4000,
      timers: {
        setInterval: () => 1,
        clearInterval: () => undefined,
      },
    });

    await Promise.resolve();

    expect(sendTyping).toHaveBeenCalledTimes(1);
    stopTyping();
  });

  test("waits for an in-flight typing request to settle before stopping", async () => {
    let resolveTyping!: () => void;
    const sendTyping = mock(
      async () =>
        await new Promise<void>((resolve) => {
          resolveTyping = resolve;
        }),
    );

    const stopTyping = createTypingHeartbeat({
      sendTyping,
      intervalMs: 4000,
      timers: {
        setInterval: () => 1,
        clearInterval: () => undefined,
      },
    });

    const stopPromise = Promise.resolve(stopTyping());
    let settled = false;
    void stopPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveTyping();
    await stopPromise;

    expect(settled).toBe(true);
  });
});
