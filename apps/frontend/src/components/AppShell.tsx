import { useEffect, useState } from "react";
import { Outlet, Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, clearToken, isLoggedIn, AUTH_INVALIDATED_EVENT } from "../auth.js";
import { CookieNotice } from "./CookieNotice.js";
import { SiteFooter } from "./SiteFooter.js";
import { Icon } from "./Icon.js";
import type { IconProps } from "./Icon.js";
import soupnetLogo from "../assets/soupnet-logo.png";
import styles from "./AppShell.module.css";

type NavIconName = IconProps["name"];
export type NavItem = { to: string; label: string; icon: NavIconName };
export type LearnItem = { to: string; label: string };

// Rule-of-7 regrouping (docs/backlog.md "[DESIGN] Side-nav regrouping (rule of
// 7) + landing reachability"): these six plus the "Learn" group below give
// seven top-level sidebar entries. Admin is an eighth, shown only to the
// system role, so it doesn't count against the rule for everyone else.
// Exported for the structural regression test in AppShell.test.ts.
export const primaryNavItems: readonly NavItem[] = [
  { to: "/app/dashboard", label: "Dashboard", icon: "home" },
  { to: "/app/check", label: "Check Recipe", icon: "clipboard-check" },
  { to: "/app/keys", label: "API Keys", icon: "key" },
  { to: "/app/map", label: "Recipe Map", icon: "map" },
  { to: "/app/recipe-books", label: "Recipe Books", icon: "users" },
  { to: "/app/settings", label: "Settings", icon: "settings" },
];

// Explainer / marketing pages, grouped under "Learn". Includes the landing
// page itself, which previously had no nav entry at all for signed-in users
// (reachable only via the logo) — restoring that reachability is part of the
// same backlog item.
export const learnNavItems: readonly LearnItem[] = [
  { to: "/", label: "Overview" },
  { to: "/info/how-it-works", label: "How it works" },
  { to: "/info/connect", label: "Connect to AI" },
  { to: "/info/privacy", label: "Privacy" },
  { to: "/info/terms", label: "Terms" },
];

// Distinct icon from Settings — Admin previously reused the settings gear,
// which made the two nav items visually indistinguishable at a glance.
export const adminNavItem: NavItem = { to: "/admin", label: "Admin", icon: "shield" };

// Mobile bottom bar shows primary items only; everything else (API Keys,
// Settings, the Learn group, Admin) lives behind "More" so the bar never
// exceeds five touch targets regardless of role.
export const mobilePrimaryItems: readonly NavItem[] = [
  { to: "/app/dashboard", label: "Dashboard", icon: "home" },
  { to: "/app/check", label: "Check Recipe", icon: "clipboard-check" },
  { to: "/app/map", label: "Recipe Map", icon: "map" },
  { to: "/app/recipe-books", label: "Recipe Books", icon: "users" },
];

// Minimal shape `isNavItemActive` needs from TanStack Router's `matchRoute` —
// narrower than `ReturnType<typeof useMatchRoute>` (a complex generic
// overloaded type) so the function stays easy to unit test with a plain fake.
export type MatchRouteFn = (opts: { to: string; fuzzy: boolean }) => boolean;

/**
 * Whether a nav item counts as "active" for highlighting. Exact-match only
 * for the root landing page ("/") — fuzzy matching there would match every
 * route in the app, since everything else nests under it, which would mark
 * "Overview" active on every page.
 */
export function isNavItemActive(matchRoute: MatchRouteFn, to: string): boolean {
  return matchRoute({ to, fuzzy: to !== "/" });
}

export function AppShell() {
  const navigate = useNavigate();
  const rawMatchRoute = useMatchRoute();
  const matchRoute: MatchRouteFn = (opts) => !!rawMatchRoute(opts);
  const queryClient = useQueryClient();
  const loggedIn = isLoggedIn();
  const [moreOpen, setMoreOpen] = useState(false);

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: { id: string; email: string; role: string } } };
      if (!json.ok || !json.data) throw new Error("Failed");
      return json.data.user;
    },
    enabled: loggedIn,
    // Don't retry on 401 — authFetch already cleared the token and
    // dispatched the invalidation event, so a retry would just 401 again
    // and waste a round trip.
    retry: false,
  });

  const isSystem = meQuery.data?.role === "system";
  const isLearnActive = learnNavItems.some((item) => isNavItemActive(matchRoute, item.to));

  // Auto-expand the Learn group's <details> when navigation lands on one of
  // its child pages, so the active item is visible without a manual click.
  // Doesn't auto-collapse on navigating away — a group the user opened stays
  // open while they browse elsewhere in the sidebar.
  const [learnOpen, setLearnOpen] = useState(isLearnActive);
  useEffect(() => {
    if (isLearnActive) setLearnOpen(true);
  }, [isLearnActive]);

  // Listen for the global session-invalidated signal raised by authFetch on
  // any 401. Clear the query cache (so the next user doesn't inherit the
  // stale user's data) and bounce to the login page. Mounted at AppShell
  // level so it's active across the whole authed area of the app, not just
  // one page. See auth.ts AUTH_INVALIDATED_EVENT for why this is decoupled
  // via an event rather than called inline.
  useEffect(() => {
    function onAuthInvalidated() {
      queryClient.clear();
      void navigate({ to: "/auth/login" });
    }
    window.addEventListener(AUTH_INVALIDATED_EVENT, onAuthInvalidated);
    return () => window.removeEventListener(AUTH_INVALIDATED_EVENT, onAuthInvalidated);
  }, [navigate, queryClient]);

  // Close the mobile "More" sheet on Escape, mirroring the other overlay in
  // this app (DeleteTraceConfirmModal has no keydown handler of its own, but
  // a bottom sheet covering the whole nav benefits from it more than a small
  // centered dialog does).
  useEffect(() => {
    if (!moreOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  function handleLogout() {
    clearToken();
    // Clear all cached React Query data — otherwise the next user to log in
    // in this browser tab sees the previous user's cached results (e.g. their
    // pending invitations) until each query refetches. Especially important
    // for per-user data keyed by constant query keys.
    queryClient.clear();
    void navigate({ to: "/auth/login" });
  }

  // Login page: no shell, just the page (plus the universal site footer and
  // one-time cookie notice). The footer mounts before the !loggedIn early
  // return so unauthenticated marketing pages (LandingPage, HowItWorksPage,
  // legal pages) get a consistent set of footer links.
  if (!loggedIn) {
    return (
      <>
        <Outlet />
        <SiteFooter />
        <CookieNotice />
      </>
    );
  }

  return (
    <div className={styles.shell}>
      {/* Sidebar (desktop) */}
      <aside className={styles.sidebar}>
        <Link to="/" className={styles.logo} aria-label="Soup.net home">
          <img src={soupnetLogo} alt="Soup.net" className={styles.logoImg} />
        </Link>

        <nav className={styles.nav} aria-label="Main navigation">
          {primaryNavItems.map((item) => {
            const isActive = isNavItemActive(matchRoute, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </Link>
            );
          })}

          <details
            className={styles.navGroup}
            open={learnOpen}
            onToggle={(e) => setLearnOpen(e.currentTarget.open)}
          >
            <summary className={`${styles.navGroupToggle} ${isLearnActive ? styles.navGroupToggleActive : ""}`}>
              <Icon name="book-open" size={18} />
              <span className={styles.navGroupToggleLabel}>Learn</span>
              <span className={styles.navGroupChevron}>
                <Icon name="chevron-right" size={14} />
              </span>
            </summary>
            <div className={styles.navGroupItems}>
              {learnNavItems.map((item) => {
                const isActive = isNavItemActive(matchRoute, item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`${styles.navSubLink} ${isActive ? styles.navSubLinkActive : ""}`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </details>

          {isSystem && (
            <Link
              to={adminNavItem.to}
              className={`${styles.navLink} ${isNavItemActive(matchRoute, adminNavItem.to) ? styles.navLinkActive : ""}`}
              aria-current={isNavItemActive(matchRoute, adminNavItem.to) ? "page" : undefined}
            >
              <Icon name={adminNavItem.icon} size={18} />
              {adminNavItem.label}
            </Link>
          )}
        </nav>

        <div className={styles.sidebarFooter}>
          <a
            href="https://github.com/AndyForest/SoupNet/tree/main/docs/architecture"
            target="_blank"
            rel="noopener"
            style={{ display: "block", fontSize: "0.8rem", color: "var(--color-on-surface-variant)", textDecoration: "none", padding: "var(--space-xs) var(--space-md)", marginBottom: "var(--space-sm)" }}
          >
            Research →
          </a>
          <button onClick={handleLogout} className={styles.logoutBtn}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
          <SiteFooter />
        </div>
      </main>

      <CookieNotice />

      {/* Bottom bar (mobile) */}
      <div className={styles.bottomBar}>
        {/* Distinct label from the desktop sidebar nav above — the two were
            both "Main navigation" (2026-07-05 journey-eval papercut),
            indistinguishable to assistive tech and test selectors even
            though only one is ever visible at a given viewport width. */}
        <nav className={styles.bottomNav} aria-label="Mobile navigation">
          {mobilePrimaryItems.map((item) => {
            const isActive = isNavItemActive(matchRoute, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`${styles.bottomLink} ${isActive ? styles.bottomLinkActive : ""}`}
              >
                <Icon name={item.icon} size={20} />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            className={styles.bottomLink}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <span className={styles.bottomMoreChevron}>
              <Icon name="chevron-right" size={20} />
            </span>
            More
          </button>
        </nav>
      </div>

      {/* "More" sheet (mobile): the rest of the nav — Learn group, API Keys,
          Settings, Admin — that doesn't fit as a primary bottom-bar item. */}
      {moreOpen && (
        <>
          <div
            className={styles.moreOverlay}
            onClick={() => setMoreOpen(false)}
          />
          <div className={styles.moreSheet} role="dialog" aria-modal="true" aria-label="More navigation">
            <div className={styles.moreSheetHeader}>
              <span className={styles.moreSheetTitle}>More</span>
              <button
                type="button"
                className={styles.moreSheetClose}
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className={styles.moreSheetSection}>
              <Link to="/app/keys" className={styles.moreSheetLink} onClick={() => setMoreOpen(false)}>
                <Icon name="key" size={18} />
                API Keys
              </Link>
              <Link to="/app/settings" className={styles.moreSheetLink} onClick={() => setMoreOpen(false)}>
                <Icon name="settings" size={18} />
                Settings
              </Link>
              {isSystem && (
                <Link to={adminNavItem.to} className={styles.moreSheetLink} onClick={() => setMoreOpen(false)}>
                  <Icon name={adminNavItem.icon} size={18} />
                  {adminNavItem.label}
                </Link>
              )}
            </div>

            <div className={styles.moreSheetLabel}>Learn</div>
            <div className={styles.moreSheetSection}>
              {learnNavItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={styles.moreSheetLink}
                  onClick={() => setMoreOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
