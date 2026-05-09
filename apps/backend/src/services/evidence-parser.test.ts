import { describe, it, expect } from "vitest";
import { parseEvidenceMarkdown } from "./evidence-parser";

describe("parseEvidenceMarkdown", () => {
  it("returns empty array for empty string", () => {
    expect(parseEvidenceMarkdown("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseEvidenceMarkdown("   \n  \n  ")).toEqual([]);
  });

  it("parses single entry with interpretation, quote, and source", () => {
    const input = [
      "This supports the claim about testing.",
      '> "Tests improve confidence in code changes."',
      "-- Martin Fowler, Refactoring",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      interpretation: "This supports the claim about testing.",
      quote: '"Tests improve confidence in code changes."',
      source: "Martin Fowler, Refactoring",
    });
  });

  it("parses multiple entries separated by blank lines", () => {
    const input = [
      "First interpretation.",
      '> "First quote."',
      "-- Source A",
      "",
      "Second interpretation.",
      '> "Second quote."',
      "-- Source B",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.interpretation).toBe("First interpretation.");
    expect(result[0]!.source).toBe("Source A");
    expect(result[1]!.interpretation).toBe("Second interpretation.");
    expect(result[1]!.source).toBe("Source B");
  });

  it("parses entry with only interpretation (no quote, no source)", () => {
    const result = parseEvidenceMarkdown("Just an interpretation line.");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      interpretation: "Just an interpretation line.",
      quote: "",
      source: "",
    });
  });

  it("parses entry with quote but no source", () => {
    const input = [
      "Some interpretation.",
      '> "A direct quote without attribution."',
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.quote).toBe('"A direct quote without attribution."');
    expect(result[0]!.source).toBe("");
  });

  it("parses entry with source but no quote", () => {
    const input = [
      "Some interpretation.",
      "-- https://example.com/article",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.quote).toBe("");
    expect(result[0]!.source).toBe("https://example.com/article");
  });

  it("recognizes unicode em-dash as source delimiter", () => {
    const input = [
      "Interpretation.",
      '> "Quote."',
      "\u2014 Em-dash source",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("Em-dash source");
  });

  it("recognizes double-dash (--) as source delimiter", () => {
    const input = [
      "Interpretation.",
      "-- Double-dash source",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result[0]!.source).toBe("Double-dash source");
  });

  it("recognizes dash-space ('- ') as source delimiter", () => {
    const input = [
      "Interpretation.",
      "- Dash-space source",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result[0]!.source).toBe("Dash-space source");
  });

  it("joins multiple quote lines together", () => {
    const input = [
      "Interpretation.",
      "> First line of quote",
      "> second line of quote",
      "> third line of quote",
      "-- Source",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result[0]!.quote).toBe(
      "First line of quote second line of quote third line of quote",
    );
  });

  it("handles leading and trailing whitespace on lines", () => {
    const input = [
      "  Interpretation with leading spaces.  ",
      "  > Quote with leading spaces.  ",
      "  -- Source with leading spaces.  ",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.interpretation).toBe("Interpretation with leading spaces.");
    expect(result[0]!.quote).toBe("Quote with leading spaces.");
    expect(result[0]!.source).toBe("Source with leading spaces.");
  });
});
