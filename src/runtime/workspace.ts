import { mkdir } from "node:fs/promises";
import path from "node:path";
import { installCronjobCreatorSkill as installCronjobCreatorSkillDefault } from "./install-codex-skill";

export async function ensureWorkspaceDirectories(
  workspaceDir: string,
  options: {
    installCronjobCreatorSkill?: () => Promise<unknown>;
    warn?: (message: string, error: unknown) => void;
  } = {},
): Promise<void> {
  await Promise.all(
    [workspaceDir, path.join(workspaceDir, "state"), path.join(workspaceDir, "logs")].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  );

  try {
    await (options.installCronjobCreatorSkill ?? installCronjobCreatorSkillDefault)();
  } catch (error) {
    (options.warn ?? ((message: string, cause: unknown) => console.warn(message, cause)))(
      "[codex-claw] failed to install cronjob creator skill",
      error,
    );
  }
}
