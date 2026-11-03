import type { ReactNode } from "react";

interface AdminPageHeaderProps {
  title: string;
  subtitle?: string | undefined;
  action?: ReactNode | undefined;
  /** The small label above the title: "Admin" on the site console, "Organization" on an org's. */
  eyebrow?: string | undefined;
}

export function AdminPageHeader({ title, subtitle, action, eyebrow = "Admin" }: AdminPageHeaderProps) {
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
          {eyebrow}
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
