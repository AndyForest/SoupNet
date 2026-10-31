import { describe, it, expect } from "vitest";
import { injectIntoShell, renderInfoPageBody } from "./static-info-pages.js";
import { localizeConnectDocs, splitAtPickerMarker } from "./localize-connect-docs.js";

const SHELL = `<!DOCTYPE html><html><head><title>Soup.net</title>
<meta property="og:url" content="https://soup.net/" />
<script type="module" src="/assets/index-abc.js"></script></head>
<body>
    <div id="root"></div>
    <noscript><p>client-rendered</p></noscript>
</body></html>`;

describe("renderInfoPageBody", () => {
  it("renders the markdown as HTML in the page column, with a plain back link", () => {
    const body = renderInfoPageBody("# Title\n\n**Operated by:** STEAMLabs, in Canada");
    expect(body).toContain(">Title</h1>");
    expect(body).toContain(">Operated by:</strong> STEAMLabs, in Canada");
    expect(body).toContain('<a href="/">← Back to soup.net</a>');
    expect(body).toContain("max-width:760px");
  });

  it("lets a code block scroll inside itself, so it can't widen the page at phone width", () => {
    expect(renderInfoPageBody("```\nsome long command\n```")).toContain('<pre style="overflow-x:auto;max-width:100%">');
  });

  it("keeps internal links on this site and opens external ones in a new tab", () => {
    const body = renderInfoPageBody("[terms](/info/terms) and [mail](https://example.com/x)");
    expect(body).toContain('<a href="/info/terms">terms</a>');
    expect(body).toContain('<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">mail</a>');
  });
});

describe("injectIntoShell", () => {
  const page = { body: "<p>The policy &amp; $& text</p>", title: "Privacy & terms", url: "https://soup.net/info/privacy" };

  it("puts the body in #root, sets the title and og:url, and keeps the app's script", () => {
    const html = injectIntoShell(SHELL, page);
    expect(html).toContain('<div id="root"><p>The policy &amp; $& text</p></div>');
    expect(html).toContain("<title>Privacy &amp; terms</title>");
    expect(html).toContain('og:url" content="https://soup.net/info/privacy"');
    expect(html).toContain('src="/assets/index-abc.js"');
  });

  it("drops the noscript note, which says the page has no content", () => {
    expect(injectIntoShell(SHELL, page)).not.toContain("noscript");
  });

  it.each([
    ["#root", SHELL.replace('<div id="root"></div>', '<div id="app"></div>')],
    ["title", SHELL.replace("<title>Soup.net</title>", "")],
    ["og:url", SHELL.replace('<meta property="og:url" content="https://soup.net/" />', "")],
    ["noscript", SHELL.replace("<noscript><p>client-rendered</p></noscript>", "")],
  ])("refuses a shell without %s, so a changed index.html fails the build", (_name, shell) => {
    expect(() => injectIntoShell(shell, page)).toThrow("static-info-pages");
  });
});

describe("splitAtPickerMarker", () => {
  it("splits at the marker and drops it, so no raw HTML reaches the renderer", () => {
    const { before, after } = splitAtPickerMarker("intro\n<!-- agent-type-picker: note\n more -->\nrest");
    expect(before).toBe("intro\n");
    expect(after).toBe("\nrest");
  });

  it.each(["no marker here", "<!-- agent-type-picker never closed"])("keeps everything in before for %s", (markdown) => {
    expect(splitAtPickerMarker(markdown)).toEqual({ before: markdown, after: "" });
  });

  it("localizes before splitting without touching the marker", () => {
    const docs = "https://mcp.soup.net/mcp\n<!-- agent-type-picker -->\nhttps://mcp.soup.net/mcp";
    const { before, after } = splitAtPickerMarker(localizeConnectDocs(docs, "https://self.example"));
    expect(before + after).toBe("https://self.example/mcp\n\nhttps://self.example/mcp");
  });
});
