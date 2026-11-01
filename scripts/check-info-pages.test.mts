import { describe, it, expect } from "vitest";
// @ts-expect-error: a plain .mjs script, without type declarations.
import { checkPage, visibleText, PAGES } from "./check-info-pages.mjs";

const MARKDOWN = "# Privacy Policy\n\n**Operated by:** STEAMLabs, in Canada\n\n<!-- note -->\n\n## Your data\n\nFirst line.\n\nLast [line](/info/terms) of `text`.\n";
const BODY = '<h1>Privacy Policy</h1><p><strong>Operated by:</strong> STEAMLabs, in Canada</p><h2>Your data</h2><p>First line.</p><p>Last <a href="/info/terms">line</a> of <code>text</code>.</p>';
const page = (body: string, head = '<title>Privacy Policy — Soup.net</title><script type="module" src="/assets/a.js"></script>') =>
  `<html><head>${head}</head><body><div id="root">${body}</div></body></html>`;
const PRIVACY = { file: "info/privacy.html", title: "Privacy Policy", required: ["Operated by: STEAMLabs"] };

describe("checkPage", () => {
  it("passes a page with its full text, title and app script", () => {
    expect(checkPage(page(BODY), PRIVACY, MARKDOWN)).toEqual([]);
  });

  it("fails an empty shell, the failure this check exists for", () => {
    const problems = checkPage(page(""), PRIVACY, MARKDOWN);
    expect(problems).toContain('missing "Privacy Policy"');
    expect(problems).toContain('missing "Operated by: STEAMLabs"');
  });

  it("fails when the operator line names someone else", () => {
    expect(checkPage(page(BODY.replace("STEAMLabs", "Andy Forest")), PRIVACY, MARKDOWN)).toContain('missing "Operated by: STEAMLabs"');
  });

  it("fails when the text stops early", () => {
    expect(checkPage(page(BODY.split("<p>Last")[0]!), PRIVACY, MARKDOWN)).toContain('missing "Last line of text."');
  });

  it("fails the generic title", () => {
    const head = '<title>Soup.net</title><script type="module" src="/assets/a.js"></script>';
    expect(checkPage(page(BODY, head), PRIVACY, MARKDOWN)).toContain('title does not start "Privacy Policy"');
  });

  it("fails an inline script, which the deployed CSP would block", () => {
    const head = '<title>Privacy Policy</title><script type="module" src="/assets/a.js"></script><script>x()</script>';
    expect(checkPage(page(BODY, head), PRIVACY, MARKDOWN)).toContain("has an inline script");
  });

  it("fails a page with no app script", () => {
    expect(checkPage(page(BODY, "<title>Privacy Policy</title>"), PRIVACY, MARKDOWN)).toContain("has no app script");
  });
});

describe("visibleText", () => {
  it("reads only #root onward, without tags, scripts or entities", () => {
    const html = '<html><title>Not this</title><body><div id="root"><p>A &amp; B</p><script>no()</script></div></body></html>';
    expect(visibleText(html)).toBe("A & B ");
  });

  it("is empty for a page with no root", () => {
    expect(visibleText("<html><body></body></html>")).toBe("");
  });
});

describe("PAGES", () => {
  it("names the three URLs the plugin listing points at", () => {
    expect(PAGES.map((p: { file: string }) => p.file)).toEqual(["info/privacy.html", "info/terms.html", "info/connect.html"]);
  });
});
