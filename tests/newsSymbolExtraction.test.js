import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMentionedSymbols } from "../js/newsFeed.js";

test("extractMentionedSymbols finds a known company name in a headline", () => {
  const found = extractMentionedSymbols("Apple unveils new chip for next-generation MacBooks");
  assert.ok(found.includes("AAPL"));
});

test("extractMentionedSymbols is case-insensitive", () => {
  const found = extractMentionedSymbols("TESLA reports record deliveries for the quarter");
  assert.ok(found.includes("TSLA"));
});

test("extractMentionedSymbols can find multiple companies in one headline", () => {
  const found = extractMentionedSymbols("Microsoft and Nvidia announce new AI partnership");
  assert.ok(found.includes("MSFT"));
  assert.ok(found.includes("NVDA"));
});

test("extractMentionedSymbols returns an empty array for text mentioning no known company", () => {
  const found = extractMentionedSymbols("Local weather expected to be sunny this weekend");
  assert.deepEqual(found, []);
});

test("extractMentionedSymbols handles empty/null input without throwing", () => {
  assert.deepEqual(extractMentionedSymbols(""), []);
  assert.deepEqual(extractMentionedSymbols(null), []);
  assert.deepEqual(extractMentionedSymbols(undefined), []);
});

test("extractMentionedSymbols never returns duplicate tickers for a company mentioned by multiple aliases", () => {
  // "Facebook" and "Meta Platforms" both map to META — a headline using both should still yield META once.
  const found = extractMentionedSymbols("Meta Platforms (formerly Facebook) posts quarterly earnings");
  const metaCount = found.filter((t) => t === "META").length;
  assert.equal(metaCount, 1);
});

test("extractMentionedSymbols output contains ONLY tickers — never a direction, sentiment, or recommendation field", () => {
  const found = extractMentionedSymbols("Amazon stock surges after strong earnings beat");
  assert.ok(Array.isArray(found));
  found.forEach((item) => {
    assert.equal(typeof item, "string"); // just a ticker string, nothing structured/interpretive attached
  });
});
