import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type PackageJson = {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  bin?: unknown;
  publishConfig?: unknown;
};

describe("package metadata", () => {
  test("is ready for public npm publication", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

    expect(packageJson.name).toBe("codex-claw");
    expect(typeof packageJson.version).toBe("string");
    expect(packageJson.private).toBe(false);
    expect(packageJson.bin).toEqual({
      "codex-claw": "./bin/codex-claw",
    });
    expect(packageJson.publishConfig).toEqual({
      access: "public",
    });
  });
});
