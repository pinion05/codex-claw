import { describe, expect, test } from "bun:test";
import {
  commandDefinitions,
  getSupportedCommandNames,
  toTelegramCommandPayload,
} from "../../src/bot/command-definitions";
import { parseCommand } from "../../src/bot/commands";

type MutableCommandDefinition = (typeof commandDefinitions)[number];

function snapshotCommandDefinitions() {
  return commandDefinitions.map((definition) => ({
    ...definition,
  }));
}

function restoreCommandDefinitions(snapshot: MutableCommandDefinition[]) {
  commandDefinitions.splice(0, commandDefinitions.length, ...snapshot);
}

describe("parseCommand", () => {
  test("exports supported command names from the registry", () => {
    expect(getSupportedCommandNames()).toEqual([
      "start",
      "status",
      "reset",
      "abort",
      "help",
    ]);
  });

  test("builds Telegram command payloads from the registry", () => {
    expect(toTelegramCommandPayload()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "status",
          description: expect.any(String),
        }),
      ]),
    );
  });

  test("parses supported slash commands", () => {
    expect(parseCommand("/status")).toEqual({ name: "status", args: "" });
    expect(parseCommand("/reset")).toEqual({ name: "reset", args: "" });
  });

  test("parses bot mentions and arguments", () => {
    expect(parseCommand("/status@codex_claw_bot show latest")).toEqual({
      name: "status",
      args: "show latest",
    });
  });

  test("returns null for unsupported slash commands", () => {
    expect(parseCommand("/deploy now")).toBeNull();
  });

  test("reflects registry changes immediately instead of using a startup snapshot", () => {
    const originalDefinitions = snapshotCommandDefinitions();

    commandDefinitions.push({
      name: "review",
      helpDescription: "show review guidance",
      telegramDescription: "Show review guidance",
      run: async () => "review",
    });

    try {
      expect(parseCommand("/review now")).toEqual({
        name: "review",
        args: "now",
      });
    } finally {
      restoreCommandDefinitions(originalDefinitions);
    }
  });

  test("rejects duplicate command names in the registry", () => {
    const originalDefinitions = snapshotCommandDefinitions();

    commandDefinitions.push({
      name: "status",
      helpDescription: "duplicate status",
      telegramDescription: "Duplicate status",
      run: async () => "duplicate",
    });

    try {
      expect(() => getSupportedCommandNames()).toThrow("Duplicate command definition: status");
      expect(() => toTelegramCommandPayload()).toThrow("Duplicate command definition: status");
      expect(() => parseCommand("/status")).toThrow("Duplicate command definition: status");
    } finally {
      restoreCommandDefinitions(originalDefinitions);
    }
  });

  test("returns null for normal chat", () => {
    expect(parseCommand("hello there")).toBeNull();
  });
});
