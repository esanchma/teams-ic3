import { describe, expect, test } from "bun:test";

import { isProbablyConversationId, looksLikeGuid, paragraphsToHtml, stripHtml } from "../src/utils";

describe("paragraphsToHtml", () => {
  test("splits paragraphs and escapes html", () => {
    expect(paragraphsToHtml("hello\n<world> & friends")).toBe("<p>hello</p><p>&lt;world&gt; &amp; friends</p>");
  });

  test("returns empty paragraph for blank input", () => {
    expect(paragraphsToHtml("   \n\n ")).toBe("<p></p>");
  });
});

describe("stripHtml", () => {
  test("removes tags and decodes entities", () => {
    const html = "<p>Hello&nbsp;<strong>Luis</strong></p><p>a &amp; b<br>c</p>";
    expect(stripHtml(html)).toBe("Hello Luis\na & b\nc");
  });
});

describe("identifier helpers", () => {
  test("detects conversation ids", () => {
    expect(isProbablyConversationId("48:notes")).toBe(true);
    expect(isProbablyConversationId("19:abc123@thread.v2")).toBe(true);
    expect(isProbablyConversationId("2")).toBe(false);
  });

  test("detects guids", () => {
    expect(looksLikeGuid("b1a0cffe-d652-426e-b6b1-b1e4aa1f56e9")).toBe(true);
    expect(looksLikeGuid("not-a-guid")).toBe(false);
  });
});
