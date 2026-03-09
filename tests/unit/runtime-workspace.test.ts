import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installCronjobCreatorSkill } from "../../src/runtime/install-codex-skill";
import { ensureWorkspaceDirectories } from "../../src/runtime/workspace";

describe("installCronjobCreatorSkill", () => {
  test("uses the packaged default skill asset when no source path override is provided", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const codexHomeDir = path.join(root, ".codex");

    try {
      const installedPath = await installCronjobCreatorSkill({ codexHomeDir });

      expect(statSync(installedPath).isFile()).toBe(true);
      expect(readFileSync(installedPath, "utf8")).toContain("# codex-claw-cronjob-creator");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("installs the packaged skill into the global Codex skills directory", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const packagedSkillPath = path.join(root, "assets", "skills", "codex-claw-cronjob-creator", "SKILL.md");
    const codexHomeDir = path.join(root, ".codex");

    try {
      mkdirSync(path.dirname(packagedSkillPath), { recursive: true });
      writeFileSync(packagedSkillPath, "# Cron Skill\n");

      const installedPath = await installCronjobCreatorSkill({
        packagedSkillPath,
        codexHomeDir,
      });

      expect(installedPath).toBe(
        path.join(codexHomeDir, "skills", "codex-claw-cronjob-creator", "SKILL.md"),
      );
      expect(statSync(installedPath).isFile()).toBe(true);
      expect(readFileSync(installedPath, "utf8")).toBe("# Cron Skill\n");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("overwrites an existing installed skill file", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const packagedSkillPath = path.join(root, "assets", "skills", "codex-claw-cronjob-creator", "SKILL.md");
    const installedPath = path.join(
      root,
      ".codex",
      "skills",
      "codex-claw-cronjob-creator",
      "SKILL.md",
    );

    try {
      mkdirSync(path.dirname(packagedSkillPath), { recursive: true });
      mkdirSync(path.dirname(installedPath), { recursive: true });
      writeFileSync(packagedSkillPath, "# New Skill\n");
      writeFileSync(installedPath, "# Old Skill\n");

      await installCronjobCreatorSkill({
        packagedSkillPath,
        codexHomeDir: path.join(root, ".codex"),
      });

      expect(readFileSync(installedPath, "utf8")).toBe("# New Skill\n");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("ensureWorkspaceDirectories", () => {
  test("creates the runtime workspace directories", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const installCronjobCreatorSkill = mock(async () => undefined);

    try {
      await ensureWorkspaceDirectories(path.join(workspaceDir, "workspace"), {
        installCronjobCreatorSkill,
      });

      expect(statSync(path.join(workspaceDir, "workspace")).isDirectory()).toBe(true);
      expect(statSync(path.join(workspaceDir, "workspace", "state")).isDirectory()).toBe(true);
      expect(statSync(path.join(workspaceDir, "workspace", "logs")).isDirectory()).toBe(true);
      expect(installCronjobCreatorSkill).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("logs a warning and continues when skill installation fails", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const warn = mock((_message: string, _error: unknown) => undefined);

    try {
      await expect(
        ensureWorkspaceDirectories(path.join(workspaceDir, "workspace"), {
          installCronjobCreatorSkill: async () => {
            throw new Error("install failed");
          },
          warn,
        }),
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("failed to install cronjob creator skill");
      expect(warn.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
