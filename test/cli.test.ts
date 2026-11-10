import { describe, expect, test } from "bun:test";

import { UsageError, parseArgs, requireNumber } from "../src/cli";

describe("parseArgs", () => {
  test("parses flags, key/value options, and positionals", () => {
    const args = parseArgs(["--json", "-n", "5", "--chat", "48:notes", "terraform"]);

    expect(args.flags.has("json")).toBe(true);
    expect(args.values.get("max")).toBe("5");
    expect(args.values.get("chat")).toBe("48:notes");
    expect(args.positionals).toEqual(["terraform"]);
  });

  test("parses equals syntax and short packed flags", () => {
    const args = parseArgs(["--max=10", "-xy", "foo"]);

    expect(args.values.get("max")).toBe("10");
    expect(args.flags.has("x")).toBe(true);
    expect(args.flags.has("y")).toBe(true);
    expect(args.positionals).toEqual(["foo"]);
  });
});

describe("requireNumber", () => {
  test("returns fallback when value missing", () => {
    expect(requireNumber(undefined, 25)).toBe(25);
  });

  test("parses valid numbers", () => {
    expect(requireNumber("0", 25)).toBe(0);
    expect(requireNumber("7", 25)).toBe(7);
  });

  test("rejects invalid numbers", () => {
    expect(() => requireNumber("-1", 25)).toThrow(UsageError);
    expect(() => requireNumber("abc", 25)).toThrow(UsageError);
  });
});
