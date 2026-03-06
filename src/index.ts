import { registerBotHandlers } from "./bot/create-bot";
import { loadConfig } from "./config";
import { createRuntimeDeps } from "./runtime/create-runtime-deps";
import { ensureWorkspaceDirectories } from "./runtime/workspace";

export async function main(): Promise<void> {
  const config = loadConfig();

  await ensureWorkspaceDirectories(config.workspaceDir);

  const { bot, handlers } = createRuntimeDeps(config);

  bot.catch((error) => {
    console.error(`[codex-claw] update ${error.ctx.update.update_id} failed`, error.error);
  });

  registerBotHandlers(bot, handlers);

  console.info(`[codex-claw] starting Telegram bot with workspace ${config.workspaceDir}`);
  await bot.start();
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error("[codex-claw] fatal startup error", error);
    process.exitCode = 1;
  });
}
