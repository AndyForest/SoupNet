/**
 * The canonical Recipe wire schema — one object, every surface (operator
 * ruling 2026-07-18, recipe 7945fd8a: "one specified 'recipe' format, with
 * optional fields … Maybe only the 'recipeId' is mandatory actually").
 *
 * A stub, a known cluster-mate, a full exemplar, an evidence-bearing related
 * recipe, and the caller's own deposit are the SAME object at different fill
 * levels. Single source of truth (recipe 43ce7ec0): the check-response
 * builders type against these, the served JSON Schema
 * (GET /schemas/recipe.json) is generated from them with every field's
 * meaning embedded, and the briefing's field glossary derives from the same
 * descriptions — consistency, external validation, and documentation cannot
 * drift apart.
 *
 * Wire vocabulary notes: `recipeId` everywhere (never bare `id` — LLM
 * consumers join sections by field name); `recipeBook` on the wire (the
 * schema-level `groups` table name is legacy, ADR-0016); the full book
 * description is OPTIONAL and appears only on surfaces that own it (the
 * briefing, list_my_recipe_books) — check results omit it by ruling
 * (recipe f3c0fe2f: the briefing owns descriptions).
 */

import { z } from "zod";

// ── Canonical field definitions ─────────────────────────────────────────────
//
// These strings are the SOURCE OF TRUTH for what each concept IS (operator
// ruling 2026-07-18: "bring in all the goodness from the other places here to
// the schema, and then derive those places from here"). The published JSON
// Schema and the briefing's field glossary use them verbatim; the
// budget-capped MCP tool-param descriptions are short forms derived beside
// them in @soupnet/domain (which depends on this package). Pedagogy — voice
// rules taught with examples, scenarios, when-to-check guidance — stays in
// the briefing; these define, the briefing teaches.

export const RECIPE_TEXT_DEFINITION =
  "The recipe text: the HUMAN USER's genuine taste or judgment position — never the agent's "
  + "reasoning, and never a fabricated search query. Written in the human's voice ('I' is the "
  + "human; the practical test: swap in the user's name for 'I' — if the sentence becomes false, "
  + "the voice is wrong), with a transferable functional role rather than a personal name or "
  + "project proper noun, in the shape 'As a [role] working on [goal], I [prefer/chose …] so that "
  + "[reason]'. Role and goal are different things: the role is who the human is (data engineer, "
  + "product owner, parent volunteer), the goal is what they are working on right now; both are "
  + "embedded and searched, so a findable role transfers across projects and users facing the "
  + "same kind of call. Absent on stubs — recipes the caller already holds (see `known`).";

export const SIMILARITY_DEFINITION =
  "Raw cosine similarity between this recipe's embedding and the current check (0–1). Never "
  + "adjusted, rescaled, or thresholded — ranking is a pure function of the check's inputs, and "
  + "no score floor ever hides a result. Note that embeddings encode TOPIC, not stance: a recipe "
  + "asserting the opposite position scores just as high as one agreeing, and even a "
  + "low-similarity recipe carries taste signal — the consuming agent judges relevance and "
  + "stance against its current context, not the server. Absent when there is no query context.";

export const EVIDENCE_INTERPRETATION_DEFINITION =
  "The submitting agent's interpretation of why the source material supports the recipe — the "
  + "warrant connecting the raw reference to the human's position. Interpretation and quote are "
  + "deliberately separate: the quote is data, the interpretation is the argument.";

export const EVIDENCE_QUOTE_DEFINITION =
  "Verbatim quote from the source material — an exact substring of the cited source at the time "
  + "of submission. If the exact string cannot be found in the original, it belongs in the "
  + "interpretation, not here: quotes are the verifiable data layer.";

export const KNOWN_DEFINITION =
  "True when the caller already holds this recipe — it was deposited or previously shown to the "
  + "presenting session (the session models the agent's context-fill state), or declared via "
  + "known_recipes. Rendered as an id stub at its true rank with its honest similarity; the full "
  + "text is omitted because the caller has it, and can be fetched any time by recipeId. "
  + "Rendering only — ranking and cluster membership are never affected.";

export const SESSION_ID_DEFINITION =
  "The opaque session token in effect for this response (a fresh one is minted whenever none — "
  + "or a malformed one — was presented). Pass it on your next check and recipes you have "
  + "already been shown collapse to id stubs while results walk down the same ranking to unseen "
  + "ones, so every check surfaces something new. Hand the token to sub-agents to share your "
  + "known-set, or withhold it to keep theirs fresh; if you compact or lose your context, omit "
  + "the token on your next check and a fresh session refills it with full text. Token "
  + "efficiency only — the token never influences ranking.";

export const CREATED_AT_DEFINITION =
  "The judgment date (ISO 8601): when the human originally made this call. For decisions "
  + "backfilled from dated artifacts (git history, ADRs — decision archaeology) this is the "
  + "artifact's date, so old judgments read as old; otherwise it is the logged time.";

export const LOGGED_AT_DEFINITION =
  "When the recipe entered the corpus (ISO 8601, the raw append time). Differs from createdAt "
  + "only for decisions backfilled from dated artifacts (decision archaeology), where createdAt "
  + "carries the original judgment date. Present on the full-detail lookup surface (get_recipes / "
  + "GET /recipes); check results carry createdAt alone.";

export const AUTHOR_DEFINITION =
  "The human account the recipe belongs to — whose taste and judgment it records. Present only "
  + "on the full-detail lookup surface (get_recipes / GET /recipes), where readers of a shared "
  + "book need attribution; check results omit it.";

export const CLUSTER_SIZE_DEFINITION =
  "How many similar recipes this exemplar represents in the clustered view. Clustering is the "
  + "response-size mechanism: results are grouped by embedding similarity and each cluster is "
  + "represented by its most central real recipe. To explore a cluster's members, re-check with "
  + "the exemplar's text and a higher clusters value.";

export const RECIPE_BOOK_DEFINITION =
  "A recipe book: the shared collection a recipe lives in, scoping who reads and writes it. "
  + "Only recipeBookId is mandatory. The full description appears only on surfaces that own it "
  + "(the briefing and list_my_recipe_books) — check results carry {recipeBookId, name} and the "
  + "briefing you already hold is the source for descriptions.";

// ── Recipe book ──────────────────────────────────────────────────────────────

export const RecipeBookSchema = z
  .object({
    recipeBookId: z
      .string()
      .uuid()
      .describe("Stable id of the recipe book (the shared collection this recipe lives in)."),
    slug: z
      .string()
      .optional()
      .describe(
        "Stable short handle for the book — the value the recipe_book and "
        + "read_recipe_books parameters accept. Present on surfaces that own "
        + "book identity (the briefing, list_my_recipe_books, recipe lookup); "
        + "check results carry {recipeBookId, name}.",
      ),
    name: z.string().optional().describe("Human-readable book name."),
    description: z
      .string()
      .optional()
      .describe(
        "The book's full description — present only on surfaces that own it "
        + "(the briefing, list_my_recipe_books). Check results omit it; the "
        + "briefing you already hold is the source.",
      ),
  })
  .describe(RECIPE_BOOK_DEFINITION);

export type RecipeBook = z.infer<typeof RecipeBookSchema>;

// ── Author ──────────────────────────────────────────────────────────────────

export const RecipeAuthorSchema = z
  .object({
    email: z.string().optional().describe("Account email of the recipe's human."),
    displayName: z.string().optional().describe("Display name, when the account has one."),
  })
  .describe(AUTHOR_DEFINITION);

export type RecipeAuthor = z.infer<typeof RecipeAuthorSchema>;

// ── Evidence ────────────────────────────────────────────────────────────────

export const EvidenceReferenceSchema = z
  .object({
    quote: z.string().optional().describe(EVIDENCE_QUOTE_DEFINITION),
    source: z.string().optional().describe("Citation for the quote — who said or wrote it, where, and when, precise enough for a reader to locate and verify the original."),
    fileUrl: z
      .string()
      .optional()
      .describe("Opaque capability URL of an attached reference file (resolvable only by the key that uploaded it)."),
    fileMimeType: z.string().optional().describe("MIME type of the attached file."),
    originalFilename: z.string().optional().describe("Filename as the submitting agent provided it."),
    fileHash: z.string().optional().describe("SHA-256 of the attached file, for verification against your own copy."),
    regionMeta: z
      .object({
        image_box: z
          .object({
            x0: z.number(),
            y0: z.number(),
            x1: z.number(),
            y1: z.number(),
          })
          .optional(),
      })
      .optional()
      .describe("Region-of-interest metadata for an attached image (normalized 0–1 box, top-left origin)."),
  })
  .describe("A raw verifiable reference: quote + citation, optionally an attached file.");

export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const EvidenceEntrySchema = z
  .object({
    interpretation: z
      .string()
      .optional()
      .describe(EVIDENCE_INTERPRETATION_DEFINITION),
    clusterSize: z
      .number()
      .int()
      .optional()
      .describe("When evidence entries were clustered: how many similar entries this one represents."),
    references: z
      .array(EvidenceReferenceSchema)
      .optional()
      .describe("Raw verifiable references backing the interpretation."),
  })
  .describe("One evidence entry: interpretation plus its verbatim references (Toulmin warrant + data).");

export type EvidenceEntry = z.infer<typeof EvidenceEntrySchema>;

// ── The Recipe object ───────────────────────────────────────────────────────

const recipeFields = {
  recipeId: z
    .string()
    .uuid()
    .describe(
      "The recipe's stable id — the ONLY mandatory field. Fetch the full "
      + "recipe any time via get_recipes (MCP) or GET /recipes?ids=<recipeId> "
      + "with the same API key.",
    ),
  recipe: z.string().optional().describe(RECIPE_TEXT_DEFINITION),
  similarity: z.number().min(0).max(1).optional().describe(SIMILARITY_DEFINITION),
  createdAt: z.string().optional().describe(CREATED_AT_DEFINITION),
  loggedAt: z.string().optional().describe(LOGGED_AT_DEFINITION),
  author: RecipeAuthorSchema.optional().describe(AUTHOR_DEFINITION),
  known: z.boolean().optional().describe(KNOWN_DEFINITION),
  clusterSize: z.number().int().optional().describe(CLUSTER_SIZE_DEFINITION),
  recipeBook: RecipeBookSchema.optional().describe(
    "The book this recipe lives in ({recipeBookId, name} on check results; the description lives in the briefing).",
  ),
  evidence: z
    .array(EvidenceEntrySchema)
    .optional()
    .describe("Evidence entries supporting the claim."),
};

export interface Recipe {
  recipeId: string;
  recipe?: string | undefined;
  similarity?: number | undefined;
  createdAt?: string | undefined;
  loggedAt?: string | undefined;
  author?: RecipeAuthor | undefined;
  known?: boolean | undefined;
  clusterSize?: number | undefined;
  recipeBook?: RecipeBook | undefined;
  evidence?: EvidenceEntry[] | undefined;
  knownMembers?: Recipe[] | undefined;
}

export const RecipeSchema: z.ZodType<Recipe> = z
  .object({
    ...recipeFields,
    knownMembers: z
      .lazy(() => z.array(RecipeSchema))
      .optional()
      .describe(
        "Cluster-mates the session already knows — each a minimal Recipe "
        + "fill ({recipeId, similarity}); full text omitted because you hold "
        + "it ('stub, stub, full recipe').",
      ),
  })
  .describe(
    "The one Recipe object, used at every fill level: a stub is "
    + "{recipeId, known, similarity}; a known cluster-mate is "
    + "{recipeId, similarity}; a full exemplar adds recipe text, evidence, "
    + "and its book; your own deposit is {recipeId, recipe}. Only recipeId "
    + "is mandatory.",
  );

// ── Check response envelope ─────────────────────────────────────────────────

export const CheckResponseDataSchema = z
  .object({
    checked: RecipeSchema.optional().describe(
      "Your own deposit — {recipeId, recipe}. Absent on the read-only filter path (nothing was logged).",
    ),
    searchOnly: z
      .boolean()
      .optional()
      .describe("True for the read-only `filter` search path — no recipe was logged."),
    filter: z.string().optional().describe("The keyword filter of a search-only response."),
    searchMode: z.string().optional().describe("How candidates were retrieved (\"semantic\")."),
    clustered: z.boolean().optional().describe("Whether results are clustered exemplars."),
    results: z
      .array(RecipeSchema)
      .optional()
      .describe(
        "The displayed recipes, most relevant first: full exemplars and id "
        + "stubs at their true ranks. Ranking is a pure function of the "
        + "check's inputs and the corpus — session state only changes "
        + "rendering, never order.",
      ),
    relatedEvidence: z
      .array(RecipeSchema)
      .optional()
      .describe(
        "Recipes surfaced through EVIDENCE similarity (a second retrieval "
        + "over evidence embeddings) — each carries the matching evidence "
        + "entry plus its parent recipe text.",
      ),
    relatedEvidenceKnown: z
      .array(RecipeSchema)
      .optional()
      .describe(
        "Known parents whose evidence would have been selected — minimal "
        + "fills ({recipeId, similarity}); the budget went to parents you "
        + "haven't seen.",
      ),
    sessionId: z.string().optional().describe(SESSION_ID_DEFINITION),
    ranking: z
      .object({
        version: z.string().describe("Dated ranking-algorithm version that served this response."),
        clusterPool: z.string().describe("Clustering-pool mode in effect (page | fixed:<n> | score-gap:<min>-<max>)."),
      })
      .optional()
      .describe("Which ranking algorithm produced this response."),
    totalResults: z
      .number()
      .int()
      .optional()
      .describe("Exact count of ALL matching recipes in scope — nothing is silently capped."),
    page: z.number().int().optional(),
    totalPages: z.number().int().optional(),
    synthesis: z.string().optional().describe("Premium opt-in: distilled preference profile."),
    synthesisNotice: z.string().optional(),
    formatWarning: z.string().optional().describe("Recipe-format suggestion (check accepted)."),
    conceptAxes: z
      .object({ axisA: z.string().optional(), axisB: z.string().optional() })
      .passthrough()
      .optional()
      .describe("Concept-axis projection labels/positions when `axes` was requested."),
  })
  .describe("The data payload of a recipe-check response.");

export const CheckResponseSchema = z
  .object({
    ok: z.boolean().describe("False ⇒ see `error`; no data was logged on hard errors."),
    error: z.string().optional(),
    formatWarning: z.string().optional().describe("(/check JSON places the warning here; MCP inside data.)"),
    data: CheckResponseDataSchema.optional(),
  })
  .describe(
    "A recipe-check response. Published at GET /schemas/check-response.json; "
    + "the Recipe object it composes is at GET /schemas/recipe.json.",
  );

export type CheckResponseData = z.infer<typeof CheckResponseDataSchema>;
export type CheckResponse = z.infer<typeof CheckResponseSchema>;

// ── Published JSON Schemas ──────────────────────────────────────────────────
//
// Generated once at module load so the backend serves them (GET
// /schemas/recipe.json, /schemas/check-response.json) without importing the
// generator itself. Every field description above is embedded verbatim —
// external consumers validate against exactly what the builders are typed
// against.

import { zodToJsonSchema } from "zod-to-json-schema";

export const recipeJsonSchema = zodToJsonSchema(RecipeSchema, "Recipe");
export const checkResponseJsonSchema = zodToJsonSchema(CheckResponseSchema, "CheckResponse");
