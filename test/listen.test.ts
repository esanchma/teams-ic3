import { describe, expect, test } from "bun:test";

import { extractTriggerCommand, truncateReply } from "../src/listen";

describe("extractTriggerCommand", () => {
  test("matches exact trigger with whitespace", () => {
    expect(extractTriggerCommand("@pi haz un resumen", "@pi")).toBe("haz un resumen");
  });

  test("matches trigger followed by punctuation", () => {
    expect(extractTriggerCommand("@pi: revisa esto", "@pi")).toBe("revisa esto");
    expect(extractTriggerCommand("@pi, revisa esto", "@pi")).toBe("revisa esto");
  });

  test("rejects non-prefix and partial prefix", () => {
    expect(extractTriggerCommand("hola @pi revisa", "@pi")).toBeNull();
    expect(extractTriggerCommand("@pista revisa", "@pi")).toBeNull();
  });

  test("rejects empty command", () => {
    expect(extractTriggerCommand("@pi", "@pi")).toBeNull();
  });
});

describe("truncateReply", () => {
  test("keeps short text", () => {
    expect(truncateReply("hola", 100)).toBe("hola");
  });

  test("truncates long text with marker", () => {
    const value = truncateReply("a".repeat(100), 60);
    expect(value.length).toBeLessThanOrEqual(60);
    expect(value.includes("[truncated by teams-ic3 listen]")).toBe(true);
  });
});
