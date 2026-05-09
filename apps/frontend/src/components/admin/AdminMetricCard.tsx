interface AdminMetricCardProps {
  label: string;
  value: string | number;
  hint?: string | undefined;
}

export function AdminMetricCard({ label, value, hint }: AdminMetricCardProps) {
  return (
    <div
      style={{
        background: "var(--color-surface-container-low)",
        padding: "var(--space-md)",
        borderRadius: 0,
        minWidth: 140,
      }}
    >
      <div
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "0.7rem",
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-on-surface-variant)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: "var(--space-xs)",
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "1.75rem",
          fontWeight: 500,
          color: "var(--color-on-surface)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {hint ? (
        <div
          style={{
            marginTop: "var(--space-xs)",
            fontSize: "0.75rem",
            color: "var(--color-on-surface-variant)",
          }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}
