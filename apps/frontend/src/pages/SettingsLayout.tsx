import { Outlet, Link, useMatchRoute } from "@tanstack/react-router";
import styles from "./SettingsLayout.module.css";

/**
 * Settings layout — left-nav + outlet for `/app/settings/*`. Below the app
 * shell's 768px mobile breakpoint the nav stacks above the content (see
 * SettingsLayout.module.css).
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
    <div className={styles.layout}>
      <nav className={styles.nav} aria-label="Settings">
        <h2 className={styles.heading}>Settings</h2>
        {NAV_ITEMS.map((item) => {
          const active = !!matchRoute({ to: item.to, fuzzy: false });
          return (
            <Link
              key={item.to}
              to={item.to}
              className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}
