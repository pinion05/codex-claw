#!/usr/bin/env bun

import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function runSendFileCli(argv, options = {}) {
  const stdout = options.stdout ?? ((value) => console.log(value));
  const stderr = options.stderr ?? ((value) => console.error(value));

  try {
    const [filePath] = argv;

    if (!filePath) {
      stderr(
        `Usage: bun ${path.basename(import.meta.filename ?? "send-file.js")} /absolute/path/to/file`,
      );
      return 1;
    }

    const result = await sendFileToActiveChat(filePath, options);
    stdout(`Sent ${path.basename(result.filePath)} to chat ${result.chatId}`);
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function sendFileToActiveChat(filePath, options = {}) {
  if (!filePath || filePath.trim().length === 0) {
    throw new Error("File path is required");
  }

  const resolvedFilePath = path.resolve(filePath);
  await assertRegularFile(resolvedFilePath);

  const {
    env = process.env,
    fetch: fetchImpl = fetch,
    codexClawHomeDir = resolveCodexClawHomeDir(env),
  } = options;
  const telegramBotToken = await readTelegramBotToken(
    path.join(codexClawHomeDir, "local-config.json"),
  );
  const chatId = await readActiveChatId(
    path.join(codexClawHomeDir, "workspace", "state", "session.json"),
  );

  const response = await sendTelegramDocument({
    fetchImpl,
    telegramBotToken,
    chatId,
    filePath: resolvedFilePath,
  });

  if (!response.ok) {
    throw new Error(`Telegram send failed: ${response.status} ${response.statusText}`);
  }

  return {
    chatId,
    filePath: resolvedFilePath,
  };
}

export function resolveCodexClawHomeDir(env = process.env) {
  return path.join(env.HOME ?? os.homedir(), ".codex-claw");
}

async function assertRegularFile(filePath) {
  let fileStats;

  try {
    fileStats = await stat(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`File does not exist: ${filePath}`);
    }

    throw error;
  }

  if (!fileStats.isFile()) {
    throw new Error(`Path is not a regular file: ${filePath}`);
  }
}

async function readTelegramBotToken(configPath) {
  let record;

  try {
    record = await readJsonRecord(configPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Telegram bot token is not configured");
    }

    throw error;
  }

  const value = typeof record.telegramBotToken === "string" ? record.telegramBotToken.trim() : "";

  if (value.length === 0) {
    throw new Error("Telegram bot token is not configured");
  }

  return value;
}

async function readActiveChatId(sessionPath) {
  let record;

  try {
    record = await readJsonRecord(sessionPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("No active codex-claw Telegram session found");
    }

    throw error;
  }

  const chatId = typeof record.chatId === "string" ? record.chatId.trim() : "";

  if (chatId.length === 0) {
    throw new Error("No active codex-claw Telegram session found");
  }

  return chatId;
}

async function readJsonRecord(filePath) {
  const content = await readFile(filePath, "utf8");
  const parsed = JSON.parse(content);

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid JSON object at ${filePath}`);
  }

  return parsed;
}

async function sendTelegramDocument({
  fetchImpl,
  telegramBotToken,
  chatId,
  filePath,
}) {
  const formData = new FormData();
  const bytes = await readFile(filePath);
  const fileName = path.basename(filePath);

  formData.set("chat_id", chatId);
  formData.set("document", new File([bytes], fileName));

  return fetchImpl(`https://api.telegram.org/bot${telegramBotToken}/sendDocument`, {
    method: "POST",
    body: formData,
  });
}

async function main(argv = process.argv.slice(2)) {
  const [filePath] = argv;
  process.exitCode = await runSendFileCli(filePath ? [filePath] : [], {
    stdout: (value) => console.log(value),
    stderr: (value) => console.error(value),
  });
}

if (import.meta.main) {
  await main();
}
