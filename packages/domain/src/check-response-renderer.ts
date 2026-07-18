/**
 * Shared markdown renderer for recipe-check results.
 *
 * One renderer, three surfaces (WT-4, 2026-07-05):
 *   - HTTP MCP check_recipe default response (response_format="markdown")
 *   - stdio MCP mirror (apps/mcp-server)
 *   - the web /check page's fenced copy-back block (the human pastes it into
 *     a web agent's chat, where the fence renders as an attachment-like card)
 *
 * The renderer accepts the JSON response shape both builders produce
 * (buildMcpJsonResponse in routes/mcp.ts and buildJsonResponse in
 * routes/check.ts) — the only divergence between the two is where
 * formatWarning lives (inside data vs. top-level), which is handled here.
 *
 * Format invariants (operator review 2026-07-05):
 *   - The check's own recipeId stays prominent (first line).
 *   - Every exemplar line carries its full recipe UUID and similarity inline,
 *     on a single line — this is what makes the check → feedback join work in
 *     the default format (agents cite trace ids without a structured payload).
 *   - No "Page X of Y" pagination text — agents can't page (the tools accept
 *     no page param). When more results exist beyond the exemplars shown, a
 *     one-line narrowing hint replaces it.
 *   - Recipes the caller already holds (declared via known_recipes, or in the
 *     session's known-set — the builders' `known: true` flag) render as
 *     one-line id-only stubs — rendering only; trace logging and cluster math
 *     are unaffected upstream. No gist text (operator ruling 2026-07-17: the
 *     gist is an ossification risk; fetch bodies via get_recipes).
 */

// ── Response shape (tolerant — both builders' outputs satisfy it) ───────────

export interface CheckResultReference {
  quote?: string;
  source?: string;
  fileUrl?: string;
  fileMimeType?: string;
  originalFilename?: string;
  fileHash?: string;
  regionMeta?: { image_box?: { x0: number; y0: number; x1: number; y1: number } };
}

export interface CheckResultEvidence {
  interpretation?: string;
  /** Present when evidence entries were clustered (MCP path). */
  clusterSize?: number;
  references?: CheckResultReference[];
}

export interface CheckResultItem {
  id?: string;
  recipe?: string;
  createdAt?: string | Date;
  group?: { id?: string; name?: string; description?: string | null };
  score?: {
    combined?: number | null;
    semantic?: number | null;
    lexical?: number | null;
  };
  clusterSize?: number;
  evidence?: CheckResultEvidence[];
  /** The caller already holds this recipe (session known-set or declared
   *  known_recipes) — renders as a one-line id-only stub. */
  known?: boolean;
  /** Known ids this full item was promoted over for display (a known cluster
   *  exemplar replaced by this next-nearest member) — rendered as id stubs
   *  alongside the item: "you already know these; this is the next in line". */
  knownStubs?: Array<{ id?: string; known?: boolean }>;
}

export interface CheckRelatedEvidence {
  evidenceId?: string;
  /** UUID of the recipe the evidence belongs to — lets agents fetch the
   *  full recipe via get_recipes / GET /recipes instead of re-checking. */
  recipeId?: string;
  parentRecipe?: string;
  evidence?: string;
  similarity?: number;
}

export interface CheckResponseData {
  recipeId?: string;
  checkedRecipe?: string;
  /** True for the /check `filter` read-only search path — no trace logged. */
  searchOnly?: boolean;
  /** The keyword filter text of a search-only response. */
  filter?: string;
  searchMode?: string;
  clustered?: boolean;
  results?: CheckResultItem[];
  relatedEvidence?: CheckRelatedEvidence[];
  conceptAxes?: { axisA?: string; axisB?: string };
  totalResults?: number;
  page?: number;
  totalPages?: number;
  /** Premium retrieval synthesis: the distilled "current preference profile"
   *  paragraph, present only when a premium+flagged caller passed synthesize.
   *  See docs/planning/premium-llm-features.md. */
  synthesis?: string;
  /** One-line hint shown when a non-eligible caller requested synthesis —
   *  the request is a silent no-op, this explains why. Mutually exclusive
   *  with `synthesis` in practice. */
  synthesisNotice?: string;
  /** MCP builder puts the warning here… */
  formatWarning?: string;
  /** The session token in effect for this check (freshly minted when none was
   *  presented). Rendered as a one-line hint so agents adopt it. */
  sessionId?: string;
}

export interface CheckResponseJson {
  ok?: boolean;
  error?: string;
  /** …the /check JSON builder puts it here. */
  formatWarning?: string;
  data?: CheckResponseData;
}

export interface RenderCheckMarkdownOptions {
  /** Trace ids the agent declared it already holds (known_recipes).
   *  Matching results render as one-line stubs: id + gist + similarity. */
  knownRecipeIds?: readonly string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function similarityLabel(score: CheckResultItem["score"]): string {
  if (score?.semantic !== null && score?.semantic !== undefined) {
    return `${Math.round(score.semantic * 100)}% similar`;
  }
  if (score?.lexical !== null && score?.lexical !== undefined) {
    return `${Math.round(score.lexical * 100)}% keyword`;
  }
  if (score?.combined !== null && score?.combined !== undefined) {
    return `score ${score.combined.toFixed(2)}`;
  }
  return "similarity n/a";
}

function dateLabel(createdAt: CheckResultItem["createdAt"]): string {
  if (!createdAt) return "";
  const iso = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
  // Explicit UTC timestamp at minute precision ("2026-07-06T02:31Z") rather
  // than a bare date slice: a minutes-old check sliced to its UTC date reads
  // as *tomorrow* for readers west of UTC (2026-07-05 eval finding), and a
  // bare date gives downstream agents nothing to convert to the user's local
  // time. Only stamp Z when the source really is UTC (Date, or a Z-suffixed
  // ISO string); anything else passes through untouched.
  const isUtc = createdAt instanceof Date || /Z$/i.test(iso);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (isUtc && m) return `${m[1]}T${m[2]}Z`;
  return iso;
}

function renderReference(ref: CheckResultReference): string {
  let text = "";
  if (ref.quote) text += `    > "${ref.quote}"\n`;
  if (ref.source) text += `    -- ${ref.source}\n`;
  if (ref.fileUrl) {
    const filename = ref.originalFilename || ref.fileUrl;
    const mime = ref.fileMimeType ? ` (${ref.fileMimeType})` : "";
    text += `    [file: ${filename}${mime}]\n`;
    if (ref.fileHash) text += `    [sha256: ${ref.fileHash}]\n`;
    const box = ref.regionMeta?.image_box;
    if (box) {
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      text += `    [region x ${pct(box.x0)}–${pct(box.x1)}, y ${pct(box.y0)}–${pct(box.y1)}]\n`;
    }
  }
  return text;
}

function renderResultItem(r: CheckResultItem, index: number, known: boolean): string {
  const head = `#${index + 1} (${similarityLabel(r.score)}) ${r.id ?? "?"}`;

  if (known) {
    // One-line id-only stub: the caller already holds this recipe, so the
    // line keeps the cluster slot visible without re-sending any body text
    // (fetch the full recipe via get_recipes if needed).
    const cluster = r.clusterSize ? ` (represents ${r.clusterSize} similar recipes)` : "";
    return `${head} [known to you]${cluster}\n`;
  }

  let text = head;
  const date = dateLabel(r.createdAt);
  if (date) text += ` -- ${date}`;
  if (r.clusterSize) text += ` (represents ${r.clusterSize} similar recipes)`;
  if (r.group?.name) text += ` [${r.group.name}]`;
  const knownStubIds = (r.knownStubs ?? []).map((s) => s.id).filter(Boolean);
  if (knownStubIds.length > 0) {
    // Budget backfill marker: a known exemplar was replaced for display by
    // this next-nearest cluster member — you already know the stubbed id(s).
    text += `\n  [shown in place of ${knownStubIds.join(", ")} — known to you; this is the next in line]`;
  }
  text += `\nRecipe: ${r.recipe ?? ""}\n`;

  for (const ev of r.evidence ?? []) {
    text += `  Supporting: ${ev.interpretation ?? ""}`;
    if (ev.clusterSize) text += ` (${ev.clusterSize} similar entries)`;
    text += "\n";
    for (const ref of ev.references ?? []) {
      text += renderReference(ref);
    }
  }
  return text;
}

// ── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Render a recipe-check JSON response as a readable markdown report.
 * Pure function — no I/O. Returns `Error: …` text for error responses so
 * callers can pass the builder output through unconditionally.
 */
export function renderCheckResponseMarkdown(
  response: CheckResponseJson,
  opts: RenderCheckMarkdownOptions = {},
): string {
  if (!response.ok || !response.data) {
    return `Error: ${response.error ?? "Unknown error"}`;
  }
  const data = response.data;
  const known = new Set(opts.knownRecipeIds ?? []);

  let text = data.searchOnly
    ? `Read-only search${data.filter ? ` for "${data.filter}"` : ""} — no recipe was logged.\nSearch mode: ${data.searchMode ?? "semantic"}\n`
    : `Recipe checked as #${data.recipeId ?? "?"}\nSearch mode: ${data.searchMode ?? "semantic"}\n`;

  const warning = data.formatWarning ?? response.formatWarning;
  if (warning) {
    text += `Format suggestion: ${warning}\n`;
  }

  // Premium synthesis sits between the header block and the exemplar list: the
  // distilled profile is the headline for eligible callers; the notice is the
  // one-line "this is a premium feature" hint for everyone else. Rendered here
  // so it appears in position even when there are no exemplars below.
  if (data.synthesis) {
    text += `\n## Synthesis\n${data.synthesis}\n`;
  } else if (data.synthesisNotice) {
    text += `\n${data.synthesisNotice}\n`;
  }

  const results = data.results ?? [];
  if (results.length === 0) {
    text += "\nNo similar recipes found.";
    if (data.sessionId) {
      text += `\nSession: ${data.sessionId} — pass session_id on your next check to keep responses lean.`;
    }
    return text;
  }

  text += `${data.totalResults ?? results.length} similar recipe(s) found`;
  if (data.clustered) {
    text += ` (clustered to ${results.length} exemplars)`;
  }
  text += ":\n";

  results.forEach((r, i) => {
    text += `\n${renderResultItem(r, i, r.known === true || (r.id !== undefined && known.has(r.id)))}`;
  });

  const related = data.relatedEvidence ?? [];
  if (related.length > 0) {
    text += "\nRelated evidence from other recipes:\n";
    for (const e of related) {
      const pct = e.similarity !== undefined ? ` (${Math.round(e.similarity * 100)}% similar)` : "";
      text += `  - ${e.evidence ?? ""}${pct}\n`;
      // Recipe id inline (2026-07-05 eval: entries without ids forced agents
      // to burn full re-checks recovering text they'd already half-seen).
      const from = e.recipeId ? `From recipe ${e.recipeId}` : "From";
      text += `    ${from}: "${(e.parentRecipe ?? "").slice(0, 100)}"\n`;
    }
    text += `  Fetch any full recipe by id: get_recipes (MCP) or GET /recipes?ids=<id> (same API key).\n`;
  }

  if (data.conceptAxes) {
    text += `\nConcept axes: "${data.conceptAxes.axisA ?? ""}" (X) / "${data.conceptAxes.axisB ?? ""}" (Y)\n`;
  }

  // Narrowing hint replaces pagination — agents can't page (no page param on
  // the tools), and field data showed zero agents paging anyway. When more
  // results exist beyond what's shown, point at the levers that do exist.
  if ((data.totalPages ?? 1) > 1) {
    text += `\nMore recipes exist beyond these exemplars. Narrow with read_recipe_books=<slugs>, project with axes="concept A, concept B", or raise clusters for finer granularity.`;
  }

  if (data.sessionId) {
    text += `\nSession: ${data.sessionId} — pass session_id on your next check to keep responses lean.`;
  }

  return text;
}

/**
 * Wrap the rendered markdown in a fenced code block with a filename hint —
 * the copy-back artifact for the web /check page. Matches the briefing's
 * "```markdown soup-net-briefing.md" pattern: pasted into a chat UI, the
 * fence renders as a distinct attachment-like card rather than inline prose.
 */
export function fenceCheckResponseMarkdown(markdown: string): string {
  return "```markdown soup-net-check-result.md\n" + markdown + "\n```";
}
