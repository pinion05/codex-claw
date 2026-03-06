import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

describe("project bootstrap", () => {
  test("environment example exists", () => {
    expect(existsSync(".env.example")).toBe(true);
  });
});
