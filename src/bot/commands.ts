const allowed = new Set(["start", "help", "status", "reset", "abort"]);

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

  if (!allowed.has(name)) {
    return null;
  }

  return {
    name,
    args: rest.join(" "),
  };
}
