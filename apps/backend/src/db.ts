import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
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
      ssl: process.env["PGSSLMODE"] === "require" ? "require" : false,
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
