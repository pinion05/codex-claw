import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("CLI bin entry", () => {
  test("invokes the exported main entrypoint", () => {
    const bin = readFileSync("bin/codex-claw", "utf8");

    expect(bin).toContain('import { main } from "../src/index.ts";');
    expect(bin).toContain("await main().catch");
  });
});
