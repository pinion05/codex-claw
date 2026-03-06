import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveCodexClawHomeDir } from "../lib/paths";

export type LocalConfig = {
  telegramBotToken: string | null;
};

export type LocalConfigStore = {
  path: string;
  read: () => Promise<LocalConfig>;
  write: (config: LocalConfig) => Promise<void>;
};

export function resolveLocalConfigPath() {
  return path.join(resolveCodexClawHomeDir(), "local-config.json");
}

export function createLocalConfigStore(configPath = resolveLocalConfigPath()): LocalConfigStore {
  return {
    path: configPath,
    async read() {
      try {
        const content = await readFile(configPath, "utf8");
        return parseLocalConfig(JSON.parse(content) as unknown);
      } catch (error) {
        if (isMissingFileError(error)) {
          return createEmptyLocalConfig();
        }

        if (error instanceof SyntaxError) {
          throw new Error(`Invalid local config file at ${configPath}: failed to parse JSON`);
        }

        throw error;
      }
    },
    async write(config) {
      const directory = path.dirname(configPath);
      const tempPath = path.join(directory, `${path.basename(configPath)}.${randomUUID()}.tmp`);

      await mkdir(directory, { recursive: true });

      try {
        await writeFile(tempPath, JSON.stringify(config, null, 2));
        await rename(tempPath, configPath);
      } catch (error) {
        await rm(tempPath, { force: true });
        throw error;
      }
    },
  };
}

function createEmptyLocalConfig(): LocalConfig {
  return {
    telegramBotToken: null,
  };
}

function parseLocalConfig(value: unknown): LocalConfig {
  if (!value || typeof value !== "object") {
    return createEmptyLocalConfig();
  }

  const config = value as Record<string, unknown>;
  return {
    telegramBotToken: normalizeOptionalString(config.telegramBotToken),
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
