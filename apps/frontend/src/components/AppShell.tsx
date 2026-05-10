import { Outlet, Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, clearToken, isLoggedIn } from "../auth.js";
import { CookieNotice } from "./CookieNotice.js";
import { Icon } from "./Icon.js";
import soupnetLogo from "../assets/soupnet-logo.png";
import styles from "./AppShell.module.css";

const baseNavItems = [
  { to: "/app/dashboard", label: "Dashboard", icon: "home" as const },
  { to: "/app/check", label: "Check Recipe", icon: "clipboard-check" as const },
  { to: "/app/keys", label: "API Keys", icon: "key" as const },
  { to: "/app/map", label: "Recipe Map", icon: "map" as const },
  { to: "/app/groups", label: "Groups", icon: "users" as const },
  { to: "/app/settings", label: "Settings", icon: "settings" as const },
] as const;

const adminNavItem = { to: "/admin", label: "Admin", icon: "settings" as const };

export function AppShell() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const queryClient = useQueryClient();
  const loggedIn = isLoggedIn();

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: { id: string; email: string; role: string } } };
      if (!json.ok || !json.data) throw new Error("Failed");
      return json.data.user;
    },
    enabled: loggedIn,
  });

  const navItems = meQuery.data?.role === "system"
    ? [...baseNavItems, adminNavItem]
    : baseNavItems;

  function handleLogout() {
    clearToken();
    // Clear all cached React Query data — otherwise the next user to log in
    // in this browser tab sees the previous user's cached results (e.g. their
    // pending invitations) until each query refetches. Especially important
    // for per-user data keyed by constant query keys.
    queryClient.clear();
    void navigate({ to: "/auth/login" });
  }

  // Login page: no shell, just the page (plus the one-time cookie notice).
  // CookieNotice mounts before the !loggedIn early-return so unauthenticated
  // marketing pages (LandingPage, HowItWorksPage, legal pages) get it too.
  if (!loggedIn) {
    return (
      <>
        <Outlet />
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
          {navItems.map((item) => {
            const isActive = !!matchRoute({ to: item.to, fuzzy: true });
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
        </div>
      </main>

      <CookieNotice />

      {/* Bottom bar (mobile) */}
      <div className={styles.bottomBar}>
        <nav className={styles.bottomNav} aria-label="Main navigation">
          {navItems.map((item) => {
            const isActive = !!matchRoute({ to: item.to, fuzzy: true });
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
        </nav>
      </div>
    </div>
  );
}
