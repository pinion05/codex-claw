import { afterEach, describe, expect, mock, test } from "bun:test";
import * as actualTelegramBotTokenModule from "../../src/config/telegram-bot-token";

type IndexModule = typeof import("../../src/index");

afterEach(() => {
  mock.restore();
});

async function loadIndexModule(): Promise<IndexModule> {
  return import(`../../src/index.ts?test=${Date.now()}-${Math.random()}`);
}

describe("main", () => {
  test("syncs Telegram commands during bot startup by default", async () => {
    const ensureWorkspaceDirectories = mock(async () => undefined);
    const registerBotHandlers = mock((_bot: unknown, _handlers: unknown) => undefined);
    const startBackgroundServices = mock(async () => undefined);
    const stopBackgroundServices = mock(() => undefined);
    const createRuntimeDeps = mock(() => ({
      startBackgroundServices,
      stopBackgroundServices,
    }));
    const resolveTelegramBotTokenWithStore = mock(async () => ({
      token: "telegram-token",
      source: "env" as const,
    }));
    const syncTelegramCommands = mock(async () => undefined);
    const sendMessage = mock(async () => undefined);
    const botCatch = mock((_handler: unknown) => undefined);
    const botStart = mock(
      async (options?: { onStart?: (botInfo: { username: string }) => void }) => {
        options?.onStart?.({ username: "codex-claw-bot" });
      },
    );

    class FakeBot {
      readonly api = {
        sendMessage,
      };

      constructor(readonly token: string) {}

      catch = botCatch;
      start = botStart;
    }

    mock.module("grammy", () => ({ Bot: FakeBot }));
    mock.module("../../src/bot/create-bot.ts", () => ({ registerBotHandlers }));
    mock.module("../../src/bot/telegram-command-sync.ts", () => ({ syncTelegramCommands }));
    mock.module("../../src/config.ts", () => ({
      loadConfig: () => ({
        telegramBotToken: undefined,
        workspaceDir: "/tmp/codex-claw-workspace",
      }),
    }));
    mock.module("../../src/config/local-config.ts", () => ({
      createLocalConfigStore: () => ({
        path: "/tmp/codex-claw-local-config.json",
      }),
    }));
    mock.module("../../src/config/telegram-bot-token.ts", () => ({
      ...actualTelegramBotTokenModule,
      promptForTelegramBotToken: mock(async () => {
        throw new Error("prompt should not be used in this test");
      }),
      resolveTelegramBotTokenWithStore,
    }));
    mock.module("../../src/runtime/create-runtime-deps.ts", () => ({ createRuntimeDeps }));
    mock.module("../../src/runtime/workspace.ts", () => ({ ensureWorkspaceDirectories }));

    const { main } = await loadIndexModule();
    await main();

    expect(syncTelegramCommands).toHaveBeenCalledTimes(1);
    expect(syncTelegramCommands).toHaveBeenCalledWith(expect.any(FakeBot));
    expect(botStart).toHaveBeenCalledTimes(1);
    expect(startBackgroundServices).toHaveBeenCalledTimes(1);
    expect(stopBackgroundServices).toHaveBeenCalledTimes(1);
  });

  test("keeps startup wiring working when the sync call resolves", async () => {
    const ensureWorkspaceDirectories = mock(async () => undefined);
    const registerBotHandlers = mock((_bot: unknown, _handlers: unknown) => undefined);
    const startBackgroundServices = mock(async () => undefined);
    const stopBackgroundServices = mock(() => undefined);
    const createRuntimeDeps = mock(() => ({
      startBackgroundServices,
      stopBackgroundServices,
    }));
    const resolveTelegramBotTokenWithStore = mock(async () => ({
      token: "telegram-token",
      source: "env" as const,
    }));
    const syncTelegramCommands = mock(async () => undefined);
    const sendMessage = mock(async () => undefined);
    const botCatch = mock((_handler: unknown) => undefined);
    const botStart = mock(
      async (options?: { onStart?: (botInfo: { username: string }) => void }) => {
        options?.onStart?.({ username: "codex-claw-bot" });
      },
    );

    class FakeBot {
      readonly api = {
        sendMessage,
      };

      constructor(readonly token: string) {}

      catch = botCatch;
      start = botStart;
    }

    mock.module("grammy", () => ({ Bot: FakeBot }));
    mock.module("../../src/bot/create-bot.ts", () => ({ registerBotHandlers }));
    mock.module("../../src/bot/telegram-command-sync.ts", () => ({ syncTelegramCommands }));
    mock.module("../../src/config.ts", () => ({
      loadConfig: () => ({
        telegramBotToken: undefined,
        workspaceDir: "/tmp/codex-claw-workspace",
      }),
    }));
    mock.module("../../src/config/local-config.ts", () => ({
      createLocalConfigStore: () => ({
        path: "/tmp/codex-claw-local-config.json",
      }),
    }));
    mock.module("../../src/config/telegram-bot-token.ts", () => ({
      ...actualTelegramBotTokenModule,
      promptForTelegramBotToken: mock(async () => {
        throw new Error("prompt should not be used in this test");
      }),
      resolveTelegramBotTokenWithStore,
    }));
    mock.module("../../src/runtime/create-runtime-deps.ts", () => ({ createRuntimeDeps }));
    mock.module("../../src/runtime/workspace.ts", () => ({ ensureWorkspaceDirectories }));

    const { main } = await loadIndexModule();
    await main();

    expect(syncTelegramCommands).toHaveBeenCalledTimes(1);
    expect(syncTelegramCommands).toHaveBeenCalledWith(expect.any(FakeBot));
    expect(botStart).toHaveBeenCalledTimes(1);
    expect(startBackgroundServices).toHaveBeenCalledTimes(1);
    expect(stopBackgroundServices).toHaveBeenCalledTimes(1);
  });

  test("does not wait for syncTelegramCommands before starting the bot", async () => {
    const ensureWorkspaceDirectories = mock(async () => undefined);
    const registerBotHandlers = mock((_bot: unknown, _handlers: unknown) => undefined);
    const startBackgroundServices = mock(async () => undefined);
    const stopBackgroundServices = mock(() => undefined);
    const createRuntimeDeps = mock(() => ({
      startBackgroundServices,
      stopBackgroundServices,
    }));
    const resolveTelegramBotTokenWithStore = mock(async () => ({
      token: "telegram-token",
      source: "env" as const,
    }));
    const syncTelegramCommands = mock(
      () =>
        new Promise<void>(() => {
          return undefined;
        }),
    );
    const sendMessage = mock(async () => undefined);
    const botCatch = mock((_handler: unknown) => undefined);
    let resolveBotStartReached!: () => void;
    const botStartReached = new Promise<void>((resolve) => {
      resolveBotStartReached = resolve;
    });
    const botStart = mock(
      async (options?: { onStart?: (botInfo: { username: string }) => void }) => {
        options?.onStart?.({ username: "codex-claw-bot" });
        resolveBotStartReached();
      },
    );

    class FakeBot {
      readonly api = {
        sendMessage,
      };

      constructor(readonly token: string) {}

      catch = botCatch;
      start = botStart;
    }

    mock.module("grammy", () => ({ Bot: FakeBot }));
    mock.module("../../src/bot/create-bot.ts", () => ({ registerBotHandlers }));
    mock.module("../../src/bot/telegram-command-sync.ts", () => ({ syncTelegramCommands }));
    mock.module("../../src/config.ts", () => ({
      loadConfig: () => ({
        telegramBotToken: undefined,
        workspaceDir: "/tmp/codex-claw-workspace",
      }),
    }));
    mock.module("../../src/config/local-config.ts", () => ({
      createLocalConfigStore: () => ({
        path: "/tmp/codex-claw-local-config.json",
      }),
    }));
    mock.module("../../src/config/telegram-bot-token.ts", () => ({
      ...actualTelegramBotTokenModule,
      promptForTelegramBotToken: mock(async () => {
        throw new Error("prompt should not be used in this test");
      }),
      resolveTelegramBotTokenWithStore,
    }));
    mock.module("../../src/runtime/create-runtime-deps.ts", () => ({ createRuntimeDeps }));
    mock.module("../../src/runtime/workspace.ts", () => ({ ensureWorkspaceDirectories }));

    const { main } = await loadIndexModule();
    const startup = main();

    await botStartReached;
    await expect(startup).resolves.toBeUndefined();

    expect(syncTelegramCommands).toHaveBeenCalledTimes(1);
    expect(botStart).toHaveBeenCalledTimes(1);
    expect(startBackgroundServices).toHaveBeenCalledTimes(1);
    expect(stopBackgroundServices).toHaveBeenCalledTimes(1);
  });
});
