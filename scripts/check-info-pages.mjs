// Checks the built static /info pages before they can ship: each must carry
// its source's text outside any script, in the HTML a client without
// JavaScript receives. Run after `vite build`, from CI and the deploy job:
//   node scripts/check-info-pages.mjs apps/frontend/dist
// See STATIC_INFO_PAGES in apps/frontend/vite.config.ts.
// No shebang: its test imports this file, and on a Windows CRLF checkout a
// shebang line ending in \r fails to load there.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PAGES = [
  { file: "info/privacy.html", source: "docs/legal/privacy-policy.md", title: "Privacy Policy", required: ["Operated by: STEAMLabs"] },
  { file: "info/terms.html", source: "docs/legal/terms-of-service.md", title: "Terms of Service", required: ["Operated by: STEAMLabs"] },
  { file: "info/connect.html", source: "docs/connectors/index.md", title: "Connect Soup.net", required: [] },
];

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };

/** The text a reader without JavaScript sees in a page's #root. */
export function visibleText(html) {
  const start = html.indexOf('<div id="root">');
  const end = html.lastIndexOf("</body>");
  if (start < 0 || end < 0) return "";
  return html
    .slice(start, end)
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, " ");
}

/** Every heading and the last line of prose: if those are in, the body is. */
function expectedLines(markdown) {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, "");
  const headings = withoutComments.match(/^#{1,6} .+$/gm) ?? [];
  const plain = (line) => line.replace(/^#{1,6} /, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`_]/g, "").trim();
  const prose = withoutComments.split("\n").filter((line) => /^[A-Za-z]/.test(line));
  return [...headings, ...prose.slice(-1)].map(plain);
}

/** The problems with one built page; empty when it's fine. */
export function checkPage(html, page, markdown) {
  const text = visibleText(html);
  const problems = [];
  if (!new RegExp(`<title>${page.title}`).test(html)) problems.push(`title does not start "${page.title}"`);
  for (const line of [...expectedLines(markdown), ...page.required]) {
    if (!text.replace(/[*`_]/g, "").includes(line)) problems.push(`missing "${line}"`);
  }
  // The deployed CSP allows no inline script, and the app's module script must load.
  if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) problems.push("has an inline script");
  if (!/<script[^>]*\bsrc=/.test(html)) problems.push("has no app script");
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = process.argv[2];
  if (!dist) {
    console.error("usage: node scripts/check-info-pages.mjs <dist dir>");
    process.exit(2);
  }
  let failed = false;
  for (const page of PAGES) {
    let problems;
    try {
      const markdown = readFileSync(join(ROOT, page.source), "utf8");
      problems = checkPage(readFileSync(join(dist, page.file), "utf8"), page, markdown);
    } catch (err) {
      problems = [err instanceof Error ? err.message : String(err)];
    }
    for (const problem of problems) console.error(`${page.file}: ${problem}`);
    if (problems.length > 0) failed = true;
    else console.log(`${page.file}: ok`);
  }
  process.exit(failed ? 1 : 0);
}
