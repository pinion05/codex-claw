import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { DetectedScheduledJobDefinition, ScheduledJobDetectionResult } from "./types";
import { ensureCronWorkspaceDirectories } from "./workspace";

type DetectScheduledJobDefinitionsOptions =
  | string
  | {
      codexClawHomeDir?: string;
    };

export async function detectScheduledJobDefinitions(
  options: DetectScheduledJobDefinitionsOptions = {},
): Promise<ScheduledJobDetectionResult> {
  const definitionsDir =
    typeof options === "string"
      ? options
      : await ensureCronWorkspaceDirectories(options.codexClawHomeDir);

  if (typeof options === "string") {
    await mkdir(definitionsDir, { recursive: true });
  }

  const entries = await readdir(definitionsDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const definitions: DetectedScheduledJobDefinition[] = [];
  const errors: ScheduledJobDetectionResult["errors"] = [];

  for (const fileName of jsonFiles) {
    const sourcePath = path.join(definitionsDir, fileName);

    try {
      const rawContent = await readFile(sourcePath, "utf8");
      definitions.push({
        sourcePath,
        raw: JSON.parse(rawContent) as unknown,
      });
    } catch (error) {
      errors.push({
        sourcePath,
        message: error instanceof SyntaxError ? "failed to parse JSON" : "failed to read file",
      });
    }
  }

  return {
    definitions,
    errors,
  };
}

export const detectCronJobDefinitions = detectScheduledJobDefinitions;
