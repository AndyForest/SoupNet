#!/usr/bin/env node

/**
 * Drift check for docs/architecture/data-model-generated.md.
 *
 * Regenerates the data-model reference into a temp file (WITHOUT touching the
 * committed copy) and diffs the two. Exits non-zero if they differ, or if the
 * generator itself fails loudly (e.g. an uncategorized table — see the
 * tableGroups coverage guard in generate-data-model-docs.ts).
 *
 * This is what makes the generated doc hard to skip: if a schema change lands
 * without regenerating the doc, this check fails in CI (and in
 * `npm run test:ci` via scripts/test-ci-local.mjs).
 *
 * The generator is deterministic — its output depends only on the latest
 * Drizzle migration snapshot, not on wall-clock time — so a mismatch here
 * always means "the committed doc is stale; run `npm run generate:data-model`".
 *
 * Usage:
 *   npm run check:data-model
 *   node scripts/check-data-model-docs.mjs
 */

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const committedPath = join(
  projectRoot,
  "docs",
  "architecture",
  "data-model-generated.md"
);

const tmpDir = mkdtempSync(join(tmpdir(), "data-model-drift-"));
const tmpOut = join(tmpDir, "data-model-generated.md");

try {
  // Regenerate to a temp path via the generator's DATA_MODEL_OUT env override
  // so the committed file is never mutated by this check. Invoked exactly like
  // `npm run generate:data-model` (npx tsx) so it works cross-platform without
  // tsx being a root devDependency.
  try {
    execSync("npx tsx scripts/generate-data-model-docs.ts", {
      cwd: projectRoot,
      env: { ...process.env, DATA_MODEL_OUT: tmpOut },
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch {
    console.error(
      "\nERROR: data-model doc generation failed (see message above).\n" +
        "Fix the generator input before committing.\n"
    );
    process.exit(1);
  }

  // Compare newline-insensitively: on Windows checkouts git materializes the
  // committed doc with CRLF (autocrlf) while the generator writes LF, so a
  // byte comparison fails on every line of a freshly cloned, perfectly
  // up-to-date doc. Content is what the check is for; line endings are git's.
  const normalize = (s) => s.replace(/\r\n/g, "\n");
  const fresh = normalize(readFileSync(tmpOut, "utf-8"));
  let committed;
  try {
    committed = normalize(readFileSync(committedPath, "utf-8"));
  } catch {
    committed = null;
  }

  if (committed === fresh) {
    console.log("data-model doc is up to date.");
    process.exit(0);
  }

  console.error(
    "\nERROR: docs/architecture/data-model-generated.md is out of date.\n" +
      "The schema changed but the generated doc was not regenerated.\n\n" +
      "Fix: run `npm run generate:data-model` and commit the result.\n"
  );

  // Show a short unified diff to make the drift obvious. Best-effort: skip
  // silently if `diff` isn't on PATH (the mismatch above is the real signal).
  try {
    execFileSync("diff", ["-u", committedPath, tmpOut], { stdio: "inherit" });
  } catch {
    /* `diff` returns non-zero when files differ (expected) or is absent */
  }

  process.exit(1);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
