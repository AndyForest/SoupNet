#!/usr/bin/env node

/**
 * Guard for the authorization seam (docs/engineering-principles.md §7).
 *
 * Two tables decide who may touch which recipe book, and the SQL that reads
 * them to make that decision lives in apps/backend/src/authz/:
 *
 *   1. MEMBERSHIP — `claimnet.group_members`. Recipe-book membership and role
 *      checks for human (JWT-path) callers. Any other source file that refers
 *      to the membership table — the SQL name `group_members` or the Drizzle
 *      export `groupMembers` — has to be registered below.
 *
 *   2. API KEYS — `claimnet.api_keys`. A statement that AUTHORIZES a request on
 *      a key (is this credential good, what may it touch, may it mint another)
 *      lives only in the module. Outside it, the table may appear only in
 *      NON-AUTHORIZING statements: minting a key, listing or revoking a user's
 *      own keys, display joins, admin counts, the rate limiter's counting
 *      lookup, cascade deletion, and the reaper. Each such file is registered
 *      below with the reason it qualifies.
 *
 * HOW A FILE IS REGISTERED. Each entry records `n`, the number of lines in the
 * file that mention the table, and `fp`, a fingerprint of exactly those lines
 * (whitespace-normalized, in order). The check fails when:
 *
 *   - a file mentions the table and is not registered;
 *   - a registered file's fingerprint no longer matches — ANY edit to a
 *     matching line, an added one, or a removed one. A bare count would let an
 *     allowlisted file swap one gate for a different one with no net change;
 *     the fingerprint makes every edit to un-migrated access SQL show up in
 *     the PR as a change to this file, where a reviewer can look at it;
 *   - a registered file no longer mentions the table at all (a stale entry is
 *     headroom for a gate to creep back, so delete it in the same change).
 *
 * To update after an intended change, run `--counts` and paste the printed
 * entry over the old one. For NOT_YET_MIGRATED the number should only ever go
 * down: new access logic belongs in the module.
 *
 * The three lists mean different things. NOT_YET_MIGRATED is debt — every
 * entry is a hand-written membership gate waiting to move into the module.
 * MEMBERSHIP_MENTIONS and NON_AUTHORIZING_KEY_SQL are permanent registers:
 * those lines belong where they are, each with a one-line reason, and a new
 * line in one of those files has to answer "does this one authorize?".
 *
 * WHAT IS SCANNED. Every workspace's source plus the repo scripts —
 * apps/<app>/src, packages/<package>/src, and scripts/ — because SQL can be written in
 * any of them. Matching is case-insensitive: Postgres folds unquoted
 * identifiers, so `claimnet.GROUP_MEMBERS` is the same table. The check is
 * textual on purpose (comments included), so it stays static — no DB, no
 * build — deterministic, and independent of line endings. EXEMPT, below, lists
 * the places where naming the tables is the file's job.
 *
 * Usage:
 *   npm run check:authz-seam
 *   node scripts/check-authz-seam.mjs --counts   # print current entries, ready to paste
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const SEAM_DIR = "apps/backend/src/authz";
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/**
 * Places that are not checked, each because naming the tables is what the file
 * is for. Prefixes are repo-relative; a trailing slash means a directory.
 * (Generated SQL in packages/db/migrations/ is outside every scan root.)
 */
const EXEMPT = [
  { prefix: `${SEAM_DIR}/`, why: "the seam itself" },
  { prefix: "packages/db/src/schema/", why: "the Drizzle table definitions" },
  { prefix: "scripts/generate-data-model-docs.ts", why: "groups tables by name for the generated data-model doc" },
  { prefix: "scripts/check-authz-seam.mjs", why: "this script" },
  { prefix: "scripts/test-ci-local.mjs", why: "a comment describing this check" },
];
/** Test files seed fixtures directly. */
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * Hand-written membership gates that predate the seam. Migrate a file to the
 * authz module, then paste its new (lower) entry here, or delete the entry
 * when nothing is left. Never add to a file on this list: new access logic
 * belongs in apps/backend/src/authz/.
 */
const NOT_YET_MIGRATED = {
  "apps/backend/src/auth.ts": { n: 2, fp: "63ff09a602b9" },
  "apps/backend/src/routes/admin.ts": { n: 1, fp: "3d166cf17c25" },
  "apps/backend/src/routes/auth.ts": { n: 4, fp: "ffe3569201fd" },
  "apps/backend/src/routes/invitations.ts": { n: 2, fp: "21fcda0422e1" },
  "apps/backend/src/routes/keys.ts": { n: 3, fp: "371eb1888237" },
  "apps/backend/src/routes/oauth.ts": { n: 1, fp: "e91793fdea66" },
  "apps/backend/src/services/ephemeral-workspace.service.ts": { n: 2, fp: "ec8a87664ebd" },
  "apps/backend/src/services/import-validate.ts": { n: 2, fp: "9084d6cf9b8a" },
  "apps/backend/src/services/import.service.ts": { n: 3, fp: "8cdf3b7ffa2a" },
};

/**
 * Files that mention the membership table without gating anything on it.
 * Permanent, each with its reason.
 */
const MEMBERSHIP_MENTIONS = {
  "packages/contracts/src/groups.ts": { n: 1, fp: "455fd5eff999", why: "a doc comment on the legacy contract" },
  "packages/domain/src/trace-move.ts": { n: 3, fp: "a479b69c8a35", why: "doc comments on the pure role allowlist; no I/O in this package" },
};

/**
 * Files outside the seam that touch `claimnet.api_keys` WITHOUT authorizing
 * anything on it. Adding a file or changing an entry is a claim that the
 * statement does not decide whether a request may proceed or what it may
 * touch — state that claim in `why`. If it does decide that, it belongs in
 * apps/backend/src/authz/key-auth.ts.
 */
const NON_AUTHORIZING_KEY_SQL = {
  "apps/backend/src/middleware/rate-limit.ts": {
    n: 1, fp: "c7800dc4d177",
    why: "counting only: maps a credential to the id its usage is counted under; the id never reaches a handler",
  },
  "apps/backend/src/routes/admin.ts": {
    n: 4, fp: "084c26a0f9ba",
    why: "admin user list and stats: counts and existence flags for display, behind requireSystem",
  },
  "apps/backend/src/routes/auth.ts": {
    n: 1, fp: "82e00470187d",
    why: "data export: lists the signed-in user's own keys (no secrets)",
  },
  "apps/backend/src/routes/traces.ts": {
    n: 3, fp: "a2cf40a2b65d",
    why: "display joins: a recipe's key label and type for the JWT-authed recipe views",
  },
  "apps/backend/src/services/api-key.service.ts": {
    n: 5, fp: "da71e276cd8d",
    why: "minting, listing, and revoking a user's own keys, behind JWT auth",
  },
  "apps/backend/src/services/ephemeral-workspace.service.ts": {
    n: 1, fp: "de2edf423d7d",
    why: "the reaper: removes a deleted book's id from every key's grants",
  },
  "apps/backend/src/services/oauth.service.ts": {
    n: 4, fp: "9b7b439ecd7d",
    why: "minting an OAuth bundle (INSERT) and purging long-dead rows; consuming a refresh token is in the module",
  },
  "apps/backend/src/services/user-delete.service.ts": {
    n: 4, fp: "b66060457b2d",
    why: "account-deletion cascade: deletes the user's own keys and what hangs off them, and removes the deleted books' ids from other users' key grants",
  },
};

const RULES = [
  {
    table: "the membership table (group_members / groupMembers)",
    pattern: /group_members|groupMembers/i,
    lists: { NOT_YET_MIGRATED, MEMBERSHIP_MENTIONS },
    failure: [
      "recipe-book membership is being read or written outside apps/backend/src/authz/.",
      "",
      "Book-access and role checks go through the authz module, so the rules stay in one reviewable",
      "place and a forgotten check fails closed. Import what you need from it — roleIn, isMember,",
      "booksFor, bookIdsFor, canReadTrace, isOwner, isOwnerOrAdmin, and the membership writes — or",
      "add a function there (with a test) if the question you are asking is new.",
    ],
    newFileHint: "move the query into apps/backend/src/authz/ and call it from here.",
  },
  {
    table: "claimnet.api_keys",
    pattern: /claimnet\s*\.\s*"?api_keys/i,
    lists: { NON_AUTHORIZING_KEY_SQL },
    failure: [
      "SQL against claimnet.api_keys has appeared outside apps/backend/src/authz/.",
      "",
      "A presented API key is judged in exactly one place — authenticateKey in authz/key-auth.ts —",
      "which returns a Principal carrying the key's EFFECTIVE scope. Handlers and services take a",
      "Principal; they do not look a key up, re-check its owner, or read its stored grant arrays.",
      "If your statement decides whether a request may proceed or what it may touch, it belongs in",
      "the module (with a test). If it genuinely does not authorize anything — minting, listing,",
      "revoking, counting, deleting — register it in NON_AUTHORIZING_KEY_SQL with a one-line reason.",
    ],
    newFileHint: "use the Principal you were given, or move the statement into apps/backend/src/authz/key-auth.ts.",
  },
];

// ── Scan ────────────────────────────────────────────────────────────────────

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

/** apps/<app>/src, packages/<package>/src, and scripts/ — wherever SQL could be written. */
function scanRoots() {
  const roots = [];
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(join(projectRoot, parent), { withFileTypes: true })) {
      const src = `${parent}/${entry.name}/src`;
      if (entry.isDirectory() && existsSync(join(projectRoot, src))) roots.push(src);
    }
  }
  roots.push("scripts");
  return roots;
}

const isExempt = (file) =>
  TEST_FILE.test(file) || EXEMPT.some(({ prefix }) => (prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix));

const sources = scanRoots()
  .flatMap(walk)
  .sort()
  .filter((file) => SOURCE_FILE.test(file) && !isExempt(file))
  .map((file) => ({ file, lines: readFileSync(join(projectRoot, file), "utf-8").split(/\r?\n/) }));

/** For each file with at least one matching line: how many, and their fingerprint. */
function measure(pattern) {
  const found = new Map();
  for (const { file, lines } of sources) {
    const matching = lines.filter((line) => pattern.test(line)).map((line) => line.trim().replace(/\s+/g, " "));
    if (matching.length === 0) continue;
    const fp = createHash("sha256").update(matching.join("\n")).digest("hex").slice(0, 12);
    found.set(file, { n: matching.length, fp });
  }
  return found;
}

if (process.argv.includes("--counts")) {
  for (const rule of RULES) {
    const found = measure(rule.pattern);
    const registered = Object.assign({}, ...Object.values(rule.lists));
    for (const listName of Object.keys(rule.lists)) {
      console.log(`\n${listName}:`);
      for (const file of Object.keys(rule.lists[listName])) {
        const now = found.get(file);
        if (now) console.log(`  "${file}": { n: ${now.n}, fp: "${now.fp}" },`);
        else console.log(`  "${file}": (no longer mentions ${rule.table} — delete the entry)`);
      }
    }
    const unregistered = [...found].filter(([file]) => !(file in registered));
    if (unregistered.length > 0) {
      console.log(`\nnot registered (${rule.table}):`);
      for (const [file, now] of unregistered) console.log(`  "${file}": { n: ${now.n}, fp: "${now.fp}" },`);
    }
  }
  process.exit(0);
}

// ── Check ───────────────────────────────────────────────────────────────────

const thisScript = relative(projectRoot, fileURLToPath(import.meta.url)).split(sep).join("/");
let failed = false;

for (const rule of RULES) {
  const found = measure(rule.pattern);
  const newFiles = [];
  const changed = [];
  const stale = [];

  const registered = new Map();
  for (const [listName, list] of Object.entries(rule.lists)) {
    for (const [file, entry] of Object.entries(list)) registered.set(file, { ...entry, listName });
  }

  for (const [file, now] of found) {
    const entry = registered.get(file);
    if (!entry) newFiles.push({ file, now });
    else if (entry.fp !== now.fp) changed.push({ file, now, entry });
  }
  for (const [file, entry] of registered) {
    if (!found.has(file)) stale.push({ file, entry });
  }

  if (newFiles.length > 0) {
    failed = true;
    console.error(
      `\n${[
        `authz seam check FAILED: ${rule.failure[0]}`,
        ...rule.failure.slice(1),
        "See docs/engineering-principles.md §7.",
        "",
        `  New references to ${rule.table} (file is not registered):`,
        ...newFiles.map(({ file, now }) => `    ${file}  (${now.n} line${now.n === 1 ? "" : "s"})`),
        `    → ${rule.newFileHint}`,
      ].join("\n")}\n`,
    );
  }

  if (changed.length > 0) {
    failed = true;
    console.error(
      `\n${[
        `authz seam check FAILED: lines that mention ${rule.table} changed in a registered file.`,
        "",
        "That may be exactly what you meant to do. The check stops here so the change is visible in",
        "review: look at the lines, and if they still belong outside the module, paste the new entry",
        `into ${thisScript} in the same change (node ${thisScript} --counts prints it).`,
        "A membership gate or a statement that authorizes on an API key belongs in",
        "apps/backend/src/authz/ instead — see docs/engineering-principles.md §7.",
        "",
        ...changed.map(
          ({ file, now, entry }) =>
            `  ${file}  [${entry.listName}]  lines ${entry.n} → ${now.n}\n    new entry:  { n: ${now.n}, fp: "${now.fp}" }`,
        ),
      ].join("\n")}\n`,
    );
  }

  if (stale.length > 0) {
    // A stale entry is headroom: a reference could come back without this
    // check noticing a NEW file. Deleting it in the same change locks the gain
    // in, the same way check:data-model fails on a stale tableGroups entry.
    failed = true;
    console.error(
      `\n${[
        `authz seam check FAILED: these registered files no longer mention ${rule.table}, which is good.`,
        `Lock the gain in the same change by deleting their entries in ${thisScript}:`,
        "",
        ...stale.map(({ file, entry }) => `  ${file}  [${entry.listName}]`),
      ].join("\n")}\n`,
    );
  }
}

if (failed) process.exit(1);

console.log(
  `authz seam holds: outside ${SEAM_DIR}/, the membership table is referenced only by the ` +
    `${Object.keys(NOT_YET_MIGRATED).length} not-yet-migrated files (+${Object.keys(MEMBERSHIP_MENTIONS).length} registered mentions), ` +
    `and claimnet.api_keys only by the ${Object.keys(NON_AUTHORIZING_KEY_SQL).length} registered non-authorizing files — ` +
    "every matching line fingerprinted.",
);
