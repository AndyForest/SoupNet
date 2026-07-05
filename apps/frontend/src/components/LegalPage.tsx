import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

interface LegalPageProps {
  content: string;
}

/**
 * Shared shell for the public legal pages (/info/privacy, /info/terms).
 * The body comes from the .md file (single source of truth in docs/legal/) —
 * this component supplies styling for headings, paragraphs, lists, and
 * internal-vs-external link routing.
 *
 * Internal links inside the markdown ("/info/terms", "/info/privacy", "/")
 * are rewritten to TanStack Router <Link>s by the components.a override so
 * navigation stays SPA. External http(s) links open in a new tab.
 *
 * Cross-page navigation (to the paired legal page, How it works, Home) lives
 * in the universal SiteFooter mounted by AppShell — not duplicated here.
 */
export function LegalPage({ content }: LegalPageProps) {
  return (
    <div style={{
      maxWidth: 760,
      margin: "0 auto",
      padding: "var(--space-2xl) var(--space-xl)",
      lineHeight: 1.65,
      color: "var(--color-on-surface)",
    }}>
      <p style={{ marginBottom: "var(--space-lg)", fontSize: "0.9rem" }}>
        <Link to="/">← Back to soup.net</Link>
      </p>

      <MarkdownContent content={content} />
    </div>
  );
}

/**
 * The markdown renderer without the page wrapper — for pages that interleave
 * interactive components with .md-sourced prose (ConnectPage splices the
 * agent-type picker into docs/connectors/index.md at a comment marker).
 */
export function MarkdownContent({ content }: LegalPageProps) {
  return (
    <ReactMarkdown components={mdComponents}>
      {content}
    </ReactMarkdown>
  );
}

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 style={{
      fontSize: "2rem",
      color: "var(--color-primary)",
      marginBottom: "var(--space-sm)",
      marginTop: 0,
    }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 style={{
      fontSize: "1.25rem",
      marginTop: "var(--space-2xl)",
      marginBottom: "var(--space-sm)",
      color: "var(--color-on-surface)",
    }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{
      fontSize: "1.05rem",
      marginTop: "var(--space-xl)",
      marginBottom: "var(--space-sm)",
      color: "var(--color-on-surface)",
    }}>{children}</h3>
  ),
  p: ({ children }) => (
    <p style={{ marginBottom: "var(--space-md)" }}>{children}</p>
  ),
  ul: ({ children }) => (
    <ul style={{ marginBottom: "var(--space-md)", paddingLeft: "var(--space-lg)" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ marginBottom: "var(--space-md)", paddingLeft: "var(--space-lg)" }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{ marginBottom: "var(--space-xs)" }}>{children}</li>
  ),
  // Trusted-tier banner is a blockquote in the markdown source — give it a
  // warning-container style so it visually announces "this is interim content"
  // without needing the page component to know about its placement.
  blockquote: ({ children }) => (
    <blockquote style={{
      background: "var(--color-warning-container, #fff4e5)",
      border: "1px solid var(--color-warning, #d97706)",
      borderRadius: "var(--radius-md)",
      padding: "var(--space-md) var(--space-lg)",
      margin: "var(--space-lg) 0",
      fontSize: "0.95rem",
    }}>{children}</blockquote>
  ),
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>;
    // Internal SPA links: any path that starts with "/" and doesn't have a
    // protocol gets wrapped in TanStack Router <Link> for client-side
    // navigation. External (http/https/mailto/etc.) opens in new tab.
    if (href.startsWith("/")) {
      return <Link to={href}>{children}</Link>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  hr: () => (
    <hr style={{
      margin: "var(--space-xl) 0",
      border: 0,
      borderTop: "1px solid var(--color-outline-variant, #e0e0e0)",
    }} />
  ),
  strong: ({ children }) => (
    <strong style={{ fontWeight: 600 }}>{children}</strong>
  ),
};
