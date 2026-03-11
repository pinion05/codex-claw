import {
  getSupportedCommandNames,
  type CommandName,
} from "./command-definitions";

const allowed = new Set<string>(getSupportedCommandNames());

export type ParsedCommand = {
  name: CommandName;
  args: string;
};

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [raw, ...rest] = trimmed.split(/\s+/);
  const name = raw.slice(1).split("@", 2)[0];

  if (!isCommandName(name)) {
    return null;
  }

  return {
    name,
    args: rest.join(" "),
  };
}

function isCommandName(value: string): value is CommandName {
  return allowed.has(value);
}
