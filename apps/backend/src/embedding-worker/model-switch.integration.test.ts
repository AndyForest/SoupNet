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
const OPERATOR_CLI = path.join(REPO, "apps/backend/src/cli/embedding-model.ts");

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
async function startBackend(extra: Record<string, string>, cwd?: string, attempt = 1): Promise<Backend> {
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
    // A native crash during start on Windows only, about one start in 30 here, with nothing logged. Not seen on CI's Linux.
    if (child.exitCode === 3221226505 && attempt === 1) return startBackend(extra, cwd, 2);
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

async function mapStatus(backend: Backend, k = 2): Promise<{ status: number; members: number }> {
  const res = await fetch(`${backend.url}/traces/map?k=${k}`, { headers: { Authorization: `Bearer ${jwt}` } });
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

function operatorCli(...args: string[]) {
  const r = spawnSync(process.execPath, [TSX, OPERATOR_CLI, ...args], {
    cwd: REPO,
    env: childEnv({}, 0),
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, output: `${r.stdout}${r.stderr}` };
}

async function readVectors(backend: Backend): Promise<string> {
  const version = await fetch(`${backend.url}/health/version`, { headers: { Authorization: `Bearer ${apiKey}` } })
    .then((r) => r.json()) as { data: { embeddings: { readVectors: string } } };
  return version.data.embeddings.readVectors;
}

/** The state is held for 5 seconds, so a change shows within that. */
async function readVectorsBecomes(backend: Backend, state: string): Promise<void> {
  const deadline = Date.now() + 8000;
  let last = "";
  while (Date.now() < deadline) {
    last = await readVectors(backend);
    if (last === state) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`readVectors stayed ${last}, expected ${state}`);
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("condition not reached before the timeout");
}

/** A model's rows on chunks search reads, whose twin under the other model is complete. */
const searchedRows = (modelId: string, otherId: string, n: number) => sql<Array<{ id: string }>>`
  SELECT g.id FROM claimnet.embedding_vectors g
  JOIN claimnet.embedding_chunks ec ON ec.id = g.embedding_chunk_id
  JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
  JOIN claimnet.embedding_vectors p ON p.embedding_chunk_id = g.embedding_chunk_id AND p.task_type = g.task_type
  WHERE g.model_id = ${modelId} AND p.model_id = ${otherId} AND p.status = 'complete'
    AND g.task_type = 'SEMANTIC_SIMILARITY' AND ecs.strategy_id IN ('full_document', 'full_recipe_context')
  LIMIT ${n}
`;

/** Every chunk hash a recipe holds, its evidence's included. */
async function recipeChunkHashes(topic: string): Promise<string[]> {
  const rows = await sql<Array<{ chunk_hash: string }>>`
    SELECT DISTINCT ec.chunk_hash FROM claimnet.traces t
    LEFT JOIN claimnet.trace_evidence te ON te.trace_id = t.id
    JOIN claimnet.embedding_sources es ON es.source_id = t.id OR es.source_id = te.evidence_id
    JOIN claimnet.embedding_chunks ec ON ec.embedding_source_id = es.id
    WHERE t.claim_text LIKE ${`%${topic}%`}
  `;
  return rows.map((r) => r.chunk_hash);
}

async function deleteRecipe(topic: string): Promise<void> {
  const [row] = await sql<Array<{ id: string }>>`SELECT id FROM claimnet.traces WHERE claim_text LIKE ${`%${topic}%`}`;
  const res = await fetch(`${children.values().next().value!.url}/traces/${row!.id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ reason: "model switch test" }),
  });
  expect(res.status).toBe(200);
}

async function cachedUnder(modelId: string, hashes: string[]): Promise<number> {
  const [row] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM claimnet.vector_cache WHERE model_id = ${modelId} AND content_hash IN ${sql(hashes)}
  `;
  return row!.n;
}

/** Forget tasks that have stopped, rather than waiting out their 3 minutes. */
const forgetTasks = () => sql`DELETE FROM claimnet.system_settings WHERE key LIKE 'embeddingTask:%'`;

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

  it("with no setting, stays on the model the database's vectors are under", async () => {
    // Preview here, though a fresh database would get GA.
    const unset = await startBackend({ EMBEDDINGS_MODEL: "", EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "0" });
    try {
      expect(unset.log()).toContain(`read model=${PREVIEW} source=database`);
      expect(await searchTotal(unset)).toBe(baseline);
      expect(unset.log()).not.toContain("READ_MODEL_EMPTY");
      expect(fake.callsFor(GA)).toHaveLength(0);
    } finally {
      await stopBackend(unset);
    }
  }, 90_000);

  it("refuses to start on an unknown model or a bad target", () => {
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

  it("with no setting and both models present, follows the target and never the counts", async () => {
    // A rebuild that has overtaken the model reads are on.
    const held = await sql<Array<{ id: string }>>`
      UPDATE claimnet.embedding_vectors SET status = 'failed'
      WHERE id IN (SELECT id FROM claimnet.embedding_vectors WHERE model_id = ${PREVIEW} AND status = 'complete' LIMIT 40)
      RETURNING id
    `;
    try {
      const preview = await modelCounts(PREVIEW);
      const ga = await modelCounts(GA);
      expect(ga.complete).toBeGreaterThan(preview.complete);

      const overtaken = await startBackend({ EMBEDDINGS_MODEL: "", EMBEDDINGS_REBUILD_TARGET: GA, EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "0" });
      expect(overtaken.log()).toContain(`read model=${PREVIEW} source=database`);
      await stopBackend(overtaken);

      // After a flip, the same rule reads the other way.
      const flipped = await startBackend({ EMBEDDINGS_MODEL: "", EMBEDDINGS_REBUILD_TARGET: PREVIEW, EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "0" });
      expect(flipped.log()).toContain(`read model=${GA} source=database`);
      await stopBackend(flipped);

      // No target says nothing about which is the rebuild, so it won't guess.
      const refusal = expectBootRefusal({ EMBEDDINGS_MODEL: "", EMBEDDINGS_REBUILD_TARGET: "" });
      expect(refusal).toContain("Refusing to guess");
      expect(refusal).not.toContain("Soup.net backend running");
    } finally {
      await sql`UPDATE claimnet.embedding_vectors SET status = 'complete' WHERE id IN ${sql(held.map((r) => r.id))}`;
    }
  }, 180_000);

  it("gives an image written during the rebuild a real target vector, after the request's transaction", async () => {
    fake.calls = [];
    // A slow target can't lengthen the write, or the request.
    fake.delay.set(GA, 4000);
    const startedAt = Date.now();
    try {
      await checkRecipe(a, "fresh image during rebuild", png(3));
      expect(Date.now() - startedAt).toBeLessThan(3500);
      const row = () => sql<Array<{ status: string; vector_source: string; marker: string }>>`
        SELECT ev.status, ev.vector_source, (subvector(ev.vector, 2, 1)::text::jsonb->>0) AS marker
        FROM claimnet.embedding_vectors ev
        JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
        JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id AND es.artifact_category = 'multimodal'
        JOIN claimnet.trace_evidence te ON te.evidence_id = es.source_id
        JOIN claimnet.traces t ON t.id = te.trace_id
        WHERE ev.model_id = ${GA} AND t.claim_text LIKE '%fresh image%'
      `;
      // Committed, and waiting on the call.
      expect((await row())[0]?.status).toBe("pending");
      await sweepUntil(async () => (await row())[0]?.status === "complete", 30_000);
      expect((await row())[0]!.vector_source).toBe("server");
      expect(Number((await row())[0]!.marker)).toBeCloseTo(IMAGE_MARKER, 2);
    } finally {
      fake.delay.clear();
    }
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

  it("keeps recipe text out of queued jobs, and a job for a deleted row sends and caches nothing", async () => {
    // Every job this rebuild queued, waiting, finished or archived.
    const [held] = await sql<Array<{ jobs: number; with_text: number }>>`
      SELECT count(*)::int AS jobs,
             count(*) FILTER (WHERE data::text LIKE '%documented approach%' OR data::text LIKE '%chunkText%')::int AS with_text
      FROM (
        SELECT data FROM pgboss.job WHERE name LIKE 'embedding.vector%ids'
        UNION ALL SELECT data FROM pgboss.archive WHERE name LIKE 'embedding.vector%ids'
      ) j
    `;
    expect(held!.jobs).toBeGreaterThan(0);
    expect(held!.with_text).toBe(0);

    await sweepUntil(async () => (await quiet(PREVIEW)) && (await quiet(GA)));
    fake.calls = [];
    const [{ n: cachedBefore }] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM claimnet.vector_cache` as unknown as [{ n: number }];
    const gone = "00000000-0000-4000-8000-000000000123";
    // Queued before the delete, and from before this rule, so it still carries the text.
    await boss.send("embedding.vector-api-call", { items: [{
      vectorId: gone, chunkId: gone, chunkText: "text of a deleted recipe", chunkHash: "deleted-recipe-hash",
      taskType: "SEMANTIC_SIMILARITY", modelId: GA,
    }] });
    await boss.send("embedding.vector-check", { items: [{
      vectorId: gone, chunkId: gone, chunkText: "text of a deleted recipe", chunkHash: "deleted-recipe-hash",
      taskType: "SEMANTIC_SIMILARITY", modelId: GA,
    }] });
    await boss.send("embedding.vector-api-call-ids", { items: [{ vectorId: gone, taskType: "SEMANTIC_SIMILARITY", modelId: GA }] });
    const drained = async () => {
      const [q] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM pgboss.job
        WHERE name LIKE 'embedding.vector%' AND state IN ('created', 'retry', 'active')
      `;
      return q!.n === 0;
    };
    const deadline = Date.now() + 30_000;
    while (!(await drained()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
    expect(await drained()).toBe(true);
    expect(fake.calls).toHaveLength(0);
    const [cached] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM claimnet.vector_cache`;
    expect(cached!.n).toBe(cachedBefore);
  }, 180_000);

  it("leaves no cache row for a recipe deleted during a provider call", async () => {
    await sweepUntil(async () => (await quiet(PREVIEW)) && (await quiet(GA)));
    const deletedDuringCall = async (topic: string, seen: () => boolean, only?: string[]) => {
      const hashes = only ?? await recipeChunkHashes(topic);
      expect(hashes.length).toBeGreaterThan(0);
      await sweepUntil(async () => seen(), 60_000);
      await deleteRecipe(topic);
      // The held call comes back and finds nothing to write.
      await new Promise((r) => setTimeout(r, 3500));
      fake.delay.clear();
      expect(await cachedUnder(GA, hashes)).toBe(0);
    };
    const sawImage = () => fake.callsFor(GA).some((c) => c.sentImage);
    try {
      // The image call after the request's transaction.
      fake.calls = [];
      fake.delay.set(GA, 3000);
      await checkRecipe(a, "deleted during the commit image call", png(4));
      await deletedDuringCall("deleted during the commit image call", sawImage);

      // The worker, for text.
      await sweepUntil(() => quiet(GA));
      fake.calls = [];
      fake.delay.set(GA, 3000);
      await checkRecipe(a, "deleted during the worker text call");
      await deletedDuringCall("deleted during the worker text call", () => fake.callsFor(GA).length > 0);

      // The worker, for an image. Its row goes back to waiting with nothing cached.
      await sweepUntil(() => quiet(GA));
      const topic = "deleted during the worker image call";
      await checkRecipe(a, topic, png(5));
      await sweepUntil(async () => (await quiet(GA)) && (await cachedUnder(GA, await recipeChunkHashes(topic))) > 0);
      const hashes = await recipeChunkHashes(topic);
      await sql`DELETE FROM claimnet.vector_cache WHERE model_id = ${GA} AND content_hash IN ${sql(hashes)}`;
      await sql`
        UPDATE claimnet.embedding_vectors ev SET status = 'pending', vector = NULL, vector_source = 'server'
        FROM claimnet.embedding_chunks ec, claimnet.embedding_sources es
        WHERE ev.embedding_chunk_id = ec.id AND ec.embedding_source_id = es.id AND es.artifact_category = 'multimodal'
          AND ev.model_id = ${GA} AND ec.chunk_hash IN ${sql(hashes)}
      `;
      // The image's own chunk: map-only chunks of this recipe can embed and cache before the delete.
      const imageChunks = await sql<Array<{ chunk_hash: string }>>`
        SELECT ec.chunk_hash FROM claimnet.embedding_chunks ec
        JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id AND es.artifact_category = 'multimodal'
        WHERE ec.chunk_hash IN ${sql(hashes)}
      `;
      fake.calls = [];
      fake.delay.set(GA, 3000);
      await deletedDuringCall(topic, sawImage, imageChunks.map((r) => r.chunk_hash));
    } finally {
      fake.delay.clear();
    }
    await sweepUntil(async () => (await quiet(PREVIEW)) && (await quiet(GA)));
  }, 240_000);

  it("restores an image's real vector over a text fallback, during the call or after it", async () => {
    const topic = "fallback landing during the image call";
    const row = async () => (await sql<Array<{ id: string; vector_source: string; marker: string }>>`
      SELECT ev.id, ev.vector_source, (subvector(ev.vector, 2, 1)::text::jsonb->>0) AS marker
      FROM claimnet.embedding_vectors ev
      JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      JOIN claimnet.embedding_sources es ON es.id = ec.embedding_source_id AND es.artifact_category = 'multimodal'
      JOIN claimnet.trace_evidence te ON te.evidence_id = es.source_id
      JOIN claimnet.traces t ON t.id = te.trace_id
      WHERE ev.model_id = ${GA} AND t.claim_text LIKE ${`%${topic}%`}
    `)[0]!;
    const asFallback = (id: string) => sql`
      UPDATE claimnet.embedding_vectors SET status = 'complete', vector_source = 'text_fallback', updated_at = now(),
        vector = (SELECT v.vector FROM claimnet.embedding_vectors v
                  JOIN claimnet.embedding_chunks c ON c.id = v.embedding_chunk_id
                  JOIN claimnet.embedding_sources s ON s.id = c.embedding_source_id AND s.artifact_category = 'text'
                  WHERE v.model_id = ${GA} AND v.status = 'complete' LIMIT 1)
      WHERE id = ${id}::uuid
    `;
    fake.calls = [];
    fake.delay.set(GA, 3000);
    try {
      await checkRecipe(a, topic, png(6));
      baseline += 1;
      await until(() => fake.callsFor(GA).some((c) => c.sentImage));
      // The sweep gets there first, from a task without the bytes.
      await asFallback((await row()).id);
      expect((await row()).vector_source).toBe("text_fallback");
      expect(Number((await row()).marker)).toBeCloseTo(TEXT_MARKER, 2);
      await until(async () => (await row()).vector_source === "server");
    } finally {
      fake.delay.clear();
    }
    expect(Number((await row()).marker)).toBeCloseTo(IMAGE_MARKER, 2);

    // It lands after the call: the real vector is in the cache, and the command restores it.
    await asFallback((await row()).id);
    const dry = operatorCli("repair-image-fallbacks");
    expect(dry.status, dry.output).toBe(0);
    expect(dry.output).toContain("1 text fallbacks can be restored");
    expect((await row()).vector_source).toBe("text_fallback");
    expect(operatorCli("status", "--read", PREVIEW).output).toContain("text fallbacks with a real image vector in the cache: 1");
    const applied = operatorCli("repair-image-fallbacks", "--apply");
    expect(applied.status, applied.output).toBe(0);
    expect((await row()).vector_source).toBe("server");
    expect(Number((await row()).marker)).toBeCloseTo(IMAGE_MARKER, 2);
    // The fallback that was never an image stays what it is.
    expect(operatorCli("repair-image-fallbacks").output).toContain("0 text fallbacks can be restored");
  }, 120_000);

  it("reads only the read model at evidence search, the map and evidence clustering", async () => {
    // Seven evidence entries, so clustering has something to do.
    const form = new FormData();
    form.set("key", apiKey);
    const claim = "As a maintainer working on clustered evidence, I chose the documented approach so that later changes stay safe";
    form.set("trace", claim);
    form.set("ef", [1, 2, 3, 4, 5, 6, 7]
      .map((n) => `Observation number ${n} about clustered evidence, entry ${n * 7919}.\n> "seen ${n}"\n-- note ${n}`)
      .join("\n\n"));
    form.set("format", "json");
    const posted = await fetch(`${a.url}/check?format=json`, { method: "POST", body: form });
    expect(posted.status).toBe(200);
    baseline += 1;
    await sweepUntil(async () => (await gap(PREVIEW, GA)) === 0 && (await gap(GA, PREVIEW)) === 0 && (await quiet(PREVIEW)) && (await quiet(GA)));

    interface CheckData {
      results?: Array<{ recipe?: string; evidence?: unknown[] }>;
      relatedEvidence?: unknown[];
      relatedEvidenceKnown?: unknown[];
    }
    const lookup = async (): Promise<CheckData> => {
      const url = new URL(`${a.url}/check`);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("filter", "clustered evidence");
      // One result per recipe, so this one is among them whatever the clustering does.
      url.searchParams.set("clusters", "30");
      url.searchParams.set("format", "json");
      return (await (await fetch(url)).json() as { data: CheckData }).data;
    };
    const evidenceOf = (d: CheckData) => {
      return d.results?.find((r) => r.recipe === claim)?.evidence ?? [];
    };
    const evidenceHits = (d: CheckData) => (d.relatedEvidence?.length ?? 0) + (d.relatedEvidenceKnown?.length ?? 0);

    // Under its own model it works: evidence is found, and the seven cluster down.
    const before = await lookup();
    expect(evidenceHits(before)).toBeGreaterThan(0);
    expect(evidenceOf(before).length).toBeGreaterThan(0);
    expect(evidenceOf(before).length).toBeLessThan(7);
    const mapBefore = (await mapStatus(a)).members;
    expect(mapBefore).toBeGreaterThan(0);

    // The read model loses every evidence vector and one recipe's own. GA still holds them all.
    const evidenceRows = await sql<Array<{ id: string }>>`
      UPDATE claimnet.embedding_vectors ev SET status = 'failed'
      FROM claimnet.embedding_chunks ec, claimnet.embedding_sources es
      WHERE ev.embedding_chunk_id = ec.id AND ec.embedding_source_id = es.id
        AND es.source_type = 'evidence' AND ev.model_id = ${PREVIEW} AND ev.status = 'complete'
      RETURNING ev.id
    `;
    const [mapRecipe] = await sql<Array<{ id: string }>>`SELECT id FROM claimnet.traces WHERE claim_text LIKE '%edge caching%'`;
    const traceRows = await sql<Array<{ id: string }>>`
      UPDATE claimnet.embedding_vectors ev SET status = 'failed'
      FROM claimnet.embedding_chunks ec, claimnet.embedding_sources es
      WHERE ev.embedding_chunk_id = ec.id AND ec.embedding_source_id = es.id
        AND es.source_type = 'trace' AND es.source_id = ${mapRecipe!.id}::uuid AND ev.model_id = ${PREVIEW}
      RETURNING ev.id
    `;
    const heldCache = await sql<Array<Record<string, unknown>>>`
      DELETE FROM claimnet.vector_cache vc USING claimnet.embedding_chunks ec, claimnet.embedding_sources es
      WHERE vc.content_hash = ec.chunk_hash AND ec.embedding_source_id = es.id
        AND es.source_type = 'trace' AND es.source_id = ${mapRecipe!.id}::uuid AND vc.model_id = ${PREVIEW}
      RETURNING vc.content_hash, vc.model_id, vc.task_type, vc.vector::text AS vector
    `;
    try {
      const after = await lookup();
      // No other model's vectors stand in at evidence search...
      expect(evidenceHits(after)).toBe(0);
      // ...or at clustering, which now has nothing to cluster and shows all seven.
      expect(evidenceOf(after)).toHaveLength(7);
      // ...or on the map, through either the vector or the cache. Another k, since a
      // layout is held until the corpus changes, and this isn't a new recipe.
      expect((await mapStatus(a, 3)).members).toBe(mapBefore - 1);
    } finally {
      const ids = [...evidenceRows, ...traceRows].map((r) => r.id);
      await sql`UPDATE claimnet.embedding_vectors SET status = 'complete' WHERE id IN ${sql(ids)}`;
      for (const c of heldCache) {
        await sql`
          INSERT INTO claimnet.vector_cache (content_hash, model_id, task_type, vector)
          VALUES (${c["content_hash"] as string}, ${c["model_id"] as string}, ${c["task_type"] as string}, ${c["vector"] as string}::vector(3072))
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }, 180_000);

  it("calls a read model partial only for chunks really missing from search", async () => {
    await readVectorsBecomes(a, "ok");
    const someSearchedRows = (n: number) => sql<Array<{ id: string; chunk_id: string }>>`
      SELECT ev.id, ec.id AS chunk_id FROM claimnet.embedding_vectors ev
      JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
      WHERE ev.model_id = ${PREVIEW} AND ev.status = 'complete'
        AND ecs.strategy_id IN ('full_document', 'full_recipe_context')
      LIMIT ${n}
    `;
    const rows = await someSearchedRows(6);
    const ids = rows.map((r) => r.id);
    const chunks = rows.map((r) => r.chunk_id);
    await sql`UPDATE claimnet.embedding_chunks SET created_at = now() - interval '1 hour' WHERE id IN ${sql(chunks)}`;
    try {
      // Refused rows are reported elsewhere, and aren't this alarm.
      await sql`UPDATE claimnet.embedding_vectors SET status = 'failed' WHERE id IN ${sql(ids)}`;
      await new Promise((r) => setTimeout(r, 5500));
      expect(await readVectors(a)).toBe("ok");
      // Nor is a chunk just written, which hasn't missed anything yet.
      await sql`UPDATE claimnet.embedding_chunks SET created_at = now() WHERE id IN ${sql(chunks)}`;
      await sql`UPDATE claimnet.embedding_vectors SET status = 'processing', updated_at = now() WHERE id IN ${sql(ids)}`;
      await new Promise((r) => setTimeout(r, 5500));
      expect(await readVectors(a)).toBe("ok");
      // Out of search, nothing refused, and old enough to matter: that is the alarm.
      await sql`UPDATE claimnet.embedding_chunks SET created_at = now() - interval '1 hour' WHERE id IN ${sql(chunks)}`;
      await readVectorsBecomes(a, "partial");
    } finally {
      await sql`UPDATE claimnet.embedding_vectors SET status = 'complete' WHERE id IN ${sql(ids)}`;
    }
    await readVectorsBecomes(a, "ok");

    // More than a handful of failures is real, whatever they say, and keeps saying so.
    const many = (await someSearchedRows(12)).map((r) => r.id);
    await sql`UPDATE claimnet.embedding_vectors SET status = 'failed', error = 'API call failed: 400 billing' WHERE id IN ${sql(many)}`;
    try {
      await readVectorsBecomes(a, "partial");
      const before = a.log().split("READ_MODEL_PARTIAL").length;
      await until(() => a.log().split("READ_MODEL_PARTIAL").length >= before + 2, 130_000);
      expect(a.log()).toMatch(/READ_MODEL_PARTIAL: \d+ of \d+ chunks are out of search under .*: 12 failed by the provider/);
    } finally {
      await sql`UPDATE claimnet.embedding_vectors SET status = 'complete', error = NULL WHERE id IN ${sql(many)}`;
    }
    await readVectorsBecomes(a, "ok");

    // The sweep giving up isn't a refusal, so it doesn't get the allowance.
    const stale = (await someSearchedRows(2)).map((r) => r.id);
    await sql`
      UPDATE claimnet.embedding_vectors SET status = 'failed',
        error = 'Auto-retry limit exceeded after stale processing recovery'
      WHERE id IN ${sql(stale)}
    `;
    try {
      await readVectorsBecomes(a, "partial");
    } finally {
      await sql`UPDATE claimnet.embedding_vectors SET status = 'complete', error = NULL WHERE id IN ${sql(stale)}`;
    }
    await readVectorsBecomes(a, "ok");

    // Another model holding far fewer or far more doesn't enter into it: GA's rows
    // are complete here, and failing them changes nothing under preview.
    const held = await sql<Array<{ id: string }>>`
      UPDATE claimnet.embedding_vectors SET status = 'failed' WHERE model_id = ${GA} AND status = 'complete' RETURNING id
    `;
    try {
      await new Promise((r) => setTimeout(r, 5500));
      expect(await readVectors(a)).toBe("ok");
    } finally {
      await sql`UPDATE claimnet.embedding_vectors SET status = 'complete' WHERE id IN ${sql(held.map((r) => r.id))}`;
    }
  }, 300_000);

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

    // The operator can see it: not safe to flip, and why no wait will help.
    await sweepUntil(async () => /safe_to_flip=no refused=\d+/.test(a.log()));
    const seen = operatorCli("status", "--read", PREVIEW, "--target", GA);
    expect(seen.status, seen.output).toBe(0);
    expect(seen.output).toMatch(/provider refused: [1-9]/);
    expect(seen.output).toContain("Safe to flip reads: NO");
    expect(seen.output).toContain("provider_refused");

    // On one stream, so each table stays under its heading in a log.
    expect(seen.stdout).toBe("");
    const order = ["vectors:", "model_id", "search coverage", "tasks heard from", "secondsAgo", "image sources:", "source_type", "failed rows, by kind", "provider_refused"];
    const at = order.map((text) => seen.stderr.indexOf(text));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);

    // retry-failed puts it back, and the gap closes.
    const retry = operatorCli("retry-failed", "--model", GA);
    expect(retry.status, retry.output).toBe(0);
    await sweepUntil(async () => (await gap(PREVIEW, GA)) === 0 && (await modelCounts(GA)).failed === 0 && (await quiet(GA)));
    expect(operatorCli("status", "--read", PREVIEW, "--target", GA).output).toContain("Safe to flip reads: YES");

    // A target row still on its way is not done: only 'complete' closes the gap.
    const [onItsWay] = await searchedRows(GA, PREVIEW, 1);
    await sql`UPDATE claimnet.embedding_vectors SET status = 'processing', updated_at = now() WHERE id = ${onItsWay!.id}`;
    expect(operatorCli("status", "--read", PREVIEW, "--target", GA).output).toContain("Safe to flip reads: NO");
    await sql`UPDATE claimnet.embedding_vectors SET status = 'complete' WHERE id = ${onItsWay!.id}`;

    // A chunk search doesn't read holds nothing up, and is counted apart.
    const [experimental] = await sql<Array<{ id: string }>>`
      SELECT ev.id FROM claimnet.embedding_vectors ev
      JOIN claimnet.embedding_chunks ec ON ec.id = ev.embedding_chunk_id
      JOIN claimnet.embedding_chunk_strategies ecs ON ecs.id = ec.chunk_strategy_id
      WHERE ev.model_id = ${GA} AND ecs.strategy_id NOT IN ('full_document', 'full_recipe_context') LIMIT 1
    `;
    await sql`UPDATE claimnet.embedding_vectors SET status = 'failed', error = 'API call failed: 400' WHERE id = ${experimental!.id}`;
    const notRead = operatorCli("status", "--read", PREVIEW, "--target", GA).output;
    expect(notRead).toContain("Safe to flip reads: YES");
    expect(notRead).toContain("Chunks search doesn't read, not counted: 1");
    expect(notRead).toContain("not_searched");
    await sql`UPDATE claimnet.embedding_vectors SET status = 'complete', error = NULL WHERE id = ${experimental!.id}`;
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

  it("won't prune what running tasks read or rebuild, and shows an emptied read model at once", async () => {
    await forgetTasks();
    const noTasks = operatorCli("prune", "--model", GA, "--keep", PREVIEW, "--apply");
    expect(noTasks.status).toBe(3);
    expect(noTasks.output).toContain("No task has reported");

    expect(operatorCli("prune", "--model", GA, "--keep", GA, "--apply").status).toBe(3);

    // Reading GA, asked to remove GA.
    const reader = await startBackend({ EMBEDDINGS_MODEL: GA, EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "0" }, a.cwd);
    const before = await modelCounts(GA);
    const reading = operatorCli("prune", "--model", GA, "--keep", PREVIEW, "--apply");
    expect(reading.status).toBe(3);
    expect(reading.output).toContain(`Running tasks read ${GA}`);
    expect((await modelCounts(GA)).complete).toBe(before.complete);
    expect(await searchTotal(reader)).toBe(baseline);

    // However the rows go, /health/version says so without waiting for the watch.
    await readVectorsBecomes(reader, "ok");
    const held = await sql<Array<{ id: string }>>`
      UPDATE claimnet.embedding_vectors SET status = 'failed' WHERE model_id = ${GA} AND status = 'complete' RETURNING id
    `;
    try {
      await readVectorsBecomes(reader, "empty");
    } finally {
      await sql`UPDATE claimnet.embedding_vectors SET status = 'complete' WHERE id IN ${sql(held.map((r) => r.id))}`;
    }
    await stopBackend(reader);
    await forgetTasks();

    // Reading the right model, but still rebuilding the one to remove.
    const rebuilder = await startBackend({ EMBEDDINGS_MODEL: GA, EMBEDDINGS_REBUILD_TARGET: PREVIEW, EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "0" }, a.cwd);
    const rebuilding = operatorCli("prune", "--model", PREVIEW, "--keep", GA, "--apply");
    expect(rebuilding.status).toBe(3);
    expect(rebuilding.output).toContain(`still rebuild ${PREVIEW}`);
    await stopBackend(rebuilder);
    await forgetTasks();
  }, 180_000);

  it("removes the old model: dry-runs by default, deletes in batches, stops if a deploy starts", async () => {
    const reader = await startBackend({ EMBEDDINGS_MODEL: GA, EMBEDDINGS_REBUILD_VECTORS_PER_MINUTE: "0" }, a.cwd);

    // Recent writes count as "still being written".
    const recent = operatorCli("prune", "--model", PREVIEW, "--keep", GA, "--apply");
    expect(recent.status).toBe(3);
    expect(recent.output).toContain("still writes them");

    await sql`UPDATE claimnet.embedding_vectors SET updated_at = now() - interval '1 hour', created_at = now() - interval '1 hour'`;

    const before = await modelCounts(PREVIEW);
    const dry = operatorCli("prune", "--model", PREVIEW, "--keep", GA);
    expect(dry.status, dry.output).toBe(0);
    expect(dry.output).toContain("irreversible");
    expect(dry.output).toContain("Dry run");
    expect((await modelCounts(PREVIEW)).complete).toBe(before.complete);

    // A row GA refuses blocks the prune, until the operator accepts losing it.
    const [one, two] = await searchedRows(GA, PREVIEW, 2);
    await sql`UPDATE claimnet.embedding_vectors SET status = 'failed' WHERE id = ${one!.id}`;
    const refused = operatorCli("prune", "--model", PREVIEW, "--keep", GA, "--apply");
    expect(refused.status).toBe(3);
    expect(refused.output).toContain("drops them from search");
    expect(refused.output).toContain("--accept-refused");
    const accepted = operatorCli("prune", "--model", PREVIEW, "--keep", GA, "--accept-refused");
    expect(accepted.status, accepted.output).toBe(0);
    expect(accepted.output).toContain("1 chunks the provider refused");

    // Accepting refusals doesn't cover a row the sweep gave up on.
    await sql`
      UPDATE claimnet.embedding_vectors SET status = 'failed',
        error = 'Auto-retry limit exceeded after stale processing recovery'
      WHERE id = ${one!.id}
    `;
    const stale = operatorCli("prune", "--model", PREVIEW, "--keep", GA, "--accept-refused", "--apply");
    expect(stale.status).toBe(3);
    expect(stale.output).toContain("0 refused by the provider, 1 over the retry limit");
    await sql`UPDATE claimnet.embedding_vectors SET error = 'API call failed: 400' WHERE id = ${one!.id}`;

    // Accepting refusals doesn't cover a row still on its way.
    await sql`UPDATE claimnet.embedding_vectors SET status = 'processing' WHERE id = ${two!.id}`;
    const unfinished = operatorCli("prune", "--model", PREVIEW, "--keep", GA, "--accept-refused", "--apply");
    expect(unfinished.status).toBe(3);
    await sql`UPDATE claimnet.embedding_vectors SET status = 'complete' WHERE id IN (${one!.id}, ${two!.id})`;

    // A task reading the old model appears partway: the next batch doesn't run.
    const child = spawn(process.execPath, [TSX, OPERATOR_CLI, "prune", "--model", PREVIEW, "--keep", GA, "--batch", "1", "--sleep-ms", "500", "--apply"], {
      cwd: REPO, env: childEnv({}, 0), stdio: ["ignore", "ignore", "pipe"],
    });
    let stopped = "";
    child.stderr!.on("data", (c: Buffer) => { stopped += c.toString(); });
    const done = new Promise<number | null>((r) => child.once("exit", r));
    const deadline = Date.now() + 60_000;
    while (!stopped.includes("removed 2/") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    await sql`
      INSERT INTO claimnet.system_settings (key, value, updated_at)
      VALUES ('embeddingTask:deploy-in-progress', ${JSON.stringify({ read: PREVIEW, target: null })}, now())
    `;
    expect(await done).toBe(3);
    expect(stopped).toContain("Stopped after removing");
    expect((await modelCounts(PREVIEW)).complete).toBeGreaterThan(0);
    await sql`DELETE FROM claimnet.system_settings WHERE key = 'embeddingTask:deploy-in-progress'`;

    const applied = operatorCli("prune", "--model", PREVIEW, "--keep", GA, "--batch", "7", "--sleep-ms", "0", "--apply");
    expect(applied.status, applied.output).toBe(0);
    expect(applied.output).toContain("removed 7/");
    const after = await modelCounts(PREVIEW);
    expect(after.complete + after.pending + after.failed).toBe(0);

    // GA alone serves everything, and no target is needed.
    expect(await searchTotal(reader)).toBe(baseline);
    await stopBackend(reader);
  }, 240_000);

});

describe.skipIf(!HAS_PG)("settling the read model on a database with no vectors", () => {
  const FRESH_DB = `model_switch_fresh_${process.pid}`;
  const unsetOnFresh = { EMBEDDINGS_MODEL: "", PGDATABASE: FRESH_DB };
  let root: ReturnType<typeof postgres>;
  let fresh: ReturnType<typeof postgres>;

  beforeAll(async () => {
    geminiUrl = await fake.start();
    root = postgres({ ...PG, database: "postgres", max: 1, onnotice: () => {} });
    await root.unsafe(`CREATE DATABASE ${FRESH_DB}`);
    fresh = postgres({ ...PG, database: FRESH_DB, max: 1, onnotice: () => {} });
  }, 60_000);

  afterAll(async () => {
    await Promise.all([...children].map(stopBackend));
    await fresh?.end({ timeout: 5 }).catch(() => {});
    await root?.unsafe(`DROP DATABASE IF EXISTS ${FRESH_DB} WITH (FORCE)`).catch(() => {});
    await root?.end({ timeout: 5 }).catch(() => {});
    await fake.stop();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("starts a fresh database on the recommended model, and a second task agrees", async () => {
    const first = await startBackend(unsetOnFresh);
    expect(first.log()).toContain(`read model=${GA} source=database`);
    expect(first.log()).toContain("recommended");
    const second = await startBackend(unsetOnFresh);
    expect(second.log()).toContain(`read model=${GA} source=database`);
    await Promise.all([stopBackend(first), stopBackend(second)]);
  }, 120_000);

  it("keeps a stack that reset its corpus on the model it has cached", async () => {
    await fresh`
      INSERT INTO claimnet.vector_cache (content_hash, model_id, task_type, vector)
      VALUES ('reset-stack', ${PREVIEW}, 'SEMANTIC_SIMILARITY', array_fill(0.1::real, ARRAY[3072])::vector(3072))
    `;
    const reset = await startBackend(unsetOnFresh);
    expect(reset.log()).toContain(`read model=${PREVIEW} source=database`);
    await stopBackend(reset);
  }, 60_000);

  it("won't start on a guess when the lookup fails", async () => {
    await fresh.unsafe("ALTER TABLE claimnet.vector_cache RENAME TO vector_cache_away");
    try {
      const refusal = expectBootRefusal(unsetOnFresh);
      expect(refusal).toContain("could not be read");
      expect(refusal).not.toContain("source=database");
      expect(refusal).not.toContain("Soup.net backend running");
    } finally {
      await fresh.unsafe("ALTER TABLE claimnet.vector_cache_away RENAME TO vector_cache");
    }
  }, 90_000);
});
