import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

/**
 * Layer 3 integration tests for POST /import — requires a running backend
 * (BACKEND_URL). See docs/planning/corpus-import.md for the brief; these
 * tests cover its acceptance criteria 1, 2, 5, 6 (auth + validation), and 7.
 * Criteria 3/4 (cache-warm / cold async re-embed) involve the worker's
 * 1-minute sweep cron and are verified manually against a dev backend —
 * see the import route header and testing-plan.md Layer 4.
 *
 * The scale check (brief point 9) lives in the IMPORT_SCALE_TEST-gated
 * describe at the bottom (20k traces ≈ 7 MB) so the default suite stays fast.
 */

const BASE = process.env["BACKEND_URL"] ?? "";
const uid = Date.now();

interface ExportFile {
  schemaVersion: number;
  traces: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  references: Array<Record<string, unknown>>;
  traceEvidence: Array<Record<string, unknown>>;
  traceReferences: Array<Record<string, unknown>>;
  evidenceReferences: Array<Record<string, unknown>>;
  groupMemberships: Array<Record<string, unknown>>;
}

const NOW = "2026-07-01T12:00:00.000Z";
const DECIDED = "2024-03-15T00:00:00.000Z";

/** A synthetic two-trace export with one evidence + reference chain. */
function buildExportFile(): { file: ExportFile; traceIds: string[]; evidenceId: string; referenceId: string } {
  const t1 = crypto.randomUUID();
  const t2 = crypto.randomUUID();
  const ev = crypto.randomUUID();
  const ref = crypto.randomUUID();
  const key = crypto.randomUUID();
  const oldGroup = crypto.randomUUID();
  const file: ExportFile = {
    schemaVersion: 1,
    traces: [
      {
        id: t1, groupId: oldGroup, apiKeyId: key,
        claimText: `As a data owner restoring a corpus (${t1.slice(0, 8)}), I prefer imports that preserve my original decision dates so that history stays trustworthy.`,
        claimTextHash: null, formatAdherenceScore: 0.8,
        decidedAt: DECIDED, createdAt: NOW, updatedAt: NOW,
      },
      {
        id: t2, groupId: oldGroup, apiKeyId: key,
        claimText: `As a data owner moving between instances (${t2.slice(0, 8)}), I chose portable JSON exports so that no vendor holds my corpus hostage.`,
        claimTextHash: null, formatAdherenceScore: 0.9,
        decidedAt: null, createdAt: NOW, updatedAt: NOW,
      },
    ],
    evidence: [
      { id: ev, content: "The user asked for a lossless round trip.", createdAt: NOW, updatedAt: NOW },
    ],
    references: [
      { id: ref, quote: "make the export importable", source: "User conversation, 2026-07", fileUrl: null, fileMimeType: null, fileHash: null, createdAt: NOW },
    ],
    traceEvidence: [
      { id: crypto.randomUUID(), traceId: t1, evidenceId: ev, stance: "for", apiKeyId: key, createdAt: NOW },
    ],
    traceReferences: [
      { id: crypto.randomUUID(), traceId: t1, referenceId: ref, apiKeyId: key, createdAt: NOW },
    ],
    evidenceReferences: [
      { id: crypto.randomUUID(), evidenceId: ev, referenceId: ref, createdAt: NOW },
    ],
    groupMemberships: [
      { groupId: oldGroup, name: "Original Book", slug: "original-book", description: "source instance book", role: "owner", joinedAt: NOW },
    ],
  };
  return { file, traceIds: [t1, t2], evidenceId: ev, referenceId: ref };
}

async function registerAndVerify(email: string, password: string): Promise<string> {
  const reg = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tosAccepted: true }),
  });
  const regBody = (await reg.json()) as { data?: { verificationToken?: string } };
  const vtok = regBody.data?.verificationToken;
  if (!vtok) throw new Error(`Setup failed for ${email}`);
  await fetch(`${BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: vtok }),
  });
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = (await login.json()) as { data?: { token?: string } };
  const t = loginBody.data?.token ?? "";
  if (!t) throw new Error(`Login failed for ${email}`);
  return t;
}

async function postImport(
  token: string,
  body: string,
  query = "",
): Promise<{ status: number; body: ImportResponse }> {
  const res = await fetch(`${BASE}/import${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body,
  });
  return { status: res.status, body: (await res.json()) as ImportResponse };
}

interface ImportResponse {
  ok: boolean;
  error?: string;
  data?: {
    book: { id: string; name: string; slug: string; created: boolean } | null;
    counts: {
      traces: { inserted: number; skippedIdentical: number; conflicted: number; overwritten: number; remapped: number };
      evidence: { inserted: number; skippedExisting: number; conflicted: number };
      references: { inserted: number; skippedExisting: number; conflicted: number };
      links: { inserted: number; skippedExisting: number; orphaned: number };
    };
    conflicts: Array<{ entity: string; id: string; fields: string[]; kept: string }>;
    conflictsTotal: number;
    idMap: Array<{ entity: string; from: string; to: string }>;
    embeddings: { evidenceQueued: number; tracesPendingBackfill: number; note: string };
    originalBooks: Array<{ groupId: string; name: string | null; slug: string | null; mappedTo: string | null }>;
  };
}

interface ExportedData {
  traces: Array<{ id: string; claimText: string; decidedAt: string | null; createdAt: string; groupId: string }>;
  evidence: Array<{ id: string; content: string }>;
  references: Array<{ id: string; quote: string }>;
  traceEvidence: Array<{ traceId: string; evidenceId: string }>;
  traceReferences: Array<{ traceId: string; referenceId: string }>;
  evidenceReferences: Array<{ evidenceId: string; referenceId: string }>;
}

async function exportAccount(token: string): Promise<ExportedData> {
  const res = await fetch(`${BASE}/auth/me/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ExportedData;
}

let tokenA = "";
let tokenB = "";

describe.skipIf(!BASE)("POST /import", () => {
  beforeAll(async () => {
    tokenA = await registerAndVerify(`test-import-a-${uid}@test.local`, "import-test-pw-aaa1");
    tokenB = await registerAndVerify(`test-import-b-${uid}@test.local`, "import-test-pw-bbb1");
  });

  // ── Auth surface (acceptance criterion 7) ────────────────────────────────
  it("rejects API-key bearers with 403 and a human-only message", async () => {
    const res = await fetch(`${BASE}/import`, {
      method: "POST",
      headers: { Authorization: "Bearer cn_d_notARealKey000000000000000000" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/human-only/i);
  });

  it("rejects missing/invalid JWT with 401", async () => {
    const res = await fetch(`${BASE}/import`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    const res2 = await fetch(`${BASE}/import`, {
      method: "POST",
      headers: { Authorization: "Bearer not.a.jwt" },
      body: "{}",
    });
    expect(res2.status).toBe(401);
  });

  // ── Malformed input (acceptance criterion 6) ─────────────────────────────
  it("rejects non-JSON bodies with 400", async () => {
    const { status, body } = await postImport(tokenA, "this is not json");
    expect(status).toBe(400);
    expect(body.error).toMatch(/not valid JSON/);
  });

  it("rejects an incompatible schemaVersion with an actionable error", async () => {
    const { status, body } = await postImport(tokenA, JSON.stringify({ schemaVersion: 99 }));
    expect(status).toBe(400);
    expect(body.error).toContain("99");
    expect(body.error).toMatch(/schemaVersion/);
  });

  it("rejects structurally broken rows with row-indexed errors", async () => {
    const { status, body } = await postImport(
      tokenA,
      JSON.stringify({ schemaVersion: 1, traces: [{ id: "nope" }] }),
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/traces\[0\]/);
  });

  it("404s an unknown destination book", async () => {
    const { file } = buildExportFile();
    const { status } = await postImport(tokenA, JSON.stringify(file), "?book=no-such-book");
    expect(status).toBe(404);
  });

  // ── Round trip + idempotency (acceptance criteria 1 + 2) ─────────────────
  const rt = buildExportFile();
  let rtBookId = "";

  it("imports a fresh export into a new book with full counts", async () => {
    const { status, body } = await postImport(tokenA, JSON.stringify(rt.file));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const data = body.data!;
    expect(data.book).not.toBeNull();
    expect(data.book!.created).toBe(true);
    rtBookId = data.book!.id;
    expect(data.counts.traces).toEqual({
      inserted: 2, skippedIdentical: 0, conflicted: 0, overwritten: 0, remapped: 0,
    });
    expect(data.idMap).toEqual([]);
    expect(data.counts.evidence.inserted).toBe(1);
    expect(data.counts.references.inserted).toBe(1);
    expect(data.counts.links.inserted).toBe(3);
    expect(data.counts.links.orphaned).toBe(0);
    // Pending embedding state is visible, not silent (design point 2).
    expect(data.embeddings.tracesPendingBackfill).toBe(2);
    expect(data.embeddings.evidenceQueued).toBe(1);
    expect(data.embeddings.note.length).toBeGreaterThan(0);
    // Original book structure preserved as metadata (design point 5).
    expect(data.originalBooks).toHaveLength(1);
    expect(data.originalBooks[0]!.name).toBe("Original Book");
    expect(data.originalBooks[0]!.mappedTo).toBe(rtBookId);
  });

  it("round-trips: a fresh export contains the imported rows with timestamps intact", async () => {
    const exported = await exportAccount(tokenA);
    const t1 = exported.traces.find((t) => t.id === rt.traceIds[0]);
    const t2 = exported.traces.find((t) => t.id === rt.traceIds[1]);
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    // decided_at fidelity (design point 4) + created_at preservation.
    expect(new Date(t1!.decidedAt!).toISOString()).toBe(DECIDED);
    expect(t2!.decidedAt).toBeNull();
    expect(new Date(t1!.createdAt).toISOString()).toBe(NOW);
    expect(t1!.groupId).toBe(rtBookId);
    expect(exported.evidence.some((e) => e.id === rt.evidenceId)).toBe(true);
    expect(exported.references.some((r) => r.id === rt.referenceId)).toBe(true);
    expect(exported.traceEvidence.some((l) => l.traceId === rt.traceIds[0] && l.evidenceId === rt.evidenceId)).toBe(true);
    expect(exported.traceReferences.some((l) => l.traceId === rt.traceIds[0] && l.referenceId === rt.referenceId)).toBe(true);
    expect(exported.evidenceReferences.some((l) => l.evidenceId === rt.evidenceId && l.referenceId === rt.referenceId)).toBe(true);
  });

  it("is idempotent: re-importing the same file skips everything and creates no book", async () => {
    const { status, body } = await postImport(tokenA, JSON.stringify(rt.file));
    expect(status).toBe(200);
    const data = body.data!;
    expect(data.counts.traces).toEqual({
      inserted: 0, skippedIdentical: 2, conflicted: 0, overwritten: 0, remapped: 0,
    });
    expect(data.counts.evidence).toEqual({ inserted: 0, skippedExisting: 1, conflicted: 0 });
    expect(data.counts.references).toEqual({ inserted: 0, skippedExisting: 1, conflicted: 0 });
    expect(data.counts.links.inserted).toBe(0);
    expect(data.counts.links.skippedExisting).toBe(3);
    // Fully-skipped import must not litter an empty book.
    expect(data.book).toBeNull();
    expect(data.embeddings.tracesPendingBackfill).toBe(0);
    expect(data.embeddings.evidenceQueued).toBe(0);
  });

  // ── Collision semantics (acceptance criterion 5) ─────────────────────────
  it("reports conflicts per row and keeps existing rows by default", async () => {
    const doctored = structuredClone(rt.file);
    doctored.traces[0]!["claimText"] = "As a doctored file, I differ.";
    doctored.traces[0]!["decidedAt"] = "2020-01-01T00:00:00.000Z";
    const { status, body } = await postImport(tokenA, JSON.stringify(doctored));
    expect(status).toBe(200);
    const data = body.data!;
    expect(data.counts.traces.conflicted).toBe(1);
    expect(data.counts.traces.skippedIdentical).toBe(1);
    expect(data.conflictsTotal).toBe(1);
    const conflict = data.conflicts[0]!;
    expect(conflict.entity).toBe("trace");
    expect(conflict.id).toBe(rt.traceIds[0]);
    expect(conflict.fields).toContain("claimText");
    expect(conflict.fields).toContain("decidedAt");
    expect(conflict.kept).toBe("existing");

    // Existing row untouched.
    const exported = await exportAccount(tokenA);
    const t1 = exported.traces.find((t) => t.id === rt.traceIds[0]);
    expect(t1!.claimText).toContain("preserve my original decision dates");
  });

  it("overwrite=true replaces owned trace content and reports kept=incoming", async () => {
    const doctored = structuredClone(rt.file);
    const newText = "As a data owner re-importing corrected history, I chose overwrite so that the incoming file wins.";
    doctored.traces[0]!["claimText"] = newText;
    const { status, body } = await postImport(tokenA, JSON.stringify(doctored), "?overwrite=true");
    expect(status).toBe(200);
    const data = body.data!;
    expect(data.counts.traces.overwritten).toBe(1);
    expect(data.conflicts[0]!.kept).toBe("incoming");
    expect(data.embeddings.tracesPendingBackfill).toBe(1);

    const exported = await exportAccount(tokenA);
    const t1 = exported.traces.find((t) => t.id === rt.traceIds[0]);
    expect(t1!.claimText).toBe(newText);
    // Overwrite is content-only: the row stays in its book.
    expect(t1!.groupId).toBe(rtBookId);

    // Restore the original content for any later assertions.
    await postImport(tokenA, JSON.stringify(rt.file), "?overwrite=true");
  });

  it("mints fresh ids for another user's traces and remaps their links (v1.1)", async () => {
    // A owns rt.traceIds. B imports the same file → mint-on-conflict: each
    // colliding trace gets a new id and is inserted as B's own, with the
    // trace_evidence / trace_references links repointed to the minted ids.
    const { status, body } = await postImport(tokenB, JSON.stringify(rt.file));
    expect(status).toBe(200);
    const data = body.data!;
    expect(data.counts.traces.remapped).toBe(2);
    expect(data.counts.traces.inserted).toBe(2);
    expect(data.counts.traces.skippedIdentical).toBe(0);
    expect(data.counts.traces.conflicted).toBe(0);
    // No conflict detail — mint-on-conflict is not a reported collision.
    expect(data.conflicts.filter((c) => c.entity === "trace")).toHaveLength(0);

    // idMap carries the old→new mapping; the new ids are fresh, the old ids
    // are A's originals.
    expect(data.idMap).toHaveLength(2);
    for (const m of data.idMap) {
      expect(m.entity).toBe("trace");
      expect(rt.traceIds).toContain(m.from);
      expect(m.to).not.toBe(m.from);
    }
    const remapOf = new Map(data.idMap.map((m) => [m.from, m.to]));
    const newT1 = remapOf.get(rt.traceIds[0]!)!;

    // Shared rows are not duplicated: the evidence + reference already exist
    // (A inserted them), so B skips them and links the minted trace to them.
    expect(data.counts.evidence.skippedExisting).toBe(1);
    expect(data.counts.references.skippedExisting).toBe(1);

    // B now holds independently-owned copies under the minted ids — not A's ids.
    const exportedB = await exportAccount(tokenB);
    expect(exportedB.traces.some((t) => t.id === rt.traceIds[0])).toBe(false);
    expect(exportedB.traces.some((t) => t.id === newT1)).toBe(true);
    // The minted trace keeps the original claim text and is linked to the
    // shared evidence + reference via the remapped links.
    const bT1 = exportedB.traces.find((t) => t.id === newT1)!;
    expect(bT1.claimText).toContain("preserve my original decision dates");
    expect(exportedB.traceEvidence.some((l) => l.traceId === newT1 && l.evidenceId === rt.evidenceId)).toBe(true);
    expect(exportedB.traceReferences.some((l) => l.traceId === newT1 && l.referenceId === rt.referenceId)).toBe(true);
  });

  it("accepts and mints ids for rows that arrive without a PK (v1.1)", async () => {
    // A corpus row with no `id` is still importable content — the server mints
    // a PK rather than rejecting (Andy 2026-07-13). Endpoints (traceId, etc.)
    // stay required, so this file is a single self-contained trace.
    const noId = {
      schemaVersion: 1,
      traces: [
        {
          // no id field
          groupId: null,
          claimText: `As a corpus author trimming an export by hand (${uid}), I prefer the importer to mint a PK so that a row without an id still lands.`,
          claimTextHash: null,
          formatAdherenceScore: 0.7,
          decidedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    };
    const { status, body } = await postImport(tokenA, JSON.stringify(noId));
    expect(status).toBe(200);
    expect(body.data!.counts.traces.inserted).toBe(1);
    expect(body.data!.counts.traces.remapped).toBe(0);
  });

  // ── Destination book targeting (design point 5) ──────────────────────────
  it("imports into an existing book via ?book=<slug>", async () => {
    // The register flow auto-creates a personal book; find its slug.
    const booksRes = await fetch(`${BASE}/recipe-books`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const booksBody = (await booksRes.json()) as { data: Array<{ id: string; slug: string }> };
    const personal = booksBody.data[0]!;

    const second = buildExportFile();
    const { status, body } = await postImport(tokenA, JSON.stringify(second.file), `?book=${personal.slug}`);
    expect(status).toBe(200);
    const data = body.data!;
    expect(data.book!.id).toBe(personal.id);
    expect(data.book!.created).toBe(false);
    expect(data.counts.traces.inserted).toBe(2);

    const exported = await exportAccount(tokenA);
    const t = exported.traces.find((tr) => tr.id === second.traceIds[0]);
    expect(t!.groupId).toBe(personal.id);
  });

  it("names the new book from ?book_name=", async () => {
    const third = buildExportFile();
    const { status, body } = await postImport(tokenA, JSON.stringify(third.file), "?book_name=Restored%20Corpus");
    expect(status).toBe(200);
    expect(body.data!.book!.name).toBe("Restored Corpus");
    expect(body.data!.book!.created).toBe(true);
  });

  it("drops links whose endpoints are missing as orphaned instead of failing", async () => {
    const { file } = buildExportFile();
    file.traceEvidence.push({
      id: crypto.randomUUID(),
      traceId: crypto.randomUUID(), // not in file, not in DB
      evidenceId: file.evidence[0]!["id"],
      stance: "for",
      apiKeyId: null,
      createdAt: NOW,
    });
    const { status, body } = await postImport(tokenA, JSON.stringify(file));
    expect(status).toBe(200);
    expect(body.data!.counts.links.orphaned).toBe(1);
    expect(body.data!.counts.links.inserted).toBe(3);
  });
});

// ── Scale (brief point 9) — run explicitly: IMPORT_SCALE_TEST=1 ─────────────
describe.skipIf(!BASE || !process.env["IMPORT_SCALE_TEST"])("POST /import at scale", () => {
  it("imports 20k traces in one request and reports correctly", async () => {
    const token = await registerAndVerify(`test-import-scale-${uid}@test.local`, "import-scale-pw-1");
    const N = 20_000;
    const traces = Array.from({ length: N }, (_, i) => {
      const id = crypto.randomUUID();
      return {
        id,
        groupId: null,
        apiKeyId: null,
        claimText: `As a data engineer bulk-restoring corpus row ${i} (${id.slice(0, 8)}), I prefer chunked batch inserts so that large imports stay a single fast transaction.`,
        claimTextHash: null,
        formatAdherenceScore: 0.75,
        decidedAt: i % 3 === 0 ? DECIDED : null,
        createdAt: NOW,
        updatedAt: NOW,
      };
    });
    const file = { schemaVersion: 1, traces };
    const payload = JSON.stringify(file);
    console.warn(`[import-scale] payload bytes: ${payload.length}`);

    const started = Date.now();
    const { status, body } = await postImport(token, payload);
    const elapsed = Date.now() - started;
    console.warn(`[import-scale] import of ${N} traces took ${elapsed}ms`);

    expect(status).toBe(200);
    expect(body.data!.counts.traces.inserted).toBe(N);
    expect(body.data!.embeddings.tracesPendingBackfill).toBe(N);

    // Idempotency holds at scale too.
    const second = await postImport(token, payload);
    expect(second.body.data!.counts.traces.skippedIdentical).toBe(N);
    expect(second.body.data!.counts.traces.inserted).toBe(0);
  }, 300_000);
});
