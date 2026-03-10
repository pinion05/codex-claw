import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export async function installPackagedSkill(
  options: InstallPackagedSkillOptions,
): Promise<string> {
  const codexHomeDir = options.codexHomeDir ?? path.join(os.homedir(), ".codex");
  const targetDir = path.join(codexHomeDir, "skills", options.skillName);
  const targetPath = path.join(targetDir, "SKILL.md");
  const skillContent = await readFile(options.packagedSkillPath, "utf8");

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, skillContent);

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
