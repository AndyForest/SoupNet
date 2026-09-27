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
 *   3. RECIPES — `claimnet.traces`, `claimnet.embedding_sources` (whose
 *      trace rows resolve to recipes), and the tables that carry a recipe's
 *      content or annotations by its id (`trace_evidence`, `trace_references`,
 *      `check_feedback`, `trace_reactions`) — drafts-and-triage slice 2. The draft
 *      visibility condition is written once in the module
 *      (authz/draft-sql.ts). Every file outside it that names either table is
 *      registered in TRACE_READS: either it COMPOSES the module's draft
 *      fragments (the check also requires the file to reference one of them),
 *      or it carries a one-line reason the draft rule does not apply (a
 *      write, a cascade, a by-id helper fed an already-filtered id list, the
 *      caller's own rows, operator-only totals). This register fingerprints
 *      the whole STATEMENT around each mention, not just the line naming the
 *      table: the line after `FROM claimnet.traces t` is where a draft
 *      condition sits, and a line fingerprint would let it be deleted
 *      silently (the F77 lesson). A statement runs from the mentioning line
 *      to the first following line that starts with a backtick (the end of
 *      the tagged template), at most 40 lines; a mention in a comment line
 *      is fingerprinted alone. Every line that calls a draft fragment is
 *      fingerprinted too, wherever it sits, so deleting a predicate that was
 *      composed before its statement (a shared `searchPredicates` or
 *      `inScope` constant) also changes the entry [F80].
 *
 *      What counts as a mention: the table named in SQL, qualified or not
 *      (`claimnet.traces`, `"claimnet"."traces"`, `FROM traces`); the Drizzle
 *      table object under whatever name `@soupnet/db` is imported as
 *      (`traces as T`, `import * as s` then `s.traces`), in any use (`.from(T)`,
 *      `${T}`, `T.id`); and the relational API (`db.query.traces`). What it
 *      does not see: SQL built from strings assembled in another file, and
 *      identifiers computed at runtime.
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
  "scripts/cleanup-test-data.ts": { n: 2, fp: "7e194ff79f22", why: "dev-only cleanup of test users: deletes their membership rows" },
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
  "scripts/cleanup-test-data.ts": {
    n: 1, fp: "88cb4780f315",
    why: "dev-only cleanup of test users: deletes their keys",
  },
};

/**
 * Files outside the seam that name `claimnet.traces` or
 * `claimnet.embedding_sources` (drafts-and-triage slice 2). `composes: true`
 * claims every result-set, count, or aggregate statement in the file applies
 * the module's draft fragments (publishedTrace, traceVisibleTo,
 * traceIdVisibleTo, traceReadableById, draftAwaitingReviewBy); the check
 * verifies the file references at least one. `composes: false` needs a `why`
 * saying why the draft rule does not apply. The read-path inventory
 * (docs/planning/drafts-and-triage-read-paths.md) maps each RP row here.
 */
const TRACE_READS = {
  "apps/backend/src/embedding-worker/jobs/chunking.ts": {
    n: 1, fp: "101d223d2ec3", composes: false,
    why: "embedding worker: embeds every recipe, drafts included, so verification needs no re-embed (RP-43); returns nothing to a caller",
  },
  "apps/backend/src/embedding-worker/jobs/strategy-check.ts": {
    n: 6, fp: "dee111dba17b", composes: false,
    why: "embedding worker: strategy coverage bookkeeping (RP-43)",
  },
  "apps/backend/src/embedding-worker/jobs/strategy-sweep.ts": {
    n: 2, fp: "ca8cf0babdc5", composes: false,
    why: "embedding worker: finds recipes missing a strategy and embeds them, drafts included (RP-43)",
  },
  "apps/backend/src/eval/grading-dump.ts": {
    n: 1, fp: "0b111b34f75e", composes: false,
    why: "offline eval, run by an operator against an eval stack; never served (RP-45)",
  },
  "apps/backend/src/eval/ranking-eval.ts": {
    n: 3, fp: "e3c745861691", composes: false,
    why: "offline eval, run by an operator against an eval stack; never served (RP-45)",
  },
  "apps/backend/src/lib/embeddings/enqueue.ts": {
    n: 1, fp: "5157be7a5f35", composes: false,
    why: "writes embedding rows for a recipe being deposited (RP-43)",
  },
  "apps/backend/src/routes/admin.ts": {
    n: 6, fp: "2bd49c06a20d", composes: false,
    why: "system-role totals and embedding coverage counts for the operator (RP-31 to RP-34)",
  },
  "apps/backend/src/routes/auth.ts": {
    n: 13, fp: "0d131b0de6ab", composes: false,
    why: "data export of the signed-in user's own recipes, draft state included (RP-30); account deletion guard",
  },
  "apps/backend/src/routes/integrity.ts": {
    n: 3, fp: "8551ff5bd83f", composes: false,
    why: "reports embedding sources whose recipe no longer exists; a live draft is never an orphan, and no recipe content or count leaves (RP-12)",
  },
  "apps/backend/src/routes/traces.ts": {
    n: 17, fp: "a8851b1aa871", composes: true,
    why: "map version counts and the book list compose the fragments (RP-24, RP-25); own list, own count, and own check log are the caller's rows (RP-27 to RP-29); feedback, reaction, and evidence reads for one recipe run after the module's read gate (RP-19 to RP-22), with lineage ids filtered through it",
  },
  "apps/backend/src/services/book-stats.service.ts": {
    n: 6, fp: "9c1e64a70445", composes: true,
    why: "briefing Index figures: published only, plus the person's own drafts awaiting review (RP-09, RP-17)",
  },
  "apps/backend/src/services/briefing-exemplars.ts": {
    n: 4, fp: "8b803d685141", composes: false,
    why: "loads author, evidence, and references by id for exemplars the pipeline chose under SHARED_AUDIENCE (RP-10, RP-42)",
  },
  "apps/backend/src/services/ephemeral-workspace.service.ts": {
    n: 3, fp: "94c52b0109bd", composes: false,
    why: "the reaper: deletes an expired workspace's recipes (RP-38)",
  },
  "apps/backend/src/services/feedback.service.ts": {
    n: 19, fp: "afbcb00162f0", composes: true,
    why: "feedback target ACL: prefix scan and readable set use traceReadableById (RP-11, RP-18); check_feedback inserts and the per-key budget count are writes and the caller's own rows",
  },
  "apps/backend/src/services/import.service.ts": {
    n: 20, fp: "ddfdd75ccf55", composes: false,
    why: "import writes the importer's own recipes and reads rows by id to classify skip / conflict / remap (RP-35)",
  },
  "apps/backend/src/services/integrity-repair.service.ts": {
    n: 6, fp: "968f1e8abb42", composes: false,
    why: "deletes orphaned embedding rows whose recipe no longer exists; operator-only",
  },
  "apps/backend/src/services/recipe-lookup.service.ts": {
    n: 2, fp: "523be2ce45e7", composes: true,
    why: "by-id lookup: prefix scan and main select use traceReadableById (RP-06, RP-08, RP-16)",
  },
  "apps/backend/src/services/result-enricher.ts": {
    n: 3, fp: "cca3461389f6", composes: false,
    why: "loads book, draft label, evidence, and references by id for results a filtered statement already chose (RP-42)",
  },
  "apps/backend/src/services/search-pipeline.ts": {
    n: 4, fp: "27cc9110e6b6", composes: true,
    why: "corpus mode rows and honest total use traceVisibleTo (RP-41); vector loads are by id for filtered results (RP-42)",
  },
  "apps/backend/src/services/trace.service.ts": {
    n: 10, fp: "ec75e45c358d", composes: true,
    why: "deposit INSERT, the depositing key's own idempotency row (RP-04), session ledger ids (RP-05), and zero-result scope counts that use traceVisibleTo (RP-03)",
  },
  "apps/backend/src/services/trace-delete.service.ts": {
    n: 13, fp: "3fbe25f62b70", composes: false,
    why: "deletes one recipe under lock after the route's access check (RP-36)",
  },
  "apps/backend/src/services/trace-move.service.ts": {
    n: 11, fp: "5368ff5140ab", composes: false,
    why: "moves one recipe under lock after the route's access check; draft state rides along unchanged (RP-36)",
  },
  "apps/backend/src/services/user-delete.service.ts": {
    n: 2, fp: "030fa45c370f", composes: false,
    why: "account-deletion cascade over the user's own recipes (RP-37)",
  },
  "apps/backend/src/services/vector-search.service.ts": {
    n: 9, fp: "4f3361bb6215", composes: true,
    why: "semantic search predicates use traceIdVisibleTo, related evidence publishedTrace (RP-39, RP-40); the trace load is by id for filtered results",
  },
  "packages/domain/src/embedding-strategies.ts": {
    n: 2, fp: "e3d3e8af7029", composes: false,
    why: "a documented SQL text for one recipe's evidence by id, run only after the caller has the recipe (by-id helper, RP-42)",
  },
  "scripts/cleanup-test-data.ts": {
    n: 9, fp: "1d600c0efe4e", composes: false,
    why: "dev-only cleanup of test users: deletes their recipes",
  },
  "scripts/repair-orphaned-user-data.mjs": {
    n: 7, fp: "da48f81bc495", composes: false,
    why: "operator repair script: deletes recipes whose owner no longer exists",
  },
};

/** The module's draft fragments; a `composes: true` file must reference one. */
const DRAFT_FRAGMENT = /\b(publishedTrace|traceVisibleTo|traceIdVisibleTo|traceReadableById|draftAwaitingReviewBy|draftStateShownTo)\(/;

/** SQL table names of the recipe rule, and their Drizzle exports. */
const TRACE_TABLES = ["traces", "embedding_sources", "trace_evidence", "trace_references", "check_feedback", "trace_reactions"];
const TRACE_EXPORTS = ["traces", "embeddingSources", "traceEvidence", "traceReferences", "checkFeedback", "traceReactions"];
const TABLE_ALT = TRACE_TABLES.join("|");
/** Qualified (`claimnet.traces`, `"claimnet"."traces"`) or unqualified after a
 *  SQL keyword (`FROM traces`, which resolves through search_path). */
const TRACE_SQL = new RegExp(
  `claimnet"?\\s*\\.\\s*"?(${TABLE_ALT})\\b|\\b(FROM|JOIN|UPDATE|INTO)\\s+"?(${TABLE_ALT})"?\\b`,
  "i",
);
const DRIZZLE_QUERY = new RegExp(`\\bquery\\s*\\.\\s*(${TRACE_EXPORTS.join("|")})\\b`);

/**
 * The names a file gives the recipe tables' Drizzle objects: named imports
 * from @soupnet/db (aliases included) and namespace imports (`ns.traces`).
 */
function drizzleNames(text) {
  const names = [];
  for (const m of text.matchAll(/import\s*(type\s+)?\{([^}]*)\}\s*from\s*["']@soupnet\/db["']/g)) {
    if (m[1]) continue; // type-only imports carry no table object
    for (const part of m[2].split(",")) {
      const [orig, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if (orig && TRACE_EXPORTS.includes(orig.trim())) names.push((alias ?? orig).trim());
    }
  }
  for (const m of text.matchAll(/import\s*\*\s*as\s+(\w+)\s*from\s*["']@soupnet\/db["']/g)) {
    for (const t of TRACE_EXPORTS) names.push(`${m[1]}\\s*\\.\\s*${t}`);
  }
  return names;
}

/** Mention line indexes for the recipe rule in one file. */
function traceMatcher(lines) {
  const text = lines.join("\n");
  const names = drizzleNames(text);
  const drizzle = names.length > 0 ? new RegExp(`(?<![\\w.])(${names.join("|")})\\b`) : null;
  const out = [];
  lines.forEach((line, i) => {
    if (/^\s*import\b/.test(line) || /^\s*\}?\s*from\s*["']@soupnet\/db["']/.test(line)) return;
    if (TRACE_SQL.test(line) || DRIZZLE_QUERY.test(line) || (drizzle && drizzle.test(line))) out.push(i);
  });
  return out;
}

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
  {
    table: "recipe tables (claimnet.traces, embedding_sources, and the recipe link tables)",
    pattern: TRACE_SQL,
    matcher: traceMatcher,
    window: "statement",
    alsoFingerprint: DRAFT_FRAGMENT,
    lists: { TRACE_READS },
    failure: [
      "a file outside apps/backend/src/authz/ reads recipes (claimnet.traces or embedding_sources) and is not registered.",
      "",
      "Drafts (drafts-and-triage slice 2) are visible only to the person they are about, their agents, and",
      "the depositor. The condition lives once in authz/draft-sql.ts: compose publishedTrace, traceVisibleTo,",
      "traceIdVisibleTo, or traceReadableById into every statement that returns, counts, clusters, or",
      "aggregates recipes, then register the file in TRACE_READS with composes: true. If the draft rule",
      "genuinely does not apply (a write, a cascade, a by-id helper fed an already-filtered list, the",
      "caller's own rows), register it with composes: false and a one-line reason.",
    ],
    newFileHint: "compose the draft fragment from apps/backend/src/authz/ and register the file in TRACE_READS.",
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

/**
 * AUTHZ_SEAM_OVERRIDES (tests only): a JSON map from repo-relative path to a
 * file whose content stands in for it, or is added as a new source, so the
 * guard's tests can plant a bypass without touching the working tree.
 */
const OVERRIDES = process.env.AUTHZ_SEAM_OVERRIDES ? JSON.parse(process.env.AUTHZ_SEAM_OVERRIDES) : {};

const sources = [...new Set([...scanRoots().flatMap(walk), ...Object.keys(OVERRIDES)])]
  .sort()
  .filter((file) => SOURCE_FILE.test(file) && !isExempt(file))
  .map((file) => ({
    file,
    lines: readFileSync(OVERRIDES[file] ?? join(projectRoot, file), "utf-8").split(/\r?\n/),
  }));

const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
const STATEMENT_MAX_LINES = 40;

/**
 * The lines a mention's fingerprint covers. "line": the mentioning line only.
 * "statement": the mentioning line through the first following line that
 * starts with a backtick (the tagged template's end), at most
 * STATEMENT_MAX_LINES; a comment line is covered alone.
 */
function coveredLineIndexes(lines, index, window) {
  if (window !== "statement" || COMMENT_LINE.test(lines[index])) return [index];
  const out = [index];
  for (let j = index + 1; j < lines.length && j <= index + STATEMENT_MAX_LINES; j++) {
    out.push(j);
    if (lines[j].trimStart().startsWith("`")) break;
  }
  return out;
}

/** For each file with at least one matching line: how many, and their fingerprint. */
function measure(rule) {
  const { pattern, matcher, window = "line", alsoFingerprint } = rule;
  const found = new Map();
  for (const { file, lines } of sources) {
    const mentions = [];
    if (matcher) mentions.push(...matcher(lines));
    else lines.forEach((line, i) => { if (pattern.test(line)) mentions.push(i); });
    if (mentions.length === 0) continue;
    const extra = [];
    if (alsoFingerprint) lines.forEach((line, i) => { if (alsoFingerprint.test(line)) extra.push(i); });
    const covered = [...new Set([...mentions.flatMap((i) => coveredLineIndexes(lines, i, window)), ...extra])].sort((a, b) => a - b);
    const matching = covered.map((i) => lines[i].trim().replace(/\s+/g, " "));
    const fp = createHash("sha256").update(matching.join("\n")).digest("hex").slice(0, 12);
    found.set(file, { n: mentions.length, fp, text: lines.join("\n") });
  }
  return found;
}

if (process.argv.includes("--counts")) {
  for (const rule of RULES) {
    const found = measure(rule);
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
  const found = measure(rule);
  const newFiles = [];
  const changed = [];
  const stale = [];
  const notComposing = [];

  const registered = new Map();
  for (const [listName, list] of Object.entries(rule.lists)) {
    for (const [file, entry] of Object.entries(list)) registered.set(file, { ...entry, listName });
  }

  for (const [file, now] of found) {
    const entry = registered.get(file);
    if (!entry) newFiles.push({ file, now });
    else if (entry.fp !== now.fp) changed.push({ file, now, entry });
    if (entry && entry.composes === true && !DRAFT_FRAGMENT.test(now.text)) notComposing.push({ file });
    if (entry && entry.composes === false && !(entry.why ?? "").trim()) notComposing.push({ file, noReason: true });
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

  if (notComposing.length > 0) {
    failed = true;
    console.error(
      `\n${[
        `authz seam check FAILED: registered ${rule.table} files do not keep their claim.`,
        "",
        ...notComposing.map(({ file, noReason }) =>
          noReason
            ? `  ${file}: composes: false needs a one-line reason in \`why\`.`
            : `  ${file}: registered as composing the draft fragments, but references none of them.`,
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
    `claimnet.api_keys only by the ${Object.keys(NON_AUTHORIZING_KEY_SQL).length} registered non-authorizing files, ` +
    `and recipes are read only by the ${Object.keys(TRACE_READS).length} registered files (${Object.values(TRACE_READS).filter((e) => e.composes).length} composing the draft condition) — ` +
    "every matching line fingerprinted.",
);
