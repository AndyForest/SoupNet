import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _db: PostgresJsDatabase | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): PostgresJsDatabase {
  if (!_db) {
    _sql = createConnection();
    _db = drizzle(_sql);
  }
  return _db;
}

/**
 * Create a postgres-js connection.
 *
 * Two configuration paths (checked in order):
 *
 * 1. **DATABASE_URL** — legacy single-string format. Supported for backwards
 *    compatibility with one-off scripts.
 *
 * 2. **PG\* env vars** — canonical path for all environments. `.env` (local),
 *    CI, and ECS (production) all set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
 *    In ECS, PGPASSWORD comes from the auto-rotating RDS master user secret.
 *    `PGSSLMODE=require` is set in production for encrypted connections.
 *
 * If neither is configured we throw loudly — fail fast over mystery connections.
 */
/**
 * Resolve the TLS config for Postgres connections (shared by this module and
 * the embedding worker's pg-boss connection).
 *
 * F48 (security-audit-2026-06-11): `PGSSLMODE=require` alone encrypts but
 * does NOT verify the server certificate (both postgres-js "require" and the
 * worker's previous `rejectUnauthorized: false` behave this way), leaving the
 * connection MITM-able inside the VPC. Setting PGSSLROOTCERT to the RDS CA
 * bundle path (libpq's env-var convention) enables full verification — the
 * production task definition sets it to the bundle baked into the image.
 *
 * Without PGSSLROOTCERT we keep the encrypt-only behavior and warn loudly,
 * rather than hard-failing a deploy whose task def hasn't been updated yet.
 */
export function resolvePgSsl():
  | false
  | { rejectUnauthorized: false }
  | { ca: string; rejectUnauthorized: true } {
  if (process.env["PGSSLMODE"] !== "require") return false;
  const caPath = process.env["PGSSLROOTCERT"];
  if (caPath) {
    return { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true };
  }
  console.warn(
    "[db] PGSSLMODE=require without PGSSLROOTCERT — connection is encrypted but the " +
      "server certificate is NOT verified (F48). Set PGSSLROOTCERT to a CA bundle path " +
      "(for RDS: certs/aws-rds-global-bundle.pem) to enable verification.",
  );
  return { rejectUnauthorized: false };
}

function createConnection(): ReturnType<typeof postgres> {
  const url = process.env["DATABASE_URL"];
  if (url) return postgres(url);

  const host = process.env["PGHOST"];
  if (host) {
    const database = required("PGDATABASE");
    const username = required("PGUSER");
    const password = required("PGPASSWORD");
    return postgres({
      host,
      port: Number(process.env["PGPORT"] ?? 5432),
      database,
      username,
      password,
      ssl: resolvePgSsl(),
    });
  }

  throw new Error(
    "Database connection not configured. Set DATABASE_URL (local/CI) or PGHOST + PGUSER + PGPASSWORD + PGDATABASE (AWS ECS).",
  );
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when PGHOST is set`);
  return value;
}

/**
 * Run Drizzle migrations at startup.
 * The migrations folder is at packages/db/migrations/ relative to the project root.
 */
export async function runMigrations(): Promise<void> {
  const db = getDb();
  // Ensure pgvector extension exists
  await _sql!`CREATE EXTENSION IF NOT EXISTS vector`;

  // MIGRATIONS_PATH env var for explicit override.
  // Default: resolve relative to __dirname.
  //   In dev (tsx): __dirname = .../apps/backend/src → ../../packages/db/migrations works
  //   In Docker (dist/): __dirname = /app/apps/backend/dist → need 3 levels up
  const migrationsFolder = process.env["MIGRATIONS_PATH"]
    ?? path.resolve(__dirname, "../../../packages/db/migrations");

  console.log(`[migrate] Running Drizzle migrations from ${migrationsFolder}...`); // eslint-disable-line no-console
  await migrate(db, { migrationsFolder });
  console.log("[migrate] Drizzle migrations complete."); // eslint-disable-line no-console
}
