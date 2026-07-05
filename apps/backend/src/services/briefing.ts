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
  BriefingMapContext,
  BriefingGroup,
  BriefingMember,
  BriefingUser,
} from "@soupnet/domain";
import { fetchBriefingExemplars } from "./briefing-exemplars";
import {
  RECIPE_LOOKUP_MAX_IDS,
  lookupRecipes,
  renderRecipeEntries,
} from "./recipe-lookup.service";

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
}

export interface BriefingComposeInput {
  db: PostgresJsDatabase;
  rawKey: string;
  /** Owning user — if omitted, the key's user_id is used (MCP path). */
  userId?: string;
  backendUrl: string;
  frontendUrl: string;
  options?: BriefingOptions;
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
}

/** Compose the full unified briefing markdown. */
export async function composeBriefing(input: BriefingComposeInput): Promise<BriefingComposeResult> {
  const scope = await resolveScope(input);
  if ("error" in scope) return scope.error;

  const { exemplarsSection, exemplarCount } = await renderExemplars(input.db, scope);
  const checkUrl = `${input.backendUrl}/check?key=${encodeURIComponent(input.rawKey)}`;

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
    apiKey: input.rawKey,
    backendUrl: input.backendUrl,
    frontendUrl: input.frontendUrl,
    checkUrl,
    groups: scope.groups,
    ...(exemplarsSection ? { exemplarsSection } : {}),
    ...(scope.options.purpose ? { purpose: scope.options.purpose } : {}),
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
  user_id: string;
  read_group_ids: string[];
  write_group_ids: string[];
  default_write_group_id: string;
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
    SELECT user_id, read_group_ids, write_group_ids, default_write_group_id
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

  const k = opts.k ?? prefs.briefing.clusterCount;

  return {
    user,
    groups,
    scopeLabel,
    exemplarGroupIds,
    readGroupIds: keyRow.read_group_ids,
    k,
    options: opts,
  };
}

async function renderExemplars(
  db: PostgresJsDatabase,
  scope: ResolvedScope,
): Promise<{ exemplarsSection: string; exemplarCount: number }> {
  const { exemplars, mapContext } = await fetchBriefingExemplars(db, scope.exemplarGroupIds, {
    k: scope.k,
    ...(scope.options.axes !== undefined ? { axes: scope.options.axes } : {}),
    ...(scope.options.filter !== undefined ? { filter: scope.options.filter } : {}),
    ...(scope.options.vectorStrategy !== undefined ? { vectorStrategy: scope.options.vectorStrategy } : {}),
    ...(scope.options.purpose !== undefined ? { purpose: scope.options.purpose } : {}),
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
