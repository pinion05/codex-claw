import { describe, expect, test } from "bun:test";
import { parseCommand } from "../../src/bot/commands";

describe("parseCommand", () => {
  test("parses supported slash commands", () => {
    expect(parseCommand("/status")).toEqual({ name: "status", args: "" });
    expect(parseCommand("/reset")).toEqual({ name: "reset", args: "" });
  });

  test("returns null for normal chat", () => {
    expect(parseCommand("hello there")).toBeNull();
  });
});
