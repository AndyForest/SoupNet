/**
 * Groups repeated check-log entries by trace id for display.
 *
 * The server logs one `recipe.checked` audit row per HTTP request against
 * `/check` — opening the link, refreshing the page, and a `format=json`
 * fetch of the *same* check URL each write their own row, even though they
 * all resolve to the same trace (the trace itself is deduped server-side).
 * That's correct for the audit trail (F29 rate limiting counts real
 * requests) but wrong for a human-facing log: today it shows N identical
 * rows for what was, from the user's perspective, one check. This groups
 * consecutive-or-not entries sharing a trace id into a single display row
 * with a repeat count, without touching how the server logs anything.
 *
 * (2026-07-05 journey-eval defect #6.)
 */

export interface GroupableCheck {
  id: string;
  traceId: string;
  occurredAt: string;
}

export interface GroupedCheck<T extends GroupableCheck> {
  /** The most recent entry for this trace — used for display. */
  latest: T;
  /** How many raw check-log rows collapsed into this one (>= 1). */
  count: number;
  /** All raw entry ids that collapsed into this group, most recent first. */
  entryIds: string[];
}

/**
 * Collapse a list of check-log entries (assumed already sorted, most recent
 * first — the order `/traces/checks` returns) into one row per trace id.
 * The first (most recent) occurrence of a trace id anchors the group; later
 * occurrences of the same trace id anywhere in the list add to its count
 * rather than starting a new row, so repeats separated by other checks still
 * collapse together.
 */
export function groupChecksByTrace<T extends GroupableCheck>(checks: readonly T[]): GroupedCheck<T>[] {
  const groups: GroupedCheck<T>[] = [];
  const indexByTraceId = new Map<string, number>();

  for (const check of checks) {
    const existingIndex = indexByTraceId.get(check.traceId);
    if (existingIndex === undefined) {
      indexByTraceId.set(check.traceId, groups.length);
      groups.push({ latest: check, count: 1, entryIds: [check.id] });
    } else {
      const group = groups[existingIndex]!;
      group.count += 1;
      group.entryIds.push(check.id);
    }
  }

  return groups;
}
