#!/usr/bin/env node

/**
 * Guard for the authorization seam (docs/engineering-principles.md §7).
 *
 * Recipe-book membership and role checks for human (JWT-path) callers live in
 * apps/backend/src/authz/. This check fails when any other non-test source
 * file under apps/backend/src refers to the membership table — the SQL name
 * `group_members` or the Drizzle export `groupMembers` — so a new hand-written
 * gate cannot land unnoticed. It is what keeps the seam from eroding.
 *
 * Files that predate the seam and have not been migrated yet are recorded in
 * NOT_YET_MIGRATED below with their current reference count. The list is a
 * ratchet, and only turns one way:
 *
 *   - a file that is not on the list        → FAIL
 *   - a listed file whose count went UP     → FAIL
 *   - a listed file whose count went DOWN   → FAIL until you lower the number
 *     (or delete the entry at zero) in the same change, so a stale entry never
 *     leaves headroom for references to creep back
 *
 * A "reference" is any occurrence of either name, comments included: the check
 * is textual on purpose, so it stays static (no DB, no build), deterministic,
 * and independent of line endings. Test files (*.test.ts) are exempt — they
 * seed fixtures directly.
 *
 * Usage:
 *   npm run check:authz-seam
 *   node scripts/check-authz-seam.mjs --counts   # print current counts as an allowlist
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const SCAN_ROOT = "apps/backend/src";
const SEAM_DIR = "apps/backend/src/authz";
const REFERENCE = /group_members|groupMembers/g;
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * Files outside the seam that still touch the membership table, with the
 * number of references each holds today. Migrate a file to the authz module,
 * then lower its number here (delete the entry at zero). Never raise one:
 * new access logic belongs in apps/backend/src/authz/.
 */
const NOT_YET_MIGRATED = {
  "apps/backend/src/auth.ts": 2,
  "apps/backend/src/routes/admin.ts": 1,
  "apps/backend/src/routes/auth.ts": 4,
  "apps/backend/src/routes/invitations.ts": 2,
  "apps/backend/src/routes/keys.ts": 3,
  "apps/backend/src/routes/mcp.ts": 1,
  "apps/backend/src/routes/oauth.ts": 1,
  "apps/backend/src/services/briefing.ts": 1,
  "apps/backend/src/services/ephemeral-workspace.service.ts": 2,
  "apps/backend/src/services/import-validate.ts": 2,
  "apps/backend/src/services/import.service.ts": 4,
  "apps/backend/src/services/user-delete.service.ts": 3,
};

/** Repo-relative, forward-slash paths of every file under `dir`. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(projectRoot, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function countReferences() {
  const counts = new Map();
  for (const file of walk(SCAN_ROOT).sort()) {
    if (!SOURCE_FILE.test(file) || TEST_FILE.test(file)) continue;
    if (file.startsWith(`${SEAM_DIR}/`)) continue;
    const n = (readFileSync(join(projectRoot, file), "utf-8").match(REFERENCE) ?? []).length;
    if (n > 0) counts.set(file, n);
  }
  return counts;
}

const counts = countReferences();

if (process.argv.includes("--counts")) {
  for (const [file, n] of counts) console.log(`  "${file}": ${n},`);
  process.exit(0);
}

const newFiles = [];
const grown = [];
const shrunk = [];

for (const [file, n] of counts) {
  const allowed = NOT_YET_MIGRATED[file];
  if (allowed === undefined) newFiles.push({ file, n });
  else if (n > allowed) grown.push({ file, n, allowed });
  else if (n < allowed) shrunk.push({ file, n, allowed });
}
for (const [file, allowed] of Object.entries(NOT_YET_MIGRATED)) {
  if (!counts.has(file)) shrunk.push({ file, n: 0, allowed });
}

const thisScript = relative(projectRoot, fileURLToPath(import.meta.url)).split(sep).join("/");

if (shrunk.length > 0) {
  // A stale entry is headroom: references could be added back up to the old
  // number without this check noticing. So a lowered count fails until the
  // allowlist is lowered with it, the same way check:data-model fails on a
  // stale tableGroups entry.
  const lines = [
    "authz seam check FAILED: the allowlist is stale. These files reference the membership table",
    "less than the allowlist records, which is good. Lock the gain in the same change by editing",
    `NOT_YET_MIGRATED in ${thisScript}:`,
    "",
    ...shrunk.map(({ file, n, allowed }) =>
      n === 0
        ? `  ${file}: ${allowed} → 0   (delete the entry)`
        : `  ${file}: ${allowed} → ${n}`,
    ),
  ];
  console.error(`\n${lines.join("\n")}\n`);
  if (newFiles.length === 0 && grown.length === 0) process.exit(1);
}

if (newFiles.length > 0 || grown.length > 0) {
  const lines = [
    "authz seam check FAILED: recipe-book membership is being read or written outside apps/backend/src/authz/.",
    "",
    "Book-access and role checks go through the authz module, so the rules stay in one reviewable",
    "place and a forgotten check fails closed. Import what you need from it — roleIn, isMember,",
    "booksFor, bookIdsFor, canReadTrace, isOwner, isOwnerOrAdmin, and the membership writes — or",
    "add a function there (with a test) if the question you are asking is new.",
    "See docs/engineering-principles.md §7.",
  ];
  if (newFiles.length > 0) {
    lines.push(
      "",
      "  New references to group_members / groupMembers (file is not on the allowlist):",
      ...newFiles.map(({ file, n }) => `    ${file}  (${n})`),
      "    → move the query into apps/backend/src/authz/ and call it from here.",
    );
  }
  if (grown.length > 0) {
    lines.push(
      "",
      "  More references than the allowlist records (these files are waiting to be migrated, not extended):",
      ...grown.map(({ file, n, allowed }) => `    ${file}  (${allowed} → ${n})`),
      "    → put the new query in apps/backend/src/authz/ instead. Do not raise the number in",
      `      ${thisScript} — it only ratchets down.`,
    );
  }
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

console.log(
  `authz seam holds: no membership-table references outside ${SEAM_DIR}/ ` +
    `beyond the ${Object.keys(NOT_YET_MIGRATED).length} not-yet-migrated files.`,
);
