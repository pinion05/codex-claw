import { resolveWorkspaceDir } from "./lib/paths";

type Env = Record<string, string | undefined>;

export type AppConfig = {
  telegramBotToken: string;
  openAiApiKey: string;
  workspaceDir: string;
};

export function loadConfig(env: Env = process.env): AppConfig {
  const missing = ["TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY"].filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN!,
    openAiApiKey: env.OPENAI_API_KEY!,
    workspaceDir: resolveWorkspaceDir(env),
  };
}
