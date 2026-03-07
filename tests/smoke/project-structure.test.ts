import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

describe("project bootstrap", () => {
  test("includes a repository license", () => {
    expect(existsSync("LICENSE")).toBe(true);
  });

  test("does not require a public environment example", () => {
    expect(existsSync(".env.example")).toBe(false);
  });
});
