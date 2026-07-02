/**
 * Embedding strategy definitions and text builders.
 *
 * Shared by:
 *   - apps/backend/src/services/trace.service.ts (recipe check fast path)
 *   - apps/backend/src/embedding-worker/jobs/strategy-check.ts (backfill consumer)
 *   - scripts/backfill-experimental-strategies.ts (manual backfill)
 *
 * Pure functions — no I/O, no database access.
 *
 * Docs to update when changing this file:
 *   - docs/architecture/search-algorithms.md (Embedding Strategies section)
 *   - docs/adr/0002-postgres-pgvector-pg-boss.md (Worker Architecture)
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface EvidenceEntry {
  interpretation: string;
  quote?: string | undefined;
  source?: string | undefined;
}

export interface EmbeddingStrategy {
  id: string;
  text: string;
}

// ── Strategy registry ────────────────────────────────────────────────────────

/**
 * All embedding strategy IDs in the system.
 * The strategy sweep uses this list to discover what work needs doing.
 * Add new strategies here — the worker will automatically backfill.
 */
export const ALL_STRATEGY_IDS = [
  "full_document",
  "full_recipe_context",
  // exp_trace_minimal removed 2026-07-01 (operator decision): its text was
  // byte-identical to full_document, so full_document IS the trace-only
  // baseline for map experiments. Existing rows cleaned up by migration.
  "exp_trace_instructed",
  "exp_trace_evidence_headed",
  "exp_trace_evidence_weighted",
  "exp_full_headed",
  "exp_full_weighted",
] as const;

export type StrategyId = (typeof ALL_STRATEGY_IDS)[number];

/** Strategies that are experimental (not used in production search). */
export const EXPERIMENTAL_STRATEGY_IDS = ALL_STRATEGY_IDS.filter(
  (id) => id.startsWith("exp_"),
);

/**
 * Strategies searched by the production recipe-check path (hybridSearch) and
 * preferred when fetching one vector per trace for clustering. Operator
 * decision 2026-07-01: experimental strategies do NOT compete in production
 * search — with all 8 strategies searched, the 1000-candidate budget covered
 * only ~141 of 1,301 traces (each trace's variants crowd out other traces);
 * filtering to these two raised that to ~754 at the same latency. exp_*
 * vectors remain available for the /traces/map strategy experiments.
 */
export const PRODUCTION_SEARCH_STRATEGY_IDS = ALL_STRATEGY_IDS.filter(
  (id) => !id.startsWith("exp_"),
);

// ── Text builders ────────────────────────────────────────────────────────────

/**
 * Build the full_recipe_context text (trace + all evidence + references).
 * This is the existing Strategy 3 from search-strategies.md.
 */
export function buildFullRecipeContext(
  traceText: string,
  entries: EvidenceEntry[],
): string {
  return [
    `Claim: ${traceText}`,
    ...entries.map((e) => {
      const parts = [`Supporting evidence: ${e.interpretation}`];
      if (e.quote) parts.push(`> "${e.quote}"`);
      if (e.source) parts.push(`-- ${e.source}`);
      return parts.join("\n");
    }),
  ].join("\n\n");
}

/**
 * Build the text for a single embedding strategy.
 * Returns the strategy text, or null if the strategy ID is not recognized.
 */
export function buildStrategyText(
  strategyId: string,
  traceText: string,
  entries: EvidenceEntry[],
): string | null {
  const evidenceBlock = entries.map((e) => {
    const parts = [e.interpretation];
    if (e.quote) parts.push(`> "${e.quote}"`);
    return parts.join("\n");
  }).join("\n\n");

  const evidenceWithRefsBlock = entries.map((e) => {
    const parts = [e.interpretation];
    if (e.quote) parts.push(`> "${e.quote}"`);
    if (e.source) parts.push(`-- ${e.source}`);
    return parts.join("\n");
  }).join("\n\n");

  switch (strategyId) {
    case "full_document":
      return traceText;

    case "full_recipe_context":
      return buildFullRecipeContext(traceText, entries);

    case "exp_trace_instructed":
      return `Taste and judgment claim (format: "As a [role] working on [goal], I [chose/prefer] so that [reason]"):\n${traceText}`;

    case "exp_trace_evidence_headed":
      return `Claim:\n${traceText}\n\nSupporting evidence:\n${evidenceBlock}`;

    case "exp_trace_evidence_weighted":
      return `PRIMARY — taste/judgment claim (weight heavily for similarity):\n${traceText}\n\nSECONDARY — supporting context:\n${evidenceBlock}`;

    case "exp_full_headed":
      return `Claim:\n${traceText}\n\nSupporting evidence with sources:\n${evidenceWithRefsBlock}`;

    case "exp_full_weighted":
      return `PRIMARY — taste/judgment claim (weight heavily for similarity):\n${traceText}\n\nSECONDARY — supporting evidence and sources:\n${evidenceWithRefsBlock}`;

    default:
      return null;
  }
}

/**
 * Build texts for all experimental strategies at once.
 * Used by the recipe check fast path to generate all embeddings synchronously.
 */
export function buildExperimentalStrategies(
  traceText: string,
  entries: EvidenceEntry[],
): EmbeddingStrategy[] {
  const results: EmbeddingStrategy[] = [];
  for (const id of EXPERIMENTAL_STRATEGY_IDS) {
    const text = buildStrategyText(id, traceText, entries);
    if (text) results.push({ id, text });
  }
  return results;
}

// ── Evidence loading query (shared SQL pattern) ──────────────────────────────

/**
 * SQL query to load evidence entries for a trace.
 * Returns rows with: interpretation, quote, source.
 *
 * This is the canonical JOIN pattern — used by trace.service.ts,
 * strategy-check worker, and backfill scripts.
 *
 * Usage (with drizzle):
 * ```
 * const rows = await db.execute(sql`
 *   SELECT e.content AS interpretation, r.quote, r.source
 *   FROM claimnet.trace_evidence te
 *   JOIN claimnet.evidence e ON e.id = te.evidence_id
 *   LEFT JOIN claimnet.evidence_references er ON er.evidence_id = e.id
 *   LEFT JOIN claimnet.references r ON r.id = er.reference_id
 *   WHERE te.trace_id = ${traceId}::uuid AND te.stance = 'for'
 *   ORDER BY e.created_at
 * `);
 * ```
 *
 * Convert rows to EvidenceEntry[]:
 * ```
 * const entries = rows.map(r => ({
 *   interpretation: r.interpretation,
 *   quote: r.quote ?? undefined,
 *   source: r.source ?? undefined,
 * }));
 * ```
 */
export const EVIDENCE_QUERY_PATTERN = `
  SELECT e.content AS interpretation, r.quote, r.source
  FROM claimnet.trace_evidence te
  JOIN claimnet.evidence e ON e.id = te.evidence_id
  LEFT JOIN claimnet.evidence_references er ON er.evidence_id = e.id
  LEFT JOIN claimnet.references r ON r.id = er.reference_id
  WHERE te.trace_id = $1::uuid AND te.stance = 'for'
  ORDER BY e.created_at
` as const;
