import { describe, expect, mock, test } from "bun:test";
import { resolveTelegramBotToken } from "../../src/config/telegram-bot-token";

describe("resolveTelegramBotToken", () => {
  test("prefers TELEGRAM_BOT_TOKEN from env", async () => {
    const readStoredToken = mock(async () => "stored-token");
    const saveStoredToken = mock(async () => undefined);
    const promptForToken = mock(async () => "prompted-token");

    const result = await resolveTelegramBotToken({
      envToken: "env-token",
      readStoredToken,
      saveStoredToken,
      promptForToken,
    });

    expect(result).toEqual({
      token: "env-token",
      source: "env",
    });
    expect(readStoredToken).not.toHaveBeenCalled();
    expect(saveStoredToken).not.toHaveBeenCalled();
    expect(promptForToken).not.toHaveBeenCalled();
  });

  test("reuses the stored token when env is missing", async () => {
    const readStoredToken = mock(async () => "stored-token");
    const saveStoredToken = mock(async () => undefined);
    const promptForToken = mock(async () => "prompted-token");

    const result = await resolveTelegramBotToken({
      envToken: null,
      readStoredToken,
      saveStoredToken,
      promptForToken,
    });

    expect(result).toEqual({
      token: "stored-token",
      source: "local-config",
    });
    expect(readStoredToken).toHaveBeenCalledTimes(1);
    expect(saveStoredToken).not.toHaveBeenCalled();
    expect(promptForToken).not.toHaveBeenCalled();
  });

  test("prompts once and persists the token when no value exists yet", async () => {
    const readStoredToken = mock(async () => null);
    const saveStoredToken = mock(async () => undefined);
    const promptForToken = mock(async () => "prompted-token");

    const result = await resolveTelegramBotToken({
      envToken: null,
      readStoredToken,
      saveStoredToken,
      promptForToken,
    });

    expect(result).toEqual({
      token: "prompted-token",
      source: "prompt",
    });
    expect(readStoredToken).toHaveBeenCalledTimes(1);
    expect(promptForToken).toHaveBeenCalledTimes(1);
    expect(saveStoredToken).toHaveBeenCalledWith("prompted-token");
  });
});
