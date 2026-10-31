import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { INFO_PAGE_STYLE, markdownComponents } from "./markdown-components.js";

interface LegalPageProps {
  content: string;
}

/**
 * Shared shell for the public legal pages (/info/privacy, /info/terms).
 * The body comes from the .md file (single source of truth in docs/legal/) —
 * this component supplies the page column; markdown-components.tsx supplies
 * styling for headings, paragraphs, lists, and external links.
 *
 * Internal links inside the markdown ("/info/terms", "/info/privacy", "/")
 * are rewritten to TanStack Router <Link>s so navigation stays SPA. External
 * http(s) links open in a new tab.
 *
 * Cross-page navigation (to the paired legal page, How it works, Home) lives
 * in the universal SiteFooter mounted by AppShell — not duplicated here.
 */
export function LegalPage({ content }: LegalPageProps) {
  return (
    <div style={INFO_PAGE_STYLE}>
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

const mdComponents = markdownComponents(({ href, children }) => <Link to={href}>{children}</Link>);
