/**
 * Display helpers for declared intents (drafts-and-triage slice 9): the id an
 * agent registers for a task (`int_` + 24 characters), shown on feedback rows
 * and on the intent page.
 */

/** `int_` plus the first 8 characters: enough to tell intents apart at a glance. */
export function shortIntentId(id: string): string {
  return id.startsWith("int_") && id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

/** What one lineage entry says happened, for the intent page's timeline. */
export function lineageLabel(type: "shown" | "deposit" | "feedback", draftState?: string | null): string {
  if (type === "shown") return "Recipe shown";
  if (type === "deposit") return draftState === "unverified" ? "Draft deposited" : "Recipe deposited";
  return "Feedback";
}

/**
 * What a feedback row without a recipe is about, for the intent page's
 * timeline: a read-only search, a briefing, or (an outcome row naming only its
 * intent, slice 8a) the task itself. Null when the row names a recipe, which
 * the page links instead.
 */
export function feedbackSubject(row: { traceId: string | null; searchId: string | null; briefingId: string | null }): string | null {
  if (row.traceId) return null;
  if (row.searchId) return "a search";
  if (row.briefingId) return "a briefing";
  return "this task";
}
