import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("README", () => {
  test("documents auth setup, env vars, and bot commands", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("TELEGRAM_BOT_TOKEN");
    expect(readme).toContain("OPENAI_API_KEY");
    expect(readme).toContain("codex login");
    expect(readme).toContain("CODEX_WORKSPACE_DIR");
    expect(readme).toContain("local-config.json");
    expect(readme).toContain("입력하세요");
    expect(readme).toContain("/status");
    expect(readme).toContain("/reset");
    expect(readme).toContain("/abort");
    expect(readme).toContain("/help");
    expect(readme).toContain("~/.codex-claw/workspace");
    expect(readme).toContain("fixed workspace");
    expect(readme).toContain("## Publishing");
    expect(readme).toContain("bun run check");
    expect(readme).toContain("bun run publish:dry-run");
    expect(readme).toContain("bun run publish:npm");
    expect(readme).toContain("bun pm whoami");
  });
});
