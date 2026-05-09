import type { ReactNode } from "react";

interface AdminPageHeaderProps {
  title: string;
  subtitle?: string | undefined;
  action?: ReactNode | undefined;
}

export function AdminPageHeader({ title, subtitle, action }: AdminPageHeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "var(--space-md)",
        padding: "var(--space-lg) var(--space-lg) var(--space-md)",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "0.7rem",
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-on-surface-variant)",
            marginBottom: "var(--space-xs)",
          }}
        >
          Admin
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: "1.5rem",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--color-on-surface)",
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            style={{
              margin: "var(--space-xs) 0 0 0",
              color: "var(--color-on-surface-variant)",
              fontSize: "0.875rem",
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </header>
  );
}
