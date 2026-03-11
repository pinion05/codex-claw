import { afterEach, describe, expect, mock, test } from "bun:test";
import { toTelegramCommandPayload } from "../../src/bot/command-definitions";

type TelegramCommandSyncModule = typeof import("../../src/bot/telegram-command-sync");

afterEach(() => {
  mock.restore();
});

async function loadTelegramCommandSyncModule(): Promise<TelegramCommandSyncModule> {
  return import(`../../src/bot/telegram-command-sync.ts?test=${Date.now()}-${Math.random()}`);
}

describe("syncTelegramCommands", () => {
  test("syncs Telegram command payload from the command registry", async () => {
    const { syncTelegramCommands } = await loadTelegramCommandSyncModule();
    const setMyCommands = mock(async () => undefined);

    await syncTelegramCommands({
      api: {
        setMyCommands,
      },
    } as never);

    expect(setMyCommands).toHaveBeenCalledTimes(1);
    expect(setMyCommands).toHaveBeenCalledWith(toTelegramCommandPayload());
  });

  test("does not throw when Telegram command sync fails", async () => {
    const { syncTelegramCommands } = await loadTelegramCommandSyncModule();
    const failure = new Error("telegram api unavailable");
    const setMyCommands = mock(async () => {
      throw failure;
    });
    const warn = mock((_message: string, _error: unknown) => undefined);

    await expect(
      syncTelegramCommands(
        {
          api: {
            setMyCommands,
          },
        } as never,
        {
          logger: { warn },
        },
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[codex-claw] failed to sync Telegram commands",
      failure,
    );
  });
});
