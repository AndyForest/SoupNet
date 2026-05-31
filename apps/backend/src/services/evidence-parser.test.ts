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
    // The surrounding `"..."` from `> "..."` is markdown not content, so the
    // parser stores the inner text. Downstream renderers wrap consistently.
    expect(result[0]).toEqual({
      interpretation: "This supports the claim about testing.",
      quote: "Tests improve confidence in code changes.",
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
    expect(result[0]!.quote).toBe("A direct quote without attribution.");
    expect(result[0]!.source).toBe("");
  });

  it("leaves unquoted quote lines unchanged (some LLMs omit the marks)", () => {
    const input = [
      "Interpretation.",
      "> Bare quote without surrounding marks",
      "-- Source",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result[0]!.quote).toBe("Bare quote without surrounding marks");
  });

  it("does not strip a single dangling quote mark (no matching pair)", () => {
    // Asymmetric input — only strip when both ends match. A lone `"` likely
    // means the LLM mid-quoted something inside the content.
    const input = [
      "Interpretation.",
      '> "Unbalanced opener with no closer',
      "-- Source",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result[0]!.quote).toBe('"Unbalanced opener with no closer');
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

  it("folds an orphaned quote/source block into the preceding interpretation", () => {
    // Natural Markdown: an interpretation paragraph, a blank line, then its
    // `> quote` / `-- source` block. The blank line must NOT fragment this
    // into an interpretation-only entry plus an orphaned citation entry.
    const input = [
      "The interpretation paragraph that stands on its own line.",
      "",
      '> "The supporting quote."',
      "-- Andy, session",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      interpretation: "The interpretation paragraph that stands on its own line.",
      quote: "The supporting quote.",
      source: "Andy, session",
    });
  });

  it("folds an orphaned source-only block into the preceding interpretation", () => {
    const input = [
      "Interpretation with only a citation, no quote.",
      "",
      "-- https://example.com/article",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      interpretation: "Interpretation with only a citation, no quote.",
      quote: "",
      source: "https://example.com/article",
    });
  });

  it("folds across multiple interpretation/citation pairs", () => {
    const input = [
      "First interpretation.",
      "",
      '> "First quote."',
      "-- Source A",
      "",
      "Second interpretation.",
      "",
      '> "Second quote."',
      "-- Source B",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      interpretation: "First interpretation.",
      quote: "First quote.",
      source: "Source A",
    });
    expect(result[1]).toEqual({
      interpretation: "Second interpretation.",
      quote: "Second quote.",
      source: "Source B",
    });
  });

  it("leaves an orphaned citation with no preceding entry as its own entry", () => {
    // Quote-only at the start of input — nothing to fold into. Faithful to an
    // author who supplied a source but no interpretation.
    const input = [
      '> "A quote with no preceding interpretation."',
      "-- Source",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.interpretation).toBe("");
    expect(result[0]!.quote).toBe("A quote with no preceding interpretation.");
    expect(result[0]!.source).toBe("Source");
  });

  it("does not fold a second orphaned citation when the predecessor already has one", () => {
    // Conservative: once an entry has its citation, a further orphaned quote
    // stays separate rather than clobbering/concatenating — preserves the
    // second reference instead of losing it.
    const input = [
      "Interpretation.",
      "",
      '> "First quote."',
      "-- Source A",
      "",
      '> "Second orphaned quote."',
      "-- Source B",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      interpretation: "Interpretation.",
      quote: "First quote.",
      source: "Source A",
    });
    expect(result[1]!.interpretation).toBe("");
    expect(result[1]!.quote).toBe("Second orphaned quote.");
    expect(result[1]!.source).toBe("Source B");
  });

  it("reproduces and fixes the trace a2c8fb64 fragmentation", () => {
    // Regression guard for the real prod payload that fragmented into 5 rows
    // (2 orphaned interpretations + 3 "(no interpretation)" citations). With
    // folding it collapses to 3: each interpretation reclaims its first quote,
    // and the one genuinely-ambiguous extra quote (two quotes sat between the
    // two interpretations) stays a standalone citation rather than being lost.
    const input = [
      "The user explicitly framed the briefing as high-stakes.",
      "",
      '> "We\'re making some tweaks to the soup.net briefing."',
      "-- Andy, 2026-05-31 session",
      "",
      '> "before I tell you what changes we\'ll be making to the briefing, do a thorough examination."',
      "-- Andy, 2026-05-31 session",
      "",
      "The user also flagged that a regression-test system is a longer-term goal.",
      "",
      '> "Long term I want to make a regression testing system for tweaks."',
      "-- Andy, 2026-05-31 session",
    ].join("\n");

    const result = parseEvidenceMarkdown(input);
    // First interp folds its quote; the second orphaned quote (predecessor
    // already cited) stays separate; second interp folds its quote.
    expect(result).toHaveLength(3);
    expect(result[0]!.interpretation).toBe("The user explicitly framed the briefing as high-stakes.");
    expect(result[0]!.quote).toBe("We're making some tweaks to the soup.net briefing.");
    expect(result[1]!.interpretation).toBe("");
    expect(result[1]!.quote).toBe("before I tell you what changes we'll be making to the briefing, do a thorough examination.");
    expect(result[2]!.interpretation).toBe("The user also flagged that a regression-test system is a longer-term goal.");
    expect(result[2]!.quote).toBe("Long term I want to make a regression testing system for tweaks.");
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
