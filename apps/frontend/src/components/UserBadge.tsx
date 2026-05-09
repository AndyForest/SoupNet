/**
 * UserBadge — compact display for a user. Today only the email is shown;
 * the props shape is open for future fields (display name, avatar, role
 * badge, signup date) without churn for callers.
 */

export interface UserBadgeData {
  email: string | null;
}

interface UserBadgeProps {
  user: UserBadgeData;
  label?: string;
}

export function UserBadge({ user, label = "Human user" }: UserBadgeProps) {
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
      <span style={{ color: "var(--color-outline-variant)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
        {user.email ?? "(unknown)"}
      </span>
    </div>
  );
}
