import type { DetectedScheduledJobDefinition, ScheduledJobAction, ScheduledJobSpec } from "./types";

export function parseScheduledJobDefinition(
  definition: DetectedScheduledJobDefinition,
): ScheduledJobSpec {
  const raw = asRecord(definition.raw, "scheduled job definition must be an object");
  const id = requireNonEmptyString(raw.id, "id");
  const time = requireNonEmptyString(raw.time, "time");
  const { hour, minute } = parseTime(time);
  const date = raw.date == null ? null : parseDate(requireNonEmptyString(raw.date, "date"));
  const disabled = raw.disabled == null ? false : requireBoolean(raw.disabled, "disabled");
  const action = parseAction(raw.action);

  return {
    id,
    sourcePath: definition.sourcePath,
    date,
    time,
    hour,
    minute,
    disabled,
    action,
  };
}

function parseAction(value: unknown): ScheduledJobAction {
  const action = asRecord(value, "action must be an object");
  const type = requireNonEmptyString(action.type, "action.type");

  if (type !== "message") {
    throw new Error('action.type must be "message"');
  }

  return {
    type,
    prompt: requireNonEmptyString(action.prompt, "action.prompt"),
  };
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(?<hour>\d{2}):(?<minute>\d{2})$/.exec(value);

  if (!match?.groups) {
    throw new Error("time must be in HH:mm format");
  }

  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("time must be in HH:mm format");
  }

  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error("time must be in HH:mm format");
  }

  return { hour, minute };
}

function parseDate(value: string): string {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(value);

  if (!match?.groups) {
    throw new Error("date must be in YYYY-MM-DD format");
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error("date must be in YYYY-MM-DD format");
  }

  return value;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean`);
  }

  return value;
}
