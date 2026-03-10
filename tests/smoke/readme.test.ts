import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("README", () => {
  test("documents the prompt-first setup flow and bot commands", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("TELEGRAM_BOT_TOKEN");
    expect(readme).toContain("codex login");
    expect(readme).toContain("bunx @npmc_5/codex-claw");
    expect(readme).toContain("local-config.json");
    expect(readme).toContain("입력하세요");
    expect(readme).toContain("/status");
    expect(readme).toContain("/reset");
    expect(readme).toContain("/abort");
    expect(readme).toContain("/help");
    expect(readme).toContain("~/.codex-claw/workspace");
    expect(readme).toContain("fixed workspace");
    expect(readme).toContain("persisted Telegram chat");
    expect(readme).toContain("delivery failure does not mean");
    expect(readme).toContain("skip");
    expect(readme).toContain("## Publishing");
    expect(readme).toContain("bun run check");
    expect(readme).toContain("bun run publish:dry-run");
    expect(readme).toContain("bun run publish:npm");
    expect(readme).toContain("bun pm whoami");
    expect(readme).not.toContain("bun install");
    expect(readme).not.toContain("OPENAI_API_KEY");
    expect(readme).not.toContain("CODEX_WORKSPACE_DIR");
    expect(readme).not.toContain(".env.example");
  });
});
