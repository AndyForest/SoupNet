import { Link } from "@tanstack/react-router";

/**
 * PLACEHOLDER. The real Terms of Service content has not been written yet —
 * see backlog "Launch Readiness > Legal and compliance" for the plan
 * (template service like Termly or iubenda, then customize). Until then this
 * page exists so the registration checkbox links to something real, the
 * structural decision is in place from day one, and we can swap the content
 * without code changes.
 */
export function TermsPage() {
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
        Terms of Service
      </h1>

      <div style={{
        background: "var(--color-warning-container, #fff4e5)",
        border: "1px solid var(--color-warning, #d97706)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-md) var(--space-lg)",
        marginBottom: "var(--space-xl)",
        fontSize: "0.9rem",
      }}>
        <strong>Placeholder content.</strong> Soup.net is in private beta with
        a small group of trusted invited testers. The real Terms of Service
        will be drafted by a legal template service before public launch. By
        accepting these placeholder terms you acknowledge that the service is
        experimental and provided as-is.
      </div>

      <h2 style={{ fontSize: "1.2rem", marginTop: "var(--space-xl)", marginBottom: "var(--space-sm)" }}>
        1. Beta service
      </h2>
      <p style={{ marginBottom: "var(--space-md)" }}>
        Soup.net is offered free of charge during the private beta. Features
        may change, data may be reset, and the service may be unavailable
        without notice. Don&apos;t use it for anything you can&apos;t afford to
        lose.
      </p>

      <h2 style={{ fontSize: "1.2rem", marginTop: "var(--space-xl)", marginBottom: "var(--space-sm)" }}>
        2. Acceptable use
      </h2>
      <p style={{ marginBottom: "var(--space-md)" }}>
        Don&apos;t upload illegal content, don&apos;t harass other users,
        don&apos;t try to break the system. We may suspend accounts that do.
      </p>

      <h2 style={{ fontSize: "1.2rem", marginTop: "var(--space-xl)", marginBottom: "var(--space-sm)" }}>
        3. Your data
      </h2>
      <p style={{ marginBottom: "var(--space-md)" }}>
        You own the recipes, evidence, and references you submit. You grant
        Soup.net a license to store, index, and display your content as part
        of the service. You can export or delete your data at any time. See
        the <Link to="/info/privacy">Privacy Policy</Link> for details.
      </p>

      <h2 style={{ fontSize: "1.2rem", marginTop: "var(--space-xl)", marginBottom: "var(--space-sm)" }}>
        4. No warranty
      </h2>
      <p style={{ marginBottom: "var(--space-md)" }}>
        The service is provided AS IS, without warranty of any kind. We are
        not liable for any damages arising from your use of the service.
      </p>

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
