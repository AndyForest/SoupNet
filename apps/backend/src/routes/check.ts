import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Next } from "hono";
import type { SubmitAndSearchResult } from "../services/trace.service";
import { submitAndSearch, searchWithoutLogging } from "../services/trace.service";
import { enrichResults, clusterEvidenceInResults } from "../services/result-enricher";
import type { EnrichedResult, EnrichedEvidence, EnrichedReference } from "../services/result-enricher";
import { maybeSynthesize, SYNTHESIS_INELIGIBLE_NOTICE } from "../services/synthesis.service";
import type { SynthesisResult } from "../services/synthesis.service";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { validateKey } from "../services/api-key.service";
import { HTML_ACCEPT_TYPES, renderCheckResponseMarkdown, fenceCheckResponseMarkdown } from "@soupnet/domain";
import type { CheckResponseJson } from "@soupnet/domain";
import { rateLimit, perKeyRateLimit, extractCheckRequestKey, getClientIp, hashApiKey } from "../middleware/rate-limit";
import { parseLenientQuery, rawQueryOfUrl } from "../lib/lenient-query";
import { invalidKeyMessage, keysPageUrl } from "../lib/key-remediation";

// Rate limit check/search:
//   - per-IP: 1000 per hour (defense-in-depth, catches NAT'd attackers)
//   - per-key: 200/hour and 1000/day (queried from audit_log; F29).
const checkRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });
const checkPerKeyRateLimit = perKeyRateLimit({ keyExtractor: extractCheckRequestKey });

// Search-only requests (filter with no recipe) write no recipe.checked
// audit rows, so the F29 audit-backed counter never sees them by design.
// They get their own in-memory per-credential cap instead — 600/hour keyed
// by the hashed key, mirroring the /recipes lookup decision (WT-3,
// 2026-07-05): reads are cheap, legitimate use should never hit the
// throttle first, and an in-memory reset on restart only widens a window
// the per-IP limiter still bounds. GET only — the documented filter surface
// is the query param.
const searchOnlyRateLimit = rateLimit({
  max: 600,
  windowMs: 60 * 60 * 1000,
  keyFn: (c) => {
    const k = c.req.query("key");
    return k ? `key:${hashApiKey(k)}` : `ip:${getClientIp(c)}`;
  },
});
const searchOnlyGate = async (c: Context, next: Next) => {
  const q = (n: string) => c.req.query(n);
  const isSearchOnly =
    !!(q("filter") ?? q("f")) && !(q("trace") ?? q("recipe")) && !!q("key");
  if (isSearchOnly) return searchOnlyRateLimit(c, next);
  return next();
};

// F28: cap multipart bodies at 21 MiB — slight slack over the 20 MiB
// MAX_UPLOAD_BYTES enforced inside storeFile() — so attacker-controlled
// memory pressure is rejected at the framework layer before the body is
// buffered into the Node process. Mounted only on POST (GET has no body).
const CHECK_BODY_LIMIT_BYTES = 21 * 1024 * 1024;
const checkBodyLimit = bodyLimit({
  maxSize: CHECK_BODY_LIMIT_BYTES,
  onError: (c) => c.json({ ok: false, error: "Request body too large" }, 413),
});

const check = new Hono();

// ── HTML escaping ────────────────────────────────────────────────────────────

function esc(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ── Parameter extraction ─────────────────────────────────────────────────────

// ── Param spec: source of truth for /check query-string handling ─────────────
//
// Single table drives:
//   - readParams()              (GET query / POST formData → PageParams)
//   - buildQs()                 (PageParams → query string for outbound links)
//   - renderHiddenCarryFields() (PageParams → hidden inputs for re-check forms)
//   - the PageParams type itself (derived below)
//
// Adding a new param = adding one row here. Every other site is derived,
// including the type — so drift is structurally impossible. This closes the
// class of bug that hit on 2026-05-27: `group` was added to PageParams and the
// readers but never to buildQs's carry-forward list, so the Copy-button URL
// silently dropped `recipe_book` and the second submission landed in the
// api_key's default book (different group_id → unique constraint correctly
// didn't collapse the duplicate).

type RoundTrip = "carry" | "carry-unless-expand" | "override-only";

interface ParamSpec {
  /** Becomes the PageParams field name via the derivation below. */
  field: string;
  /** Canonical wire name in URL query strings */
  wire: string;
  /** Wire-name aliases accepted on read (e.g. ["recipe"] for "trace") */
  aliases: readonly string[];
  /** Whether the value carries forward in buildQs */
  roundTrip: RoundTrip;
  /** When true, the derived PageParams field is `string | null` (else `string | undefined`). */
  nullable?: true;
}

export const CHECK_PARAMS = [
  { field: "key",        wire: "key",                aliases: [],              roundTrip: "carry",                 nullable: true },
  { field: "trace",      wire: "trace",              aliases: ["recipe"],      roundTrip: "carry",                 nullable: true },
  { field: "ef",         wire: "ef",                 aliases: ["evidence"],    roundTrip: "carry",                 nullable: true },
  { field: "ea",         wire: "ea",                 aliases: [],              roundTrip: "carry" },
  { field: "group",      wire: "recipe_book",        aliases: ["group"],       roundTrip: "carry" },
  { field: "readGroups", wire: "read_recipe_books",  aliases: ["read_groups"], roundTrip: "carry" },
  { field: "filter",     wire: "filter",             aliases: ["f"],           roundTrip: "carry" },
  { field: "axes",       wire: "axes",               aliases: [],              roundTrip: "carry" },
  { field: "decidedAt",  wire: "decided_at",         aliases: ["decided"],     roundTrip: "carry" },
  { field: "agentId",    wire: "agent_id",           aliases: [],              roundTrip: "carry" },
  { field: "knownRecipes", wire: "known_recipes",    aliases: [],              roundTrip: "carry" },
  // Opaque session token for known-set stub rendering (token efficiency only —
  // never influences ranking; plan v2 seam 2). Carries forward like the other
  // intent-preserving params so the session survives the re-check form and
  // Copy-URL round-trips; the response echoes the effective (possibly freshly
  // minted) token as data.sessionId.
  { field: "sessionId",  wire: "session_id",         aliases: [],              roundTrip: "carry" },
  { field: "sort",       wire: "sort",               aliases: [],              roundTrip: "carry" },
  // Premium opt-in behavior flag — carries like the other intent-preserving
  // params (agent_id, decided_at) so an opted-in caller keeps synthesis on
  // across the page's re-check form and Copy-URL round-trips, rather than
  // silently losing it on the second submission (the class of bug the
  // CHECK_PARAMS header records). See docs/planning/premium-llm-features.md.
  { field: "synthesize", wire: "synthesize",         aliases: [],              roundTrip: "carry" },
  { field: "clusters",   wire: "clusters",           aliases: [],              roundTrip: "carry-unless-expand" },
  { field: "maxChars",   wire: "max_chars",          aliases: [],              roundTrip: "carry-unless-expand" },
  { field: "page",       wire: "page",               aliases: [],              roundTrip: "override-only" },
  { field: "format",     wire: "format",             aliases: [],              roundTrip: "override-only" },
  { field: "expand",     wire: "expand",             aliases: [],              roundTrip: "override-only" },
  { field: "compact",    wire: "compact",            aliases: [],              roundTrip: "override-only" },
] as const satisfies readonly ParamSpec[];

// PageParams is derived from CHECK_PARAMS. Adding a row grants the field;
// removing a row removes it. `imageFile` is added by intersection — it is a
// File from multipart parsing, not a URL query param, so it lives outside the
// wire-format table.
type FieldFor<S> = S extends { nullable: true } ? string | null : string | undefined;

export type PageParams =
  & { [S in (typeof CHECK_PARAMS)[number] as S["field"]]: FieldFor<S> }
  & { imageFile: File | undefined };

/**
 * Parse a query-source map (Hono query string or POST formData) into
 * PageParams. Wire-name wins over aliases; missing nullable fields default
 * to null, missing non-nullable fields default to undefined. Mirrors the
 * `?? null` / `|| undefined` semantics the inline readers used.
 *
 * `imageFile` is not handled here — multipart files are set by the caller
 * after this returns.
 */
export function readParams(get: (name: string) => string | undefined): PageParams {
  const out: Record<string, unknown> = { imageFile: undefined };
  for (const spec of CHECK_PARAMS) {
    let value = get(spec.wire);
    if (value === undefined) {
      for (const alias of spec.aliases) {
        const v = get(alias);
        if (v !== undefined) { value = v; break; }
      }
    }
    const nullable = "nullable" in spec && spec.nullable === true;
    out[spec.field] = nullable ? (value ?? null) : (value || undefined);
  }
  return out as unknown as PageParams;
}

// Default max_chars for HTML responses when no clustering params are specified.
// Produces ~3-5 compact exemplars. Agents can override via expand=true or explicit clusters/max_chars.
const HTML_DEFAULT_MAX_CHARS = 3000;

// Default clusters for JSON/MCP responses when no clustering params are specified.
// 3 clusters surfaces diverse viewpoints without overwhelming context budgets.
// max_chars overrides this when specified.
const JSON_DEFAULT_CLUSTERS = 3;

/** Parse the known_recipes wire param (comma-separated recipe UUIDs) into a
 *  set. Rendering-only dedup — see the stub branches below. */
function parseKnownRecipes(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

// ── Content negotiation ─────────────────────────────────────────────────────

function wantsJson(c: Context, params: PageParams): boolean {
  if (params.format === "json") return true;
  const accept = c.req.header("accept") ?? "";
  // Prefer JSON if explicitly requested; ignore browser default */*
  return accept.includes("application/json") && !accept.includes("text/html");
}

// ── JSON response builder ───────────────────────────────────────────────────

function buildJsonResponse(
  result: SubmitAndSearchResult,
  enriched: EnrichedResult[],
  page: number,
  knownRecipeIds?: ReadonlySet<string>,
  synthesis?: SynthesisResult,
) {
  if (result.error) {
    return { ok: false, error: result.error };
  }

  const response: Record<string, unknown> = {
    ok: true,
    data: {
      recipeId: result.traceId,
      checkedRecipe: result.traceText,
      searchMode: result.searchMode ?? "semantic",
      clustered: result.clustered ?? false,
      results: enriched.map((r) => {
        // Known-set stub (rendering only — logging and cluster math are
        // untouched upstream; the stub keeps its cluster slot at its true
        // rank). Triggered by client-declared known_recipes ids or the
        // pipeline's session-known flag. Trimmed id-only shape — no recipe
        // gist (operator ruling: the gist is an ossification risk), no
        // createdAt (operator ruling 2026-07-18: trim stub rows). Fetch the
        // full recipe via GET /recipes or get_recipes when needed.
        if (knownRecipeIds?.has(r.id) || r.known) {
          return {
            id: r.id,
            known: true,
            // ONE similarity vocabulary (operator ruling 2026-07-18, recipe
            // ef245b63): the raw cosine, nothing else.
            similarity: r.semanticScore,
            ...(r.clusterSize ? { clusterSize: r.clusterSize } : {}),
          };
        }
        const item: Record<string, unknown> = {
          id: r.id,
          recipe: r.claimText,
          createdAt: r.createdAt,
          // Recipe-book id + name only — the description lives in the
          // briefing (operator ruling 2026-07-18: "It's in the briefing").
          ...(r.group ? { group: { id: r.group.id, name: r.group.name } } : {}),
          similarity: r.semanticScore,
          evidence: r.evidence.map((e) => ({
            interpretation: e.content,
            references: e.references.map((ref) => ({
              quote: ref.quote,
              source: ref.source,
              ...(ref.fileUrl ? {
                fileUrl: ref.fileUrl,
                fileMimeType: ref.fileMimeType,
                ...(ref.originalFilename ? { originalFilename: ref.originalFilename } : {}),
                ...(ref.fileHash ? { fileHash: ref.fileHash } : {}),
                ...(ref.regionMeta ? { regionMeta: ref.regionMeta } : {}),
              } : {}),
            })),
          })),
        };
        if (r.clusterSize) {
          item["clusterSize"] = r.clusterSize;
        }
        // Known cluster-mates (seam 2, "stub, stub, full recipe" — operator
        // design 2026-07-18): this cluster's members the session already
        // holds, each with its raw similarity, beside the full exemplar.
        if (r.knownClusterMembers && r.knownClusterMembers.length > 0) {
          item["knownMembers"] = r.knownClusterMembers;
        }
        return item;
      }),
      totalResults: result.totalResults,
      page,
      totalPages: result.totalPages,
      // The session token in effect for this check — freshly minted when none
      // was presented (self-healing). Callers pass it back as session_id so
      // recipes this session already deposited render as id-only stubs.
      ...(result.sessionId ? { sessionId: result.sessionId } : {}),
      // Which ranking served this response — dated algorithm version +
      // effective switches (docs/architecture/ranking-changelog.md). JSON
      // metadata only; the markdown surfaces stay token-lean.
      ...(result.ranking ? { ranking: result.ranking } : {}),
    },
  };

  if (result.formatWarning) {
    response["formatWarning"] = result.formatWarning;
  }

  // Premium synthesis: exactly one of the profile or the one-line notice, when
  // a caller passed synthesize (mutually exclusive by construction upstream).
  // The shared markdown renderer picks these up for the copy-back and MCP
  // default format for free. See docs/planning/premium-llm-features.md.
  if (synthesis?.synthesis) {
    (response["data"] as Record<string, unknown>)["synthesis"] = synthesis.synthesis;
  } else if (synthesis?.synthesisNotice) {
    (response["data"] as Record<string, unknown>)["synthesisNotice"] = synthesis.synthesisNotice;
  }

  // Related evidence from other recipes (evidence discovery pipeline).
  // recipeId per entry (2026-07-05): without it agents burned full
  // re-checks recovering recipes they'd already half-seen — GET /recipes
  // (or the get_recipes MCP tool) turns that into a cheap lookup. Entry
  // shape trimmed 2026-07-18 (operator ruling): no evidenceId, no constant
  // strategy field.
  if (result.relatedEvidence && result.relatedEvidence.length > 0) {
    const data = response["data"] as Record<string, unknown>;
    data["relatedEvidence"] = result.relatedEvidence.map((e) => ({
      recipeId: e.parentTraceId,
      parentRecipe: e.parentTraceText,
      evidence: e.evidenceContent,
      similarity: e.semanticScore,
    }));
    data["relatedEvidenceHint"] =
      "Each entry carries the source recipe's UUID as recipeId — fetch the full recipe with GET /recipes?ids=<recipeId> (same API key) instead of re-checking.";
  }
  // Known evidence parents (seam 2): parents whose evidence would have made
  // the selection but the session already holds them — id + best evidence
  // similarity per parent (ONE similarity vocabulary, recipe ef245b63).
  if (result.relatedEvidenceKnown && result.relatedEvidenceKnown.length > 0) {
    (response["data"] as Record<string, unknown>)["relatedEvidenceKnown"] =
      result.relatedEvidenceKnown;
  }

  // Concept-axis positions (TCAV-style projection)
  // Research basis: Kim et al. 2018, "Testing with Concept Activation Vectors" (ICLR)
  if (result.conceptAxes) {
    (response["data"] as Record<string, unknown>)["conceptAxes"] = result.conceptAxes;
  }

  return response;
}

/**
 * JSON shape for the read-only `filter` search path — same result mapping
 * as a check, minus everything that implies a logged trace (recipeId,
 * checkedRecipe), plus an explicit searchOnly marker and notice.
 */
function buildSearchOnlyJsonResponse(
  result: SubmitAndSearchResult,
  enriched: EnrichedResult[],
  page: number,
  filter: string,
  knownRecipeIds?: ReadonlySet<string>,
) {
  const response = buildJsonResponse(result, enriched, page, knownRecipeIds);
  if (response["ok"] !== true) return response;
  const data = response["data"] as Record<string, unknown>;
  delete data["recipeId"];
  delete data["checkedRecipe"];
  response["data"] = {
    searchOnly: true,
    filter,
    notice: "Read-only search — no recipe was logged.",
    ...data,
  };
  return response;
}

// ── Premium synthesis ─────────────────────────────────────────────────────────

/**
 * Resolve the premium synthesis result for a completed check — only when the
 * caller opted in via synthesize=true and the request logged a recipe (never
 * the search-only path, per the brief's scope). The userId comes from a
 * dedicated validateKey lookup performed only on this branch, so non-synthesize
 * requests never pay for it and the audited api-key seam stays untouched
 * (recipe 5c33168b). Returns undefined when synthesis wasn't requested — the
 * response then stays byte-identical to today.
 */
async function resolveSynthesis(
  db: PostgresJsDatabase,
  params: PageParams,
  result: SubmitAndSearchResult,
  enriched: EnrichedResult[],
  searchOnly: boolean,
): Promise<SynthesisResult | undefined> {
  if (searchOnly || params.synthesize !== "true") return undefined;
  const keyResult = params.key ? await validateKey(db, params.key) : null;
  // A completed check implies a valid key; the null branch is defensive and
  // degrades to the ineligible notice rather than surfacing an error.
  if (!keyResult) return { synthesisNotice: SYNTHESIS_INELIGIBLE_NOTICE };
  return maybeSynthesize({
    db,
    userId: keyResult.userId,
    requested: true,
    checkedRecipe: result.traceText ?? params.trace ?? "",
    results: enriched,
    relatedEvidence: result.relatedEvidence,
  });
}

// ── Query string builder ─────────────────────────────────────────────────────

export function buildQs(params: PageParams, overrides: Record<string, string> = {}): string {
  const overrideKeys = new Set(Object.keys(overrides));
  const parts: string[] = [];

  for (const spec of CHECK_PARAMS) {
    if (spec.roundTrip === "override-only") continue;
    if (overrideKeys.has(spec.wire)) continue;                                       // override wins
    if (spec.roundTrip === "carry-unless-expand" && overrideKeys.has("expand")) continue;  // expand cancels clustering

    const value = params[spec.field];
    if (value) parts.push(`${spec.wire}=${encodeURIComponent(value)}`);
  }

  for (const [k, v] of Object.entries(overrides)) {
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/**
 * Render hidden form inputs that round-trip URL state (recipe_book, axes,
 * read_recipe_books, etc.) through the "Re-check with file" form. Same
 * carry-forward set as buildQs, same source of truth (CHECK_PARAMS).
 */
function renderHiddenCarryFields(params: PageParams): string {
  const fields: string[] = [];
  for (const spec of CHECK_PARAMS) {
    if (spec.roundTrip === "override-only") continue;
    const value = params[spec.field];
    if (value) {
      fields.push(`<input type="hidden" name="${spec.wire}" value="${esc(String(value))}">`);
    }
  }
  return fields.join("\n        ");
}

// ── Evidence HTML renderer ──────────────────────────────────────────────────

function renderReferenceMedia(_ref: EnrichedReference): string {
  // File serving removed (F10 security fix — uploads no longer served directly)
  return "";
}

function renderEvidenceEntry(e: EnrichedEvidence): string {
  const refs = e.references
    .map((ref) => `<blockquote>${esc(ref.quote)}</blockquote><cite>${esc(ref.source)}</cite>${renderReferenceMedia(ref)}`)
    .join("\n");
  return `<li>${esc(e.content)}${refs ? `\n${refs}` : ""}</li>`;
}

function renderEvidenceHtml(label: string, items: EnrichedEvidence[]): string {
  if (items.length === 0) return "";
  const entries = items.map(renderEvidenceEntry).join("\n");
  return `<p><strong>${esc(label)}:</strong></p><ul>${entries}</ul>`;
}

/** Pick the single most informative evidence entry — prefers one with a quote+source reference. */
function pickBestEvidence(items: EnrichedEvidence[]): EnrichedEvidence | undefined {
  if (items.length === 0) return undefined;
  // Score: has quote+source > has quote > has source > has content > nothing
  let best = items[0]!;
  let bestScore = 0;
  for (const e of items) {
    let score = e.content.length > 20 ? 1 : 0;
    for (const ref of e.references) {
      if (ref.quote) score += 2;
      if (ref.source) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** Render the single best evidence entry, with a "N more" count for the rest. */
function renderCompactEvidence(items: EnrichedEvidence[]): string {
  let html = "";

  const best = pickBestEvidence(items);
  if (best) {
    html += `<ul>${renderEvidenceEntry(best)}</ul>`;
    if (items.length > 1) {
      html += `<p><small>${items.length - 1} more evidence entr${items.length - 1 === 1 ? "y" : "ies"}</small></p>`;
    }
  }

  return html;
}

// ── Page renderer ────────────────────────────────────────────────────────────

interface KeyGroup {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  canWrite: boolean;
  isDefault: boolean;
}

function renderPage(
  params: PageParams,
  result?: SubmitAndSearchResult,
  enriched?: EnrichedResult[],
  keyGroups?: KeyGroup[],
  nonce?: string,
  synthesisResult?: SynthesisResult,
): string {
  const hasSearch = !!(params.trace && params.ef && params.key);
  // A result with no traceId is the read-only `filter` search — nothing was
  // logged, so no "checked as #" confirmation and no re-check affordances.
  const isSearchOnly = !!(result && !result.error && !result.traceId);
  const isCompact = params.compact !== "false";

  // Build Next Steps block — shown whenever a check completed successfully,
  // even when there are no matching recipes (empty corpus, unique claim, etc).
  // Hoisting the "Your recipe was checked as #..." confirmation out of
  // resultsHtml was previously tracked as a backlog item; it also matters for
  // agent auto-submit flows — the agent sees confirmation + a Copy button for
  // the JSON response + an optional path to add a file attachment, without
  // having to re-submit the form manually.
  let nextStepsHtml = "";
  if (result && !result.error && isSearchOnly) {
    nextStepsHtml = `
  <section id="search-only-notice" style="background:#f0efe3;padding:0.75rem 1rem;border-radius:4px;margin:0.5rem 0">
    <p style="margin:0.25rem 0"><strong>Read-only search${params.filter ? ` for &ldquo;${esc(params.filter)}&rdquo;` : ""}</strong> &mdash; no recipe was logged.</p>
    <p style="font-size:0.85em;color:#555;margin:0.25rem 0">To log a genuine taste/judgment call instead, submit a recipe with evidence below or add <code>recipe=</code> and <code>evidence=</code> params (keeping <code>filter=</code> narrows that check's results by keyword).</p>
  </section>`;
  }
  if (result && !result.error && hasSearch && result.traceId) {
    const jsonQs = buildQs(params, { format: "json" });
    const hiddenCarryFields = renderHiddenCarryFields(params);

    // Markdown copy-back (2026-07-05, absorbs the backlog "Markdown response
    // option for web /check page" item): the same renderer that serves the
    // MCP default format, fenced so a paste into a chat UI renders as an
    // attachment-like card. Readable by the human on the way back to their
    // agent — the 2026-05-27 demo showed raw JSON alienates even technical
    // users. format=json stays unchanged for API integrators.
    const page = params.page ? parseInt(params.page, 10) : 1;
    const knownIds = parseKnownRecipes(params.knownRecipes);
    const markdownFenced = fenceCheckResponseMarkdown(
      renderCheckResponseMarkdown(
        buildJsonResponse(result, enriched ?? [], page, knownIds, synthesisResult) as unknown as CheckResponseJson,
        { knownRecipeIds: [...knownIds] },
      ),
    );

    nextStepsHtml = `
  <section id="next-steps" style="background:#f0efe3;padding:0.75rem 1rem;border-radius:4px;margin:0.5rem 0">
    <p style="margin:0.25rem 0"><strong>Your recipe was checked as #${esc(result.traceId)}</strong>
    <button id="copy-md-btn" style="font-size:0.85em;padding:3px 10px;margin-left:1em;cursor:pointer">Copy results for AI agent</button>
    <button id="copy-json-btn" style="font-size:0.85em;padding:3px 10px;margin-left:0.5em;cursor:pointer">Copy as JSON</button></p>
    <script nonce="${nonce ?? ""}">
    document.getElementById('copy-md-btn').addEventListener('click',function(){var btn=this;var txt=document.getElementById('md-result').textContent;function ok(){btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy results for AI agent'},2000)}try{navigator.clipboard.writeText(txt).then(ok).catch(function(){var ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);ok()})}catch(e){console.error(e);btn.textContent='Copy failed: '+e.message}});
    document.getElementById('copy-json-btn').addEventListener('click',function(){var btn=this;btn.textContent='Fetching...';var url='/check${jsonQs.replace(/'/g, "\\'")}';try{var blob=fetch(url).then(function(r){return r.text()}).then(function(t){return new Blob([t],{type:'text/plain'})});navigator.clipboard.write([new ClipboardItem({'text/plain':blob})]).then(function(){btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy as JSON'},2000)}).catch(function(e){fetch(url).then(function(r){return r.text()}).then(function(j){var ta=document.createElement('textarea');ta.value=j;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy as JSON'},2000)}).catch(function(e2){console.error(e2);btn.textContent='Copy failed: '+e2.message})})}catch(e){console.error(e);btn.textContent='Copy failed: '+e.message}});
    </script>
    <details style="margin-top:0.5rem">
      <summary style="cursor:pointer;font-size:0.9em">Results as markdown &mdash; readable report to paste into any AI chat</summary>
      <pre id="md-result" style="white-space:pre-wrap;font-size:0.8em;background:#faf9f2;border:1px solid #ddd;border-radius:4px;padding:0.5rem;max-height:24rem;overflow:auto">${esc(markdownFenced)}</pre>
    </details>
    <details style="margin-top:0.5rem">
      <summary style="cursor:pointer;font-size:0.9em">Add a file attachment &mdash; image, video, audio, or PDF as reference evidence</summary>
      <form method="post" action="/check" enctype="multipart/form-data" style="margin-top:0.5rem">
        ${hiddenCarryFields}
        <input type="file" name="image" accept="${HTML_ACCEPT_TYPES}" required>
        <button type="submit" style="font-size:0.85em;padding:3px 10px;cursor:pointer">Re-check with file</button>
        <p style="font-size:0.75em;color:#888;margin:0.3em 0">Re-submits the same recipe and evidence with the attached file. The original recipe stays unchanged.</p>
      </form>
    </details>
  </section>`;
  }

  // Build results HTML
  let resultsHtml = "";
  if (result && !result.error && (hasSearch || isSearchOnly) && enriched) {
    const knownIdsForHtml = parseKnownRecipes(params.knownRecipes);
    const resultItems = enriched
      .map((r) => {
        // ONE similarity vocabulary (recipe ef245b63): the raw cosine as a
        // percentage, or an honest n/a — no combined/lexical fallbacks.
        const scoreDetail =
          r.semanticScore !== null && r.semanticScore !== undefined
            ? `${Math.round(r.semanticScore * 100)}% similar`
            : "similarity n/a";

        // Known-set stub — one line: id + similarity, no recipe text (id-only
        // ruling; the caller already holds the body). Rendering only; the
        // result still occupies its cluster slot. Triggered by declared
        // known_recipes ids or the pipeline's session-known flag.
        if (knownIdsForHtml.has(r.id) || r.known) {
          return `
    <article class="result">
      <p><small><code>${esc(r.id)}</code> [known to you] ${esc(scoreDetail)}${r.clusterSize ? ` &mdash; represents ${r.clusterSize} similar recipes` : ""}</small></p>
    </article>`;
        }

        // Cluster drill-down: search using the exemplar's text to find all its cluster members.
        // In search-only mode the drill link stays search-only (filter as the
        // semantic query) — a read-only page must not mint links that log.
        let clusterHtml = "";
        if (r.clusterSize && r.clusterSize > 1) {
          const drillQs = isSearchOnly
            ? buildQs({
              ...params,
              filter: r.claimText,
              trace: null,
              ef: null,
              clusters: undefined,
              maxChars: undefined,
              expand: undefined,
              compact: undefined,
            } as PageParams, { expand: "true" })
            : buildQs({
              ...params,
              trace: r.claimText,
              ef: r.evidence[0]?.content || params.ef || "",
              clusters: undefined,
              maxChars: undefined,
              expand: undefined,
              compact: undefined,
            } as PageParams, { expand: "true" });
          clusterHtml = `\n      <a class="cluster-size" href="/check${drillQs}">Explore ${r.clusterSize} similar recipes in this cluster</a>`;
        }

        // Default: single best evidence entry. Full: all evidence.
        const evidenceHtml = isCompact
          ? renderCompactEvidence(r.evidence)
          : renderEvidenceHtml("Evidence", r.evidence);

        const groupHtml = r.group ? `<span class="group">[${esc(r.group.name)}]</span> ` : "";

        // Known cluster-mates (seam 2, "stub, stub, full recipe"): members of
        // this cluster the caller already holds, listed as id-stubs beside
        // the full exemplar.
        const knownMembersHtml = r.knownClusterMembers && r.knownClusterMembers.length > 0
          ? `\n      <p><small>Cluster also holds ${r.knownClusterMembers.length} you've seen: ${r.knownClusterMembers.map((m) => `<code>${esc(m.id)}</code> ${Math.round(m.similarity * 100)}%`).join(", ")}</small></p>`
          : "";

        return `
    <article class="result">
      <p>${groupHtml}${esc(r.claimText)}</p>
      <span class="rank">${esc(scoreDetail)}</span>${clusterHtml}${knownMembersHtml}
      ${evidenceHtml}
    </article>`;
      })
      .join("\n");

    const currentSort = params.sort || "relevance";
    const sortRelevanceQs = buildQs(params, { sort: "relevance" });
    const sortRecentQs = buildQs(params, { sort: "recent" });

    let paginationHtml = "";
    if (result.totalPages > 1) {
      const prevPage = result.currentPage > 1 ? result.currentPage - 1 : null;
      const nextPage =
        result.currentPage < result.totalPages ? result.currentPage + 1 : null;
      const pageLabel = result.clustered
        ? `Batch ${result.currentPage} of ${result.totalPages} (${result.totalResults} total recipes)`
        : `Page ${result.currentPage} of ${result.totalPages}`;
      paginationHtml = `
    <nav>
      ${pageLabel}
      ${prevPage ? `<a href="/check${buildQs(params, { page: String(prevPage) })}">&#8592; prev</a>` : ""}
      ${nextPage ? `<a href="/check${buildQs(params, { page: String(nextPage) })}">${result.clustered ? "next batch" : "next"} &#8594;</a>` : ""}
    </nav>`;
    }

    const searchModeLabel = `Search mode: ${result.searchMode ?? "semantic"}`;

    // Confirmation + Copy button moved to nextStepsHtml. This block renders
    // only the matching recipes, their ranking, and related evidence.
    resultsHtml = `
  <section id="results">
    <p><em>${esc(searchModeLabel)}</em></p>

    <h2>Similar recipes (${result.totalResults} found${result.clustered ? `, ${result.results.length} exemplars shown` : ""})</h2>
    ${result.clustered ? `<p>Clustered by similarity. Each exemplar represents a group.
      <a href="/check${buildQs(params, { expand: "true" })}">Show all</a>
      ${!(params.clusters || params.maxChars) ? ` | <a href="/check${buildQs(params, { clusters: "10" })}">More exemplars</a>` : ""}
      ${isCompact ? ` | <a href="/check${buildQs(params, { compact: "false" })}">Show all evidence</a>` : ""}
    </p>` : ""}
    <p>Sort:
      ${currentSort === "relevance" ? "<strong>relevance</strong>" : `<a href="/check${sortRelevanceQs}">relevance</a>`}
      |
      ${currentSort === "recent" ? "<strong>recent</strong>" : `<a href="/check${sortRecentQs}">recent</a>`}
    </p>

    ${result.results.length > 0 ? resultItems : "<p>No matching recipes found.</p>"}
    ${paginationHtml}
  </section>`;

    // Related evidence from other recipes (evidence discovery pipeline).
    // Known parents render as ONE compact line of ids, not per-row stubs
    // (seam 2, 2026-07-18 reshape).
    if ((result.relatedEvidence && result.relatedEvidence.length > 0)
      || (result.relatedEvidenceKnown && result.relatedEvidenceKnown.length > 0)) {
      const knownParentsHtml = result.relatedEvidenceKnown && result.relatedEvidenceKnown.length > 0
        ? `\n    <p><small>Known evidence parents (already shown): ${result.relatedEvidenceKnown.map((p) => `<code>${esc(p.recipeId)}</code> ${Math.round(p.similarity * 100)}%`).join(", ")}</small></p>`
        : "";
      resultsHtml += `
  <section id="related-evidence">
    <h2>Related evidence from other recipes</h2>
    <p><small>Surfaced via cosine-similarity search over gemini-embedding-2-preview vectors &mdash;
    evidence from other recipes that is topically related to yours. The system makes no stance assertion;
    you decide if it supports, contradicts, or adds context.</small></p>
    <ul>
      ${(result.relatedEvidence ?? []).map((e) => `
      <li>
        <p>${esc(e.evidenceContent)}</p>
        <p><small>From recipe <code>${esc(e.parentTraceId)}</code>: <em>${esc(e.parentTraceText.slice(0, 120))}${e.parentTraceText.length > 120 ? "..." : ""}</em>
        (${Math.round(e.semanticScore * 100)}% similar)</small></p>
      </li>`).join("\n")}
    </ul>${knownParentsHtml}
    <p><small>Fetch any full recipe by id: <code>GET /recipes?ids=&lt;id&gt;</code> with the same API key (Bearer), or the <code>get_recipes</code> MCP tool.</small></p>
  </section>`;
    }

  }

  // Error section
  let errorHtml = "";
  if (result?.error) {
    errorHtml = `<div class="error"><strong>Error:</strong> ${esc(result.error)}</div>`;
  }

  // Format warning section
  let formatWarningHtml = "";
  if (result?.formatWarning) {
    formatWarningHtml = `<div class="warning" style="background:#fff3cd;border:1px solid #ffc107;padding:0.75rem 1rem;border-radius:4px;margin:0.5rem 0"><strong>Format suggestion:</strong> ${esc(result.formatWarning)}</div>`;
  }

  // Instructions: show fully only on empty form, collapse when results present
  let instructionsHtml: string;
  const keyParam = params.key ? `?key=${encodeURIComponent(params.key)}` : "";
  const guideUrl = `/docs/recipe-check-guide${keyParam}`;
  const mcpSetupUrl = `/docs/mcp-setup${keyParam}`;
  const bootstrapUrl = `/docs/bootstrap${keyParam}`;

  // Cross-link to SPA for humans without a key
  const frontendBase = process.env["FRONTEND_URL"] ?? "https://soup.net";
  const noKeyNotice = !params.key
    ? `
  <section id="human-notice" style="background:#f0efe3;padding:0.75rem 1rem;border-radius:4px;margin:0.5rem 0">
    <p><strong>Human?</strong> This page is designed for AI agents. For a richer experience, visit <a href="${esc(frontendBase)}/check">${esc(frontendBase)}</a> to sign in, get an API key, and check recipes from your dashboard.</p>
    <p>If you&rsquo;re an AI agent, you need an API key in the URL: <code>/check?key=YOUR_KEY</code>. Your human can generate one at <a href="${esc(frontendBase)}/keys">${esc(frontendBase)}/keys</a>.</p>
  </section>`
    : "";

  if (hasSearch || isSearchOnly) {
    // Minimal: just links for returning agents
    instructionsHtml = `
  <p><small><a href="${guideUrl}">Recipe check guide</a> | <a href="${mcpSetupUrl}">MCP setup</a> | <a href="${bootstrapUrl}">Bootstrap</a> &mdash; <code>?format=json</code> for structured data</small></p>`;
  } else {
    // Full instructions for first-time visitors
    instructionsHtml = `${noKeyNotice}
  <section id="instructions">
    <details open>
      <summary>How to check a recipe</summary>
      <p>This is <strong>Soup.net</strong> &mdash; a <a href="https://en.wikipedia.org/wiki/Stigmergy">stigmergic</a> environment for taste and judgment.</p>
      <p>Checking a recipe means: you bring a hypothesis (a taste preference or judgment call) with evidence, and we find similar recipes others have checked. Your recipe is added to the soup, making future checks smarter.</p>
      <p>This is semantic similarity matching, not Q&amp;A. Recipes are hypotheses with evidence &mdash; agents submitting questions (&ldquo;What fonts does the user prefer?&rdquo;) get noisier results than agents submitting claims they actually hold.</p>
      <p><strong>Recipe format:</strong> <code>As a [role] working on [goal], I [prefer/chose/decided] so that [reason]</code><br>Every recipe needs context &mdash; the role and goal scope the judgment.</p>
      <p><a href="${guideUrl}">Full guide with examples</a> | <a href="${mcpSetupUrl}">Set up MCP tools</a> | <a href="${bootstrapUrl}">Bootstrap your corpus</a></p>
    </details>
  </section>

  <section id="examples">
    <details>
      <summary>Examples (good and bad recipes)</summary>

      <div class="trace-example">
        <p><strong>Good recipe &mdash; taste preference:</strong></p>
        <p><strong>Recipe:</strong> As a frontend developer working on the company dashboard, I chose a component-first architecture with Radix primitives so that accessibility is built-in rather than bolted on.</p>
        <p><strong>Evidence for:</strong> Radix provides unstyled, accessible components that handle keyboard navigation, focus management, and ARIA attributes out of the box.<br>&gt; &quot;Radix saves us from reimplementing WAI-ARIA patterns in every component&quot;<br>&mdash; Architecture decision meeting, 2026-03-10</p>
      </div>

      <div class="trace-example" style="margin-top:0.75rem">
        <p><strong>Good recipe &mdash; meta-hypothesis about where to look:</strong></p>
        <p><strong>Recipe:</strong> As a backend developer working on a Node app, I want my AI agents to ask me about data retention preferences for working files rather than assuming defaults.</p>
        <p><strong>Evidence for:</strong> Checked Claude Code memory &mdash; no retention preferences found. This knowledge gap should be filled by asking directly.<br>&gt; &quot;No data retention preferences in memory files&quot;<br>&mdash; Claude Code memory check, 2026-03-25</p>
      </div>

      <div class="trace-example" style="margin-top:0.75rem">
        <p><strong>Bad &mdash; this is a question, not a recipe:</strong></p>
        <p>&ldquo;What are the preferences about fonts?&rdquo; &mdash; This is a Q&amp;A query, not a recipe. If you have no hypothesis, ask the user or check other sources first.</p>
      </div>
    </details>
  </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Soup.net &mdash; Check a Recipe</title>
  <link rel="stylesheet" href="/check-style.css">
</head>
<body>
  <header>
    <h1>Soup.net &mdash; Check a Recipe</h1>
  </header>

  ${instructionsHtml}

  ${errorHtml}

  ${formatWarningHtml}

  ${nextStepsHtml}

  ${resultsHtml}

  <form method="post" action="/check" enctype="multipart/form-data">
    <input type="hidden" name="key" value="${esc(params.key)}">

    <label for="recipe">Recipe with evidence</label>
    <textarea id="recipe" name="recipe" required rows="6" placeholder="As a [role] working on [goal], I [chose/prefer] so that [reason]&#10;&#10;Your interpretation of the evidence&#10;&gt; &quot;Direct quote from source&quot;&#10;-- Source citation">${params.trace && params.ef ? esc(params.trace + "\n\n" + params.ef) : esc(params.trace ?? "")}</textarea>
    <p style="font-size:0.75em;color:#888;margin-top:2px">First paragraph is the recipe. After a blank line, supporting evidence: interpretation, then <code>&gt; "quote"</code> and <code>-- source</code>.</p>

    <label for="image">File (optional &mdash; image, video, audio, or PDF as reference evidence)</label>
    <input type="file" id="image" name="image" accept="${HTML_ACCEPT_TYPES}">

    ${keyGroups && keyGroups.length > 0 ? `
    <details${keyGroups.filter((g) => g.canWrite).length > 1 ? " open" : ""}>
      <summary>Your recipe books (${keyGroups.length})</summary>
      <ul style="font-size:0.85em;margin:0.3em 0">
        ${keyGroups.map((g) => {
          const desc = g.description?.trim() ? ` &mdash; <em>${esc(g.description.trim())}</em>` : "";
          return `<li><code>${esc(g.slug)}</code> &mdash; ${esc(g.name)} (${g.canWrite ? "read/write" : "read"}${g.isDefault ? ", default" : ""})${desc}</li>`;
        }).join("\n        ")}
      </ul>
      <p style="font-size:0.75em;color:#888;margin:0.3em 0">Use slug in URLs: <code>&amp;recipe_book=SLUG</code> to write, <code>&amp;read_recipe_books=SLUG1,SLUG2</code> to search. Legacy <code>&amp;group=</code> / <code>&amp;read_groups=</code> still accepted.</p>
    </details>
    ${keyGroups.filter((g) => g.canWrite).length > 1 ? `
    <label for="group">Write to recipe book</label>
    <select id="group" name="group">
      ${keyGroups.filter((g) => g.canWrite).map((g) =>
        `<option value="${esc(g.slug)}"${g.isDefault ? " selected" : ""}${params.group === g.slug ? " selected" : ""}>${esc(g.name)}${g.isDefault ? " (default)" : ""}</option>`
      ).join("\n      ")}
    </select>
    ` : ""}` : ""}

    <details>
      <summary>Advanced</summary>

      <label for="axes">Concept axes (two terms, comma-separated &mdash; positions results by similarity to each)</label>
      <input type="text" id="axes" name="axes" placeholder="accessibility, performance" value="${esc(params.axes)}">

      <label for="read_groups">Search recipe books (comma-separated slugs &mdash; default: all)</label>
      <input type="text" id="read_groups" name="read_groups" placeholder="all recipe books" value="${esc(params.readGroups)}">
      <label for="max_chars">Max response size (characters &mdash; auto-clusters to fit)</label>
      <input type="number" id="max_chars" name="max_chars" placeholder="2000" value="${esc(params.maxChars)}">

      <label for="clusters">Cluster count (reduce results to k exemplars)</label>
      <input type="number" id="clusters" name="clusters" placeholder="5" value="${esc(params.clusters)}">

      <label for="mix">Mix traces (trace_id:weight, comma-separated)</label>
      <input type="text" id="mix" name="mix" placeholder="4821:1.0, 3102:0.5, 3450:-0.3">
    </details>

    <button type="submit">Check Recipe</button>
  </form>
</body>
</html>`;
}

// ── Invalid-key state (key-death UX, 2026-07-05) ────────────────────────────
//
// A keyed-but-invalid request must never fall through to the anonymous page
// (the 2026-07-05 evals' #1 finding: yesterday's briefing link silently
// became a documentation page and agents abandoned the tool). The no-key
// anonymous page is untouched — it's a legitimate zero-setup surface.
//
// Anti-enumeration: validateKey collapses "expired" and "never existed" to
// the same null, and this page renders identically for both. It also never
// echoes the presented key.

function renderInvalidKeyPage(): string {
  const frontendBase = process.env["FRONTEND_URL"] ?? "https://soup.net";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Soup.net &mdash; API key invalid or expired</title>
  <link rel="stylesheet" href="/check-style.css">
</head>
<body>
  <header>
    <h1>Soup.net &mdash; API key invalid or expired</h1>
  </header>

  <section id="invalid-key" style="background:#fff3cd;border:1px solid #ffc107;padding:0.75rem 1rem;border-radius:4px;margin:0.5rem 0">
    <p><strong>The API key on this request is invalid or expired.</strong> (The two cases are deliberately indistinguishable.)</p>
    <p>How to recover:</p>
    <ul>
      <li>Your human can sign in at <a href="${esc(frontendBase)}/app/keys">${esc(frontendBase)}/app/keys</a> and mint a new key.</li>
      <li>Daily keys expire every 24 hours &mdash; a briefing URL from yesterday carries yesterday&rsquo;s key. Copying a fresh briefing refreshes the key too.</li>
      <li>The new key works immediately on this page: <code>/check?key=NEW_KEY</code> (add <code>&amp;format=json</code> for structured data). No MCP reconnect needed.</li>
    </ul>
    <p><small>If you&rsquo;re an AI agent seeing this mid-task: tell your human the Soup.net key needs re-minting rather than continuing without recipe checks.</small></p>
  </section>
</body>
</html>`;
}

// ── Shared handler logic ────────────────────────────────────────────────────

async function handleCheck(
  c: Context,
  params: PageParams,
) {
  const jsonMode = wantsJson(c, params);

  // Key-death gate: a present-but-invalid key gets an explicit 401 state on
  // both content types — never the anonymous fallback page. Runs before any
  // service work so nothing downstream sees a dead key.
  if (params.key) {
    const keyCheck = await validateKey(getDb(), params.key);
    if (!keyCheck) {
      if (jsonMode) {
        return c.json(
          {
            ok: false,
            error: invalidKeyMessage(),
            remediation: {
              keysUrl: keysPageUrl(),
              note: "Sign in and mint a new key; a fresh key works on /check immediately with no MCP reconnect. Invalid and expired keys are deliberately indistinguishable.",
            },
          },
          401,
        );
      }
      return c.html(renderInvalidKeyPage(), 401);
    }
  }

  // For HTML responses, default to clustered results unless explicitly expanded
  // or the caller already specified clustering params.
  const isExpanded = params.expand === "true";
  const hasExplicitClustering = !!(params.clusters || params.maxChars);
  const useDefaultHtmlClustering = !jsonMode && !isExpanded && !hasExplicitClustering;
  const useDefaultJsonClustering = jsonMode && !hasExplicitClustering;

  // Convert uploaded file to image attachment if present
  let image: { buffer: Buffer; mimeType: string; filename: string } | undefined;
  if (params.imageFile) {
    const arrayBuf = await params.imageFile.arrayBuffer();
    image = {
      buffer: Buffer.from(arrayBuf),
      mimeType: params.imageFile.type,
      filename: params.imageFile.name,
    };
  }

  // Combined field: if recipe is provided without separate evidence, split on blank line.
  // First paragraph = recipe, remaining paragraphs = evidence.
  if (params.trace && !params.ef) {
    const parts = params.trace.split(/\n\s*\n/);
    if (parts.length >= 2) {
      params.trace = parts[0]!.trim();
      params.ef = parts.slice(1).join("\n\n").trim();
    }
  }

  // Connection surface (UVP Layer 1): the stdio MCP proxy self-identifies
  // via this header; anything else through /check is "web". The /mcp route
  // stamps "mcp-http" itself without touching this path.
  const surface = c.req.header("x-soupnet-surface") === "mcp-stdio" ? "mcp-stdio" : "web";

  // Known-set ids the client declared (known_recipes). Parsed once — the set
  // drives route-side stub rendering; the array joins the session's own
  // deposits inside the service to form the full known-set.
  const knownRecipeIds = parseKnownRecipes(params.knownRecipes);

  let result: SubmitAndSearchResult | undefined;
  let searchOnly = false;
  if (params.trace && params.ef && params.key) {
    result = await submitAndSearch({
      surface,
      key: params.key,
      traceText: params.trace,
      evidenceFor: params.ef,
      // evidence_against removed from ingest (negation problem — embeddings can't
      // distinguish stance). Related evidence is surfaced via discovery pipeline instead.
      sort: params.sort,
      page: params.page ? parseInt(params.page, 10) : undefined,
      clusters: params.clusters
        ? parseInt(params.clusters, 10)
        : useDefaultJsonClustering
          ? JSON_DEFAULT_CLUSTERS
          : undefined,
      maxChars: params.maxChars
        ? parseInt(params.maxChars, 10)
        : useDefaultHtmlClustering
          ? HTML_DEFAULT_MAX_CHARS
          : undefined,
      image,
      axes: params.axes,
      targetGroup: params.group,
      readGroups: params.readGroups,
      decidedAt: params.decidedAt,
      agentId: params.agentId,
      // filter alongside a recipe narrows the candidate set by keyword;
      // the check itself logs normally.
      keywordFilter: params.filter,
      sessionId: params.sessionId,
      knownRecipeIds: knownRecipeIds.size > 0 ? [...knownRecipeIds] : undefined,
    });
  } else if (params.key && params.filter && !params.trace) {
    // The sanctioned no-logging path: filter (alias f) with no recipe runs a
    // read-only keyword search over the key's read scope. No trace, no
    // recipe.checked audit row — searchWithoutLogging writes a check.searched
    // accounting row instead. Implemented 2026-07-05 (operator decision
    // resolving the backlog [DECISION NEEDED] item).
    searchOnly = true;
    result = await searchWithoutLogging({
      surface,
      key: params.key,
      filter: params.filter,
      sort: params.sort,
      page: params.page ? parseInt(params.page, 10) : undefined,
      clusters: params.clusters
        ? parseInt(params.clusters, 10)
        : useDefaultJsonClustering
          ? JSON_DEFAULT_CLUSTERS
          : undefined,
      maxChars: params.maxChars
        ? parseInt(params.maxChars, 10)
        : useDefaultHtmlClustering
          ? HTML_DEFAULT_MAX_CHARS
          : undefined,
      axes: params.axes,
      readGroups: params.readGroups,
    });
  }

  // Per-stage latency attribution (embed/write/search/evidence/cluster/total)
  // as a Server-Timing header on both JSON and HTML responses — never in the
  // payload. See docs/rough-notes/2026-07-01/recipe-check-latency-findings.md.
  if (result?.serverTiming) {
    c.header("Server-Timing", result.serverTiming);
  }

  // JSON response path
  if (jsonMode) {
    if (!result) {
      if (!params.key) {
        return c.json({
          ok: false,
          error: "No API key provided. Generate one at " + keysPageUrl(),
        }, 400);
      }
      // Accurate per-request diff in modern vocabulary (2026-07-05 eval
      // finding: the old static "key, trace, ef" list named params the
      // caller had already provided, in legacy names, and mis-taught agents
      // that the documented modern names don't work).
      const missing: string[] = [];
      if (!params.trace) missing.push("recipe (alias: trace)");
      if (!params.ef) missing.push("evidence (alias: ef)");
      return c.json({
        ok: false,
        error:
          `Missing required parameter${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
          "To check a recipe, provide both. Just looking for something? Use filter=<keywords> (alias f) for a read-only search that logs nothing.",
      }, 400);
    }
    if (result.error) {
      return c.json({ ok: false, error: result.error }, 400);
    }
    const db = getDb();
    let enriched = await enrichResults(db, result.results);
    enriched = await clusterEvidenceInResults(db, enriched);
    const page = params.page ? parseInt(params.page, 10) : 1;
    const synthesis = await resolveSynthesis(db, params, result, enriched, searchOnly);
    return c.json(searchOnly
      ? buildSearchOnlyJsonResponse(result, enriched, page, params.filter ?? "", knownRecipeIds)
      : buildJsonResponse(result, enriched, page, knownRecipeIds, synthesis));
  }

  // HTML response path — always enrich + cluster evidence
  let enriched: EnrichedResult[] | undefined;
  if (result && !result.error && result.results.length > 0) {
    const db = getDb();
    enriched = await enrichResults(db, result.results);
    enriched = await clusterEvidenceInResults(db, enriched);
  }

  // Premium synthesis for the markdown copy-back block (same computation the
  // JSON path runs). Only fires when synthesize=true and a recipe was logged.
  let synthesisResult: SynthesisResult | undefined;
  if (result && !result.error && enriched) {
    synthesisResult = await resolveSynthesis(getDb(), params, result, enriched, searchOnly);
  }

  // Look up key's groups for the form dropdown (if key is provided)
  let keyGroups: KeyGroup[] | undefined;
  if (params.key) {
    try {
      const db = getDb();
      const keyResult = await validateKey(db, params.key);
      if (keyResult) {
        const allIds = [...new Set([...keyResult.readGroupIds, ...keyResult.writeGroupIds])];
        if (allIds.length > 0) {
          const rows = await db.execute(sql`
            SELECT id, slug, name, description FROM claimnet.groups
            WHERE id IN (${sql.join(allIds.map((id: string) => sql`${id}::uuid`), sql`, `)})
            ORDER BY name
          `);
          keyGroups = (rows as unknown as Array<{ id: string; slug: string; name: string; description: string | null }>).map((g) => ({
            id: g.id,
            slug: g.slug,
            name: g.name,
            description: g.description,
            canWrite: keyResult.writeGroupIds.includes(g.id),
            isDefault: g.id === keyResult.defaultWriteGroupId,
          }));
        }
      }
    } catch { /* non-blocking — form works without group data */ }
  }

  const nonce = c.get("cspNonce" as never) as string | undefined;
  const html = renderPage(params, result, enriched, keyGroups, nonce, synthesisResult);
  return c.html(html, result?.error ? 400 : 200);
}

// ── Route handlers ───────────────────────────────────────────────────────────

// GET /check — display form or process check via query params.
// Params are read from the RAW query string via the lenient decoder rather
// than c.req.query(): Hono returns the raw percent-encoded text when
// decodeURIComponent throws, which is how windows-1252 escapes (%97 for an
// em-dash) ended up stored literally. See lib/lenient-query.ts.
check.get("/", checkRateLimit, checkPerKeyRateLimit, searchOnlyGate, async (c) => {
  const params = readParams(parseLenientQuery(rawQueryOfUrl(c.req.url)));
  return handleCheck(c, params);
});

// POST /check — form body (url-encoded or multipart for image uploads).
// Body values win; URL query params fill the gaps — so POST /check?format=json
// with body params returns JSON exactly like GET does (2026-07-05 parity fix).
check.post("/", checkBodyLimit, checkRateLimit, checkPerKeyRateLimit, async (c) => {
  const queryGet = parseLenientQuery(rawQueryOfUrl(c.req.url));
  const contentType = c.req.header("content-type") ?? "";

  let bodyGet: (name: string) => string | undefined;
  let imageFile: File | undefined;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    // Same lenient decoding as GET for urlencoded bodies — Request.formData()
    // replaces invalid-UTF-8 escapes (%97) with U+FFFD instead of decoding
    // them as windows-1252. Hono caches the raw body, so the rate-limit
    // middleware's earlier parseBody() doesn't consume it.
    bodyGet = parseLenientQuery(await c.req.text());
  } else {
    const formData = await c.req.parseBody();
    const rawImage = formData["image"];
    imageFile = rawImage instanceof File && rawImage.size > 0 ? rawImage : undefined;
    bodyGet = (name) => {
      const v = formData[name];
      return typeof v === "string" ? v : undefined;
    };
  }

  const params = readParams((name) => bodyGet(name) ?? queryGet(name));
  params.imageFile = imageFile;

  return handleCheck(c, params);
});

export { check as checkRoutes };
