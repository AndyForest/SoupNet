/**
 * Static HTML for the /info pages a plugin directory fetches (privacy, terms,
 * support), so their full text is in the first response, without JavaScript.
 * The rest of the app stays client-rendered. Runs only at build time, from the
 * static-info-pages plugin in vite.config.ts; the app never imports it.
 *
 * Each page goes into the built index.html's #root, so it loads the app like
 * any other route: createRoot replaces this markup with the live page. The
 * source stays the one .md file its live page and .md twin already use.
 */
import ReactMarkdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { INFO_PAGE_STYLE, markdownComponents } from "../components/markdown-components.js";

const components = markdownComponents(({ href, children }) => <a href={href}>{children}</a>);

/** One page's body, in the live page's column and styles. */
export function renderInfoPageBody(markdown: string): string {
  return renderToStaticMarkup(
    <div style={INFO_PAGE_STYLE}>
      <p style={{ marginBottom: "var(--space-lg)", fontSize: "0.9rem" }}>
        <a href="/">← Back to soup.net</a>
      </p>
      <ReactMarkdown components={components}>{markdown}</ReactMarkdown>
    </div>,
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function replaceOrThrow(html: string, pattern: string | RegExp, replacement: string): string {
  const replaced = html.replace(pattern, () => replacement);
  if (replaced === html) throw new Error(`static-info-pages: the built index.html has no ${String(pattern)}`);
  return replaced;
}

/**
 * The built index.html with one page's body and title. Refuses a shell it
 * doesn't recognize, so a changed index.html fails the build rather than
 * shipping an empty page. The shell's noscript note is dropped: it tells a
 * reader this page has no content, and here it does.
 */
export function injectIntoShell(shell: string, page: { body: string; title: string; url: string }): string {
  let html = replaceOrThrow(shell, '<div id="root"></div>', `<div id="root">${page.body}</div>`);
  html = replaceOrThrow(html, /<title>[^<]*<\/title>/, `<title>${escapeHtml(page.title)}</title>`);
  html = replaceOrThrow(html, /<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${escapeHtml(page.url)}"`);
  return replaceOrThrow(html, /\s*<noscript>[\s\S]*?<\/noscript>/, "");
}
