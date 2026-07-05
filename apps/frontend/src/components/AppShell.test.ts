import { describe, it, expect } from "vitest";
import {
  isNavItemActive,
  primaryNavItems,
  learnNavItems,
  adminNavItem,
  mobilePrimaryItems,
} from "./AppShell.js";

/**
 * Fake `matchRoute` that mimics TanStack Router's fuzzy-matching semantics
 * closely enough to test `isNavItemActive` in isolation: `fuzzy: true` means
 * "current path starts with `to`", `fuzzy: false` means exact match only.
 */
function fakeMatchRoute(currentPath: string) {
  return ({ to, fuzzy }: { to: string; fuzzy: boolean }) =>
    fuzzy ? currentPath.startsWith(to) : currentPath === to;
}

describe("isNavItemActive", () => {
  it("does not mark the landing page active on every route (the fuzzy-match bug)", () => {
    // Every app route nests under "/", so naively fuzzy-matching "/" (as the
    // old flat nav array did for every item) would mark the landing page
    // active everywhere. Exact-match-only for "/" is the fix.
    const matchRoute = fakeMatchRoute("/app/dashboard");
    expect(isNavItemActive(matchRoute, "/")).toBe(false);
  });

  it("marks the landing page active only on the landing page itself", () => {
    const matchRoute = fakeMatchRoute("/");
    expect(isNavItemActive(matchRoute, "/")).toBe(true);
  });

  it("fuzzy-matches non-root routes so nested pages still highlight their parent nav item", () => {
    const matchRoute = fakeMatchRoute("/app/recipe-books/abc123/traces");
    expect(isNavItemActive(matchRoute, "/app/recipe-books")).toBe(true);
  });

  it("does not cross-match unrelated routes", () => {
    const matchRoute = fakeMatchRoute("/app/dashboard");
    expect(isNavItemActive(matchRoute, "/info/how-it-works")).toBe(false);
  });
});

describe("nav structure (rule of 7)", () => {
  it("keeps the desktop sidebar's default top-level entries at or under 7 (primary items + the Learn group)", () => {
    // +1 for the collapsed "Learn" group itself. Admin is excluded here —
    // it's an 8th item shown only to the system role, not counted against
    // the rule for everyone else.
    expect(primaryNavItems.length + 1).toBeLessThanOrEqual(7);
  });

  it("groups exactly the explainer/marketing pages under Learn, including the landing page", () => {
    const learnPaths = learnNavItems.map((item) => item.to);
    expect(learnPaths).toEqual([
      "/",
      "/info/how-it-works",
      "/info/connect",
      "/info/privacy",
      "/info/terms",
    ]);
  });

  it("gives Admin a distinct icon from Settings", () => {
    const settingsItem = primaryNavItems.find((item) => item.to === "/app/settings");
    expect(settingsItem).toBeDefined();
    expect(adminNavItem.icon).not.toBe(settingsItem?.icon);
  });

  it("caps the mobile bottom bar at 4 primary items (plus a More affordance) so it never re-crushes", () => {
    expect(mobilePrimaryItems.length).toBeLessThanOrEqual(4);
  });

  it("keeps every mobile-primary route inside the desktop primary set too (no orphaned mobile-only routes)", () => {
    const primaryPaths = new Set(primaryNavItems.map((item) => item.to));
    for (const item of mobilePrimaryItems) {
      expect(primaryPaths.has(item.to)).toBe(true);
    }
  });
});
