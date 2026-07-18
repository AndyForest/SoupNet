#!/usr/bin/env node

/**
 * One-command golden-set ranking eval (Layer B of the offline regression
 * harness — docs/planning/check-recipe-ranking-system.md §3b, workflow in
 * docs/workflows/ranking-tuning.md).
 *
 *   1. Boot a throwaway postgres via docker-compose.ci.yml conventions
 *      (own compose project `soupnet-rankeval-<port>`, host port
 *      RANKEVAL_PGPORT, default 5564 — clear of dev 5633 and test:ci 5534).
 *   2. Build the internal packages the runner imports.
 *   3. Run apps/backend/src/eval/ranking-eval.ts via tsx with
 *      EMBEDDINGS_PROVIDER=local (bge-small ONNX, keyless — stub embeddings
 *      cannot verify semantic ranking). Migrations are applied by the runner
 *      itself through the same drizzle migrator the backend uses at startup.
 *   4. Tear the stack down (RANKEVAL_KEEP=1 keeps it up — repeat runs against
 *      the kept stack re-embed nothing, vector_cache is content-hash keyed).
 *
 * Usage:
 *   npm run eval:ranking
 *   npm run eval:ranking -- --dataset eval/golden/<name>
 *   RANKEVAL_PGPORT=5574 npm run eval:ranking     # parallel eval stacks
 *   RANKEVAL_SKIP_BUILD=1 npm run eval:ranking    # packages already built
 *
 * Exit code: the runner's — non-zero on any thresholds.json breach.
 */

import { execSync, spawnSync } from "node:child_process";

function parsePort(name, raw, fallback) {
  const port = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be a port number in 1024-65535, got "${raw ?? port}"`);
  }
  return port;
}

const PG_PORT = parsePort("RANKEVAL_PGPORT", process.env.RANKEVAL_PGPORT, 5564);
const COMPOSE_PROJECT = `soupnet-rankeval-${PG_PORT}`;
// Reuses docker-compose.ci.yml — its host port interpolates from TESTCI_PGPORT,
// so the eval stack passes its own port through that variable while the
// distinct project name keeps containers/networks/teardown separate from any
// concurrently running test:ci gate.
const COMPOSE = `docker compose -p ${COMPOSE_PROJECT} -f docker-compose.ci.yml`;
const COMPOSE_ENV = { ...process.env, TESTCI_PGPORT: String(PG_PORT) };

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function main() {
  const extraArgs = process.argv.slice(2);
  let code = 1;

  try {
    console.log(`\n=== Starting rankeval postgres (project ${COMPOSE_PROJECT}, port ${PG_PORT}) ===`);
    run(`${COMPOSE} up -d --wait`, { env: COMPOSE_ENV });

    if (process.env.RANKEVAL_SKIP_BUILD !== "1") {
      console.log("\n=== Building internal packages ===");
      run("npm run build:packages");
    }

    console.log("\n=== Running ranking eval (EMBEDDINGS_PROVIDER=local) ===");
    const env = {
      ...process.env,
      PGHOST: "localhost",
      PGPORT: String(PG_PORT),
      PGUSER: "claimnet",
      PGPASSWORD: "claimnet",
      PGDATABASE: "claimnet",
      EMBEDDINGS_PROVIDER: "local",
      JWT_SECRET: process.env.JWT_SECRET
        ?? "rankeval-offline-secret-0000000000000000000000000000000000",
    };
    // db.ts prefers DATABASE_URL over the PG* set — a host .env leaking one
    // in would silently point the eval (which WRITES eval users + corpora)
    // at the wrong database. The throwaway stack is the only valid target.
    delete env.DATABASE_URL;

    const result = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", "apps/backend/src/eval/ranking-eval.ts", ...extraArgs],
      { stdio: "inherit", env, shell: process.platform === "win32" },
    );
    code = result.status ?? 1;
  } catch (err) {
    console.error("\n=== ranking eval FAILED ===", err.message ?? err);
    code = 1;
  } finally {
    if (process.env.RANKEVAL_KEEP === "1") {
      console.log(`\n=== RANKEVAL_KEEP=1 — leaving ${COMPOSE_PROJECT} up (port ${PG_PORT}) ===`);
    } else {
      console.log("\n=== Cleaning up ===");
      try {
        run(`${COMPOSE} down -v`, { env: COMPOSE_ENV });
      } catch { /* ignore cleanup errors */ }
    }
  }
  process.exit(code);
}

main();
