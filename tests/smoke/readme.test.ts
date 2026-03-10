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
    expect(readme).toContain("codex-claw-agentty");
    expect(readme).toContain("npx -y agentty-cli");
    expect(readme).toContain("/start");
    expect(readme).toContain("/status");
    expect(readme).toContain("/reset");
    expect(readme).toContain("/abort");
    expect(readme).toContain("/help");
    expect(readme).toContain("~/.codex-claw/workspace");
    expect(readme).toContain("fixed workspace");
    expect(readme).toContain("persisted Telegram chat");
    expect(readme).toContain("Telegram albums are coalesced into one prepared run");
    expect(readme).toContain("lowest message id");
    expect(readme).toContain("failedAttachments");
    expect(readme).toContain("bundle.json");
    expect(readme).toContain("\"version\": 2");
    expect(readme).toContain("Failed downloads do not discard the whole bundle");
    expect(readme).toContain("delivery failure does not mean");
    expect(readme).toContain("If there is no persisted target chat yet, the cron job will skip execution entirely instead of running without a delivery target.");
    expect(readme).toContain("Cron jobs still run immediately and deliver to the persisted Telegram chat even if an interactive run is already active.");
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
