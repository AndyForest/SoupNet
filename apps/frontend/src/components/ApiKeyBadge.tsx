/**
 * ApiKeyBadge — compact display for an API key (the agent session that
 * created a trace). Today shows the user-given label and a shortened ID;
 * the props shape is open for future fields (read/write groups, expiry,
 * agent type) without churn for callers.
 */

export interface ApiKeyBadgeData {
  id: string;
  label: string | null;
}

interface ApiKeyBadgeProps {
  apiKey: ApiKeyBadgeData;
  description?: string;
}

export function ApiKeyBadge({
  apiKey,
  description = "Agent (API key)",
}: ApiKeyBadgeProps) {
  const shortId = apiKey.id.slice(0, 8);
  return (
    <div
      className="text-xs"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: "2px",
        padding: "var(--space-xs) var(--space-sm)",
        background: "var(--color-surface-container)",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-on-surface-variant)",
      }}
    >
      <span style={{ color: "var(--color-outline-variant)" }}>{description}</span>
      <span>
        {/* Honest fallback: "(unlabeled)" glued to a hash prefix read as one
            confusing token in the field (2026-07-05 journey-eval defect
            #7c). A labeled key gets its label in the normal weight; an
            unlabeled one gets a plain-language note instead of a symbol,
            with the id kept as a secondary, de-emphasized detail either way. */}
        {apiKey.label ? (
          <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{apiKey.label}</span>
        ) : (
          <em>No label set</em>
        )}
        <span style={{ color: "var(--color-outline-variant)", marginLeft: "0.5em", fontFamily: "var(--font-mono, monospace)" }}>
          {shortId}…
        </span>
      </span>
    </div>
  );
}
