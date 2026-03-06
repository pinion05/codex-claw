const allowedCommands = ["start", "help", "status", "reset", "abort"] as const;
const allowed = new Set<string>(allowedCommands);

type CommandName = (typeof allowedCommands)[number];

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
