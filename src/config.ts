import { resolveWorkspaceDir } from "./lib/paths";

type Env = Record<string, string | undefined>;

export type AppConfig = {
  telegramBotToken: string | null;
  openAiApiKey: string | null;
  workspaceDir: string;
};

export function loadConfig(env: Env = process.env): AppConfig {
  return {
    telegramBotToken: normalizeOptionalEnv(env.TELEGRAM_BOT_TOKEN),
    openAiApiKey: normalizeOptionalEnv(env.OPENAI_API_KEY),
    workspaceDir: resolveWorkspaceDir(env),
  };
}

function normalizeOptionalEnv(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
