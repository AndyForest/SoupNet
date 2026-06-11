import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Icon } from "../Icon.js";

type NavIcon = "home" | "users" | "clock" | "settings" | "mail";

interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
}

// User management pair (Users, Signups) sits together; no generic "Settings"
// page — each control lives with the surface it governs (the embeddings
// kill-switch is on the Embeddings page, the signup cap on Signups).
const NAV: NavItem[] = [
  { label: "Overview", href: "/admin", icon: "home" },
  { label: "Users", href: "/admin/users", icon: "users" },
  { label: "Signups", href: "/admin/signups", icon: "users" },
  { label: "Emails", href: "/admin/emails", icon: "mail" },
  { label: "Queues", href: "/admin/queues", icon: "clock" },
  { label: "Embeddings", href: "/admin/workers/embeddings", icon: "settings" },
];

interface AdminLayoutProps {
  children: ReactNode;
  inspector?: ReactNode | undefined;
}

export function AdminLayout({ children, inspector }: AdminLayoutProps) {
  const location = useLocation();
  const current = location.pathname;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: inspector ? "200px 1fr 320px" : "200px 1fr",
        minHeight: "calc(100vh - 56px)",
        background: "var(--color-surface)",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <nav
        style={{
          background: "var(--color-surface-container-low)",
          padding: "var(--space-md) var(--space-sm)",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
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
            padding: "var(--space-xs) var(--space-sm)",
            marginBottom: "var(--space-xs)",
          }}
        >
          System Admin
        </div>
        {NAV.map((item) => {
          const active =
            item.href === "/admin"
              ? current === "/admin"
              : current === item.href || current.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              to={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                padding: "var(--space-sm) var(--space-sm)",
                color: active ? "var(--color-on-surface)" : "var(--color-on-surface-variant)",
                background: active ? "var(--color-surface-container-high)" : "transparent",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: active ? 500 : 400,
                borderRadius: 0,
              }}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <main style={{ overflow: "auto" }}>{children}</main>

      {inspector ? (
        <aside
          style={{
            background: "var(--color-surface-container-low)",
            padding: "var(--space-lg)",
            overflow: "auto",
          }}
        >
          {inspector}
        </aside>
      ) : null}
    </div>
  );
}
