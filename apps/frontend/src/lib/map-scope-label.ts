/**
 * Recipe Map header/button copy for the empty and tiny-corpus cases.
 *
 * A fresh or single-recipe book projects with zero clusters (clustering
 * needs more than one point to group), which rendered as "1 recipes · 0
 * clusters" and a disabled "Copy agent briefing (0)" button — reading as
 * broken rather than as "nothing to cluster yet, but the briefing still
 * works." (2026-07-05 journey-eval papercut.)
 */

export function describeMapScope(totalTraces: number, clusterCount: number): string {
  if (totalTraces === 0) return "No recipes yet";
  if (clusterCount === 0) {
    return totalTraces === 1
      ? "1 recipe · not enough yet to cluster"
      : `${totalTraces} recipes · not enough yet to cluster`;
  }
  return `${totalTraces} recipe${totalTraces === 1 ? "" : "s"} · ${clusterCount} cluster${clusterCount === 1 ? "" : "s"}`;
}

/**
 * The count shown on the "Copy agent briefing (N)" button. The briefing
 * always draws from the full read scope, not just what happened to cluster,
 * so an uncluttered corpus (0 clusters, some unclustered traces) should
 * still show and copy something real rather than a misleading "(0)".
 */
export function mapBriefingCount(totalTraces: number, clusterCount: number): number {
  return clusterCount > 0 ? clusterCount : totalTraces;
}
