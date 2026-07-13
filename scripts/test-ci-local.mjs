#!/usr/bin/env node

/**
 * Run tests against a fresh CI-like postgres — no dev data, no Gemini key.
 *
 * Reproduces the exact CI environment locally:
 *   1. Start fresh postgres via docker-compose.ci.yml
 *   2. Build packages + backend
 *   3. Clear tsbuildinfo cache + typecheck (mirrors CI fresh-checkout behavior)
 *   4. Lint
 *   5. Start backend (runs migrations, creates system user)
 *   6. Seed system settings (signup cap)
 *   7. Run vitest
 *   8. Tear down
 *
 * Why the tsbuildinfo clearing: tsc with incremental builds writes
 * tsconfig.tsbuildinfo and skips files it considers unchanged on the next
 * run. CI starts from a clean checkout so it always re-checks, and a type
 * drift that this script's typecheck step would otherwise miss can sneak
 * past local. Clearing before typecheck makes local behavior match CI.
 *
 * Usage:
 *   npm run test:ci
 *   node scripts/test-ci-local.mjs
 *   node scripts/test-ci-local.mjs -- --reporter verbose
 *   TESTCI_PGPORT=5544 npm run test:ci   # parallel gate on its own stack
 *
 * Parallel gates: TESTCI_PGPORT (default 5534) picks the CI postgres host
 * port, and everything else derives from it so one knob keeps the whole
 * stack self-consistent — the compose project name becomes
 * `soupnet-ci-<port>` (containers/networks/teardown stay per-gate, and the
 * container name keeps the `*-postgres-ci-1` suffix that sessions grep in
 * `docker ps` to detect a running gate), and the backend's host port shifts
 * by the same offset from its 3098 base so two gates don't collide there
 * either (override explicitly with TESTCI_BACKEND_PORT if the derived port
 * is taken). Defaults preserve the historical single-gate behavior exactly.
 */

import { execSync, spawn } from "node:child_process";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

function parsePort(name, raw, fallback) {
  const port = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(
      `${name} must be a port number in 1024-65535, got "${raw ?? port}"` +
        (raw === undefined ? " (derived — set the env var explicitly)" : ""),
    );
  }
  return port;
}

// CI postgres defaults to 5534 to avoid colliding with dev on 5633
const PG_PORT = parsePort("TESTCI_PGPORT", process.env.TESTCI_PGPORT, 5534);
const CI_PORT = parsePort(
  "TESTCI_BACKEND_PORT",
  process.env.TESTCI_BACKEND_PORT,
  3098 + (PG_PORT - 5534),
);
const COMPOSE_PROJECT = `soupnet-ci-${PG_PORT}`;
const COMPOSE = `docker compose -p ${COMPOSE_PROJECT} -f docker-compose.ci.yml`;
// Compose interpolates ${TESTCI_PGPORT:-5534} in docker-compose.ci.yml; pass
// the parsed value explicitly so up/down always see what we validated.
const COMPOSE_ENV = { ...process.env, TESTCI_PGPORT: String(PG_PORT) };
const CI_PG = {
  PGHOST: "localhost",
  PGPORT: String(PG_PORT),
  PGUSER: "claimnet",
  PGPASSWORD: "claimnet",
  PGDATABASE: "claimnet",
};
const CI_BACKEND = `http://localhost:${CI_PORT}`;
// Frontend URL used by surfaces that render absolute frontend links (OAuth
// authorization_endpoint metadata, password reset emails, etc.). The frontend
// dev server isn't running during test:ci, but anything that interpolates
// FRONTEND_URL still needs a deterministic value to assert against.
const CI_FRONTEND = "http://localhost:5273";

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function runSilent(cmd) {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

/**
 * Recursively remove all *.tsbuildinfo files under a root, skipping
 * node_modules. Walks the tree manually so the script stays portable
 * across Windows/macOS/Linux (no `find` shell command needed).
 */
function clearTsBuildInfo(root) {
  const removed = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next"]);

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) {
        try {
          unlinkSync(full);
          removed.push(full);
        } catch { /* ignore */ }
      }
    }
  }

  // Sanity check the root exists before walking
  try { statSync(root); } catch { return removed; }
  walk(root);
  return removed;
}

async function waitForHealth(url, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Backend not healthy after ${maxRetries}s`);
}

async function main() {
  const extraArgs = process.argv.slice(2).join(" ");
  let backendProcess;

  try {
    // 1. Start fresh CI postgres
    console.log(`\n=== Starting CI postgres (project ${COMPOSE_PROJECT}, port ${PG_PORT}) ===`);
    run(`${COMPOSE} up -d --wait`, { env: COMPOSE_ENV });

    // 2. Build
    console.log("\n=== Building packages + backend ===");
    run("npm run build:packages");
    run("npm run build -w apps/backend");

    // 3. Typecheck — mirrors CI's separate typecheck step. Clear
    //    tsbuildinfo first so tsc doesn't skip files it thinks are
    //    unchanged; CI starts from a clean checkout, so missing this
    //    let a type drift slip past local on 2026-04-27 (groupName on
    //    Trace) — see feedback_typecheck_buildinfo_trap memory.
    console.log("\n=== Clearing tsbuildinfo cache ===");
    const cleared = clearTsBuildInfo(process.cwd());
    if (cleared.length > 0) {
      console.log(`Removed ${cleared.length} tsbuildinfo file(s).`);
    } else {
      console.log("No tsbuildinfo files found.");
    }

    console.log("\n=== Typecheck ===");
    run("npm run typecheck --workspaces --if-present");

    // 4. Lint — same reason as typecheck: CI fails on lint errors,
    //    test:ci should too.
    console.log("\n=== Lint ===");
    run("npm run lint --workspaces --if-present");

    // 4b. Data-model doc drift — mirrors the "Check data-model doc is up to
    //     date" step in .github/workflows/ci.yml. Fails if the generated
    //     reference is stale vs the latest Drizzle snapshot. Static (no DB).
    console.log("\n=== Data-model doc drift check ===");
    run("npm run check:data-model");

    // 5. Start backend
    console.log("\n=== Starting backend on port", CI_PORT, "===");
    backendProcess = spawn("node", ["apps/backend/dist/index.js"], {
      env: {
        ...process.env,
        ...CI_PG,
        JWT_SECRET: "ci-test-secret-64-char-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        GEMINI_API_KEY: "",
        EMBEDDINGS_PROVIDER: "stub",
        SYNTHESIS_PROVIDER: "stub",
        DEV_USERNAME: "ci@test.local",
        DEV_PASSWORD: "ci-test-password",
        ALLOW_AUTO_SETUP: "true",
        DISABLE_RATE_LIMIT: "true",
        PORT: String(CI_PORT),
        // Align the backend's self-knowledge with the port it listens on, so
        // surfaces that render absolute URLs (briefing, OAuth metadata, etc.)
        // match what tests fetch via BASE = CI_BACKEND.
        BACKEND_URL: CI_BACKEND,
        FRONTEND_URL: CI_FRONTEND,
      },
      stdio: "inherit",
    });

    console.log("Waiting for backend health...");
    await waitForHealth(CI_BACKEND);
    console.log("Backend ready.");

    // 6. Seed system settings
    console.log("\n=== Seeding system settings ===");
    const loginRes = await fetch(`${CI_BACKEND}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ci@test.local", password: "ci-test-password" }),
    });
    const loginBody = await loginRes.json();
    const token = loginBody.data?.token;
    if (!token) throw new Error("Failed to get admin token");

    await fetch(`${CI_BACKEND}/admin/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ signupCap: 1000 }),
    });
    console.log("Signup cap set to 1000.");

    // 7. Run tests
    // Vitest inherits the host `.env` for DEV_USERNAME/DEV_PASSWORD by default,
    // but the CI backend was started with CI-specific credentials — so admin
    // integration tests must see the same `ci@test.local` values here. Keep
    // this list in sync with the backend spawn env above whenever a test adds
    // a new process.env dependency.
    run(`npx vitest run ${extraArgs}`, {
      env: {
        ...process.env,
        ...CI_PG,
        BACKEND_URL: CI_BACKEND,
        FRONTEND_URL: CI_FRONTEND,
        GEMINI_API_KEY: "",
        EMBEDDINGS_PROVIDER: "stub",
        SYNTHESIS_PROVIDER: "stub",
        DISABLE_RATE_LIMIT: "true",
        DEV_USERNAME: "ci@test.local",
        DEV_PASSWORD: "ci-test-password",
      },
    });

    console.log("\n=== CI tests passed! ===");
  } catch (err) {
    console.error("\n=== CI tests FAILED ===");
    process.exitCode = 1;
  } finally {
    // 8. Tear down
    console.log("\n=== Cleaning up ===");
    if (backendProcess) {
      backendProcess.kill();
    }
    try {
      run(`${COMPOSE} down -v`, { env: COMPOSE_ENV });
    } catch { /* ignore cleanup errors */ }
  }
}

main();
