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
 */

import { execSync, spawn } from "node:child_process";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const CI_PORT = 3098;
// CI postgres runs on 5534 to avoid colliding with dev on 5533
const CI_PG = {
  PGHOST: "localhost",
  PGPORT: "5534",
  PGUSER: "claimnet",
  PGPASSWORD: "claimnet",
  PGDATABASE: "claimnet",
};
const CI_BACKEND = `http://localhost:${CI_PORT}`;

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
    console.log("\n=== Starting CI postgres (port 5534) ===");
    run("docker compose -f docker-compose.ci.yml up -d --wait");

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

    // 5. Start backend
    console.log("\n=== Starting backend on port", CI_PORT, "===");
    backendProcess = spawn("node", ["apps/backend/dist/index.js"], {
      env: {
        ...process.env,
        ...CI_PG,
        JWT_SECRET: "ci-test-secret-64-char-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        GEMINI_API_KEY: "",
        EMBEDDINGS_PROVIDER: "stub",
        DEV_USERNAME: "ci@test.local",
        DEV_PASSWORD: "ci-test-password",
        ALLOW_AUTO_SETUP: "true",
        DISABLE_RATE_LIMIT: "true",
        PORT: String(CI_PORT),
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
        GEMINI_API_KEY: "",
        EMBEDDINGS_PROVIDER: "stub",
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
      run("docker compose -f docker-compose.ci.yml down -v");
    } catch { /* ignore cleanup errors */ }
  }
}

main();
