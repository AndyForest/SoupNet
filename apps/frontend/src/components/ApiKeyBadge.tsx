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
      <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
        {apiKey.label || "(unlabeled)"}
        <span style={{ color: "var(--color-outline-variant)", marginLeft: "0.5em" }}>
          {shortId}…
        </span>
      </span>
    </div>
  );
}
