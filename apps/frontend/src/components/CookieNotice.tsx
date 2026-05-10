import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";

const STORAGE_KEY = "cookie_notice_dismissed";

/**
 * One-time first-visit banner explaining what we store in the browser.
 *
 * Soup.net stores a JWT in localStorage to keep you signed in and that's it
 * — no tracking cookies, no analytics. The notice is informational, not a
 * GDPR/CCPA consent gate (our localStorage use is "strictly necessary" under
 * ePrivacy Article 5(3) so consent isn't required). One-time dismissal is
 * tracked in localStorage; once dismissed the banner never re-renders.
 *
 * Positioned at the very bottom of the viewport with a higher z-index than
 * LandingPage's sticky CTA bar (z=100) so it covers that bar on the first
 * visit. Dismissal restores the CTA bar's visibility.
 */
export function CookieNotice() {
  // Defer the localStorage read to a useEffect so SSR / SSG (if ever added)
  // doesn't break on missing window. Default to hidden on the first render
  // to avoid a flash on already-dismissed visits.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    if (dismissed !== "true") {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    window.localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
  }

  return (
    <div
      role="region"
      aria-label="Browser storage notice"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "var(--color-surface-container, #1f1f1f)",
        color: "var(--color-on-surface, #f0f0f0)",
        borderTop: "1px solid var(--color-outline-variant, #444)",
        padding: "var(--space-sm) var(--space-lg)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-md)",
        fontSize: "0.85rem",
        zIndex: 200,
        boxShadow: "0 -2px 12px rgba(0,0,0,0.15)",
      }}
    >
      <span style={{ flex: "1 1 auto", minWidth: 220, lineHeight: 1.4 }}>
        Soup.net stores a sign-in token in your browser&apos;s localStorage.
        No tracking cookies, no third-party analytics.{" "}
        <Link to="/info/privacy" style={{ color: "var(--color-primary)" }}>
          Privacy Policy
        </Link>
        .
      </span>
      <button
        type="button"
        onClick={dismiss}
        style={{
          padding: "var(--space-xs) var(--space-md)",
          fontSize: "0.85rem",
          flexShrink: 0,
        }}
      >
        Got it
      </button>
    </div>
  );
}
