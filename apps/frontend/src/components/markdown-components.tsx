import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { Components } from "react-markdown";

/** The column every markdown-sourced /info page sits in. */
export const INFO_PAGE_STYLE: CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "var(--space-2xl) var(--space-xl)",
  lineHeight: 1.65,
  color: "var(--color-on-surface)",
};

/**
 * The styled elements for markdown-sourced pages, shared by the live page and
 * the static HTML built for it (static-info-pages.tsx). The caller supplies
 * how an internal link renders: a TanStack Router <Link> in the app, a plain
 * <a> in the static HTML, which runs before any router exists.
 */
export function markdownComponents(InternalLink: ComponentType<{ href: string; children?: ReactNode }>): Components {
  return {
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
      // Any path that starts with "/" and has no protocol is internal.
      // External (http/https/mailto/etc.) opens in new tab.
      if (href.startsWith("/")) {
        return <InternalLink href={href}>{children}</InternalLink>;
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    // A long command scrolls inside its block rather than widening the page
    // at phone width.
    pre: ({ children }) => (
      <pre style={{ overflowX: "auto", maxWidth: "100%" }}>{children}</pre>
    ),
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
}
