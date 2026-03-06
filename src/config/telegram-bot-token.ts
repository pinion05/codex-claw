import { createInterface } from "node:readline/promises";
import type { LocalConfigStore } from "./local-config";

type ResolveTelegramBotTokenArgs = {
  envToken: string | null;
  readStoredToken: () => Promise<string | null>;
  saveStoredToken: (token: string) => Promise<void>;
  promptForToken: () => Promise<string>;
};

export type TelegramBotTokenResolution =
  | { token: string; source: "env" | "local-config" }
  | { token: string; source: "prompt" };

export async function resolveTelegramBotToken({
  envToken,
  readStoredToken,
  saveStoredToken,
  promptForToken,
}: ResolveTelegramBotTokenArgs): Promise<TelegramBotTokenResolution> {
  const normalizedEnvToken = normalizeRequiredToken(envToken);

  if (normalizedEnvToken) {
    return {
      token: normalizedEnvToken,
      source: "env",
    };
  }

  const storedToken = normalizeRequiredToken(await readStoredToken());

  if (storedToken) {
    return {
      token: storedToken,
      source: "local-config",
    };
  }

  const promptedToken = normalizeRequiredToken(await promptForToken());

  if (!promptedToken) {
    throw new Error("TELEGRAM_BOT_TOKEN prompt returned an empty value");
  }

  await saveStoredToken(promptedToken);

  return {
    token: promptedToken,
    source: "prompt",
  };
}

export async function resolveTelegramBotTokenWithStore({
  envToken,
  store,
  promptForToken = promptForTelegramBotToken,
}: {
  envToken: string | null;
  store: LocalConfigStore;
  promptForToken?: () => Promise<string>;
}): Promise<TelegramBotTokenResolution> {
  return resolveTelegramBotToken({
    envToken,
    readStoredToken: async () => (await store.read()).telegramBotToken,
    saveStoredToken: async (token) => {
      await store.write({
        telegramBotToken: token,
      });
    },
    promptForToken,
  });
}

export async function promptForTelegramBotToken(): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const value = (await readline.question("TELEGRAM_BOT_TOKEN을 입력하세요: ")).trim();

      if (value.length > 0) {
        return value;
      }

      console.log("TELEGRAM_BOT_TOKEN은 비워둘 수 없습니다.");
    }
  } finally {
    readline.close();
  }
}

function normalizeRequiredToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
