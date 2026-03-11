import type { AbortRunResult, ResetSessionResult } from "../runtime/agent-runtime";
import { formatAbortMessage, formatResetMessage } from "./formatters";

export type CommandExecutionDeps = {
  getStatusMessage: (chatId: bigint) => Promise<string>;
  resetSession: (chatId: bigint) => Promise<ResetSessionResult>;
  abortRun: (chatId: bigint) => Promise<AbortRunResult>;
};

export type CommandDefinition = {
  name: string;
  helpDescription: string;
  telegramDescription: string;
  run: (input: { chatId: bigint; deps: CommandExecutionDeps }) => Promise<string>;
};

export const commandDefinitions: CommandDefinition[] = [
  {
    name: "start",
    helpDescription: "show the quick help message",
    telegramDescription: "Show help",
    run: async () => buildHelpMessage(),
  },
  {
    name: "status",
    helpDescription: "show the current session status",
    telegramDescription: "Show current status",
    run: async ({ chatId, deps }) => deps.getStatusMessage(chatId),
  },
  {
    name: "reset",
    helpDescription: "reset the current session",
    telegramDescription: "Reset the session",
    run: async ({ chatId, deps }) => formatResetMessage(await deps.resetSession(chatId)),
  },
  {
    name: "abort",
    helpDescription: "request cancellation for the active run",
    telegramDescription: "Abort the active run",
    run: async ({ chatId, deps }) => formatAbortMessage(await deps.abortRun(chatId)),
  },
  {
    name: "help",
    helpDescription: "show the quick help message",
    telegramDescription: "Show help",
    run: async () => buildHelpMessage(),
  },
];

export function getCommandDefinitions(): readonly CommandDefinition[] {
  validateCommandDefinitions(commandDefinitions);
  return commandDefinitions;
}

export function findCommandDefinition(name: string): CommandDefinition | undefined {
  return getCommandDefinitions().find((definition) => definition.name === name);
}

export async function dispatchCommand(
  name: string,
  input: { chatId: bigint; deps: CommandExecutionDeps },
): Promise<string | null> {
  const definition = findCommandDefinition(name);
  return definition ? definition.run(input) : null;
}

export function getSupportedCommandNames(): string[] {
  return getCommandDefinitions().map((definition) => definition.name);
}

export function toTelegramCommandPayload() {
  return getCommandDefinitions().map((definition) => ({
    command: definition.name,
    description: definition.telegramDescription,
  }));
}

export function buildHelpMessage(): string {
  const inlineCommands = getCommandDefinitions().map((definition) => `/${definition.name}`);
  return ["Send a prompt to run Codex.", `Available commands: ${inlineCommands.join(" ")}`].join("\n");
}

function validateCommandDefinitions(definitions: readonly CommandDefinition[]) {
  const seen = new Set<string>();

  for (const definition of definitions) {
    if (seen.has(definition.name)) {
      throw new Error(`Duplicate command definition: ${definition.name}`);
    }

    seen.add(definition.name);
  }
}
