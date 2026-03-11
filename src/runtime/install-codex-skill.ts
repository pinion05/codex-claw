import { cp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type InstallPackagedSkillOptions = {
  skillName: string;
  packagedSkillPath: string;
  codexHomeDir?: string;
};

type InstallCronjobCreatorSkillOptions = {
  packagedSkillPath?: string;
  codexHomeDir?: string;
};

type InstallAgenttySkillOptions = {
  packagedSkillPath?: string;
  codexHomeDir?: string;
};

type InstallTelegramFileSendSkillOptions = {
  packagedSkillPath?: string;
  codexHomeDir?: string;
};

function resolveCodexHomeDir(codexHomeDir?: string): string {
  if (codexHomeDir) {
    return codexHomeDir;
  }

  return path.join(process.env.HOME ?? os.homedir(), ".codex");
}

export async function installPackagedSkill(
  options: InstallPackagedSkillOptions,
): Promise<string> {
  const codexHomeDir = resolveCodexHomeDir(options.codexHomeDir);
  const sourceDir = path.dirname(options.packagedSkillPath);
  const targetDir = path.join(codexHomeDir, "skills", options.skillName);
  const targetPath = path.join(targetDir, "SKILL.md");

  await mkdir(path.dirname(targetDir), { recursive: true });
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true });

  return targetPath;
}

export async function installCronjobCreatorSkill(
  options: InstallCronjobCreatorSkillOptions = {},
): Promise<string> {
  const packagedSkillPath =
    options.packagedSkillPath ??
    path.resolve(import.meta.dir, "../../assets/skills/codex-claw-cronjob-creator/SKILL.md");

  return installPackagedSkill({
    skillName: "codex-claw-cronjob-creator",
    packagedSkillPath,
    codexHomeDir: options.codexHomeDir,
  });
}

export async function installAgenttySkill(
  options: InstallAgenttySkillOptions = {},
): Promise<string> {
  const packagedSkillPath =
    options.packagedSkillPath ??
    path.resolve(import.meta.dir, "../../assets/skills/codex-claw-agentty/SKILL.md");

  return installPackagedSkill({
    skillName: "codex-claw-agentty",
    packagedSkillPath,
    codexHomeDir: options.codexHomeDir,
  });
}

export async function installTelegramFileSendSkill(
  options: InstallTelegramFileSendSkillOptions = {},
): Promise<string> {
  const packagedSkillPath =
    options.packagedSkillPath ??
    path.resolve(import.meta.dir, "../../assets/skills/codex-claw-telegram-file-send/SKILL.md");

  return installPackagedSkill({
    skillName: "codex-claw-telegram-file-send",
    packagedSkillPath,
    codexHomeDir: options.codexHomeDir,
  });
}
