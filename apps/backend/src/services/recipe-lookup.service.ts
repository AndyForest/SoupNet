/**
 * Recipe lookup by id — the WT-3 retrieval service.
 *
 * Shared by three surfaces:
 *   - REST GET /recipes?ids=...            (routes/recipes.ts)
 *   - MCP get_recipes tool                 (routes/mcp.ts)
 *   - get_briefing's recipe_ids param      (services/briefing.ts → "Requested recipes" section)
 *
 * ACL model: strictly the API key's read_group_ids — the same model /check and
 * runSearchPipeline use, NOT the JWT group-membership check in routes/traces.ts.
 * A trace is readable iff its group_id is in the key's read scope.
 *
 * Marker semantics (anti-enumeration, mirrors the F30 waitlist/register
 * pattern and the uploads "uniform unreachable URL" shape): unknown ids,
 * unreadable ids, and malformed ids all resolve to ONE indistinguishable
 * marker entry — { id, status: "not_found_or_unreadable" }. Never content,
 * never distinct statuses, never a request-killing error. A caller holding
 * someone else's trace id must not be able to learn whether it exists.
 */
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { enrichResults } from "./result-enricher";
import type { SearchResultItem } from "./trace.service";

/** Hard cap on ids per lookup call. Routes reject above this; the briefing
 *  surface silently truncates and says so in the rendered section. */
export const RECIPE_LOOKUP_MAX_IDS = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Types ────────────────────────────────────────────────────────────────────

export interface RecipeLookupReference {
  quote: string | null;
  source: string | null;
  fileUrl?: string | undefined;
  fileMimeType?: string | undefined;
  originalFilename?: string | undefined;
}

export interface RecipeLookupEvidence {
  interpretation: string;
  references: RecipeLookupReference[];
}

export interface RecipeLookupFound {
  id: string;
  status: "ok";
  /** The recipe (claim) text. */
  recipe: string;
  recipeBook: { slug: string; name: string } | null;
  author: { email: string; displayName: string | null } | null;
  /** ISO timestamp of when the trace was logged. */
  createdAt: string;
  /** ISO timestamp of the original judgment (decided_at), when backfilled. */
  decidedAt: string | null;
  evidence: RecipeLookupEvidence[];
}

export interface RecipeLookupMarker {
  id: string;
  status: "not_found_or_unreadable";
}

export type RecipeLookupEntry = RecipeLookupFound | RecipeLookupMarker;

// ── Id parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a comma- and/or whitespace-separated id list into unique ids in
 * first-seen order. Does NOT validate UUID shape — malformed entries flow
 * through so lookupRecipes can return their markers (uniform marker rule).
 */
export function parseRecipeIds(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

// ── Lookup ───────────────────────────────────────────────────────────────────

interface TraceRow {
  id: string;
  claimText: string;
  createdAt: string;
  decidedAt: string | null;
  groupSlug: string | null;
  groupName: string | null;
  authorEmail: string | null;
  authorDisplayName: string | null;
}

/**
 * Resolve up to RECIPE_LOOKUP_MAX_IDS trace ids against the key's read scope.
 * Returns one entry per unique input id, in input order. Ids beyond the cap
 * are ignored (callers surface their own cap message).
 */
export async function lookupRecipes(
  db: PostgresJsDatabase,
  ids: string[],
  readGroupIds: string[],
): Promise<RecipeLookupEntry[]> {
  const capped = [...new Set(ids)].slice(0, RECIPE_LOOKUP_MAX_IDS);
  const validIds = capped.filter((id) => UUID_RE.test(id));

  const foundById = new Map<string, RecipeLookupFound>();

  if (validIds.length > 0 && readGroupIds.length > 0) {
    // ACL is enforced IN the query: a trace outside the key's read scope is
    // never fetched, so it cannot leak through any downstream shape.
    const rows = await db.execute(sql`
      SELECT
        t.id,
        t.claim_text        AS "claimText",
        t.created_at        AS "createdAt",
        t.decided_at        AS "decidedAt",
        g.slug              AS "groupSlug",
        g.name              AS "groupName",
        u.email             AS "authorEmail",
        u.display_name      AS "authorDisplayName"
      FROM claimnet.traces t
      LEFT JOIN claimnet.groups g ON g.id = t.group_id
      LEFT JOIN claimnet.users u ON u.id = t.user_id
      WHERE t.id IN (${sql.join(validIds.map((id) => sql`${id}::uuid`), sql`, `)})
        AND t.group_id IN (${sql.join(readGroupIds.map((id) => sql`${id}::uuid`), sql`, `)})
    `);

    const traceRows = rows as unknown as TraceRow[];
    if (traceRows.length > 0) {
      // Reuse the /check enrichment pipeline for evidence + references so the
      // lookup surface returns the same shape agents already see in check
      // results (file refs included).
      const searchItems: SearchResultItem[] = traceRows.map((r) => ({
        id: r.id,
        claimText: r.claimText,
        createdAt: new Date(r.createdAt),
        rank: 0,
      }));
      const enriched = await enrichResults(db, searchItems);
      const evidenceByTrace = new Map(enriched.map((e) => [e.id, e.evidence]));

      for (const row of traceRows) {
        const evidence = (evidenceByTrace.get(row.id) ?? []).map((e) => ({
          interpretation: e.content,
          references: e.references.map((ref) => ({
            quote: ref.quote ?? null,
            source: ref.source ?? null,
            ...(ref.fileUrl ? { fileUrl: ref.fileUrl } : {}),
            ...(ref.fileMimeType ? { fileMimeType: ref.fileMimeType } : {}),
            ...(ref.originalFilename ? { originalFilename: ref.originalFilename } : {}),
          })),
        }));

        foundById.set(row.id, {
          id: row.id,
          status: "ok",
          recipe: row.claimText,
          recipeBook: row.groupSlug !== null || row.groupName !== null
            ? { slug: row.groupSlug ?? "", name: row.groupName ?? "" }
            : null,
          author: row.authorEmail
            ? { email: row.authorEmail, displayName: row.authorDisplayName }
            : null,
          createdAt: new Date(row.createdAt).toISOString(),
          decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
          evidence,
        });
      }
    }
  }

  // Input order preserved; every unresolved id (unknown, unreadable, or
  // malformed alike) gets the same marker.
  return capped.map((id) => {
    const found = foundById.get(id.toLowerCase()) ?? foundById.get(id);
    return found ?? { id, status: "not_found_or_unreadable" as const };
  });
}

// ── Rendering (shared by the MCP tool and the briefing section) ─────────────

/** Format a YYYY-MM-DD date from an ISO timestamp. */
function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Render lookup entries as markdown blocks. No top-level heading — callers
 * wrap with their own ("## Requested recipes" in the briefing, a short header
 * in the MCP tool response).
 */
export function renderRecipeEntries(entries: RecipeLookupEntry[]): string {
  return entries.map((entry) => {
    if (entry.status !== "ok") {
      return `### ${entry.id}\nStatus: not_found_or_unreadable — this id does not exist or is not readable by this API key (the two cases are deliberately indistinguishable).`;
    }

    const metaLines = [
      `### ${entry.id}`,
      ...(entry.recipeBook ? [`Recipe book: ${entry.recipeBook.slug} (${entry.recipeBook.name})`] : []),
      ...(entry.author
        ? [`Author: ${entry.author.displayName ? `${entry.author.displayName} <${entry.author.email}>` : entry.author.email}`]
        : []),
      `Logged: ${shortDate(entry.createdAt)}`,
      ...(entry.decidedAt ? [`Decided: ${shortDate(entry.decidedAt)}`] : []),
    ].join("\n");

    let text = `${metaLines}\n\n${entry.recipe}`;

    if (entry.evidence.length > 0) {
      const blocks = entry.evidence.map((ev) => {
        const lines = [`- ${ev.interpretation}`];
        for (const ref of ev.references) {
          if (ref.quote) lines.push(`  > "${ref.quote}"`);
          if (ref.source) lines.push(`  -- ${ref.source}`);
          if (ref.fileUrl) {
            const label = ref.originalFilename ?? ref.fileUrl;
            lines.push(`  [file: ${label}${ref.fileMimeType ? ` (${ref.fileMimeType})` : ""}]`);
          }
        }
        return lines.join("\n");
      });
      text += `\n\nEvidence:\n${blocks.join("\n\n")}`;
    }

    return text;
  }).join("\n\n");
}
