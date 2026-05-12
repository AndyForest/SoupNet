import { Link } from "@tanstack/react-router";

/**
 * Universal page footer. Mounted in `AppShell` for both authenticated and
 * unauthenticated branches so every page gets the same set of links.
 *
 * Inline footers in `LandingPage` and `HowItWorksPage` were dropped when this
 * was added. `LegalPage` also dropped its custom bottom cross-link footer —
 * the SiteFooter covers cross-page navigation.
 *
 * Note about overlap on LandingPage: the LandingPage has a sticky bottom CTA
 * bar (`position: fixed`) that visually covers this footer when scrolled to
 * the absolute bottom. That's intentional for now — the marketing CTA wins
 * over the footer for unauthenticated visitors. The footer is still in DOM
 * and reachable via screen readers and tab navigation.
 */
export function SiteFooter() {
  return (
    <footer
      style={{
        textAlign: "center",
        padding: "var(--space-lg) var(--space-xl)",
        color: "var(--color-on-surface-variant)",
        fontSize: "0.8rem",
      }}
    >
      <Link
        to="/"
        style={{ color: "var(--color-on-surface-variant)" }}
      >
        Soup.net
      </Link>
      <Link
        to="/info/how-it-works"
        style={{ color: "var(--color-on-surface-variant)", marginLeft: "var(--space-md)" }}
      >
        How it works
      </Link>
      <Link
        to="/info/privacy"
        style={{ color: "var(--color-on-surface-variant)", marginLeft: "var(--space-md)" }}
      >
        Privacy
      </Link>
      <Link
        to="/info/terms"
        style={{ color: "var(--color-on-surface-variant)", marginLeft: "var(--space-md)" }}
      >
        Terms
      </Link>
    </footer>
  );
}
