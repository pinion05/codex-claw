import { toTelegramCommandPayload } from "./command-definitions";

type TelegramCommandSyncBot = {
  api: {
    setMyCommands: (commands: ReturnType<typeof toTelegramCommandPayload>) => Promise<unknown>;
  };
};

type TelegramCommandSyncLogger = {
  warn: (message: string, error: unknown) => void;
};

export async function syncTelegramCommands(
  bot: TelegramCommandSyncBot,
  options: {
    logger?: TelegramCommandSyncLogger;
  } = {},
): Promise<void> {
  const logger = options.logger ?? console;

  try {
    await bot.api.setMyCommands(toTelegramCommandPayload());
  } catch (error) {
    logger.warn("[codex-claw] failed to sync Telegram commands", error);
  }
}
