type SendTyping = () => Promise<void> | void;

type TimerApi<Handle> = {
  setInterval: (callback: () => void, delay: number) => Handle;
  clearInterval: (handle: Handle) => void;
};

export function createTypingHeartbeat<Handle = ReturnType<typeof globalThis.setInterval>>({
  sendTyping,
  intervalMs = 4000,
  timers,
}: {
  sendTyping: SendTyping;
  intervalMs?: number;
  timers?: TimerApi<Handle>;
}) {
  const resolvedTimers =
    timers ??
    (({
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    } as unknown) as TimerApi<Handle>);
  let stopped = false;
  const runTyping = async () => {
    if (stopped) {
      return;
    }

    await Promise.resolve(sendTyping()).catch(() => undefined);
  };
  let inFlight = runTyping();

  const heartbeat = () => {
    if (stopped) {
      return inFlight;
    }

    inFlight = inFlight.then(runTyping);

    return inFlight;
  };

  const intervalId = resolvedTimers.setInterval(() => {
    void heartbeat();
  }, intervalMs);

  return async () => {
    stopped = true;
    resolvedTimers.clearInterval(intervalId);
    await inFlight;
  };
}
