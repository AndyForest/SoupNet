import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Icon } from "../Icon.js";
import type { AdminScope } from "./useAdminGate.js";

type NavIcon = "home" | "users" | "clock" | "settings" | "mail" | "book-open" | "shield";

interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
}

// User management pair (Users, Signups) sits together; no generic "Settings"
// page — each control lives with the surface it governs (the embeddings
// kill-switch is on the Embeddings page, the signup cap on Signups).
//
// The org console (CN-M4, recipe b66536c5) follows the same rule: the sharing
// policy sits on Books beside the books it governs, and nothing in its nav
// leads into the site operator's pages.
const NAV: Record<AdminScope, NavItem[]> = {
  site: [
    { label: "Overview", href: "/admin", icon: "home" },
    { label: "Users", href: "/admin/users", icon: "users" },
    { label: "Organizations", href: "/admin/organizations", icon: "shield" },
    { label: "Signups", href: "/admin/signups", icon: "users" },
    { label: "Emails", href: "/admin/emails", icon: "mail" },
    { label: "Queues", href: "/admin/queues", icon: "clock" },
    { label: "Embeddings", href: "/admin/workers/embeddings", icon: "settings" },
  ],
  org: [
    { label: "Members", href: "/org", icon: "users" },
    { label: "Books", href: "/org/books", icon: "book-open" },
    { label: "Domains", href: "/org/domains", icon: "shield" },
    { label: "Activity", href: "/org/activity", icon: "clock" },
  ],
};

const HEADING: Record<AdminScope, string> = { site: "System Admin", org: "Organization" };

interface AdminLayoutProps {
  children: ReactNode;
  inspector?: ReactNode | undefined;
  /** Which console's nav to show; the site operator's by default. */
  scope?: AdminScope;
  /** Shown above the nav in place of the console's generic heading (the organization's name). */
  heading?: string | undefined;
}

export function AdminLayout({ children, inspector, scope = "site", heading }: AdminLayoutProps) {
  const nav = NAV[scope];
  const home = nav[0]?.href;
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
          {heading ?? HEADING[scope]}
        </div>
        {nav.map((item) => {
          const active =
            item.href === home
              ? current === home
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
