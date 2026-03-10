import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installAgenttySkill,
  installCronjobCreatorSkill,
  installPackagedSkill,
} from "../../src/runtime/install-codex-skill";
import { ensureWorkspaceDirectories } from "../../src/runtime/workspace";

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
    return;
  }

  process.env.HOME = originalHome;
});

describe("installPackagedSkill", () => {
  test("installs a packaged skill into the global Codex skills directory", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const packagedSkillPath = path.join(root, "assets", "skills", "test-skill", "SKILL.md");
    const codexHomeDir = path.join(root, ".codex");

    try {
      mkdirSync(path.dirname(packagedSkillPath), { recursive: true });
      writeFileSync(packagedSkillPath, "# Test Skill\n");

      const installedPath = await installPackagedSkill({
        skillName: "test-skill",
        packagedSkillPath,
        codexHomeDir,
      });

      expect(installedPath).toBe(path.join(codexHomeDir, "skills", "test-skill", "SKILL.md"));
      expect(statSync(installedPath).isFile()).toBe(true);
      expect(readFileSync(installedPath, "utf8")).toBe("# Test Skill\n");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("overwrites an existing installed skill file", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const packagedSkillPath = path.join(root, "assets", "skills", "test-skill", "SKILL.md");
    const installedPath = path.join(root, ".codex", "skills", "test-skill", "SKILL.md");

    try {
      mkdirSync(path.dirname(packagedSkillPath), { recursive: true });
      mkdirSync(path.dirname(installedPath), { recursive: true });
      writeFileSync(packagedSkillPath, "# New Skill\n");
      writeFileSync(installedPath, "# Old Skill\n");

      await installPackagedSkill({
        skillName: "test-skill",
        packagedSkillPath,
        codexHomeDir: path.join(root, ".codex"),
      });

      expect(readFileSync(installedPath, "utf8")).toBe("# New Skill\n");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("installCronjobCreatorSkill", () => {
  test("uses the packaged default skill asset when no source path override is provided", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const codexHomeDir = path.join(root, ".codex");

    try {
      const installedPath = await installCronjobCreatorSkill({ codexHomeDir });
      const installedSkill = readFileSync(installedPath, "utf8");

      expect(statSync(installedPath).isFile()).toBe(true);
      expect(installedSkill.startsWith("---\n")).toBe(true);
      expect(installedSkill).toContain("name: codex-claw-cronjob-creator");
      expect(installedSkill).toContain("description:");
      expect(installedSkill).toContain("# codex-claw-cronjob-creator");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("installAgenttySkill", () => {
  test("uses the packaged default skill asset when no source path override is provided", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const codexHomeDir = path.join(root, ".codex");

    try {
      const installedPath = await installAgenttySkill({ codexHomeDir });
      const installedSkill = readFileSync(installedPath, "utf8");

      expect(statSync(installedPath).isFile()).toBe(true);
      expect(installedSkill.startsWith("---\n")).toBe(true);
      expect(installedSkill).toContain("name: codex-claw-agentty");
      expect(installedSkill).toContain("MUST use this skill");
      expect(installedSkill).toContain("npx -y agentty-cli");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("installs the packaged agentty skill into the global Codex skills directory", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const packagedSkillPath = path.join(root, "assets", "skills", "codex-claw-agentty", "SKILL.md");
    const codexHomeDir = path.join(root, ".codex");

    try {
      mkdirSync(path.dirname(packagedSkillPath), { recursive: true });
      writeFileSync(packagedSkillPath, "# Agentty Skill\n");

      const installedPath = await installAgenttySkill({
        packagedSkillPath,
        codexHomeDir,
      });

      expect(installedPath).toBe(
        path.join(codexHomeDir, "skills", "codex-claw-agentty", "SKILL.md"),
      );
      expect(statSync(installedPath).isFile()).toBe(true);
      expect(readFileSync(installedPath, "utf8")).toBe("# Agentty Skill\n");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("ensureWorkspaceDirectories", () => {
  test("installs both packaged skills through the default startup path", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const workspaceDir = path.join(root, "workspace");
    const cronSkillPath = path.join(
      root,
      ".codex",
      "skills",
      "codex-claw-cronjob-creator",
      "SKILL.md",
    );
    const agenttySkillPath = path.join(root, ".codex", "skills", "codex-claw-agentty", "SKILL.md");

    try {
      process.env.HOME = root;

      await ensureWorkspaceDirectories(workspaceDir);

      expect(statSync(cronSkillPath).isFile()).toBe(true);
      expect(statSync(agenttySkillPath).isFile()).toBe(true);
      expect(readFileSync(cronSkillPath, "utf8")).toContain("name: codex-claw-cronjob-creator");
      expect(readFileSync(agenttySkillPath, "utf8")).toContain("name: codex-claw-agentty");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("creates the runtime workspace directories", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const installCronjobCreatorSkill = mock(async () => undefined);
    const installAgenttySkill = mock(async () => undefined);

    try {
      await ensureWorkspaceDirectories(path.join(workspaceDir, "workspace"), {
        packagedSkillInstallers: [
          {
            install: installCronjobCreatorSkill,
            label: "cronjob creator skill",
          },
          {
            install: installAgenttySkill,
            label: "agentty skill",
          },
        ],
      });

      expect(statSync(path.join(workspaceDir, "workspace")).isDirectory()).toBe(true);
      expect(statSync(path.join(workspaceDir, "workspace", "state")).isDirectory()).toBe(true);
      expect(statSync(path.join(workspaceDir, "workspace", "logs")).isDirectory()).toBe(true);
      expect(statSync(path.join(workspaceDir, "workspace", "inbox")).isDirectory()).toBe(true);
      expect(installCronjobCreatorSkill).toHaveBeenCalledTimes(1);
      expect(installAgenttySkill).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("logs a warning and continues when one packaged skill installation fails", async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "codex-claw-runtime-workspace-"));
    const warn = mock((_message: string, _error: unknown) => undefined);
    const installAgenttySkill = mock(async () => undefined);

    try {
      await expect(
        ensureWorkspaceDirectories(path.join(workspaceDir, "workspace"), {
          packagedSkillInstallers: [
            {
              install: async () => {
                throw new Error("install failed");
              },
              label: "cronjob creator skill",
            },
            {
              install: installAgenttySkill,
              label: "agentty skill",
            },
          ],
          warn,
        }),
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("failed to install cronjob creator skill");
      expect(warn.mock.calls[0]?.[1]).toBeInstanceOf(Error);
      expect(installAgenttySkill).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
