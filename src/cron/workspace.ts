import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveCodexClawHomeDir } from "../lib/paths";

export function resolveCronJobsDir(homeDir = resolveCodexClawHomeDir()): string {
  return path.join(homeDir, "cronjobs");
}

export async function ensureCronWorkspaceDirectories(
  homeDir = resolveCodexClawHomeDir(),
): Promise<string> {
  const cronJobsDir = resolveCronJobsDir(homeDir);
  await mkdir(cronJobsDir, { recursive: true });
  return cronJobsDir;
}

export async function disableScheduledJobDefinition(sourcePath: string): Promise<void> {
  const rawContent = await readFile(sourcePath, "utf8");
  const parsed = JSON.parse(rawContent) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Scheduled job definition at ${sourcePath} must be a JSON object`);
  }

  const updated = {
    ...(parsed as Record<string, unknown>),
    disabled: true,
  };

  const temporaryPath = `${sourcePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`);
  await rename(temporaryPath, sourcePath);
}

export const resolveCronjobsDirectory = resolveCronJobsDir;
export const ensureCronjobsDirectory = ensureCronWorkspaceDirectories;
