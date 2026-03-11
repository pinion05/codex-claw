import { getSupportedCommandNames } from "./command-definitions";

export type ParsedCommand = {
  name: string;
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

function isCommandName(value: string): value is string {
  return getSupportedCommandNames().includes(value);
}
