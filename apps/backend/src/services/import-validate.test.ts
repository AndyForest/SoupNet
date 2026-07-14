import { describe, it, expect } from "vitest";
import { parseExportPayload } from "./import-validate";

/**
 * Layer 1 unit tests for the pure corpus-import validator.
 * No I/O — runs without a backend or database.
 */

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const E1 = "33333333-3333-4333-8333-333333333333";
const R1 = "44444444-4444-4444-8444-444444444444";
const L1 = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-07-01T12:00:00.000Z";

function minimalTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: T1,
    groupId: T2,
    claimText: "As a tester, I prefer round trips.",
    claimTextHash: null,
    formatAdherenceScore: 0.9,
    decidedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("parseExportPayload — envelope", () => {
  it("rejects non-object bodies", () => {
    for (const bad of [null, 42, "str", [1, 2]]) {
      const res = parseExportPayload(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/JSON object/);
    }
  });

  it("rejects a missing or non-integer schemaVersion with a recognizable message", () => {
    for (const bad of [{}, { schemaVersion: "1" }, { schemaVersion: 1.5 }]) {
      const res = parseExportPayload(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/schemaVersion/);
    }
  });

  it("rejects an unsupported schemaVersion naming both versions", () => {
    const res = parseExportPayload({ schemaVersion: 99 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("99");
      expect(res.error).toContain("1");
    }
  });

  it("accepts schemaVersion 1 with all sections missing (client-side subsetting)", () => {
    const res = parseExportPayload({ schemaVersion: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.traces).toEqual([]);
      expect(res.data.evidence).toEqual([]);
      expect(res.data.books).toEqual([]);
    }
  });

  it("ignores unknown additive keys (forward compatibility)", () => {
    const res = parseExportPayload({
      schemaVersion: 1,
      futureSection: [{ anything: true }],
      traces: [minimalTrace({ futureField: "ignored" })],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.traces).toHaveLength(1);
  });

  it("rejects a section that is present but not an array", () => {
    const res = parseExportPayload({ schemaVersion: 1, traces: { not: "an array" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/"traces" must be an array/);
  });
});

describe("parseExportPayload — trace rows", () => {
  it("parses a full trace row with timestamps as Dates", () => {
    const res = parseExportPayload({
      schemaVersion: 1,
      traces: [minimalTrace({ decidedAt: "2024-03-15T00:00:00.000Z" })],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const t = res.data.traces[0]!;
      expect(t.id).toBe(T1);
      expect(t.decidedAt).toBeInstanceOf(Date);
      expect(t.decidedAt?.toISOString()).toBe("2024-03-15T00:00:00.000Z");
      expect(t.createdAt.toISOString()).toBe(NOW);
    }
  });

  it("rejects rows with a bad uuid, empty claimText, or unparseable timestamp", () => {
    for (const bad of [
      minimalTrace({ id: "not-a-uuid" }),
      minimalTrace({ claimText: "" }),
      minimalTrace({ claimText: 7 }),
      minimalTrace({ createdAt: "yesterday-ish" }),
      minimalTrace({ createdAt: undefined }),
      minimalTrace({ decidedAt: "not a date" }),
      minimalTrace({ formatAdherenceScore: "high" }),
      minimalTrace({ groupId: "nope" }),
      "not an object",
    ]) {
      const res = parseExportPayload({ schemaVersion: 1, traces: [bad] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/traces\[0\]/);
    }
  });

  it("mints a PK for a trace row that arrives without an id (v1.1)", () => {
    const { id: _drop, ...noId } = minimalTrace();
    const res = parseExportPayload({ schemaVersion: 1, traces: [noId] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.traces).toHaveLength(1);
      const minted = res.data.traces[0]!.id;
      expect(minted).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(minted).not.toBe(T1);
    }
  });

  it("still rejects a present-but-malformed id (garbage is a broken file, not a PK-less row)", () => {
    const res = parseExportPayload({ schemaVersion: 1, traces: [minimalTrace({ id: "not-a-uuid" })] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/traces\[0\]/);
  });

  it("dedupes repeated ids within the file (first occurrence wins)", () => {
    const res = parseExportPayload({
      schemaVersion: 1,
      traces: [minimalTrace({ claimText: "first" }), minimalTrace({ claimText: "second" })],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.traces).toHaveLength(1);
      expect(res.data.traces[0]!.claimText).toBe("first");
    }
  });

  it("truncates the error list on pathologically broken files", () => {
    const rows = Array.from({ length: 30 }, () => minimalTrace({ id: "bad" }));
    const res = parseExportPayload({ schemaVersion: 1, traces: rows });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/truncated/);
  });
});

describe("parseExportPayload — linked sections", () => {
  it("parses evidence, references, links, and books", () => {
    const res = parseExportPayload({
      schemaVersion: 1,
      traces: [minimalTrace()],
      evidence: [{ id: E1, content: "supports it", createdAt: NOW, updatedAt: NOW }],
      references: [{ id: R1, quote: "q", source: "s", fileUrl: null, fileMimeType: null, fileHash: null, createdAt: NOW }],
      traceEvidence: [{ id: L1, traceId: T1, evidenceId: E1, stance: "for", apiKeyId: null, createdAt: NOW }],
      traceReferences: [{ id: T2, traceId: T1, referenceId: R1, apiKeyId: T2, createdAt: NOW }],
      evidenceReferences: [{ id: R1, evidenceId: E1, referenceId: R1, createdAt: NOW }],
      groupMemberships: [{ groupId: T2, name: "Old Book", slug: "old-book", description: null, role: "owner", joinedAt: NOW }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.evidence[0]!.content).toBe("supports it");
      expect(res.data.references[0]!.quote).toBe("q");
      expect(res.data.traceEvidence[0]!.stance).toBe("for");
      expect(res.data.traceReferences[0]!.apiKeyId).toBe(T2);
      expect(res.data.evidenceReferences[0]!.referenceId).toBe(R1);
      expect(res.data.books[0]).toEqual({ groupId: T2, name: "Old Book", slug: "old-book", description: null });
    }
  });

  it("mints PKs for id-less evidence/reference/link rows but still requires their FK endpoints (v1.1)", () => {
    const res = parseExportPayload({
      schemaVersion: 1,
      evidence: [{ content: "no id here", createdAt: NOW }],
      traceEvidence: [{ traceId: T1, evidenceId: E1, stance: "for", createdAt: NOW }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.evidence[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.data.traceEvidence[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    // A missing FK endpoint is still a hard error (nothing for the link to point at).
    const bad = parseExportPayload({
      schemaVersion: 1,
      traceEvidence: [{ evidenceId: E1, stance: "for", createdAt: NOW }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/traceId/);
  });

  it("allows empty-string evidence content and reference quote/source (export writes them)", () => {
    const res = parseExportPayload({
      schemaVersion: 1,
      evidence: [{ id: E1, content: "", createdAt: NOW }],
      references: [{ id: R1, quote: "", source: "", createdAt: NOW }],
    });
    expect(res.ok).toBe(true);
  });

  it("rejects an invalid stance", () => {
    const res = parseExportPayload({
      schemaVersion: 1,
      traceEvidence: [{ id: L1, traceId: T1, evidenceId: E1, stance: "maybe", apiKeyId: null, createdAt: NOW }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/stance/);
  });

  it("rejects non-uuid apiKeyId but accepts null (hand-trimmed files)", () => {
    const bad = parseExportPayload({
      schemaVersion: 1,
      traceEvidence: [{ id: L1, traceId: T1, evidenceId: E1, stance: "for", apiKeyId: "abc", createdAt: NOW }],
    });
    expect(bad.ok).toBe(false);
    const good = parseExportPayload({
      schemaVersion: 1,
      traceEvidence: [{ id: L1, traceId: T1, evidenceId: E1, stance: "for", createdAt: NOW }],
    });
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.data.traceEvidence[0]!.apiKeyId).toBeNull();
  });
});
