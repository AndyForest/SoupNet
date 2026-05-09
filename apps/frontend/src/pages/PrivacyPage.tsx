import { Link } from "@tanstack/react-router";

/**
 * PLACEHOLDER. The real Privacy Policy has not been written yet — see
 * backlog "Launch Readiness > Legal and compliance" for the plan. The
 * structural commitments below (no tracking, exportable data, deletion on
 * request) are accurate as of 2026-04-09 and reflect the actual product
 * design, but the document is not yet written by legal counsel.
 */
export function PrivacyPage() {
  return (
    <div style={{
      maxWidth: 720,
      margin: "0 auto",
      padding: "var(--space-2xl) var(--space-xl)",
      lineHeight: 1.6,
    }}>
      <p style={{ marginBottom: "var(--space-lg)" }}>
        <Link to="/auth/login">← Back to sign in</Link>
      </p>

      <h1 style={{
        fontSize: "2rem",
        color: "var(--color-primary)",
        marginBottom: "var(--space-md)",
      }}>
        Privacy Policy
      </h1>

      <div style={{
        background: "var(--color-warning-container, #fff4e5)",
        border: "1px solid var(--color-warning, #d97706)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-md) var(--space-lg)",
        marginBottom: "var(--space-xl)",
        fontSize: "0.9rem",
      }}>
        <strong>Placeholder content.</strong> Soup.net is operated from Canada
        and serves users worldwide. The policy below describes the actual
        product design as of 2026-04-09 but has not yet been reviewed by legal
        counsel. A formal policy (PIPEDA / GDPR-compliant) will replace this
        before public launch.
      </div>

      <h2 style={{ fontSize: "1.2rem", marginTop: "var(--space-xl)", marginBottom: "var(--space-sm)" }}>
        What we collect
      </h2>
      <ul style={{ marginBottom: "var(--space-md)", paddingLeft: "var(--space-lg)" }}>
        <li>Email address (for sign-in and notifications)</li>
        <li>Recipes, evidence, and references you submit</li>
        <li>API key metadata (creation time, group access, last-used time — never the raw key after creation)</li>
        <li>Server logs (request paths, status codes — no request bodies)</li>
      </ul>

      <h2 style={{ fontSize: "1.2rem", marginTop: "var(--space-xl)", marginBottom: "var(--space-sm)" }}>
        What we don&apos;t do
      </h2>
      <ul style={{ marginBottom: "var(--space-md)", paddingLeft: "var(--space-lg)" }}>
        <li>We do not sell your data.</li>
        <li>We do not use tracking cookies. The only client storage is a JWT token in localStorage to keep you signed in.</li>
        <li>We do not use third-party analytics or advertising.</li>
      </ul>

      <h2 style={{ fontSize: "1.2rem", marginTop: "var(--space-xl)", marginBottom: "var(--space-sm)" }}>
        Vector embeddings
      </h2>
      <p style={{ marginBottom: "var(--space-md)" }}>
        Recipe text is sent to Google&apos;s Gemini embedding API to generate
        semantic vectors for search. Vectors are content-hash keyed and cached
        in our database; the original text stays in your account&apos;s scope.
        See the open-source code at github.com/soupnet for the exact data flow.
      </p>

      <h2 style={{ fontSize: "1.2rem", marginTop: "var(--space-xl)", marginBottom: "var(--space-sm)" }}>
        Your rights
      </h2>
      <ul style={{ marginBottom: "var(--space-md)", paddingLeft: "var(--space-lg)" }}>
        <li>Export all your data anytime (Settings → Export).</li>
        <li>Delete your account and all associated data anytime (Settings → Delete Account).</li>
        <li>Request a copy of any data we hold by emailing the address on the contact page.</li>
      </ul>

      <p style={{
        marginTop: "var(--space-2xl)",
        fontSize: "0.85rem",
        color: "var(--color-on-surface-variant)",
      }}>
        Last updated: 2026-04-09 (placeholder version)
      </p>
    </div>
  );
}
