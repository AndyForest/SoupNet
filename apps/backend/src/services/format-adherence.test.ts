import { describe, it, expect } from "vitest";
import { scoreFormatAdherence } from "./format-adherence";

describe("scoreFormatAdherence", () => {
  it("scores a full user story as good", () => {
    const result = scoreFormatAdherence(
      "As a developer, I prefer TypeScript so that I catch bugs early.",
    );
    expect(result.level).toBe("good");
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it("scores a taste assertion without role framing as warn", () => {
    const result = scoreFormatAdherence(
      "I prefer high-contrast themes for extended coding sessions.",
    );
    expect(["good", "warn"]).toContain(result.level);
    expect(result.score).toBeGreaterThanOrEqual(0.3);
  });

  it("rejects a question", () => {
    const result = scoreFormatAdherence(
      "What font should I use for my project?",
    );
    expect(result.level).toBe("reject");
    expect(result.score).toBeLessThan(0.3);
  });

  it("rejects a command", () => {
    const result = scoreFormatAdherence("Change the font to 16px.");
    expect(result.level).toBe("reject");
    expect(result.score).toBeLessThan(0.3);
  });

  it("rejects a search command", () => {
    const result = scoreFormatAdherence("Find all traces about typography.");
    expect(result.level).toBe("reject");
    expect(result.score).toBeLessThan(0.3);
  });

  it("scores partial recipe (has role + choice, no 'so that') as warn or good", () => {
    const result = scoreFormatAdherence("As a developer, I chose TypeScript.");
    expect(["good", "warn"]).toContain(result.level);
    expect(result.score).toBeGreaterThanOrEqual(0.3);
  });

  it("scores bare assertion without context as warn", () => {
    const result = scoreFormatAdherence(
      "TypeScript is better than JavaScript.",
    );
    expect(result.level).toBe("warn");
  });

  it("rejects empty input", () => {
    const result = scoreFormatAdherence("");
    expect(result.level).toBe("reject");
    expect(result.score).toBe(0);
  });

  it("rejects very short input", () => {
    const result = scoreFormatAdherence("test");
    expect(result.level).toBe("reject");
  });

  // Additional edge cases
  it("handles 'As an' (not just 'As a')", () => {
    const result = scoreFormatAdherence(
      "As an engineer, I prefer explicit error handling so that failures are visible.",
    );
    expect(result.level).toBe("good");
  });

  it("handles 'As the' (definite article — singular roles like co-creator, founder)", () => {
    // Antigravity feedback (2026-04-18): "As the co-creator of an indie game"
    // was flagged as warning under the old /^As an?/ regex, even though it's
    // grammatically correct English for a singular role title.
    const result = scoreFormatAdherence(
      "As the co-creator of an indie game working on the v0.4 milestone, I prefer hand-drawn assets so that the game keeps its sketchbook feel.",
    );
    expect(result.level).toBe("good");
  });

  it("handles 'because' as reasoning indicator", () => {
    const result = scoreFormatAdherence(
      "As a designer, I chose Inter because it reads well at small sizes.",
    );
    expect(result.level).toBe("good");
  });

  it("rejects 'What are the preferences about...'", () => {
    const result = scoreFormatAdherence(
      "What are the preferences about fonts and typography?",
    );
    expect(result.level).toBe("reject");
  });

  it("rejects 'How do I...'", () => {
    const result = scoreFormatAdherence("How do I configure dark mode?");
    expect(result.level).toBe("reject");
  });

  it("gives project context a positive signal", () => {
    // A partial recipe (no reasoning) benefits from project context
    const withContext = scoreFormatAdherence(
      "As a developer working on the Acme API, I prefer TypeScript.",
    );
    const withoutContext = scoreFormatAdherence(
      "As a developer, I prefer TypeScript.",
    );
    expect(withContext.score).toBeGreaterThan(withoutContext.score);
    expect(withContext.level).toBe("good");
  });

  it("recognizes non-technical user recipes as good", () => {
    const result = scoreFormatAdherence(
      "As a parent organizing the Spring Fundraiser, I prefer bold poster layouts so that they grab attention from a distance.",
    );
    expect(result.level).toBe("good");
  });
});
