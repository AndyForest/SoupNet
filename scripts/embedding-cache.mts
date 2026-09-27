/**
 * A long-lived local copy of the embedding cache (claimnet.vector_cache),
 * so paid-for vectors outlive the development and test databases they were
 * made in. See docs/workflows/embedding-cache.md.
 *
 *   npx tsx scripts/embedding-cache.mts setup                 # table + insert-only writer role (idempotent)
 *   npx tsx scripts/embedding-cache.mts status                # counts, permissions, latest backup
 *   npx tsx scripts/embedding-cache.mts harvest [--from URL]… # copy vectors the cache lacks
 *   npx tsx scripts/embedding-cache.mts backup                # pg_dump + sorted key list + manifest
 *   npx tsx scripts/embedding-cache.mts verify                # newest backup is intact and lost no keys
 *   npx tsx scripts/embedding-cache.mts prune [--keep 3]      # verify, then delete backups beyond --keep
 *   npx tsx scripts/embedding-cache.mts restore-test          # restore newest backup into a scratch DB and compare
 *   npx tsx scripts/embedding-cache.mts nightly [--backup-every-days 7] [--keep 3]
 *
 * Environment (defaults suit docker-compose.embedding-cache.yml):
 *   EMBEDDING_CACHE_URL        writer connection (select + insert only)
 *   EMBEDDING_CACHE_ADMIN_URL  owner connection, for setup and backups
 *   EMBEDDING_CACHE_CONTAINER  container that runs pg_dump / pg_restore
 *   EMBEDDING_CACHE_BACKUP_DIR where backups go (required for backup commands)
 *   EMBEDDING_CACHE_SOURCES    comma-separated source database URLs for harvest
 *                              (else --from, else DATABASE_URL)
 */

import postgres from "postgres";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import {
  backupName,
  compareKeyStreams,
  isBackupName,
  keyOf,
  redactUrl,
  selectPrunable,
  type CacheKey,
} from "./embedding-cache/lib.mts";

const WRITER_URL = process.env["EMBEDDING_CACHE_URL"] ?? "postgresql://cache_writer:cache_writer@127.0.0.1:5733/embedding_cache";
const ADMIN_URL = process.env["EMBEDDING_CACHE_ADMIN_URL"] ?? "postgresql://cache_admin:cache_admin@127.0.0.1:5733/embedding_cache";
const CONTAINER = process.env["EMBEDDING_CACHE_CONTAINER"] ?? "soupnet-embedding-cache";
const BACKUP_DIR = process.env["EMBEDDING_CACHE_BACKUP_DIR"];

/** Stub vectors are deterministic fakes for tests; never worth keeping. */
const SKIPPED_MODELS = ["stub-embeddings"];
const HARVEST_BATCH = 200;
const KEY_ORDER = `(content_hash || E'\\t' || model_id || E'\\t' || task_type) COLLATE "C"`;

const log = (msg: string) => console.log(`${new Date().toISOString()}  ${msg}`);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
}
function requireBackupDir(): string {
  if (!BACKUP_DIR) throw new Error("EMBEDDING_CACHE_BACKUP_DIR is required for backup commands");
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return BACKUP_DIR;
}

// ── setup ────────────────────────────────────────────────────────────────────

async function setup(): Promise<void> {
  const writer = new URL(WRITER_URL);
  const role = decodeURIComponent(writer.username);
  const password = decodeURIComponent(writer.password);
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`writer role "${role}" must be a plain lower-case identifier`);

  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    // Same shape as the app's claimnet.vector_cache (packages/db/src/schema/vector-cache.ts),
    // so rows copy across unchanged and the app's own queries work against it.
    await admin.unsafe(`
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE SCHEMA IF NOT EXISTS claimnet;
      CREATE TABLE IF NOT EXISTS claimnet.vector_cache (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        content_hash text NOT NULL,
        model_id     text NOT NULL,
        task_type    text NOT NULL,
        vector       vector(3072) NOT NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT vector_cache_hash_model_task_unique UNIQUE (content_hash, model_id, task_type)
      );
    `);
    const [exists] = await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role}`;
    const literal = `'${password.replace(/'/g, "''")}'`;
    await admin.unsafe(`${exists ? "ALTER" : "CREATE"} ROLE ${role} LOGIN PASSWORD ${literal}`);
    // Insert-only: the cache only ever gains rows, so a writer never needs more.
    await admin.unsafe(`
      REVOKE ALL ON claimnet.vector_cache FROM ${role};
      GRANT USAGE ON SCHEMA claimnet TO ${role};
      GRANT SELECT, INSERT ON claimnet.vector_cache TO ${role};
    `);
    log(`setup: claimnet.vector_cache ready; role ${role} may SELECT and INSERT only`);
  } finally {
    await admin.end();
  }
  await checkWriterPermissions();
}

/** Prove the writer cannot change or remove rows. Throws if it can. */
async function checkWriterPermissions(): Promise<void> {
  const w = postgres(WRITER_URL, { max: 1, onnotice: () => {} });
  try {
    const attempts: Array<[string, string]> = [
      ["UPDATE", "UPDATE claimnet.vector_cache SET task_type = task_type WHERE false"],
      ["DELETE", "DELETE FROM claimnet.vector_cache WHERE false"],
      ["TRUNCATE", "TRUNCATE claimnet.vector_cache"],
    ];
    for (const [verb, statement] of attempts) {
      try {
        await w.begin(async (tx) => {
          await tx.unsafe(statement);
          throw new Error("ROLLBACK_PROBE");
        });
        throw new Error(`writer role was allowed to ${verb} — run setup again`);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "42501") continue; // insufficient_privilege: what we want
        if ((e as Error).message === "ROLLBACK_PROBE") throw new Error(`writer role was allowed to ${verb} — run setup again`);
        throw e;
      }
    }
    log("permissions: writer is denied UPDATE, DELETE and TRUNCATE");
  } finally {
    await w.end();
  }
}

// ── harvest ──────────────────────────────────────────────────────────────────

export async function harvest(sourceUrl: string): Promise<{ copied: number; alreadyHad: number }> {
  const src = postgres(sourceUrl, { max: 1, onnotice: () => {} });
  const dst = postgres(WRITER_URL, { max: 1, onnotice: () => {} });
  try {
    const [t] = await src`SELECT to_regclass('claimnet.vector_cache') AS t`;
    if (!t?.["t"]) {
      log(`harvest ${redactUrl(sourceUrl)}: no claimnet.vector_cache table, skipped`);
      return { copied: 0, alreadyHad: 0 };
    }

    const have = new Set<string>();
    for await (const rows of dst<CacheKey[]>`SELECT content_hash, model_id, task_type FROM claimnet.vector_cache`.cursor(20_000)) {
      for (const r of rows) have.add(keyOf(r));
    }

    const missing: CacheKey[] = [];
    let alreadyHad = 0;
    for await (const rows of src<CacheKey[]>`
      SELECT content_hash, model_id, task_type FROM claimnet.vector_cache
      WHERE model_id <> ALL(${SKIPPED_MODELS})
    `.cursor(20_000)) {
      for (const r of rows) {
        if (have.has(keyOf(r))) alreadyHad++;
        else missing.push(r);
      }
    }
    log(`harvest ${redactUrl(sourceUrl)}: ${missing.length} new, ${alreadyHad} already cached`);

    let copied = 0;
    for (let i = 0; i < missing.length; i += HARVEST_BATCH) {
      const batch = missing.slice(i, i + HARVEST_BATCH);
      const hashes = batch.map((k) => k.content_hash);
      const models = batch.map((k) => k.model_id);
      const tasks = batch.map((k) => k.task_type);
      // vector::text is pgvector's shortest round-trip form, so the float32
      // values arrive exactly; the check below proves it per batch.
      const rows = await src<Array<CacheKey & { vector: string; created_at: Date }>>`
        SELECT v.content_hash, v.model_id, v.task_type, v.vector::text AS vector, v.created_at
        FROM claimnet.vector_cache v
        JOIN unnest(${hashes}::text[], ${models}::text[], ${tasks}::text[]) AS k(h, m, t)
          ON v.content_hash = k.h AND v.model_id = k.m AND v.task_type = k.t
      `;
      await dst`
        INSERT INTO claimnet.vector_cache (content_hash, model_id, task_type, vector, created_at)
        SELECT h, m, t, v::vector(3072), c
        FROM unnest(
          ${rows.map((r) => r.content_hash)}::text[],
          ${rows.map((r) => r.model_id)}::text[],
          ${rows.map((r) => r.task_type)}::text[],
          ${rows.map((r) => r.vector)}::text[],
          ${rows.map((r) => r.created_at.toISOString())}::timestamptz[]
        ) AS x(h, m, t, v, c)
        ON CONFLICT (content_hash, model_id, task_type) DO NOTHING
      `;
      const stored = await dst<Array<CacheKey & { vector: string }>>`
        SELECT v.content_hash, v.model_id, v.task_type, v.vector::text AS vector
        FROM claimnet.vector_cache v
        JOIN unnest(${hashes}::text[], ${models}::text[], ${tasks}::text[]) AS k(h, m, t)
          ON v.content_hash = k.h AND v.model_id = k.m AND v.task_type = k.t
      `;
      const storedByKey = new Map(stored.map((r) => [keyOf(r), r.vector]));
      for (const r of rows) {
        if (storedByKey.get(keyOf(r)) !== r.vector) {
          throw new Error(`harvest: stored vector differs from the source for ${keyOf(r)}`);
        }
      }
      copied += rows.length;
      if ((i / HARVEST_BATCH) % 50 === 0 || i + HARVEST_BATCH >= missing.length) {
        log(`harvest: ${copied}/${missing.length} copied and verified`);
      }
    }
    return { copied, alreadyHad };
  } finally {
    await src.end();
    await dst.end();
  }
}

function harvestSources(): string[] {
  const fromArgs = args("--from");
  if (fromArgs.length) return fromArgs;
  const env = process.env["EMBEDDING_CACHE_SOURCES"];
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env["DATABASE_URL"]) return [process.env["DATABASE_URL"]];
  throw new Error("no harvest source: pass --from <url>, or set EMBEDDING_CACHE_SOURCES or DATABASE_URL");
}

// ── backups ──────────────────────────────────────────────────────────────────

interface Manifest {
  name: string;
  createdAt: string;
  rows: number;
  perModel: Record<string, number>;
  dumpBytes: number;
  dumpSha256: string;
  keysSha256: string;
  serverVersion: string;
  pgvectorVersion: string;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

/** Run a command, streaming stdout to `outFile` (if given) and stdin from `inFile` (if given). */
function run(cmd: string[], opts: { outFile?: string; inFile?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd[0]!, cmd.slice(1), { stdio: [opts.inFile ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    if (opts.outFile) p.stdout!.pipe(fs.createWriteStream(opts.outFile));
    else p.stdout!.on("data", (d) => (stdout += d));
    p.stderr!.on("data", (d) => (stderr += d));
    if (opts.inFile) {
      // `pg_restore --list` reads only the table of contents and exits, closing
      // stdin early; that's expected, and the exit code still reports failure.
      p.stdin!.on("error", (e: NodeJS.ErrnoException) => {
        if (e.code !== "EPIPE" && e.code !== "EOF") reject(e);
      });
      const input = fs.createReadStream(opts.inFile);
      input.on("error", reject);
      input.pipe(p.stdin!);
      p.on("close", () => input.destroy());
    }
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${cmd.slice(0, 4).join(" ")} exited ${code}: ${stderr.trim()}`))));
  });
}

async function* keyLines(file: string): AsyncGenerator<string> {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield line;
}

function listBackups(dir: string): string[] {
  return fs.readdirSync(dir).filter(isBackupName).sort();
}

function readManifest(dir: string, name: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(dir, name, "manifest.json"), "utf8")) as Manifest;
}

async function backup(): Promise<string> {
  const dir = requireBackupDir();
  const name = backupName(new Date());
  const partial = path.join(dir, `${name}.partial`);
  fs.mkdirSync(partial, { recursive: true });
  const dumpFile = path.join(partial, "vector_cache.dump");
  const keysFile = path.join(partial, "keys.txt.gz");

  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  let manifest: Manifest;
  try {
    manifest = await admin.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
      // The dump and the key list read the same snapshot, so the key list
      // describes exactly the rows in the dump.
      const [snap] = await tx`SELECT pg_export_snapshot() AS s`;
      const dump = run(
        ["docker", "exec", CONTAINER, "pg_dump", "-U", "cache_admin", "-d", "embedding_cache", "-Fc",
          `--snapshot=${snap!["s"]}`, "-t", "claimnet.vector_cache"],
        { outFile: dumpFile },
      );

      let rows = 0;
      const gz = zlib.createGzip();
      const written = pipeline(gz, fs.createWriteStream(keysFile));
      for await (const batch of tx.unsafe(
        `SELECT content_hash, model_id, task_type FROM claimnet.vector_cache ORDER BY ${KEY_ORDER}`,
      ).cursor(20_000)) {
        for (const r of batch as unknown as CacheKey[]) {
          if (!gz.write(`${keyOf(r)}\n`)) await new Promise((res) => gz.once("drain", res));
          rows++;
        }
      }
      gz.end();
      await written;

      const perModelRows = await tx<Array<{ model_id: string; n: number }>>`
        SELECT model_id, count(*)::int AS n FROM claimnet.vector_cache GROUP BY 1 ORDER BY 1
      `;
      const [ver] = await tx`SELECT current_setting('server_version') AS v, (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pv`;
      await dump;

      return {
        name,
        createdAt: new Date().toISOString(),
        rows,
        perModel: Object.fromEntries(perModelRows.map((r) => [r.model_id, r.n])),
        dumpBytes: fs.statSync(dumpFile).size,
        dumpSha256: await sha256File(dumpFile),
        keysSha256: await sha256File(keysFile),
        serverVersion: String(ver!["v"]),
        pgvectorVersion: String(ver!["pv"]),
      };
    });
  } finally {
    await admin.end();
  }
  fs.writeFileSync(path.join(partial, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  // Only a complete backup gets a backup name; a crash leaves a .partial behind.
  fs.renameSync(partial, path.join(dir, name));
  log(`backup ${name}: ${manifest.rows} vectors, ${(manifest.dumpBytes / 1e9).toFixed(2)} GB`);
  return name;
}

/** Check the newest backup on its own and against its predecessor. Returns the problems found. */
async function verify(): Promise<string[]> {
  const dir = requireBackupDir();
  const names = listBackups(dir);
  const newest = names.at(-1);
  if (!newest) return ["no backups found"];
  const problems: string[] = [];
  const m = readManifest(dir, newest);
  const dumpFile = path.join(dir, newest, "vector_cache.dump");
  const keysFile = path.join(dir, newest, "keys.txt.gz");

  if ((await sha256File(dumpFile)) !== m.dumpSha256) problems.push(`${newest}: dump checksum does not match its manifest`);
  if ((await sha256File(keysFile)) !== m.keysSha256) problems.push(`${newest}: key list checksum does not match its manifest`);
  const toc = await run(["docker", "exec", "-i", CONTAINER, "pg_restore", "--list"], { inFile: dumpFile }).catch((e: Error) => {
    problems.push(`${newest}: pg_restore cannot read the dump (${e.message})`);
    return "";
  });
  if (toc && !/TABLE DATA claimnet vector_cache/.test(toc)) problems.push(`${newest}: dump has no vector_cache table data`);

  const previous = names.at(-2);
  if (previous) {
    const cmp = await compareKeyStreams(keyLines(path.join(dir, previous, "keys.txt.gz")), keyLines(keysFile));
    if (cmp.newerCount !== m.rows) problems.push(`${newest}: key list has ${cmp.newerCount} keys, manifest says ${m.rows}`);
    if (cmp.missingCount > 0) {
      problems.push(`${newest}: lost ${cmp.missingCount} keys that ${previous} has (e.g. ${cmp.missingSample[0]})`);
    }
    log(`verify ${newest}: ${cmp.newerCount} keys, ${cmp.newerCount - cmp.olderCount} more than ${previous}, ${cmp.missingCount} missing`);
  } else {
    log(`verify ${newest}: first backup, nothing to compare against`);
  }
  for (const p of problems) log(`verify: PROBLEM ${p}`);
  if (!problems.length) log(`verify ${newest}: ok`);
  return problems;
}

async function prune(keep: number): Promise<void> {
  const dir = requireBackupDir();
  const problems = await verify();
  if (problems.length) {
    log("prune: newest backup failed verification, deleting nothing");
    process.exitCode = 1;
    return;
  }
  for (const name of selectPrunable(listBackups(dir), keep)) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    log(`prune: deleted ${name}`);
  }
  for (const stale of fs.readdirSync(dir).filter((n) => n.endsWith(".partial"))) {
    log(`prune: incomplete backup left from an interrupted run: ${stale} (not deleted)`);
  }
}

/** Restore the newest backup into a scratch database and compare it with its key list and the live cache. */
async function restoreTest(): Promise<void> {
  const dir = requireBackupDir();
  const newest = listBackups(dir).at(-1);
  if (!newest) throw new Error("no backups found");
  const scratch = "vector_cache_restore_test";
  const psql = (sqlText: string) => run(["docker", "exec", CONTAINER, "psql", "-U", "cache_admin", "-d", "postgres", "-c", sqlText]);

  await psql(`DROP DATABASE IF EXISTS ${scratch}`);
  await psql(`CREATE DATABASE ${scratch}`);
  const scratchUrl = new URL(ADMIN_URL);
  scratchUrl.pathname = `/${scratch}`;
  const restored = postgres(scratchUrl.toString(), { max: 1, onnotice: () => {} });
  const live = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    // A single-table dump carries neither the schema nor the extension, and
    // its grant names a role a fresh server may not have: set up the first
    // two and skip privileges, as a real restore onto a new server would.
    await restored.unsafe("CREATE EXTENSION IF NOT EXISTS vector; CREATE SCHEMA IF NOT EXISTS claimnet;");
    await run(["docker", "exec", "-i", CONTAINER, "pg_restore", "-U", "cache_admin", "-d", scratch,
      "--no-owner", "--no-privileges", "--exit-on-error"], {
      inFile: path.join(dir, newest, "vector_cache.dump"),
    });

    async function* restoredKeys(): AsyncGenerator<string> {
      for await (const batch of restored.unsafe(
        `SELECT content_hash, model_id, task_type FROM claimnet.vector_cache ORDER BY ${KEY_ORDER}`,
      ).cursor(20_000)) {
        for (const r of batch as unknown as CacheKey[]) yield keyOf(r);
      }
    }
    const listed = path.join(dir, newest, "keys.txt.gz");
    const a = await compareKeyStreams(keyLines(listed), restoredKeys());
    const b = await compareKeyStreams(restoredKeys(), keyLines(listed));
    if (a.missingCount || b.missingCount) {
      throw new Error(`restore-test ${newest}: restored rows and key list differ (${a.missingCount} missing, ${b.missingCount} extra)`);
    }

    // Full precision: a sample of restored vectors must match the live cache exactly.
    const sample = await restored<Array<CacheKey & { vector: string }>>`
      SELECT content_hash, model_id, task_type, vector::text AS vector FROM claimnet.vector_cache ORDER BY random() LIMIT 200
    `;
    for (const r of sample) {
      const [l] = await live<Array<{ vector: string }>>`
        SELECT vector::text AS vector FROM claimnet.vector_cache
        WHERE content_hash = ${r.content_hash} AND model_id = ${r.model_id} AND task_type = ${r.task_type}
      `;
      if (l && l.vector !== r.vector) throw new Error(`restore-test ${newest}: vector differs from the live cache for ${keyOf(r)}`);
    }
    log(`restore-test ${newest}: ${a.olderCount} rows restored, key list matches exactly, ${sample.length} sampled vectors identical to the live cache`);
  } finally {
    await restored.end();
    await live.end();
    await psql(`DROP DATABASE IF EXISTS ${scratch}`);
  }
}

// ── status / nightly ─────────────────────────────────────────────────────────

async function status(): Promise<void> {
  const w = postgres(WRITER_URL, { max: 1, onnotice: () => {} });
  try {
    const perModel = await w<Array<{ model_id: string; n: number }>>`
      SELECT model_id, count(*)::int AS n FROM claimnet.vector_cache GROUP BY 1 ORDER BY 2 DESC
    `;
    const [size] = await w`SELECT pg_size_pretty(pg_total_relation_size('claimnet.vector_cache')) AS s`;
    log(`cache ${redactUrl(WRITER_URL)}: ${perModel.reduce((n, r) => n + r.n, 0)} vectors, ${size!["s"]}`);
    for (const r of perModel) log(`  ${r.model_id}: ${r.n}`);
  } finally {
    await w.end();
  }
  await checkWriterPermissions();
  if (BACKUP_DIR && fs.existsSync(BACKUP_DIR)) {
    const names = listBackups(BACKUP_DIR);
    log(`backups in ${BACKUP_DIR}: ${names.length ? names.join(", ") : "none"}`);
  }
}

async function nightly(): Promise<void> {
  let failed = false;
  for (const src of harvestSources()) {
    try {
      await harvest(src);
    } catch (e) {
      failed = true;
      log(`harvest ${redactUrl(src)} FAILED: ${(e as Error).message}`);
    }
  }
  const dir = requireBackupDir();
  const every = Number(arg("--backup-every-days") ?? 7);
  const newest = listBackups(dir).at(-1);
  const ageDays = newest ? (Date.now() - Date.parse(readManifest(dir, newest).createdAt)) / 86_400_000 : Infinity;
  if (ageDays >= every) await backup();
  else log(`backup: newest is ${ageDays.toFixed(1)} days old, next after ${every}`);
  await prune(Number(arg("--keep") ?? 3));
  if (failed) process.exitCode = 1;
}

// ── main ─────────────────────────────────────────────────────────────────────

const commands: Record<string, () => Promise<unknown>> = {
  setup,
  status,
  harvest: async () => {
    for (const src of harvestSources()) await harvest(src);
  },
  backup,
  verify: async () => {
    if ((await verify()).length) process.exitCode = 1;
  },
  prune: () => prune(Number(arg("--keep") ?? 3)),
  "restore-test": restoreTest,
  nightly,
};

const command = process.argv[2] ?? "";
const fn = commands[command];
if (!fn) {
  console.error(`usage: npx tsx scripts/embedding-cache.mts <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}
fn().catch((e: Error) => {
  log(`${command} FAILED: ${e.message}`);
  process.exit(1);
});
