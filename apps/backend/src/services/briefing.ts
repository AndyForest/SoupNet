/**
 * Unified briefing composer + corpus-context composer.
 *
 * Two surfaces share content:
 *   - `composeBriefing` — full briefing for /keys/briefing (JWT) and /briefing
 *     (Bearer API key) + the MCP get_briefing tool.
 *   - `composeCorpusContext` — identity + recipe books + exemplars only, no
 *     boilerplate. Used by the MCP `list_my_recipe_books` tool so an agent
 *     can refresh corpus context mid-session without re-pasting the briefing.
 *
 * Both go through the same backing data fetch (key validation, group + member
 * lookup, exemplar clustering, user prefs) — single source of truth.
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  BRIEFING,
  buildCorpusContextSection,
  buildExemplarsSection,
  mergeUserPreferences,
} from "@soupnet/domain";
import type {
  BriefingBookStats,
  BriefingMapContext,
  BriefingGroup,
  BriefingMember,
  BriefingUser,
} from "@soupnet/domain";
import { fetchBriefingExemplars } from "./briefing-exemplars";
import { fetchBookStats } from "./book-stats.service";
import { listTombstonedGroupIds } from "./ephemeral-workspace.service";
import { writeAudit } from "./audit-log.service";
import {
  RECIPE_LOOKUP_MAX_IDS,
  lookupRecipes,
  renderRecipeEntries,
} from "./recipe-lookup.service";
import { resolveIntent, intentEchoLine } from "./intent.service";

export interface BriefingOptions {
  /** Override cluster count. Falls back to user preference, then default 5. */
  k?: number | undefined;
  /** Concept-axis pair for projection (e.g. "accessibility, performance"). */
  axes?: string | undefined;
  /** Keyword filter applied at clustering time. */
  filter?: string | undefined;
  /** Embedding strategy name for clustering experiments. */
  vectorStrategy?: string | undefined;
  /** Optional recipe-book slug or UUID to narrow the exemplar scope. */
  recipeBookIdOrSlug?: string | undefined;
  /** Free-text task purpose (WT-3) — biases within-cluster exemplar choice
   *  and is echoed back as a one-line acknowledgment in the briefing. */
  purpose?: string | undefined;
  /** Recipe ids (WT-3) to render in a "Requested recipes" section — same
   *  lookup service and ACL/marker semantics as GET /recipes. */
  recipeIds?: string[] | undefined;
  /** Exemplar-selection mechanism (adaptive-briefing experiment arm, OFF by
   *  default; no public surface sets it yet — the eval harness passes it
   *  directly). See ExemplarFetchOptions.selection for semantics. */
  selection?: "corpus-kmeans" | "goal-mmr" | undefined;
  /** Declared intent (cold-start v2 Phase C): task story text (always
   *  registers a new intent) or an int_… id (joins). Registration at
   *  briefing time is the canonical cold-start move — the id seeds the whole
   *  session's checks/searches/feedback. Supersedes `purpose` over time. */
  intent?: string | undefined;
}

export interface BriefingComposeInput {
  db: PostgresJsDatabase;
  rawKey: string;
  /** Owning user — if omitted, the key's user_id is used (MCP path). */
  userId?: string;
  backendUrl: string;
  frontendUrl: string;
  options?: BriefingOptions;
  /** Connection surface for the briefing.issued audit event (UVP Layer 1 —
   *  makes the briefing→first-check funnel computable per surface).
   *  e.g. "mcp-http". Omitted → recorded as null (REST /briefing, dashboard
   *  copy buttons — callers can adopt the field incrementally). */
  surface?: string | undefined;
}

export interface BriefingComposeSuccess {
  ok: true;
  text: string;
  groups: BriefingGroup[];
  exemplarCount: number;
}

export type BriefingComposeError =
  | { ok: false; code: "key_not_found" }
  | { ok: false; code: "no_groups" };

export type BriefingComposeResult = BriefingComposeSuccess | BriefingComposeError;

// Internal: fully-resolved scope data, reused by composeBriefing + composeCorpusContext.
interface ResolvedScope {
  user: BriefingUser;
  groups: BriefingGroup[];
  scopeLabel: string;
  exemplarGroupIds: string[];
  /** The key's full read scope — used by the requested-recipes lookup, which
   *  is deliberately NOT narrowed by recipeBookIdOrSlug (an explicitly
   *  requested id should resolve from any book the key can read). */
  readGroupIds: string[];
  k: number;
  options: BriefingOptions;
  /** api_keys.id + owning user — for the briefing.issued audit stamp. */
  keyId: string;
  userId: string;
  /** api_keys.key_type — 'daily' | 'scoped' | 'oauth'. OAuth access tokens
   *  must never be rendered as pasteable credentials in the briefing. */
  keyType: string;
  /** True for MCP surfaces (mcp-http / mcp-stdio) — the thin-briefing profile
   *  (cold-start v2 Phase B): per-book index stats render, exemplars default
   *  to zero (explicit k / verbosity opts back in), and BRIEFING.build drops
   *  the setup/link/pasted-JSON sections. Non-MCP surfaces are byte-identical
   *  to the pre-profile briefing. */
  mcpSurface: boolean;
}

/** Compose the full unified briefing markdown. */
export async function composeBriefing(input: BriefingComposeInput): Promise<BriefingComposeResult> {
  const scope = await resolveScope(input);
  if ("error" in scope) return scope.error;

  const { exemplarsSection, exemplarCount } = await renderExemplars(input.db, scope);

  // Declared intent (cold-start v2 Phase C): registration at briefing time
  // is the canonical cold-start move — the returned id seeds the session's
  // checks, searches, and feedback. Same always-new/join semantics as the
  // check path; never fails the briefing.
  const intent = scope.options.intent !== undefined
    ? await resolveIntent(input.db, {
        value: scope.options.intent,
        userId: scope.userId,
        apiKeyId: scope.keyId,
      })
    : undefined;
  const intentNotice = intent ? intentEchoLine(intent) : null;

  // UVP Layer 1: briefing.issued makes the survivorship denominator visible —
  // get_briefing calls with zero subsequent checks are the null cohort no
  // local log could see. Awaited like the recipe.checked audit write —
  // writeAudit swallows failures so it can never fail the briefing, and an
  // awaited insert is deterministic for consumers reading the funnel. F29's
  // limiter filters on action = 'recipe.checked', so these rows add no load
  // to its indexed COUNT.
  await writeAudit(input.db, {
    actorUserId: scope.userId,
    action: "briefing.issued",
    targetType: "api_key",
    targetId: scope.keyId,
    apiKeyId: scope.keyId,
    metadata: {
      surface: input.surface ?? null,
      exemplarCount,
      ...(intent?.intentId ? { intentId: intent.intentId } : {}),
    },
  });

  // No raw credential ever reaches the template: BRIEFING.build takes no key
  // input at all. Non-OAuth briefings render the literal placeholder
  // (BRIEFING_KEY_PLACEHOLDER) — every Bearer consumer already supplied the
  // key to fetch this briefing, and the human copy-briefing flow substitutes
  // the placeholder client-side at copy time. OAuth connections
  // (key_type = 'oauth') get credential-free connection notes instead — a
  // placeholder would mislead there (the 1h access token is not a pasteable
  // key).
  const isOAuth = scope.keyType === "oauth";

  // Requested recipes (WT-3): render exactly the ids the caller named, with
  // the same ACL and marker semantics as GET /recipes / the get_recipes tool.
  let requestedRecipesSection: string | undefined;
  const recipeIds = scope.options.recipeIds ?? [];
  if (recipeIds.length > 0) {
    const entries = await lookupRecipes(input.db, recipeIds, scope.readGroupIds);
    const truncated = recipeIds.length > RECIPE_LOOKUP_MAX_IDS
      ? `\n\n(${recipeIds.length - RECIPE_LOOKUP_MAX_IDS} id(s) beyond the ${RECIPE_LOOKUP_MAX_IDS}-id cap were ignored — fetch them with the get_recipes tool or GET /recipes.)`
      : "";
    requestedRecipesSection = `## Requested recipes

The recipes you asked for by id. Entries marked not_found_or_unreadable either don't exist or aren't readable by this API key — the two cases are deliberately indistinguishable. For mid-session lookups, use the get_recipes tool (MCP) or GET /recipes?ids=... (REST) instead of re-fetching this briefing.

${renderRecipeEntries(entries)}${truncated}`;
  }

  const text = BRIEFING.build({
    user: scope.user,
    backendUrl: input.backendUrl,
    frontendUrl: input.frontendUrl,
    groups: scope.groups,
    // Thin profile for MCP surfaces (cold-start v2 Phase B) — composes with
    // the OAuth branch (OAuth key-section note wins; mcp drops setup anyway).
    surface: scope.mcpSurface ? "mcp" : "full",
    ...(isOAuth ? { oauthConnection: true } : {}),
    ...(exemplarsSection ? { exemplarsSection } : {}),
    ...(scope.options.purpose ? { purpose: scope.options.purpose } : {}),
    ...(intentNotice ? { intentNotice } : {}),
    ...(requestedRecipesSection ? { requestedRecipesSection } : {}),
  });

  return { ok: true, text, groups: scope.groups, exemplarCount };
}

/** Compose just the corpus-context section (identity + recipe books +
 *  exemplars), for the MCP list_my_recipe_books tool. */
export async function composeCorpusContext(input: BriefingComposeInput): Promise<BriefingComposeResult> {
  const scope = await resolveScope(input);
  if ("error" in scope) return scope.error;

  const { exemplarsSection, exemplarCount } = await renderExemplars(input.db, scope);
  const text = buildCorpusContextSection({
    user: scope.user,
    groups: scope.groups,
    ...(exemplarsSection ? { exemplarsSection } : {}),
  });

  return { ok: true, text, groups: scope.groups, exemplarCount };
}

// ── Internals ───────────────────────────────────────────────────────────────

interface KeyRow {
  id: string;
  user_id: string;
  read_group_ids: string[];
  write_group_ids: string[];
  default_write_group_id: string;
  key_type: string;
}

interface GroupRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface UserRow {
  display_name: string | null;
  email: string;
}

interface MemberRow {
  group_id: string;
  display_name: string | null;
  email: string;
}

async function resolveScope(
  input: BriefingComposeInput,
): Promise<ResolvedScope | { error: BriefingComposeError }> {
  const { db, rawKey, userId } = input;

  // Hashed-key lookup matches the F33 fix in /keys/briefing — never look up
  // by 8-char prefix because cn_d_/cn_s_ keys can collide on prefix.
  const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
  const userScopeClause = userId ? sql`AND user_id = ${userId}::uuid` : sql``;
  const keyRows = await db.execute(sql`
    SELECT id, user_id, read_group_ids, write_group_ids, default_write_group_id, key_type
    FROM claimnet.api_keys
    WHERE key = ${hashedKey}
      AND expires_at > NOW()
      ${userScopeClause}
    LIMIT 1
  `);

  const keyRow = (keyRows as unknown as KeyRow[])[0];
  if (!keyRow) {
    return { error: { ok: false, code: "key_not_found" } };
  }

  // Tombstone seam (audit F57): a born-ephemeral book past its TTL leaves the
  // briefing's recipe-book list, member counts, and exemplar scope the instant
  // expiry passes — the same scope-resolution exclusion the check path applies,
  // so a briefing never surfaces a book a check can no longer read or write.
  const tomb = await listTombstonedGroupIds(
    db,
    [...new Set([...keyRow.read_group_ids, ...keyRow.write_group_ids])],
  );
  if (tomb.size > 0) {
    keyRow.read_group_ids = keyRow.read_group_ids.filter((g) => !tomb.has(g));
    keyRow.write_group_ids = keyRow.write_group_ids.filter((g) => !tomb.has(g));
  }

  // User identity (display name + email) for the "## Your user" line.
  const userRows = await db.execute(sql`
    SELECT display_name, email FROM claimnet.users WHERE id = ${keyRow.user_id}::uuid
  `);
  const userRow = (userRows as unknown as UserRow[])[0];
  const user: BriefingUser = userRow
    ? { displayName: userRow.display_name, email: userRow.email }
    : { email: "(unknown)" };

  const allIds = [...new Set([...keyRow.read_group_ids, ...keyRow.write_group_ids])];
  const groupRowList = allIds.length > 0
    ? (await db.execute(sql`
        SELECT id, slug, name, description FROM claimnet.groups
        WHERE id IN (${sql.join(allIds.map((id) => sql`${id}::uuid`), sql`, `)})
        ORDER BY name
      `) as unknown as GroupRow[])
    : [];

  // Fetch members for all in-scope recipe books in one query; bucket per group.
  // Surface members so the briefing flags collaboration: when a shared book
  // appears, the receiving LLM can name collaborators in synthesis.
  const memberRowList = allIds.length > 0
    ? (await db.execute(sql`
        SELECT gm.group_id, u.display_name, u.email
        FROM claimnet.group_members gm
        JOIN claimnet.users u ON u.id = gm.user_id
        WHERE gm.group_id IN (${sql.join(allIds.map((id) => sql`${id}::uuid`), sql`, `)})
        ORDER BY gm.group_id, u.email
      `) as unknown as MemberRow[])
    : [];

  const membersByGroup = new Map<string, BriefingMember[]>();
  for (const row of memberRowList) {
    const list = membersByGroup.get(row.group_id) ?? [];
    list.push({ email: row.email, displayName: row.display_name });
    membersByGroup.set(row.group_id, list);
  }

  // Thin-briefing profile applies to MCP surfaces only (cold-start v2 Phase
  // B): stats computed here, exemplar default zeroed below. Everything else
  // (rest, web, absent) keeps the pre-profile behavior byte-for-byte.
  const mcpSurface = input.surface === "mcp-http" || input.surface === "mcp-stdio";

  // Per-book index stats — MCP surfaces only, so the web copy-briefing path
  // pays nothing and its output stays byte-identical.
  const statsByGroup: Map<string, BriefingBookStats> = mcpSurface
    ? await fetchBookStats(db, allIds)
    : new Map();

  const groups: BriefingGroup[] = groupRowList.map((g) => {
    const members = membersByGroup.get(g.id) ?? [];
    const base: BriefingGroup = {
      slug: g.slug,
      name: g.name,
      description: g.description,
      canWrite: keyRow.write_group_ids.includes(g.id),
      isDefault: g.id === keyRow.default_write_group_id,
    };
    // Only attach members when there's more than one (the user themselves) —
    // solo books skip the Members line entirely in renderRecipeBooks.
    if (members.length > 1) base.members = members;
    const stats = statsByGroup.get(g.id);
    if (stats) base.stats = stats;
    return base;
  });

  // Load user preferences for the cluster count default. PATCH /me/preferences
  // is what populates this; new users see DEFAULT_USER_PREFERENCES.
  const prefRows = await db.execute(sql`
    SELECT preferences FROM claimnet.users WHERE id = ${keyRow.user_id}::uuid
  `);
  const prefs = mergeUserPreferences((prefRows as unknown as Array<{ preferences: unknown }>)[0]?.preferences);

  // Exemplar scope: explicit recipe_book param narrows; otherwise the union
  // of the key's read scope. Mirrors the recipe-map UI's "all key recipe
  // books" vs single-book modes.
  let exemplarGroupIds = keyRow.read_group_ids;
  let scopeLabel = "all your recipe books";
  const opts = input.options ?? {};
  if (opts.recipeBookIdOrSlug) {
    const target = groupRowList.find((g) =>
      g.id === opts.recipeBookIdOrSlug || g.slug === opts.recipeBookIdOrSlug
    );
    if (target && keyRow.read_group_ids.includes(target.id)) {
      exemplarGroupIds = [target.id];
      scopeLabel = target.name;
    }
  } else if (groupRowList.length === 1) {
    scopeLabel = groupRowList[0]!.name;
  }

  // Exemplar count: explicit k (incl. verbosity-mapped) always wins; the
  // MCP default is ZERO (thin index instead of a pushed sample — retrieval
  // arrives task-keyed via checks/searches; operator ruling 2026-08-23,
  // recipe ef844c32); other surfaces keep the preference-driven default.
  const k = opts.k ?? (mcpSurface ? 0 : prefs.briefing.clusterCount);

  return {
    user,
    groups,
    scopeLabel,
    exemplarGroupIds,
    readGroupIds: keyRow.read_group_ids,
    k,
    options: opts,
    keyId: keyRow.id,
    userId: keyRow.user_id,
    keyType: keyRow.key_type,
    mcpSurface,
  };
}

async function renderExemplars(
  db: PostgresJsDatabase,
  scope: ResolvedScope,
): Promise<{ exemplarsSection: string; exemplarCount: number }> {
  // k=0 (the MCP-surface default): no exemplars section, and no search
  // pipeline / clustering cost at all — the index lines carry the corpus
  // shape instead.
  if (scope.k <= 0) {
    return { exemplarsSection: "", exemplarCount: 0 };
  }
  const { exemplars, mapContext } = await fetchBriefingExemplars(db, scope.exemplarGroupIds, {
    k: scope.k,
    ...(scope.options.axes !== undefined ? { axes: scope.options.axes } : {}),
    ...(scope.options.filter !== undefined ? { filter: scope.options.filter } : {}),
    ...(scope.options.vectorStrategy !== undefined ? { vectorStrategy: scope.options.vectorStrategy } : {}),
    ...(scope.options.purpose !== undefined ? { purpose: scope.options.purpose } : {}),
    ...(scope.options.selection !== undefined ? { selection: scope.options.selection } : {}),
  });

  // Trim undefined fields off mapContext before passing to the formatter so
  // exactOptionalPropertyTypes accepts the shape (the BriefingMapContext type
  // distinguishes "missing" from "present-but-undefined").
  const formatterContext: Omit<BriefingMapContext, "scopeLabel"> = {
    k: mapContext.k,
    mode: mapContext.mode,
    ...(mapContext.axes !== undefined ? { axes: mapContext.axes } : {}),
    ...(mapContext.filter !== undefined ? { filter: mapContext.filter } : {}),
    ...(mapContext.strategy !== undefined ? { strategy: mapContext.strategy } : {}),
    ...(mapContext.purpose !== undefined ? { purpose: mapContext.purpose } : {}),
  };
  const exemplarsSection = buildExemplarsSection(scope.scopeLabel, formatterContext, exemplars);
  return { exemplarsSection, exemplarCount: exemplars.length };
}
