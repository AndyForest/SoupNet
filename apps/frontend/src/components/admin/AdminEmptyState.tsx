import type { ReactNode } from "react";

interface AdminEmptyStateProps {
  title: string;
  body?: string | undefined;
  action?: ReactNode | undefined;
}

export function AdminEmptyState({ title, body, action }: AdminEmptyStateProps) {
  return (
    <div
      style={{
        padding: "var(--space-xl) var(--space-lg)",
        textAlign: "center",
        background: "var(--color-surface-container-lowest)",
        color: "var(--color-on-surface-variant)",
      }}
    >
      <div
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "0.875rem",
          fontWeight: 500,
          color: "var(--color-on-surface)",
          marginBottom: "var(--space-xs)",
        }}
      >
        {title}
      </div>
      {body ? (
        <div style={{ fontSize: "0.8125rem", maxWidth: 480, margin: "0 auto" }}>{body}</div>
      ) : null}
      {action ? <div style={{ marginTop: "var(--space-md)" }}>{action}</div> : null}
    </div>
  );
}
