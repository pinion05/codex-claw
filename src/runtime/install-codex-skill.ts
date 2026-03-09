import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type InstallCronjobCreatorSkillOptions = {
  packagedSkillPath?: string;
  codexHomeDir?: string;
};

export async function installCronjobCreatorSkill(
  options: InstallCronjobCreatorSkillOptions = {},
): Promise<string> {
  const packagedSkillPath =
    options.packagedSkillPath ??
    path.resolve(import.meta.dir, "../../assets/skills/codex-claw-cronjob-creator/SKILL.md");
  const codexHomeDir = options.codexHomeDir ?? path.join(os.homedir(), ".codex");
  const targetDir = path.join(codexHomeDir, "skills", "codex-claw-cronjob-creator");
  const targetPath = path.join(targetDir, "SKILL.md");
  const skillContent = await readFile(packagedSkillPath, "utf8");

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, skillContent);

  return targetPath;
}
