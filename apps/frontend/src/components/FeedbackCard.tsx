import { Link } from "@tanstack/react-router";
import { useSetFeedbackStar } from "../hooks/useTraces.js";
import type { TraceFeedbackRow } from "../hooks/useTraces.js";
import { shortIntentId } from "../lib/intent-link.js";

/**
 * One feedback row about a check, as the recipe detail page and the intent
 * page show it: the agent's chips, story and note, related recipes, the
 * declared intent it reports on (slice 9), and the "mattered" star.
 *
 * `traceId` is the recipe the row is about. A row about a read-only search
 * has none, and is shown without the star (a star is a reader's mark on a
 * recipe's lineage). `showIntent` is false on the intent page itself, where
 * the intent link would point at the page already open.
 */

/** Small labeled chip for feedback enum values. Impact gets a color accent —
 *  it's the value the human scans for. */
function FeedbackChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span
      className="text-xs"
      style={{
        display: "inline-flex",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface-container)",
        color: accent ? "var(--color-primary)" : "var(--color-on-surface-variant)",
        border: accent ? "1px solid var(--color-primary)" : "1px solid transparent",
      }}
    >
      <span style={{ color: "var(--color-outline-variant)" }}>{label}</span>
      {value}
    </span>
  );
}

const LINK_STYLE = { color: "var(--color-primary)", textDecoration: "none", fontFamily: "var(--font-mono, monospace)" } as const;

export function FeedbackCard({ row, traceId, showIntent = true }: { row: TraceFeedbackRow; traceId: string | null; showIntent?: boolean }) {
  const setStar = useSetFeedbackStar(traceId ?? "");
  const createdAt = new Date(row.createdAt);
  // Human-origin rows (a re-filing correction) carry actorUserId and no api key.
  const byHuman = !!row.actorUserId;
  const agentBits = [row.agentId, row.model, row.harness && `${row.harness}${row.harnessVersion ? ` ${row.harnessVersion}` : ""}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{
      background: "var(--color-surface-container-lowest)",
      borderRadius: "var(--radius-lg)",
      padding: "var(--space-lg)",
      borderLeft: `3px solid ${byHuman ? "var(--color-success)" : "var(--color-primary)"}`,
    }}>
      <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
        {byHuman && <FeedbackChip label="by" value="human" accent />}
        <FeedbackChip label="impact" value={row.impact} accent={row.impact === "big" || row.impact === "new"} />
        <FeedbackChip label="disposition" value={row.disposition} />
        <FeedbackChip label="kind" value={row.kind} />
        <FeedbackChip label="fulfilled" value={row.storyFulfilled} />
        {row.topSimilarity !== null && (
          <FeedbackChip label="top match" value={`${Math.round(row.topSimilarity * 100)}%`} />
        )}
        {traceId && (
          <button
            className="btn-ghost"
            onClick={() => setStar.mutate({ feedbackId: row.id, starred: !row.starredByMe })}
            disabled={setStar.isPending}
            aria-pressed={row.starredByMe}
            title={row.starredByMe ? "Unstar — remove 'this one mattered'" : "Star — this one mattered"}
            style={{
              marginLeft: "auto",
              fontSize: "0.85rem",
              padding: "2px 8px",
              cursor: "pointer",
              color: row.starredByMe ? "var(--color-primary)" : "var(--color-outline-variant)",
            }}
          >
            {row.starredByMe ? "★" : "☆"}{row.starCount > 0 ? ` ${row.starCount}` : ""}
          </button>
        )}
      </div>

      <p style={{ marginTop: "var(--space-sm)" }}>{row.story}</p>
      {row.note && (
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
          {row.note}
        </p>
      )}

      {row.relatedTraceIds && row.relatedTraceIds.length > 0 && (
        <p className="text-xs" style={{ marginTop: "var(--space-xs)" }}>
          Related recipes:{" "}
          {row.relatedTraceIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <a href={`/app/traces/${id}`} style={LINK_STYLE}>
                {id.slice(0, 8)}…
              </a>
            </span>
          ))}
        </p>
      )}

      {showIntent && row.intentId && (
        <p className="text-xs" style={{ marginTop: "var(--space-xs)" }} data-testid="feedback-intent">
          Intent:{" "}
          {row.isMine === false ? (
            // Another person's intent: its page is theirs alone, so the id is shown, not linked.
            <span title={`${row.intentId} (another person's intent)`} style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {shortIntentId(row.intentId)}
            </span>
          ) : (
            <Link to="/app/intents/$intentId" params={{ intentId: row.intentId }} title={row.intentId} style={LINK_STYLE}>
              {shortIntentId(row.intentId)}
            </Link>
          )}
        </p>
      )}

      <p className="text-xs" style={{ color: "var(--color-outline-variant)", marginTop: "var(--space-sm)" }}>
        {byHuman && row.actorEmail ? `${row.actorEmail} · ` : ""}
        {agentBits ? `${agentBits} · ` : ""}
        {row.apiKeyLabel ? `key: ${row.apiKeyLabel} · ` : ""}
        {createdAt.toLocaleString()}
      </p>
    </div>
  );
}
