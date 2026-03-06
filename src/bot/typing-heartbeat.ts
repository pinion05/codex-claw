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
  const heartbeat = () => {
    void Promise.resolve(sendTyping()).catch(() => undefined);
  };

  heartbeat();

  const intervalId = resolvedTimers.setInterval(() => {
    heartbeat();
  }, intervalMs);

  return () => {
    resolvedTimers.clearInterval(intervalId);
  };
}
