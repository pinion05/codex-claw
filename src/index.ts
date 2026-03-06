import { Bot } from "grammy";
import { registerBotHandlers } from "./bot/create-bot";
import { createLocalConfigStore } from "./config/local-config";
import { promptForTelegramBotToken, resolveTelegramBotTokenWithStore } from "./config/telegram-bot-token";
import { loadConfig } from "./config";
import { createRuntimeDeps } from "./runtime/create-runtime-deps";
import { ensureWorkspaceDirectories } from "./runtime/workspace";

export async function main(): Promise<void> {
  const config = loadConfig();
  const localConfigStore = createLocalConfigStore();
  const telegramToken = await resolveTelegramBotTokenWithStore({
    envToken: config.telegramBotToken,
    store: localConfigStore,
    promptForToken: promptForTelegramBotToken,
  });

  await ensureWorkspaceDirectories(config.workspaceDir);

  const handlers = createRuntimeDeps(config);
  const bot = new Bot(telegramToken.token);

  bot.catch((error) => {
    console.error(`[codex-claw] update ${error.ctx.update.update_id} failed`, error.error);
  });

  registerBotHandlers(bot, handlers);

  if (telegramToken.source === "prompt") {
    console.info(`[codex-claw] saved TELEGRAM_BOT_TOKEN to ${localConfigStore.path}`);
  }

  console.info(`[codex-claw] starting Telegram bot with workspace ${config.workspaceDir}`);
  await bot.start({
    onStart(botInfo) {
      console.info(`[codex-claw] polling as @${botInfo.username}`);
    },
  });
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error("[codex-claw] fatal startup error", error);
    process.exitCode = 1;
  });
}
