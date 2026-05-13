import { Outlet, Link, useMatchRoute } from "@tanstack/react-router";

/**
 * Settings layout — left-nav + outlet for `/app/settings/*`.
 *
 * The nav is a simple persistent vertical list rather than a true accordion;
 * with 2 children it would be over-engineered to collapse. When a third
 * section lands, group related items under expandable headings (e.g.
 * "Account & Data", "Briefings & Agents", "Integrations") and lift this into
 * a generic SidebarNav component.
 */
const NAV_ITEMS = [
  { to: "/app/settings/account", label: "Account" },
  { to: "/app/settings/briefings", label: "Briefings" },
] as const;

export function SettingsLayout() {
  const matchRoute = useMatchRoute();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "var(--space-xl)", alignItems: "start" }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", position: "sticky", top: "var(--space-md)" }}>
        <h2 style={{ fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-on-surface-variant)", marginBottom: "var(--space-xs)" }}>
          Settings
        </h2>
        {NAV_ITEMS.map((item) => {
          const active = !!matchRoute({ to: item.to, fuzzy: false });
          return (
            <Link
              key={item.to}
              to={item.to}
              style={{
                display: "block",
                padding: "var(--space-xs) var(--space-sm)",
                borderRadius: "var(--radius-sm)",
                background: active ? "var(--color-surface-container)" : "transparent",
                color: active ? "var(--color-primary)" : "var(--color-on-surface)",
                fontWeight: active ? 600 : 400,
                fontSize: "0.9rem",
                textDecoration: "none",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div style={{ minWidth: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
