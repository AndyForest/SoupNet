/**
 * The review queue's pure view logic (drafts-and-triage slice 3): what each
 * item says, what each action is called, and the dashboard entry. The page
 * (pages/DraftQueuePage.tsx) renders these; the backend decides what is
 * listed (GET /traces/drafts).
 *
 * Wording (build log ruling 27): one click, no confirmation dialog, so every
 * button's visible label says what it does (confirm publishes to the named
 * book; reject and not chosen keep the draft private), and its accessible
 * name adds which draft, so ten Confirm buttons are told apart (S3-UI2).
 * Ratings are words, never colour alone (S3-UI3), and say they are the
 * agent's, as on the detail page (S3-Q4).
 */

/** `verified` reaches only the draft's own person; anyone else sees `published` ([F83]). */
export type QueueItemState = "unverified" | "verified" | "rejected" | "not_chosen" | "published";

export interface QueueItem {
  id: string;
  recipe: string;
  recipeBook: { id: string; name: string; slug: string };
  impact: string | null;
  uncertainty: string | null;
  depositedAt: string;
  decidedAt?: string | null;
  keyLabel: string | null;
  firstInterpretation: string | null;
  state: QueueItemState;
  canResolve: boolean;
  blockedReason?: string;
}

export type QueueAction = "confirm" | "reject" | "not_chosen";

export const QUEUE_ACTIONS: readonly QueueAction[] = ["confirm", "reject", "not_chosen"];

/** How much of the recipe an accessible name quotes. */
const NAME_EXCERPT = 80;

export function excerpt(text: string, max = NAME_EXCERPT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** "Agent's ratings: impact high · uncertainty not rated", or "…: not rated". */
export function queueRatingsText(item: Pick<QueueItem, "impact" | "uncertainty">): string {
  if (item.impact === null && item.uncertainty === null) return "Agent's ratings: not rated";
  return `Agent's ratings: impact ${item.impact ?? "not rated"} · uncertainty ${item.uncertainty ?? "not rated"}`;
}

/** The button's visible label. */
export function actionLabel(action: QueueAction, item: Pick<QueueItem, "recipeBook">): string {
  switch (action) {
    case "confirm":
      return `Confirm: publish to ${item.recipeBook.name}`;
    case "reject":
      return "Reject: keep private";
    case "not_chosen":
      return "Not chosen: keep private";
  }
}

/**
 * The button's accessible name: the visible label first (WCAG 2.5.3), then
 * the draft, with its short id so two drafts that open with the same 80
 * characters still get different names (fix pass after the browser run).
 */
export function actionAccessibleName(action: QueueAction, item: Pick<QueueItem, "recipeBook" | "recipe" | "id">): string {
  return `${actionLabel(action, item)}. Draft ${item.id.slice(0, 8)}: ${excerpt(item.recipe)}`;
}

/** What the live region announces after an action succeeds. */
export function actionOutcome(action: QueueAction, item: Pick<QueueItem, "recipeBook" | "recipe">): string {
  const which = `"${excerpt(item.recipe, 60)}"`;
  switch (action) {
    case "confirm":
      return `Confirmed ${which}: it is published to ${item.recipeBook.name}.`;
    case "reject":
      return `Rejected ${which}: it stays private to you and your agents.`;
    case "not_chosen":
      return `Marked ${which} not chosen: it stays private to you and your agents.`;
  }
}

/** The state line for an item that is not an unresolved draft (id-list links, S3-L3). */
export function stateLabel(state: QueueItemState): string | null {
  switch (state) {
    case "unverified":
      return null;
    case "verified":
      return "Verified draft: you confirmed it, and it is published to its recipe book";
    case "published":
      return "Published: not a draft awaiting review";
    case "rejected":
      return "Rejected draft";
    case "not_chosen":
      return "Draft not chosen";
  }
}

/** The label for the first evidence interpretation: the agent's reason on a
 *  draft, plain evidence on a recipe that was never one. */
export function whyLabel(state: QueueItemState): string {
  return state === "published" ? "Evidence:" : "Why your agent drafted it:";
}

/** "Deposited 27 Sep 2026 by Claude Code key" (key label when known). */
export function depositedText(item: Pick<QueueItem, "depositedAt" | "keyLabel">, locale?: string): string {
  const d = new Date(item.depositedAt);
  const when = Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
  const by = item.keyLabel ? ` by ${item.keyLabel}` : " by an agent key";
  return `Deposited${when ? ` ${when}` : ""}${by}`;
}

/** The dashboard's tier-1 entry (S3-Q8): shown only when drafts are waiting. */
export function dashboardDraftsEntry(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null;
  return count === 1 ? "1 draft awaits your review" : `${count} drafts await your review`;
}

/** The queue's total line. */
export function queueTotalText(total: number): string {
  if (total === 0) return "No drafts await your review.";
  return total === 1 ? "1 draft awaits your review." : `${total} drafts await your review.`;
}

/** The note for ids a link named that are not shown (S3-L2, S3-L4): one wording whatever the reason. */
export function linkNotShownText(notShown: number, truncated: boolean): string | null {
  const parts: string[] = [];
  if (notShown > 0) {
    parts.push(
      notShown === 1
        ? "1 recipe in this link is not shown: it does not exist or you cannot see it."
        : `${notShown} recipes in this link are not shown: they do not exist or you cannot see them.`,
    );
  }
  if (truncated) parts.push("The link named more than 20 recipes; only the first 20 were looked up.");
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The item to move focus to after `removedId` leaves the list (S3-A5): the
 * next item, else the previous one, else null (focus the heading).
 */
export function nextFocusId(ids: readonly string[], removedId: string): string | null {
  const at = ids.indexOf(removedId);
  if (at < 0) return ids[0] ?? null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}
