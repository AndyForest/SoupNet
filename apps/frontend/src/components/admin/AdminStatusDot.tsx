export type AdminStatus = "healthy" | "warning" | "error" | "idle";

const COLORS: Record<AdminStatus, string> = {
  healthy: "#34d399", // emerald
  warning: "#f59e0b", // amber
  error: "#ef4444",   // red
  idle: "#6b7280",    // gray
};

export function AdminStatusDot({ status, label }: { status: AdminStatus; label?: string | undefined }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: "0.75rem",
        color: "var(--color-on-surface-variant)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          background: COLORS[status],
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
