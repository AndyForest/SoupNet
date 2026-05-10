import { Hono } from "hono";
import type { Context } from "hono";
import type { SubmitAndSearchResult } from "../services/trace.service";
import { submitAndSearch } from "../services/trace.service";
import { enrichResults, clusterEvidenceInResults } from "../services/result-enricher";
import type { EnrichedResult, EnrichedEvidence, EnrichedReference } from "../services/result-enricher";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { validateKey } from "../services/api-key.service";
import { HTML_ACCEPT_TYPES } from "@soupnet/domain";
import { rateLimit } from "../middleware/rate-limit";

// Rate limit check/search: 1000 per hour per IP
const checkRateLimit = rateLimit({ max: 1000, windowMs: 60 * 60 * 1000 });

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

interface PageParams {
  key: string | null;
  trace: string | null;
  ef: string | null;
  ea?: string | undefined; // deprecated — kept for backward compat of existing traces
  sort: string | undefined;
  page: string | undefined;
  format: string | undefined;
  clusters: string | undefined;
  maxChars: string | undefined;
  expand: string | undefined;
  compact: string | undefined;
  /** Two concept terms for semantic axis projection (comma-separated). */
  axes: string | undefined;
  /** Group slug or ID to write to (resolved within key's write groups). */
  group: string | undefined;
  /** Comma-separated group slugs to restrict search scope. */
  readGroups: string | undefined;
  /** Uploaded image file (from multipart form) */
  imageFile: File | undefined;
}

// Default max_chars for HTML responses when no clustering params are specified.
// Produces ~3-5 compact exemplars. Agents can override via expand=true or explicit clusters/max_chars.
const HTML_DEFAULT_MAX_CHARS = 3000;

// Default clusters for JSON/MCP responses when no clustering params are specified.
// 3 clusters surfaces diverse viewpoints without overwhelming context budgets.
// max_chars overrides this when specified.
const JSON_DEFAULT_CLUSTERS = 3;

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
        const item: Record<string, unknown> = {
          id: r.id,
          recipe: r.claimText,
          createdAt: r.createdAt,
          ...(r.group ? { group: { id: r.group.id, name: r.group.name, description: r.group.description } } : {}),
          score: {
            combined: r.combinedScore,
            semantic: r.semanticScore,
          },
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
        return item;
      }),
      totalResults: result.totalResults,
      page,
      totalPages: result.totalPages,
    },
  };

  if (result.formatWarning) {
    response["formatWarning"] = result.formatWarning;
  }

  // Related evidence from other recipes (evidence discovery pipeline)
  if (result.relatedEvidence && result.relatedEvidence.length > 0) {
    (response["data"] as Record<string, unknown>)["relatedEvidence"] = result.relatedEvidence.map((e) => ({
      evidenceId: e.evidenceId,
      parentRecipe: e.parentTraceText,
      evidence: e.evidenceContent,
      similarity: e.semanticScore,
      strategy: "contextual_evidence",
    }));
  }

  // Concept-axis positions (TCAV-style projection)
  // Research basis: Kim et al. 2018, "Testing with Concept Activation Vectors" (ICLR)
  if (result.conceptAxes) {
    (response["data"] as Record<string, unknown>)["conceptAxes"] = result.conceptAxes;
  }

  return response;
}

// ── Query string builder ─────────────────────────────────────────────────────

function buildQs(params: PageParams, overrides: Record<string, string> = {}): string {
  const parts: string[] = [];
  // Always carry forward the core search params
  if (params.key) parts.push(`key=${encodeURIComponent(params.key)}`);
  if (params.trace) parts.push(`trace=${encodeURIComponent(params.trace)}`);
  if (params.ef) parts.push(`ef=${encodeURIComponent(params.ef)}`);
  if (params.ea) parts.push(`ea=${encodeURIComponent(params.ea)}`);
  // Carry forward display params unless overridden
  const overrideKeys = new Set(Object.keys(overrides));
  if (params.sort && !overrideKeys.has("sort")) parts.push(`sort=${encodeURIComponent(params.sort)}`);
  if (params.clusters && !overrideKeys.has("clusters") && !overrideKeys.has("expand")) parts.push(`clusters=${encodeURIComponent(params.clusters)}`);
  if (params.maxChars && !overrideKeys.has("max_chars") && !overrideKeys.has("expand")) parts.push(`max_chars=${encodeURIComponent(params.maxChars)}`);
  for (const [k, v] of Object.entries(overrides)) {
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
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
): string {
  const hasSearch = !!(params.trace && params.ef && params.key);
  const isCompact = params.compact !== "false";

  // Build Next Steps block — shown whenever a check completed successfully,
  // even when there are no matching recipes (empty corpus, unique claim, etc).
  // Hoisting the "Your recipe was checked as #..." confirmation out of
  // resultsHtml was previously tracked as a backlog item; it also matters for
  // agent auto-submit flows — the agent sees confirmation + a Copy button for
  // the JSON response + an optional path to add a file attachment, without
  // having to re-submit the form manually.
  let nextStepsHtml = "";
  if (result && !result.error && hasSearch) {
    const jsonQs = buildQs(params, { format: "json" });
    const groupHiddenField = params.group ? `<input type="hidden" name="group" value="${esc(params.group)}">` : "";
    nextStepsHtml = `
  <section id="next-steps" style="background:#f0efe3;padding:0.75rem 1rem;border-radius:4px;margin:0.5rem 0">
    <p style="margin:0.25rem 0"><strong>Your recipe was checked as #${esc(result.traceId)}</strong>
    <button id="copy-json-btn" style="font-size:0.85em;padding:3px 10px;margin-left:1em;cursor:pointer">Copy results for AI agent</button></p>
    <script nonce="${nonce ?? ""}">
    document.getElementById('copy-json-btn').addEventListener('click',function(){var btn=this;btn.textContent='Fetching...';var url='/check${jsonQs.replace(/'/g, "\\'")}';try{var blob=fetch(url).then(function(r){return r.text()}).then(function(t){return new Blob([t],{type:'text/plain'})});navigator.clipboard.write([new ClipboardItem({'text/plain':blob})]).then(function(){btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy results for AI agent'},2000)}).catch(function(e){fetch(url).then(function(r){return r.text()}).then(function(j){var ta=document.createElement('textarea');ta.value=j;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy results for AI agent'},2000)}).catch(function(e2){console.error(e2);btn.textContent='Copy failed: '+e2.message})})}catch(e){console.error(e);btn.textContent='Copy failed: '+e.message}});
    </script>
    <details style="margin-top:0.5rem">
      <summary style="cursor:pointer;font-size:0.9em">Add a file attachment &mdash; image, video, audio, or PDF as reference evidence</summary>
      <form method="post" action="/check" enctype="multipart/form-data" style="margin-top:0.5rem">
        <input type="hidden" name="key" value="${esc(params.key)}">
        <input type="hidden" name="trace" value="${esc(params.trace ?? "")}">
        <input type="hidden" name="ef" value="${esc(params.ef ?? "")}">
        ${groupHiddenField}
        <input type="file" name="image" accept="${HTML_ACCEPT_TYPES}" required>
        <button type="submit" style="font-size:0.85em;padding:3px 10px;cursor:pointer">Re-check with file</button>
        <p style="font-size:0.75em;color:#888;margin:0.3em 0">Re-submits the same recipe and evidence with the attached file. The original recipe stays unchanged.</p>
      </form>
    </details>
  </section>`;
  }

  // Build results HTML
  let resultsHtml = "";
  if (result && !result.error && hasSearch && enriched) {
    const resultItems = enriched
      .map((r) => {
        let scoreDetail: string;
        if (r.semanticScore !== null && r.semanticScore !== undefined) {
          scoreDetail = `${Math.round(r.semanticScore * 100)}% similar`;
        } else {
          scoreDetail = `Score: ${r.combinedScore.toFixed(4)}`;
        }

        // Cluster drill-down: search using the exemplar's text to find all its cluster members
        let clusterHtml = "";
        if (r.clusterSize && r.clusterSize > 1) {
          const drillQs = buildQs({
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

        return `
    <article class="result">
      <p>${groupHtml}${esc(r.claimText)}</p>
      <span class="rank">${esc(scoreDetail)}</span>${clusterHtml}
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

    // Related evidence from other recipes (evidence discovery pipeline)
    if (result.relatedEvidence && result.relatedEvidence.length > 0) {
      resultsHtml += `
  <section id="related-evidence">
    <h2>Related evidence from other recipes</h2>
    <p><small>Surfaced via cosine-similarity search over gemini-embedding-2-preview vectors &mdash;
    evidence from other recipes that is topically related to yours. The system makes no stance assertion;
    you decide if it supports, contradicts, or adds context.</small></p>
    <ul>
      ${result.relatedEvidence.map((e) => `
      <li>
        <p>${esc(e.evidenceContent)}</p>
        <p><small>From recipe: <em>${esc(e.parentTraceText.slice(0, 120))}${e.parentTraceText.length > 120 ? "..." : ""}</em>
        (${Math.round(e.semanticScore * 100)}% similar)</small></p>
      </li>`).join("\n")}
    </ul>
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

  if (hasSearch) {
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

// ── Shared handler logic ────────────────────────────────────────────────────

async function handleCheck(
  c: Context,
  params: PageParams,
) {
  const jsonMode = wantsJson(c, params);

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

  let result: SubmitAndSearchResult | undefined;
  if (params.trace && params.ef && params.key) {
    result = await submitAndSearch({
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
    });
  }

  // JSON response path
  if (jsonMode) {
    if (!result) {
      const hint = !params.key
        ? "No API key provided. Generate one at " + (process.env["FRONTEND_URL"] ?? "https://soup.net") + "/app/keys"
        : "Missing required parameters: key, trace, ef";
      return c.json({ ok: false, error: hint }, 400);
    }
    if (result.error) {
      return c.json({ ok: false, error: result.error }, 400);
    }
    const db = getDb();
    let enriched = await enrichResults(db, result.results);
    enriched = await clusterEvidenceInResults(db, enriched);
    const page = params.page ? parseInt(params.page, 10) : 1;
    return c.json(buildJsonResponse(result, enriched, page));
  }

  // HTML response path — always enrich + cluster evidence
  let enriched: EnrichedResult[] | undefined;
  if (result && !result.error && result.results.length > 0) {
    const db = getDb();
    enriched = await enrichResults(db, result.results);
    enriched = await clusterEvidenceInResults(db, enriched);
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
  const html = renderPage(params, result, enriched, keyGroups, nonce);
  return c.html(html, result?.error ? 400 : 200);
}

// ── Route handlers ───────────────────────────────────────────────────────────

// GET /check — display form or process check via query params
check.get("/", checkRateLimit, async (c) => {
  const params: PageParams = {
    key: c.req.query("key") ?? null,
    // Accept both short names (trace/ef/f) and human-readable aliases (recipe/evidence/filter)
    trace: c.req.query("trace") ?? c.req.query("recipe") ?? null,
    ef: c.req.query("ef") ?? c.req.query("evidence") ?? null,
    ea: c.req.query("ea") || undefined,
    sort: c.req.query("sort") || undefined,
    page: c.req.query("page") || undefined,
    format: c.req.query("format") || undefined,
    clusters: c.req.query("clusters") || undefined,
    maxChars: c.req.query("max_chars") || undefined,
    expand: c.req.query("expand") || undefined,
    compact: c.req.query("compact") || undefined,
    axes: c.req.query("axes") || undefined,
    // Accept both `recipe_book` (canonical) and `group` (legacy alias) on the
    // wire — see Decision A1/B1 rename. Same for read_recipe_books / read_groups.
    group: c.req.query("recipe_book") || c.req.query("group") || undefined,
    readGroups: c.req.query("read_recipe_books") || c.req.query("read_groups") || undefined,
    imageFile: undefined,
  };

  return handleCheck(c, params);
});

// POST /check — form body (url-encoded or multipart for image uploads)
check.post("/", checkRateLimit, async (c) => {
  const formData = await c.req.parseBody();

  // Extract image file if present (multipart/form-data)
  const rawImage = formData["image"];
  const imageFile = rawImage instanceof File && rawImage.size > 0 ? rawImage : undefined;

  const params: PageParams = {
    key: (formData["key"] as string) ?? null,
    trace: (formData["trace"] as string) ?? (formData["recipe"] as string) ?? null,
    ef: (formData["ef"] as string) ?? (formData["evidence"] as string) ?? null,
    // Note: when "recipe" is provided without "ef"/"evidence", the combined-field
    // parser in handleCheck() splits on blank line (recipe = first paragraph, rest = evidence)
    ea: (formData["ea"] as string) || undefined,
    sort: (formData["sort"] as string) || undefined,
    page: (formData["page"] as string) || undefined,
    format: (formData["format"] as string) || undefined,
    clusters: (formData["clusters"] as string) || undefined,
    maxChars: (formData["max_chars"] as string) || undefined,
    expand: (formData["expand"] as string) || undefined,
    compact: (formData["compact"] as string) || undefined,
    axes: (formData["axes"] as string) || undefined,
    group: (formData["recipe_book"] as string) || (formData["group"] as string) || undefined,
    readGroups: (formData["read_recipe_books"] as string) || (formData["read_groups"] as string) || undefined,
    imageFile,
  };

  return handleCheck(c, params);
});

export { check as checkRoutes };
