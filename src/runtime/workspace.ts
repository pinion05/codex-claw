import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  installAgenttySkill as installAgenttySkillDefault,
  installCronjobCreatorSkill as installCronjobCreatorSkillDefault,
  installTelegramFileSendSkill as installTelegramFileSendSkillDefault,
} from "./install-codex-skill";

type PackagedSkillInstaller = {
  install: () => Promise<unknown>;
  label: string;
};

export async function ensureWorkspaceDirectories(
  workspaceDir: string,
  options: {
    packagedSkillInstallers?: PackagedSkillInstaller[];
    warn?: (message: string, error: unknown) => void;
  } = {},
): Promise<void> {
  await Promise.all(
    [workspaceDir, path.join(workspaceDir, "state"), path.join(workspaceDir, "logs")].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  );

  const packagedSkillInstallers = options.packagedSkillInstallers ?? [
    {
      install: installCronjobCreatorSkillDefault,
      label: "cronjob creator skill",
    },
    {
      install: installAgenttySkillDefault,
      label: "agentty skill",
    },
    {
      install: installTelegramFileSendSkillDefault,
      label: "Telegram file-send skill",
    },
  ];

  for (const packagedSkillInstaller of packagedSkillInstallers) {
    try {
      await packagedSkillInstaller.install();
    } catch (error) {
      (options.warn ?? ((message: string, cause: unknown) => console.warn(message, cause)))(
        `[codex-claw] failed to install ${packagedSkillInstaller.label}`,
        error,
      );
    }
  }
}
