import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { mintImportId } from "../lib/deterministic-id";

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
      traces: { inserted: number; skippedIdentical: number; conflicted: number; remapped: number };
      evidence: { inserted: number; skippedExisting: number; remapped: number };
      references: { inserted: number; skippedExisting: number; remapped: number };
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
let tokenC = "";

describe.skipIf(!BASE)("POST /import", () => {
  beforeAll(async () => {
    tokenA = await registerAndVerify(`test-import-a-${uid}@test.local`, "import-test-pw-aaa1");
    tokenB = await registerAndVerify(`test-import-b-${uid}@test.local`, "import-test-pw-bbb1");
    tokenC = await registerAndVerify(`test-import-c-${uid}@test.local`, "import-test-pw-ccc1");
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
      inserted: 2, skippedIdentical: 0, conflicted: 0, remapped: 0,
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
      inserted: 0, skippedIdentical: 2, conflicted: 0, remapped: 0,
    });
    expect(data.counts.evidence).toEqual({ inserted: 0, skippedExisting: 1, remapped: 0 });
    expect(data.counts.references).toEqual({ inserted: 0, skippedExisting: 1, remapped: 0 });
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

  it("never changes an existing recipe: the retired overwrite option is ignored", async () => {
    // Import only creates rows (recipe 5d541d2c). overwrite=true was removed;
    // a changed row of the importer's own is kept and reported as a conflict.
    const doctored = structuredClone(rt.file);
    doctored.traces[0]!["claimText"] = "As a data owner re-importing corrected history, I chose overwrite so that the incoming file wins.";
    const { status, body } = await postImport(tokenA, JSON.stringify(doctored), "?overwrite=true");
    expect(status).toBe(200);
    expect(body.data!.counts.traces).toMatchObject({ inserted: 0, conflicted: 1 });
    expect(body.data!.conflicts[0]!.kept).toBe("existing");

    const exported = await exportAccount(tokenA);
    const t1 = exported.traces.find((t) => t.id === rt.traceIds[0]);
    expect(t1!.claimText).toContain("preserve my original decision dates");
  });

  it("mints a fully independent subgraph for another user's corpus (v1.1 isolation)", async () => {
    // A owns rt's rows. B imports the same file → EVERYTHING that belongs to
    // (traces) or is linked into (evidence, references) A's graph is minted
    // B's own deterministic copy. No cross-user rows are shared or linked —
    // the isolation invariant parallel benchmark runs depend on.
    const { status, body } = await postImport(tokenB, JSON.stringify(rt.file));
    expect(status).toBe(200);
    const data = body.data!;
    expect(data.counts.traces.remapped).toBe(2);
    expect(data.counts.traces.inserted).toBe(2);
    expect(data.counts.traces.skippedIdentical).toBe(0);
    expect(data.counts.traces.conflicted).toBe(0);
    // No conflict detail — minting is not a reported collision.
    expect(data.conflicts.filter((c) => c.entity === "trace")).toHaveLength(0);

    // Evidence + reference are foreign-linked (A's traces link them), so B
    // gets minted copies — inserted, not shared.
    expect(data.counts.evidence.remapped).toBe(1);
    expect(data.counts.evidence.inserted).toBe(1);
    expect(data.counts.evidence.skippedExisting).toBe(0);
    expect(data.counts.references.remapped).toBe(1);
    expect(data.counts.references.inserted).toBe(1);
    expect(data.counts.references.skippedExisting).toBe(0);

    // idMap carries old→new for all three entities.
    expect(data.idMap.filter((m) => m.entity === "trace")).toHaveLength(2);
    expect(data.idMap.filter((m) => m.entity === "evidence")).toHaveLength(1);
    expect(data.idMap.filter((m) => m.entity === "reference")).toHaveLength(1);
    for (const m of data.idMap) expect(m.to).not.toBe(m.from);

    const remapOf = new Map(
      data.idMap.filter((m) => m.entity === "trace").map((m) => [m.from, m.to]),
    );
    const newT1 = remapOf.get(rt.traceIds[0]!)!;
    const newEv = data.idMap.find((m) => m.entity === "evidence")!.to;
    const newRef = data.idMap.find((m) => m.entity === "reference")!.to;

    // B holds independently-owned copies under minted ids — none of A's ids,
    // and B's links point ONLY at B's copies (no cross-user edges).
    const exportedB = await exportAccount(tokenB);
    expect(exportedB.traces.some((t) => t.id === rt.traceIds[0])).toBe(false);
    const bT1 = exportedB.traces.find((t) => t.id === newT1)!;
    expect(bT1.claimText).toContain("preserve my original decision dates");
    expect(exportedB.evidence.some((e) => e.id === rt.evidenceId)).toBe(false);
    expect(exportedB.evidence.some((e) => e.id === newEv)).toBe(true);
    expect(exportedB.references.some((r) => r.id === rt.referenceId)).toBe(false);
    expect(exportedB.traceEvidence.some((l) => l.traceId === newT1 && l.evidenceId === newEv)).toBe(true);
    expect(exportedB.traceEvidence.some((l) => l.evidenceId === rt.evidenceId)).toBe(false);
    expect(exportedB.traceReferences.some((l) => l.traceId === newT1 && l.referenceId === newRef)).toBe(true);

    // Minted evidence is INSERTED evidence, so it gets embedding stubs in B's
    // book — the isolation copy is searchable where B works.
    expect(data.embeddings.evidenceQueued).toBeGreaterThanOrEqual(1);

    // A's rows are untouched.
    const exportedA = await exportAccount(tokenA);
    expect(exportedA.traces.some((t) => t.id === rt.traceIds[0])).toBe(true);
    expect(exportedA.evidence.some((e) => e.id === rt.evidenceId)).toBe(true);
  });

  it("re-importing the same foreign file is idempotent — deterministic mint (v1.1)", async () => {
    // The mint is uuidv5(importer, original): the second run derives the SAME
    // minted ids, which now exist as B's own rows and flow down the same-owner
    // path. Nothing is inserted twice; idMap is stable across runs.
    const first = await postImport(tokenB, JSON.stringify(rt.file));
    const firstMap = new Map(first.body.data!.idMap.map((m) => [m.from, m.to]));

    const { status, body } = await postImport(tokenB, JSON.stringify(rt.file));
    expect(status).toBe(200);
    const data = body.data!;
    expect(data.counts.traces.inserted).toBe(0);
    expect(data.counts.traces.skippedIdentical).toBe(2);
    expect(data.counts.traces.remapped).toBe(2); // remaps recomputed, not re-inserted
    expect(data.counts.evidence.inserted).toBe(0);
    expect(data.counts.evidence.skippedExisting).toBe(1);
    expect(data.counts.references.inserted).toBe(0);
    expect(data.counts.references.skippedExisting).toBe(1);
    expect(data.embeddings.evidenceQueued).toBe(0);
    // No new book for an all-skipped run.
    expect(data.book).toBeNull();
    // Deterministic: identical old→new mapping both runs.
    for (const m of data.idMap) expect(firstMap.get(m.from)).toBe(m.to);

    // No duplicates: B still holds exactly one copy per original row.
    const exportedB = await exportAccount(tokenB);
    const minted = [...firstMap.values()];
    for (const id of minted.filter((v) => exportedB.traces.some((t) => t.id === v))) {
      expect(exportedB.traces.filter((t) => t.id === id)).toHaveLength(1);
    }
    expect(exportedB.traces.filter((t) => t.claimText.includes("preserve my original decision dates"))).toHaveLength(1);
  });

  it("parallel importers derive disjoint subgraphs (v1.1 isolation)", async () => {
    // C imports the same source file → C's minted ids differ from B's AND from
    // A's originals; C's links never touch B's or A's rows.
    const { status, body } = await postImport(tokenC, JSON.stringify(rt.file));
    expect(status).toBe(200);
    const cMap = new Map(body.data!.idMap.map((m) => [m.from, m.to]));

    const bImport = await postImport(tokenB, JSON.stringify(rt.file)); // idempotent re-run
    const bMap = new Map(bImport.body.data!.idMap.map((m) => [m.from, m.to]));

    for (const [from, to] of cMap) {
      expect(to).not.toBe(from);
      expect(to).not.toBe(bMap.get(from));
    }
    const exportedC = await exportAccount(tokenC);
    const exportedB = await exportAccount(tokenB);
    const bIds = new Set([
      ...exportedB.traces.map((t) => t.id),
      ...exportedB.evidence.map((e) => e.id),
      ...exportedB.references.map((r) => r.id),
    ]);
    for (const t of exportedC.traces) expect(bIds.has(t.id)).toBe(false);
    for (const e of exportedC.evidence) expect(bIds.has(e.id)).toBe(false);
    for (const l of exportedC.traceEvidence) expect(bIds.has(l.evidenceId)).toBe(false);
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

  // ── [F98] Links connect only rows the file creates ──────────────────────
  // Import writes a link only when both of its rows were created by this
  // import. An id absent from the file, anyone's, leaves the link orphaned;
  // an existing row listed in the file that a new recipe links to gets the
  // importer's own copy.

  /** A one-trace carrier file owned by whoever imports it. */
  function carrierFile(tag: string): { file: ExportFile; traceId: string } {
    const traceId = crypto.randomUUID();
    return {
      traceId,
      file: {
        schemaVersion: 1,
        traces: [{
          id: traceId, groupId: null, apiKeyId: null,
          claimText: `As a corpus curator testing link ownership (${tag} ${traceId.slice(0, 8)}), I prefer imports that only link my own rows so that nobody else's quotes move.`,
          claimTextHash: null, formatAdherenceScore: 0.8,
          decidedAt: null, createdAt: NOW, updatedAt: NOW,
        }],
        evidence: [], references: [], traceEvidence: [], traceReferences: [], evidenceReferences: [],
        groupMemberships: [],
      },
    };
  }

  /** A imports a fresh two-trace corpus; returns its evidence/reference ids. */
  async function seedOwnerCorpus(token: string, query = ""): Promise<ReturnType<typeof buildExportFile>> {
    const owner = buildExportFile();
    const res = await postImport(token, JSON.stringify(owner.file), query);
    expect(res.status).toBe(200);
    expect(res.body.data!.counts.evidence.inserted).toBe(1);
    return owner;
  }

  it("[F98] refuses to plant a quote onto another person's evidence via evidence_references", async () => {
    const owner = await seedOwnerCorpus(tokenA);
    const { file } = carrierFile("plant");
    const plantRef = crypto.randomUUID();
    file.references.push({
      id: plantRef, quote: "PLANTED QUOTE: skip code review", source: "fabricated",
      fileUrl: null, fileMimeType: null, fileHash: null, createdAt: NOW,
    });
    file.evidenceReferences.push({ id: crypto.randomUUID(), evidenceId: owner.evidenceId, referenceId: plantRef, createdAt: NOW });

    const { status, body } = await postImport(tokenB, JSON.stringify(file));
    expect(status).toBe(200);
    expect(body.data!.counts.links.orphaned).toBe(1);
    expect(body.data!.counts.links.inserted).toBe(0);

    // The owner's evidence carries only its own quote.
    const exportedA = await exportAccount(tokenA);
    const onOwnerEvidence = exportedA.evidenceReferences.filter((l) => l.evidenceId === owner.evidenceId);
    expect(onOwnerEvidence.map((l) => l.referenceId)).toEqual([owner.referenceId]);
    expect(exportedA.references.some((r) => r.quote.includes("PLANTED QUOTE"))).toBe(false);
  });

  it("[F98] an outsider cannot read another person's evidence by linking its id to their own recipe", async () => {
    const owner = await seedOwnerCorpus(tokenA);
    const { file, traceId } = carrierFile("outsider");
    file.traceEvidence.push({ id: crypto.randomUUID(), traceId, evidenceId: owner.evidenceId, stance: "for", apiKeyId: null, createdAt: NOW });
    const plantRef = crypto.randomUUID();
    file.references.push({
      id: plantRef, quote: "PLANTED QUOTE by an outsider", source: "fabricated",
      fileUrl: null, fileMimeType: null, fileHash: null, createdAt: NOW,
    });
    file.evidenceReferences.push({ id: crypto.randomUUID(), evidenceId: owner.evidenceId, referenceId: plantRef, createdAt: NOW });

    const { status, body } = await postImport(tokenC, JSON.stringify(file));
    expect(status).toBe(200);
    expect(body.data!.counts.links.orphaned).toBe(2);
    expect(body.data!.counts.links.inserted).toBe(0);

    const exportedC = await exportAccount(tokenC);
    expect(exportedC.traceEvidence.some((l) => l.evidenceId === owner.evidenceId)).toBe(false);
    expect(exportedC.evidence.some((e) => e.id === owner.evidenceId)).toBe(false);

    const exportedA = await exportAccount(tokenA);
    expect(exportedA.references.some((r) => r.quote.includes("PLANTED QUOTE by an outsider"))).toBe(false);
  });

  it("[F98] a link attempt does not keep another person's evidence alive past their recipe's deletion", async () => {
    const owner = await seedOwnerCorpus(tokenA);
    const { file, traceId } = carrierFile("retention");
    file.traceEvidence.push({ id: crypto.randomUUID(), traceId, evidenceId: owner.evidenceId, stance: "for", apiKeyId: null, createdAt: NOW });
    const attempt = await postImport(tokenC, JSON.stringify(file));
    expect(attempt.status).toBe(200);
    expect(attempt.body.data!.counts.links.orphaned).toBe(1);

    // The owner deletes the recipe the evidence hangs off.
    const del = await fetch(`${BASE}/traces/${owner.traceIds[0]}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(del.status).toBe(200);
    const delBody = (await del.json()) as { data?: { evidenceDeleted?: number } };
    expect(delBody.data?.evidenceDeleted).toBe(1);

    // The outsider holds nothing of it.
    const exportedC = await exportAccount(tokenC);
    expect(exportedC.evidence.some((e) => e.id === owner.evidenceId)).toBe(false);
  });

  it("[F98] cannot link evidence or references from a book the importer cannot read", async () => {
    // The owner's corpus sits in their personal book, which B is not in.
    const booksRes = await fetch(`${BASE}/recipe-books`, { headers: { Authorization: `Bearer ${tokenA}` } });
    const personal = ((await booksRes.json()) as { data: Array<{ slug: string }> }).data[0]!;
    const owner = await seedOwnerCorpus(tokenA, `?book=${personal.slug}`);

    const { file, traceId } = carrierFile("cross-account");
    file.traceEvidence.push({ id: crypto.randomUUID(), traceId, evidenceId: owner.evidenceId, stance: "for", apiKeyId: null, createdAt: NOW });
    file.traceReferences.push({ id: crypto.randomUUID(), traceId, referenceId: owner.referenceId, apiKeyId: null, createdAt: NOW });

    const { status, body } = await postImport(tokenB, JSON.stringify(file));
    expect(status).toBe(200);
    expect(body.data!.counts.links.orphaned).toBe(2);
    expect(body.data!.counts.links.inserted).toBe(0);

    const exportedB = await exportAccount(tokenB);
    expect(exportedB.evidence.some((e) => e.id === owner.evidenceId)).toBe(false);
    expect(exportedB.references.some((r) => r.id === owner.referenceId)).toBe(false);
  });

  it("[F98] does not link even the importer's own existing evidence and references by id", async () => {
    // Nothing is looked up to decide a link: an id absent from the file is
    // orphaned whoever owns it (recipe 5d541d2c).
    const own = await seedOwnerCorpus(tokenA);
    const { file, traceId } = carrierFile("own");
    file.traceEvidence.push({ id: crypto.randomUUID(), traceId, evidenceId: own.evidenceId, stance: "for", apiKeyId: null, createdAt: NOW });
    file.traceReferences.push({ id: crypto.randomUUID(), traceId, referenceId: own.referenceId, apiKeyId: null, createdAt: NOW });

    const { status, body } = await postImport(tokenA, JSON.stringify(file));
    expect(status).toBe(200);
    expect(body.data!.counts.links.orphaned).toBe(2);
    expect(body.data!.counts.links.inserted).toBe(0);
  });

  it("[F98] mints a copy of an existing row in the file that hangs off no one's recipe", async () => {
    // B imports evidence with no trace link: the row exists but belongs to
    // nobody. C listing the same id gets its own copy, never B's row.
    const orphanEv = crypto.randomUUID();
    const orphanFile = carrierFile("orphan-src").file;
    orphanFile.evidence.push({ id: orphanEv, content: "B's unlinked evidence text", createdAt: NOW, updatedAt: NOW });
    expect((await postImport(tokenB, JSON.stringify(orphanFile))).body.data!.counts.evidence.inserted).toBe(1);

    const { file, traceId } = carrierFile("orphan-reuse");
    file.evidence.push({ id: orphanEv, content: "C's own text under a colliding id", createdAt: NOW, updatedAt: NOW });
    file.traceEvidence.push({ id: crypto.randomUUID(), traceId, evidenceId: orphanEv, stance: "for", apiKeyId: null, createdAt: NOW });
    const { status, body } = await postImport(tokenC, JSON.stringify(file));
    expect(status).toBe(200);
    expect(body.data!.counts.evidence.remapped).toBe(1);
    expect(body.data!.counts.evidence.inserted).toBe(1);

    const exportedC = await exportAccount(tokenC);
    expect(exportedC.evidence.some((e) => e.id === orphanEv)).toBe(false);
    expect(exportedC.evidence.some((e) => e.content === "C's own text under a colliding id")).toBe(true);
  });

  it("[F101] link ids another account already used cannot strip the links from an import", async () => {
    // C imports her own rows under link rows that reuse the ids of the links
    // in B's file; B, the first to import that file, must still get every link.
    const victim = buildExportFile();
    const squat = carrierFile("link-squat");
    const sqEv = crypto.randomUUID();
    const sqRef = crypto.randomUUID();
    squat.file.evidence.push({ id: sqEv, content: "C's evidence", createdAt: NOW, updatedAt: NOW });
    squat.file.references.push({ id: sqRef, quote: "C's quote", source: "C", fileUrl: null, fileMimeType: null, fileHash: null, createdAt: NOW });
    squat.file.traceEvidence.push({ id: victim.file.traceEvidence[0]!["id"], traceId: squat.traceId, evidenceId: sqEv, stance: "for", apiKeyId: null, createdAt: NOW });
    squat.file.traceReferences.push({ id: victim.file.traceReferences[0]!["id"], traceId: squat.traceId, referenceId: sqRef, apiKeyId: null, createdAt: NOW });
    squat.file.evidenceReferences.push({ id: victim.file.evidenceReferences[0]!["id"], evidenceId: sqEv, referenceId: sqRef, createdAt: NOW });
    expect((await postImport(tokenC, JSON.stringify(squat.file))).body.data!.counts.links.inserted).toBe(3);

    const { status, body } = await postImport(tokenB, JSON.stringify(victim.file));
    expect(status).toBe(200);
    expect(body.data!.counts.traces.inserted).toBe(2);
    expect(body.data!.counts.links).toEqual({ inserted: 3, skippedExisting: 0, orphaned: 0 });
    const exportedB = await exportAccount(tokenB);
    expect(exportedB.traceEvidence.some((l) => l.traceId === victim.traceIds[0] && l.evidenceId === victim.evidenceId)).toBe(true);
    expect(exportedB.traceReferences.some((l) => l.traceId === victim.traceIds[0] && l.referenceId === victim.referenceId)).toBe(true);
    expect(exportedB.evidenceReferences.some((l) => l.evidenceId === victim.evidenceId && l.referenceId === victim.referenceId)).toBe(true);
  });

  it("[F100] rows pre-planted under the importer's mint are never taken as the importer's own", async () => {
    // The mint is public, so C can create rows under B's minted ids before B
    // imports a file naming A's rows. B's rows must land under fresh ids with
    // B's content, and nothing C planted may reach B's recipe.
    const me = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${tokenB}` } });
    const bId = ((await me.json()) as { data?: { user?: { id: string } } }).data?.user?.id ?? "";
    expect(bId).not.toBe("");
    const source = await seedOwnerCorpus(tokenA);

    const plantedTrace = mintImportId(bId, source.traceIds[0]!);
    const plantedEv = mintImportId(bId, source.evidenceId);
    const plantRef = crypto.randomUUID();
    const plant = carrierFile("plant-mint");
    plant.file.traces[0]!["id"] = plantedTrace;
    plant.file.evidence.push({ id: plantedEv, content: "C's planted evidence", createdAt: NOW, updatedAt: NOW });
    plant.file.references.push({ id: plantRef, quote: "PLANTED QUOTE under B's mint", source: "fabricated", fileUrl: null, fileMimeType: null, fileHash: null, createdAt: NOW });
    plant.file.traceEvidence.push({ id: crypto.randomUUID(), traceId: plantedTrace, evidenceId: plantedEv, stance: "for", apiKeyId: null, createdAt: NOW });
    plant.file.evidenceReferences.push({ id: crypto.randomUUID(), evidenceId: plantedEv, referenceId: plantRef, createdAt: NOW });
    expect((await postImport(tokenC, JSON.stringify(plant.file))).body.data!.counts.traces.inserted).toBe(1);

    const { status, body } = await postImport(tokenB, JSON.stringify(source.file));
    expect(status).toBe(200);
    const data = body.data!;
    expect(data.counts.traces).toMatchObject({ inserted: 2, skippedIdentical: 0, conflicted: 0 });
    expect(data.counts.evidence).toMatchObject({ inserted: 1, skippedExisting: 0 });
    const to = new Map(data.idMap.map((m) => [m.from, m.to]));
    expect(to.get(source.traceIds[0]!)).not.toBe(plantedTrace);
    expect(to.get(source.evidenceId)).not.toBe(plantedEv);

    const exportedB = await exportAccount(tokenB);
    expect(exportedB.traces.some((t) => t.id === plantedTrace)).toBe(false);
    expect(exportedB.evidence.some((e) => e.content === "C's planted evidence")).toBe(false);
    expect(exportedB.references.some((r) => r.quote.includes("PLANTED QUOTE under B's mint"))).toBe(false);
    const bT1 = to.get(source.traceIds[0]!)!;
    const bEv = to.get(source.evidenceId)!;
    expect(exportedB.traceEvidence.some((l) => l.traceId === bT1 && l.evidenceId === bEv)).toBe(true);
    expect(exportedB.evidence.find((e) => e.id === bEv)?.content).toBe("The user asked for a lossless round trip.");
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
