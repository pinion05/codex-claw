import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type PackageJson = {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  bin?: unknown;
  publishConfig?: unknown;
  packageManager?: unknown;
  keywords?: unknown;
  scripts?: unknown;
};

describe("package metadata", () => {
  test("is ready for public npm publication", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

    expect(packageJson.name).toBe("codex-claw");
    expect(typeof packageJson.version).toBe("string");
    expect(packageJson.private).toBe(false);
    expect(packageJson.bin).toEqual({
      "codex-claw": "bin/codex-claw",
    });
    expect(packageJson.publishConfig).toEqual({
      access: "public",
    });
    expect(packageJson.packageManager).toBe("bun@1.3.9");
    expect(packageJson.keywords).toEqual(
      expect.arrayContaining(["telegram", "bot", "codex", "grammy", "bun"]),
    );
    expect(packageJson.scripts).toMatchObject({
      check: "bun test && bun run typecheck",
      "pack:dry-run": "bun pm pack --dry-run",
      "publish:dry-run": "bun publish --dry-run --access public",
      "publish:npm": "bun publish --access public",
      "release:patch": "bun pm version patch",
      "release:minor": "bun pm version minor",
      "release:major": "bun pm version major",
      prepublishOnly: "bun run check",
    });
  });
});
