/**
 * Retrieval-synthesis prompt builder + deterministic stub — the pure half of
 * Soup.net's first server-side LLM feature (premium `synthesize`, ADR pending;
 * see docs/planning/premium-llm-features.md).
 *
 * Both functions are pure (no I/O, no time, no randomness) and live here in
 * @soupnet/domain for the same reason stub-embeddings.ts does: the route layer
 * owns the provider seam (the one Gemini call), this owns the prompt shape and
 * the CI-safe stub. Keeping them side-by-side means the stub always answers the
 * exact input the real call would have seen.
 *
 * The synthesis distils the exemplars a check returned into a short "current
 * preference profile" — the user's most decision-relevant judgments, with
 * conflicts resolved newest-wins by judgment date. The benchmark motivation:
 * retrieval breadth alone dilutes (more exemplars is *worse*); the corpus needs
 * synthesising, not enumerating (docs/benchmarks.md, trace 84141bb3).
 */

/** ≤150 words is the operator-set ceiling on the profile paragraph. */
export const SYNTHESIS_WORD_LIMIT = 150;

/** How many leading words of a recipe the stub keeps as its gist. */
const STUB_GIST_WORDS = 8;

export interface SynthesisInput {
  /** The recipe the caller just checked — the profile is oriented to it. */
  checkedRecipe: string;
  results: Array<{
    id: string;
    recipe: string;
    /** Coalesced COALESCE(decided_at, created_at) date — the newest-wins key. */
    judgmentDate: string;
    evidence?: string[];
  }>;
  relatedEvidence?: Array<{ recipeId: string; content: string }>;
}

/**
 * Order results newest judgment first. judgmentDate is an ISO date string
 * (COALESCE(decided_at, created_at)), so a plain descending string compare is a
 * chronological sort. Stable and pure — no Date parsing, no locale surprises.
 */
function newestFirst(results: SynthesisInput["results"]): SynthesisInput["results"] {
  return [...results].sort((a, b) => (a.judgmentDate < b.judgmentDate ? 1 : a.judgmentDate > b.judgmentDate ? -1 : 0));
}

/**
 * Build the LLM prompt that distils the returned exemplars into a preference
 * profile. Pure — the caller feeds the result to the provider seam.
 *
 * The guardrails are pinned into the prompt rather than trusted to the model:
 * cite only the ids supplied, quote only verbatim evidence, resolve conflicts
 * newest-wins, interpret but never invent. Same truthfulness contract the
 * client-side eval profile builder already runs (perma-ab adapter), so the two
 * synthesis paths stay honest against each other.
 */
export function buildSynthesisPrompt(input: SynthesisInput): string {
  const ordered = newestFirst(input.results);

  const lines: string[] = [
    "You are distilling a user's recorded taste-and-judgment recipes into a single",
    `"current preference profile" — the judgments most relevant to the recipe they`,
    "just checked. Follow these rules exactly:",
    "",
    `- Write one paragraph, at most ${SYNTHESIS_WORD_LIMIT} words.`,
    "- Surface the most decision-relevant judgments. When two recipes conflict, the",
    "  one with the newer judgment date wins; treat the older as superseded.",
    "- Cite recipe ids inline (e.g. [<id>]) for every judgment you draw on.",
    "- Quote only text that appears verbatim in the evidence below. If a detail is",
    "  not in the evidence, do not assert it. Interpret the recipes; never invent a",
    "  preference the evidence does not support.",
    "",
    "Recipe just checked:",
    input.checkedRecipe,
    "",
  ];

  if (ordered.length === 0) {
    // No exemplars to synthesise — say so plainly so the model returns an honest
    // "nothing to profile" rather than confabulating from the checked recipe alone.
    lines.push("Recorded recipes (newest judgment first): none returned.");
  } else {
    lines.push("Recorded recipes (newest judgment first):");
    for (const r of ordered) {
      lines.push(`- [${r.id}] (${r.judgmentDate}) ${r.recipe}`);
      const evidence = (r.evidence ?? []).filter((e) => e.trim().length > 0);
      if (evidence.length > 0) {
        lines.push(`    evidence: ${evidence.join(" | ")}`);
      }
    }
  }

  const related = (input.relatedEvidence ?? []).filter((e) => e.content.trim().length > 0);
  if (related.length > 0) {
    lines.push("");
    lines.push("Related evidence from other recipes:");
    for (const e of related) {
      lines.push(`- (recipe ${e.recipeId}) ${e.content}`);
    }
  }

  lines.push("");
  lines.push("Write the preference profile now.");
  return lines.join("\n");
}

/**
 * Deterministic, pure stand-in for the LLM synthesis — the CI-safe path (like
 * stubEmbeddingVector). Same input → same output, no time, no randomness. It
 * cites every result's id verbatim and stays within the word limit, so
 * integration tests can assert the response carries exactly the ids it should
 * without a live model.
 */
export function stubSynthesis(input: SynthesisInput): string {
  const ordered = newestFirst(input.results);
  if (ordered.length === 0) {
    return "Current preference profile (stub synthesis): no recorded recipes to synthesize.";
  }

  // One compact clause per exemplar, newest first — the id is always present;
  // the gist is a short verbatim slice of the recipe (never invented text).
  const clauses = ordered.map((r) => {
    const gist = r.recipe.trim().split(/\s+/).slice(0, STUB_GIST_WORDS).join(" ");
    return `[${r.id}] ${gist}`;
  });

  return `Current preference profile (stub synthesis of ${ordered.length} recipe(s), newest first): ${clauses.join("; ")}.`;
}
