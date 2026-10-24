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
