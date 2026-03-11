export const commandDefinitions = [
  {
    name: "start",
    kind: "help",
    helpDescription: "show the quick help message",
    telegramDescription: "Show help",
  },
  {
    name: "help",
    kind: "help",
    helpDescription: "show the quick help message",
    telegramDescription: "Show help",
  },
  {
    name: "status",
    kind: "status",
    helpDescription: "show the current session status",
    telegramDescription: "Show current status",
  },
  {
    name: "reset",
    kind: "reset",
    helpDescription: "reset the current session",
    telegramDescription: "Reset the session",
  },
  {
    name: "abort",
    kind: "abort",
    helpDescription: "request cancellation for the active run",
    telegramDescription: "Abort the active run",
  },
] as const;

export type CommandDefinition = (typeof commandDefinitions)[number];
export type CommandName = CommandDefinition["name"];

export function getSupportedCommandNames(): CommandName[] {
  return commandDefinitions.map((definition) => definition.name);
}

export function toTelegramCommandPayload() {
  return commandDefinitions.map((definition) => ({
    command: definition.name,
    description: definition.telegramDescription,
  }));
}
