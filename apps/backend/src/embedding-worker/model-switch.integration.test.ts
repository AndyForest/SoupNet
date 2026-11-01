/**
 * Changing the embedding model, end to end (ADR-0024): real backend processes, real
 * routes, the real worker and real Postgres, with only Gemini's HTTP API faked. The
 * tests run in order, as one migration: preview to GA and back again.
 *
 * Spawns its own backends against its own database, created on the Postgres the
 * environment points at. Skips when no Postgres is configured.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import PgBoss from "pg-boss";
import postgres from "postgres";
import { FakeGemini, IMAGE_MARKER, MODEL_MARKERS, TEXT_MARKER } from "../test-fixtures/fake-gemini";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../..");
const TSX = path.join(REPO, "node_modules/tsx/dist/cli.mjs");
const BACKEND_ENTRY = path.join(REPO, "apps/backend/src/index.ts");

const PG = {
  host: process.env["PGHOST"] ?? "",
  port: Number(process.env["PGPORT"] ?? 5432),
  user: process.env["PGUSER"] ?? "",
  password: process.env["PGPASSWORD"] ?? "",
};
const HAS_PG = Boolean(PG.host && PG.user);

const PREVIEW = "gemini-embedding-2-preview";
const GA = "gemini-embedding-2";
const DB_NAME = `model_switch_${process.pid}`;
const EMAIL = "model-switch@test.local";
const PASSWORD = "model-switch-password-123456";

const fake = new FakeGemini();
let geminiUrl = "";
let admin: ReturnType<typeof postgres>;
let sql: ReturnType<typeof postgres>;
let boss: PgBoss;
let apiKey = "";
let jwt = "";
const tempDirs: string[] = [];
const children = new Set<Backend>();

interface Backend {
  port: number;
  url: string;
  cwd: string;
  child: ChildProcess;
  log: () => string;
}

function freePort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

function childEnv(extra: Record<string, string>, port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: PG.host,
    PGPORT: String(PG.port),
    PGUSER: PG.user,
    PGPASSWORD: PG.password,
    PGDATABASE: DB_NAME,
    PGSSLMODE: "disable",
    PORT: String(port),
    NODE_ENV: "development",
    JWT_SECRET: "model-switch-secret-0123456789abcdef0123456789abcdef0123456789",
    DEV_USERNAME: EMAIL,
    DEV_PASSWORD: PASSWORD,
    ALLOW_AUTO_SETUP: "true",
    DISABLE_RATE_LIMIT: "true",
    GEMINI_API_KEY: "fake-key",
    GEMINI_API_BASE_URL: geminiUrl,
    EMBEDDINGS_PROVIDER: "gemini",
    EMBEDDINGS_REBUILD_TARGET: "",
    SYNTHESIS_PROVIDER: "stub",
    EMBEDDING_WORKER_ENABLED: "true",
    WORKER_CONCURRENCY: "5",
    BACKEND_URL: `http://localhost:${port}`,
    FRONTEND_URL: "http://localhost:5999",
    SMTP_HOST: "localhost",
    SMTP_PORT: "1",
    ...extra,
  };
  delete env["DATABASE_URL"];
  // Not this test worker's own plumbing: a child that inherits the IPC channel
  // variables tries to use the worker's channel and takes the worker down.
  for (const key of Object.keys(env)) {
    if (/^(VITEST|NODE_CHANNEL|NODE_UNIQUE)/.test(key)) delete env[key];
  }
  return env;
}

/** Start a backend process. Each gets its own working directory unless given one, so its own upload store. */
async function startBackend(extra: Record<string, string>, cwd?: string): Promise<Backend> {
  const port = freePort();
  const dir = cwd ?? mkdtempSync(path.join(tmpdir(), "model-switch-"));
  if (!cwd) tempDirs.push(dir);
  // A log file rather than pipes: the backend logs hard during a sweep, and the log
  // outlives a process that exits, which is when it's wanted.
  const logDir = process.env["MODEL_SWITCH_LOG_DIR"] ?? dir;
  const logPath = path.join(logDir, `backend-${port}.log`);
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [TSX, BACKEND_ENTRY], {
    cwd: dir,
    env: childEnv(extra, port),
    stdio: ["ignore", logFd, logFd],
  });
  const output = () => readFileSync(logPath, "utf8");
  child.on("exit", () => closeSync(logFd));
  const backend: Backend = { port, url: `http://localhost:${port}`, cwd: dir, child, log: output };
  children.add(backend);
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`backend exited ${child.exitCode}: ${output().slice(-2000)}`);
    const up = await fetch(`${backend.url}/health/ready`).then((r) => r.ok, () => false);
    if (up) return backend;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`backend did not start: ${output().slice(-2000)}`);
}

async function stopBackend(backend: Backend): Promise<void> {
  children.delete(backend);
  if (backend.child.exitCode !== null) return;
  const exited = new Promise((r) => backend.child.once("exit", r));
  backend.child.kill("SIGTERM");
  await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
  if (backend.child.exitCode === null) backend.child.kill("SIGKILL");
}

/** Boot with this configuration and expect the process to refuse. */
function expectBootRefusal(extra: Record<string, string>): string {
  const port = freePort();
  const result = spawnSync(process.execPath, [TSX, BACKEND_ENTRY], {
    cwd: tmpdir(),
    env: childEnv(extra, port),
    encoding: "utf8",
    timeout: 60_000,
  });
  expect(result.status, `expected a refusal, got: ${result.stdout}`).not.toBe(0);
  return `${result.stdout}${result.stderr}`;
}

function png(seed: number): Buffer {
  const crc32 = (buf: Buffer) => {
    let crc = ~0;
    for (const x of buf) {
      let c = (crc ^ x) & 255;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return ~crc >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < 8; y++) {
    const row = Buffer.alloc(25);
    for (let x = 0; x < 8; x++) row[1 + x * 3] = (x * 30 + seed * 77) & 255;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function checkRecipe(backend: Backend, topic: string, image?: Buffer): Promise<void> {
  const form = new FormData();
  form.set("key", apiKey);
  form.set("trace", `As a maintainer working on ${topic}, I chose the documented approach so that later changes stay safe`);
  form.set("ef", `Past work on ${topic} went better when written down.\n> "the runbook helped"\n-- retrospective`);
  form.set("format", "json");
  if (image) form.set("image", new File([new Uint8Array(image)], "d.png", { type: "image/png" }));
  const res = await fetch(`${backend.url}/check?format=json`, { method: "POST", body: form });
  const body = await res.json() as { ok: boolean };
  expect(res.status).toBe(200);
  expect(body.ok).toBe(true);
}

/** Total recipes a semantic search finds, through the real route. */
async function searchTotal(backend: Backend): Promise<number> {
  const url = new URL(`${backend.url}/check`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("filter", "documented approach");
  url.searchParams.set("format", "json");
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = await res.json() as { data?: { totalResults?: number } };
  return body.data?.totalResults ?? 0;
}

async function mapStatus(backend: Backend): Promise<{ status: number; members: number }> {
  const res = await fetch(`${backend.url}/traces/map?k=2`, { headers: { Authorization: `Bearer ${jwt}` } });
  const body = await res.json() as { data?: { clusters?: Array<{ memberCount?: number }> } };
  return {
    status: res.status,
    members: (body.data?.clusters ?? []).reduce((a, c) => a + (c.memberCount ?? 0), 0),
  };
}

async function modelCounts(modelId: string): Promise<{ complete: number; pending: number; processing: number; failed: number }> {
  const [row] = await sql<Array<{ complete: number; pending: number; processing: number; failed: number }>>`
    SELECT count(*) FILTER (WHERE status = 'complete')::int AS complete,
           count(*) FILTER (WHERE status = 'pending')::int AS pending,
           count(*) FILTER (WHERE status = 'processing')::int AS processing,
           count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM claimnet.embedding_vectors WHERE model_id = ${modelId}
  `;
  return row!;
}

async function gap(from: string, to: string): Promise<number> {
  const [row] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM claimnet.embedding_vectors f
    WHERE f.model_id = ${from} AND f.status = 'complete' AND NOT EXISTS (
      SELECT 1 FROM claimnet.embedding_vectors t
      WHERE t.embedding_chunk_id = f.embedding_chunk_id AND t.model_id = ${to} AND t.status = 'complete'
    )
  `;
  return row!.n;
}

/** Every stored vector was made by the model its row names. */
async function mislabelledRows(): Promise<number> {
  let wrong = 0;
  for (const [modelId, marker] of Object.entries(MODEL_MARKERS)) {
    const [row] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM claimnet.embedding_vectors
      WHERE model_id = ${modelId} AND status = 'complete'
        AND abs((subvector(vector, 1, 1)::text::jsonb->>0)::float8 - ${marker}) > 0.01
    `;
    wrong += row!.n;
  }
  return wrong;
}

const sweep = () => boss.send("embedding.strategy-sweep", {});

/** Fire sweeps until the condition holds. The cron runs too; these make it quick. */
async function sweepUntil(condition: () => Promise<boolean>, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await sweep();
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("condition not reached before the timeout");
}

const quiet = async (modelId: string) => {
  const c = await modelCounts(modelId);
  return c.pending === 0 && c.processing === 0;
};

describe.skipIf(!HAS_PG)("changing the embedding model", () => {
  let a: Backend; // read=preview
  let baseline = 0;

  beforeAll(async () => {
    geminiUrl = await fake.start();
    admin = postgres({ ...PG, database: "postgres", max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    sql = postgres({ ...PG, database: DB_NAME, max: 3, onnotice: () => {} });

    a = await startBackend({ EMBEDDINGS_MODEL: PREVIEW });

    boss = new PgBoss({ ...PG, database: DB_NAME });
    boss.on("error", () => {});
    await boss.start();

    const login = await fetch(`${a.url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    }).then((r) => r.json()) as { data: { token: string } };
    jwt = login.data.token;
    const key = await fetch(`${a.url}/keys/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    }).then((r) => r.json()) as { data: { key: string } };
    apiKey = key.data.key;

    for (const topic of ["database pools", "webhook retries", "dashboard contrast", "worker logging", "schema flags", "edge caching"]) {
      await checkRecipe(a, topic);
    }
    // One image recipe whose bytes stay on disk, one whose bytes will go.
    await checkRecipe(a, "rack photos with bytes kept", png(1));
    await checkRecipe(a, "rack photos with bytes lost", png(2));
    await sweepUntil(async () => {
      const exp = await sql<Array<{ n: number }>>`SELECT count(DISTINCT strategy_id)::int AS n FROM claimnet.embedding_chunk_strategies`;
      return exp[0]!.n >= 7 && (await quiet(PREVIEW));
    }, 120_000);
    baseline = await searchTotal(a);
  }, 240_000);

  afterAll(async () => {
    await Promise.all([...children].map(stopBackend));
    await boss?.stop({ graceful: false }).catch(() => {});
    await sql?.end({ timeout: 5 }).catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).catch(() => {});
    await admin?.end({ timeout: 5 }).catch(() => {});
    await fake.stop();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("starts with a corpus under the read id, and searches find it", async () => {
    expect(baseline).toBe(8);
    expect((await modelCounts(GA)).complete).toBe(0);
    expect(fake.callsFor(GA)).toHaveLength(0);
    expect((await mapStatus(a)).status).toBe(200);
  });

  it("refuses to start on an empty or unknown model, or a bad target", () => {
    expect(expectBootRefusal({ EMBEDDINGS_MODEL: "" })).toContain("EMBEDDINGS_MODEL is required");
    expect(expectBootRefusal({ EMBEDDINGS_MODEL: "gemini-embedding-9" })).toContain("not a known Gemini embedding model");
    expect(expectBootRefusal({ EMBEDDINGS_MODEL: PREVIEW, EMBEDDINGS_REBUILD_TARGET: "typo" })).toContain("not a known Gemini embedding model");
    expect(expectBootRefusal({ EMBEDDINGS_MODEL: PREVIEW, EMBEDDINGS_REBUILD_TARGET: PREVIEW })).toContain("reads already use");
  }, 180_000);

  it("makes a read id with no vectors loud, without taking the service down", async () => {
    // Paused so this process doesn't start filling the gap.
    const b = await startBackend({ EMBEDDINGS_MODEL: GA, EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "0" });
    try {
      expect(b.log()).toContain("READ_MODEL_EMPTY");
      expect(await searchTotal(b)).toBe(0);
      const ready = await fetch(`${b.url}/health/ready`);
      expect(ready.status).toBe(200);
      const version = await fetch(`${b.url}/health/version`, { headers: { Authorization: `Bearer ${apiKey}` } })
        .then((r) => r.json()) as { data: { embeddings: { modelId: string; readVectors: string } } };
      expect(version.data.embeddings.modelId).toBe(GA);
      expect(version.data.embeddings.readVectors).toBe("empty");
    } finally {
      await stopBackend(b);
    }
    // That process's own query embedding went to GA; drop the vectors it cached.
    await sql`DELETE FROM claimnet.vector_cache WHERE model_id = ${GA}`;
  }, 90_000);

  it("rebuilds at the budget with every search still finding everything, sending no taskType", async () => {
    await stopBackend(a);
    // The second image's bytes are gone from this task's disk.
    const artifacts = path.join(a.cwd, "uploads/artifacts");
    const files = readdirSync(artifacts);
    expect(files.length).toBe(2);
    const [lost] = await sql<Array<{ file_hash: string }>>`
      SELECT r.file_hash FROM claimnet."references" r
      JOIN claimnet.evidence_references er ON er.reference_id = r.id
      JOIN claimnet.evidence e ON e.id = er.evidence_id
      JOIN claimnet.trace_evidence te ON te.evidence_id = e.id
      JOIN claimnet.traces t ON t.id = te.trace_id
      WHERE t.claim_text LIKE '%bytes lost%' AND r.file_hash IS NOT NULL
    `;
    rmSync(path.join(artifacts, `${lost!.file_hash}.png`));

    a = await startBackend({
      EMBEDDINGS_MODEL: PREVIEW,
      EMBEDDINGS_REBUILD_TARGET: GA,
      EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "12",
    }, a.cwd);

    fake.calls = [];
    const total = (await modelCounts(PREVIEW)).complete;
    let sawPartial = false;
    await sweepUntil(async () => {
      expect(await searchTotal(a)).toBe(baseline);
      const c = await modelCounts(GA);
      // Rows in flight or waiting never exceed one budget.
      expect(c.pending + c.processing).toBeLessThanOrEqual(12);
      if (c.complete > 0 && c.complete < total) sawPartial = true;
      return (await gap(PREVIEW, GA)) === 0;
    }, 300_000);

    expect(sawPartial).toBe(true);
    expect(a.log()).toContain("safe_to_flip=no");
    await sweep();
    await sweepUntil(async () => a.log().includes("safe_to_flip=yes"));
    expect(await searchTotal(a)).toBe(baseline);
    expect(fake.calls.filter((c) => c.sentTaskType)).toHaveLength(0);
    expect(await mislabelledRows()).toBe(0);
  }, 360_000);

  it("rebuilds an image from real bytes when they exist, and from text with a label when they don't", async () => {
    const rows = await sql<Array<{ claim_text: string; vector_source: string; image_marker: string; cached: boolean }>>`
      SELECT t.claim_text, ev.vector_source,
             (subvector(ev.vector, 2, 1)::text::jsonb->>0) AS image_marker,
             EXISTS (SELECT 1 FROM claimnet.vector_cache vc WHERE vc.content_hash = ec.chunk_hash AND vc.model_id = ${GA}) AS cached
      FROM claimnet.embedding_vectors ev
      JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id AND es.artifact_category = 'multimodal'
      JOIN claimnet.trace_evidence te ON te.evidence_id = es.source_id
      JOIN claimnet.traces t ON t.id = te.trace_id
      WHERE ev.model_id = ${GA} AND ev.status = 'complete'
    `;
    expect(rows).toHaveLength(2);
    const kept = rows.find((r) => r.claim_text.includes("bytes kept"))!;
    expect(kept.vector_source).toBe("server");
    expect(Number(kept.image_marker)).toBeCloseTo(IMAGE_MARKER, 2);
    expect(kept.cached).toBe(true);

    const lost = rows.find((r) => r.claim_text.includes("bytes lost"))!;
    expect(lost.vector_source).toBe("text_fallback");
    expect(Number(lost.image_marker)).toBeCloseTo(TEXT_MARKER, 2);
    // A text-only vector must never sit under a key that hashes the image bytes.
    expect(lost.cached).toBe(false);
    expect(a.log()).toContain("text_fallback=1");
  });

  it("gives an image written during the rebuild a real target vector straight away", async () => {
    fake.calls = [];
    await checkRecipe(a, "fresh image during rebuild", png(3));
    const [row] = await sql<Array<{ vector_source: string; marker: string }>>`
      SELECT ev.vector_source, (subvector(ev.vector, 2, 1)::text::jsonb->>0) AS marker
      FROM claimnet.embedding_vectors ev
      JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id AND es.artifact_category = 'multimodal'
      JOIN claimnet.trace_evidence te ON te.evidence_id = es.source_id
      JOIN claimnet.traces t ON t.id = te.trace_id
      WHERE ev.model_id = ${GA} AND t.claim_text LIKE '%fresh image%'
    `;
    expect(row).toBeDefined();
    expect(Number(row!.marker)).toBeCloseTo(IMAGE_MARKER, 2);
    baseline += 1;
    await sweepUntil(async () => (await gap(PREVIEW, GA)) === 0 && (await quiet(GA)));
  }, 120_000);

  it("labels each row by its own model when one job carries both", async () => {
    const [p] = await sql<Array<{ id: string; chunk_id: string; chunk_text: string; chunk_hash: string }>>`
      SELECT ev.id, ec.id AS chunk_id, ec.chunk_text, ec.chunk_hash
      FROM claimnet.embedding_vectors ev JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id AND es.artifact_category = 'text'
      WHERE ev.model_id = ${PREVIEW} LIMIT 1
    `;
    const [g] = await sql<Array<{ id: string }>>`
      SELECT id FROM claimnet.embedding_vectors WHERE model_id = ${GA} AND embedding_chunk_id = ${p!.chunk_id}
    `;
    await sql`UPDATE claimnet.embedding_vectors SET status = 'processing', vector = NULL WHERE id IN (${p!.id}, ${g!.id})`;
    const item = (vectorId: string, modelId: string) => ({
      vectorId, chunkId: p!.chunk_id, chunkText: p!.chunk_text, chunkHash: p!.chunk_hash,
      taskType: "SEMANTIC_SIMILARITY", modelId,
    });
    fake.calls = [];
    await boss.send("embedding.vector-api-call", { items: [item(p!.id, PREVIEW), item(g!.id, GA)] });
    await sweepUntil(async () => (await quiet(PREVIEW)) && (await quiet(GA)));
    expect(fake.calls.map((c) => c.model).sort()).toEqual([GA, PREVIEW].sort());
    expect(fake.calls.every((c) => c.count === 1)).toBe(true);
    expect(await mislabelledRows()).toBe(0);
  }, 120_000);

  it("survives 429s: rows wait, nothing fails, search keeps working, the work finishes", async () => {
    await checkRecipe(a, "recipe during rate limit one");
    await checkRecipe(a, "recipe during rate limit two");
    baseline += 2;
    fake.rateLimit.set(GA, 1000);
    fake.calls = [];
    await sweepUntil(async () => a.log().includes(`Provider pushback (429) on ${GA}`));

    const cooling = await sql`
      SELECT value FROM claimnet.system_settings WHERE key = ${`embeddingsCooldown:${GA}`}
    `;
    expect(cooling).toHaveLength(1);
    const callsWhileCooling = fake.callsFor(GA).length;
    for (let i = 0; i < 4; i++) {
      await sweep();
      await new Promise((r) => setTimeout(r, 2500));
      expect(await searchTotal(a)).toBe(baseline);
    }
    // No calls during the backoff; the first 429 can be followed by others already in flight.
    expect(fake.callsFor(GA).length).toBeLessThanOrEqual(callsWhileCooling + 4);
    expect((await modelCounts(GA)).failed).toBe(0);

    // The provider recovers and the backoff runs out.
    fake.rateLimit.clear();
    await sql`DELETE FROM claimnet.system_settings WHERE key = ${`embeddingsCooldown:${GA}`}`;
    await sweepUntil(async () => (await gap(PREVIEW, GA)) === 0 && (await quiet(PREVIEW)) && (await quiet(GA)));
    expect((await modelCounts(GA)).failed).toBe(0);
    expect(await mislabelledRows()).toBe(0);
  }, 240_000);

  it("isolates a row the provider refuses, leaving it failed and visible", async () => {
    fake.poison = { model: GA, text: "refused-by-provider" };
    await checkRecipe(a, "topic refused-by-provider here");
    baseline += 1;
    await sweepUntil(async () => (await modelCounts(GA)).failed > 0 && (await quiet(GA)), 150_000);
    fake.poison = null;
    expect(await searchTotal(a)).toBe(baseline);
    // retry-failed puts it back, and the gap closes.
    const retry = spawnSync(process.execPath, [TSX, path.join(REPO, "scripts/embedding-model.mts"), "retry-failed", "--model", GA], {
      cwd: REPO,
      env: childEnv({ PGDATABASE: DB_NAME }, 0),
      encoding: "utf8",
    });
    expect(retry.status, retry.stderr).toBe(0);
    await sweepUntil(async () => (await gap(PREVIEW, GA)) === 0 && (await modelCounts(GA)).failed === 0);
  }, 240_000);

  let b: Backend; // read=GA, target=preview

  it("flips under a rolling deploy: old and new tasks agree, and each catches up the other's writes", async () => {
    b = await startBackend({ EMBEDDINGS_MODEL: GA, EMBEDDINGS_REBUILD_TARGET: PREVIEW }, a.cwd);

    expect(await searchTotal(a)).toBe(baseline);
    expect(await searchTotal(b)).toBe(baseline);

    // A recipe through each side of the deploy.
    await checkRecipe(a, "written by the old task during overlap");
    await checkRecipe(b, "written by the new task during overlap");
    baseline += 2;

    await sweepUntil(async () =>
      (await gap(PREVIEW, GA)) === 0 && (await gap(GA, PREVIEW)) === 0 && (await quiet(PREVIEW)) && (await quiet(GA)));
    expect(await searchTotal(a)).toBe(baseline);
    expect(await searchTotal(b)).toBe(baseline);
    expect(await mislabelledRows()).toBe(0);
    await stopBackend(a);
  }, 180_000);

  it("keeps reads on GA while preview stops serving, without holding GA up or failing rows", async () => {
    fake.gone.add(PREVIEW);
    await checkRecipe(b, "written after preview stopped");
    baseline += 1;
    await sweepUntil(async () => b.log().includes(`Provider pushback (404) on ${PREVIEW}`));
    expect(await searchTotal(b)).toBe(baseline);
    await checkRecipe(b, "second after preview stopped");
    baseline += 1;
    expect(await searchTotal(b)).toBe(baseline);
    expect((await modelCounts(PREVIEW)).failed).toBe(0);
    expect((await modelCounts(GA)).failed).toBe(0);
    fake.gone.clear();
    await sql`DELETE FROM claimnet.system_settings WHERE key = ${`embeddingsCooldown:${PREVIEW}`}`;
    await sweepUntil(async () => (await gap(GA, PREVIEW)) === 0 && (await quiet(PREVIEW)));
  }, 180_000);

  it("flips back, including recipes written since the flip", async () => {
    await checkRecipe(b, "written on GA before flipping back");
    baseline += 1;
    await sweepUntil(async () => (await gap(GA, PREVIEW)) === 0 && (await quiet(PREVIEW)));
    await stopBackend(b);

    const back = await startBackend({ EMBEDDINGS_MODEL: PREVIEW, EMBEDDINGS_REBUILD_TARGET: GA }, a.cwd);
    expect(back.log()).not.toContain("READ_MODEL_EMPTY");
    expect(await searchTotal(back)).toBe(baseline);
    const map = await mapStatus(back);
    expect(map.status).toBe(200);
    await stopBackend(back);
  }, 120_000);

  it("removes the old model with the script: refuses when unsafe, dry-runs by default, deletes in batches", async () => {
    const run = (...args: string[]) => spawnSync(
      process.execPath,
      [TSX, path.join(REPO, "scripts/embedding-model.mts"), ...args],
      { cwd: REPO, env: childEnv({ PGDATABASE: DB_NAME }, 0), encoding: "utf8" },
    );

    const same = run("prune", "--model", PREVIEW, "--keep", PREVIEW, "--apply");
    expect(same.status).toBe(3);

    // Recent writes count as "still being written".
    const recent = run("prune", "--model", PREVIEW, "--keep", GA, "--apply");
    expect(recent.status).toBe(3);
    expect(recent.stderr).toContain("still writes them");

    await sql`UPDATE claimnet.embedding_vectors SET updated_at = now() - interval '1 hour', created_at = now() - interval '1 hour'`;

    const before = await modelCounts(PREVIEW);
    const dry = run("prune", "--model", PREVIEW, "--keep", GA);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stderr).toContain("irreversible");
    expect(dry.stdout).toContain("Dry run");
    expect((await modelCounts(PREVIEW)).complete).toBe(before.complete);

    // With a gap the other way, it won't remove what reads would lose.
    const [one] = await sql<Array<{ id: string }>>`SELECT id FROM claimnet.embedding_vectors WHERE model_id = ${GA} LIMIT 1`;
    await sql`UPDATE claimnet.embedding_vectors SET status = 'failed', updated_at = now() - interval '1 hour' WHERE id = ${one!.id}`;
    const gapped = run("prune", "--model", PREVIEW, "--keep", GA, "--apply");
    expect(gapped.status).toBe(3);
    expect(gapped.stderr).toContain("drops them from search");
    await sql`UPDATE claimnet.embedding_vectors SET status = 'complete', updated_at = now() - interval '1 hour' WHERE id = ${one!.id}`;

    const applied = run("prune", "--model", PREVIEW, "--keep", GA, "--batch", "7", "--sleep-ms", "0", "--apply");
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stdout).toContain("removed 7/");
    const after = await modelCounts(PREVIEW);
    expect(after.complete + after.pending + after.failed).toBe(0);

    // GA alone serves everything, and no target is needed.
    const final = await startBackend({ EMBEDDINGS_MODEL: GA }, a.cwd);
    expect(await searchTotal(final)).toBe(baseline);
    await stopBackend(final);
  }, 180_000);

});
