import { describe, expect, test } from "bun:test";
import path from "node:path";
import { loadConfig } from "../../src/config";
import { resolveWorkspaceDir } from "../../src/lib/paths";

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
  test("loads required variables and resolved workspace dir", () => {
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

  test("throws a descriptive error when required variables are missing", () => {
    expect(() => loadConfig({})).toThrow(
      "Missing required environment variables: TELEGRAM_BOT_TOKEN, OPENAI_API_KEY",
    );
  });
});
