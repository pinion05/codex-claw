import { describe, expect, test } from "bun:test";
import { parseCommand } from "../../src/bot/commands";

describe("parseCommand", () => {
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

  test("returns null for normal chat", () => {
    expect(parseCommand("hello there")).toBeNull();
  });

  test("narrows command names to the supported command union", () => {
    const parsed = parseCommand("/abort");
    expect(parsed).not.toBeNull();

    if (!parsed) {
      throw new Error("expected /abort to parse");
    }

    const name: "start" | "help" | "status" | "reset" | "abort" = parsed.name;
    expect(name).toBe("abort");
  });
});
