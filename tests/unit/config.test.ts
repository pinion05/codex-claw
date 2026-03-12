import { afterEach, describe, expect, mock, test } from "bun:test";
import path from "node:path";
import { resolveWorkspaceDir } from "../../src/lib/paths";

type ConfigModule = typeof import("../../src/config");

afterEach(() => {
  mock.restore();
});

async function loadConfigModule(): Promise<ConfigModule> {
  return import(`../../src/config.ts?test=${Date.now()}-${Math.random()}`);
}

describe("resolveWorkspaceDir", () => {
  test("uses the default ~/.codex-claw/workspace when env is missing", () => {
    const value = resolveWorkspaceDir({});
    expect(value.endsWith("/.codex-claw/workspace")).toBe(true);
  });

  test("uses CODEX_WORKSPACE_DIR when provided", () => {
    expect(resolveWorkspaceDir({ CODEX_WORKSPACE_DIR: "/tmp/claw" })).toBe("/tmp/claw");
  });

  test("falls back to the default workspace when override is an empty string", () => {
    const value = resolveWorkspaceDir({ CODEX_WORKSPACE_DIR: "" });
    expect(value.endsWith("/.codex-claw/workspace")).toBe(true);
  });

  test("falls back to the default workspace when override is whitespace only", () => {
    const value = resolveWorkspaceDir({ CODEX_WORKSPACE_DIR: "   " });
    expect(value.endsWith("/.codex-claw/workspace")).toBe(true);
  });

  test("normalizes a relative CODEX_WORKSPACE_DIR to an absolute path", () => {
    expect(resolveWorkspaceDir({ CODEX_WORKSPACE_DIR: "tmp/claw" })).toBe(path.resolve("tmp/claw"));
  });
});

describe("loadConfig", () => {
  test("loads the telegram token, optional OpenAI key override, and resolved workspace dir", async () => {
    const { loadConfig } = await loadConfigModule();

    expect(
      loadConfig({
        TELEGRAM_BOT_TOKEN: "telegram-token",
        OPENAI_API_KEY: "openai-key",
        CODEX_WORKSPACE_DIR: "/tmp/claw",
      }),
    ).toEqual({
      telegramBotToken: "telegram-token",
      openAiApiKey: "openai-key",
      workspaceDir: "/tmp/claw",
    });
  });

  test("allows config without OPENAI_API_KEY so local codex login can be reused", async () => {
    const { loadConfig } = await loadConfigModule();

    expect(
      loadConfig({
        TELEGRAM_BOT_TOKEN: "telegram-token",
      }),
    ).toEqual({
      telegramBotToken: "telegram-token",
      openAiApiKey: null,
      workspaceDir: resolveWorkspaceDir({}),
    });
  });

  test("returns null token values when env overrides are missing", async () => {
    const { loadConfig } = await loadConfigModule();

    expect(loadConfig({})).toEqual({
      telegramBotToken: null,
      openAiApiKey: null,
      workspaceDir: resolveWorkspaceDir({}),
    });
  });

  test("does not expose a Telegram command sync toggle in runtime config", async () => {
    const { loadConfig } = await loadConfigModule();

    expect("syncTelegramCommandsOnStartup" in loadConfig({ TELEGRAM_SYNC_COMMANDS: "false" })).toBe(
      false,
    );
  });
});
