import { readFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { axeFindings } from "./helpers/evidence";

// Known failures for the drafts regression specs (drafts-slice3/4/5/9 and
// drafts-post-merge). A failure counts as known only if the SoupNet backlog
// item named below lists it. Each known finding is recorded as a "known-issue"
// annotation, and it stops failing the test. Anything else still fails.
// Delete an entry once the backlog item fixes it.

export const BACKLOG = "Trace detail page and keys page: pre-existing contrast and accessibility issues";

interface KnownAxe {
  rule: string;
  what: string;
  /** Matched against the failing node's outer HTML as axe reports it. Each pattern names one element, not the whole rule. */
  html: RegExp;
}

const OUTLINE_VARIANT = String.raw`color: var\(--color-outline-variant\);`;

export const KNOWN_AXE: KnownAxe[] = [
  {
    rule: "color-contrast",
    what: 'trace detail badge caption "Human user" / "Agent (API key)" in --color-outline-variant (1.52:1)',
    html: new RegExp(String.raw`^<span style="${OUTLINE_VARIANT}">(Human user|Agent \(API key\))</span>$`),
  },
  {
    rule: "color-contrast",
    what: "trace detail key-id prefix in --color-outline-variant (1.52:1)",
    html: new RegExp(String.raw`^<span style="${OUTLINE_VARIANT} margin-left: 0\.5em; font-family: var\(--font-mono, monospace\);">[0-9a-f]{8}…</span>$`),
  },
  {
    rule: "color-contrast",
    what: 'trace detail evidence source line ("— <source>") in --color-outline-variant (1.76:1)',
    html: new RegExp(String.raw`^<p class="text-xs" style="${OUTLINE_VARIANT}[^"]*">— `),
  },
  {
    rule: "color-contrast",
    what: 'keys page key-row "expires <date>" in --color-outline-variant (1.52:1)',
    html: new RegExp(String.raw`^<span class="text-xs" style="${OUTLINE_VARIANT}">expires `),
  },
  {
    rule: "color-contrast",
    what: 'book traces list row "via <key>" / "N evidence" in --color-outline-variant (GroupTracesPage TraceRow)',
    html: new RegExp(String.raw`^<span style="${OUTLINE_VARIANT}">(via .+|\d+ evidence)</span>$`),
  },
  {
    rule: "color-contrast",
    what: 'feedback card chip captions ("impact", "disposition", "kind", "fulfilled") in --color-outline-variant (1.52:1; FeedbackCard, on the detail and intent pages)',
    html: new RegExp(String.raw`^<span style="${OUTLINE_VARIANT}">(impact|disposition|kind|fulfilled|top match|by)</span>$`),
  },
  {
    rule: "color-contrast",
    what: "feedback card footer line (agent · key · date) in --color-outline-variant (1.76:1; FeedbackCard)",
    html: new RegExp(String.raw`^<p class="text-xs" style="${OUTLINE_VARIANT} margin-top: var\(--space-sm\);">`),
  },
  {
    rule: "label",
    what: "keys page just-created raw-key input has no label",
    html: /^<input readonly="" class="text-mono" value="cn_[^"]*" style="font-size: 0\.78rem;">$/,
  },
];

export const KNOWN_HEADING_OVERFLOW = "trace detail recipe heading (h1) has no overflow-wrap, so a long unbroken token widens the page";

/** Record a known issue once per test. */
export function knownIssue(testInfo: TestInfo, what: string): void {
  const description = `${what} — backlog: ${BACKLOG}`;
  if (!testInfo.annotations.some((a) => a.type === "known-issue" && a.description === description)) {
    testInfo.annotations.push({ type: "known-issue", description });
  }
}

interface AxeNode { target: unknown[]; html: string }
interface AxeViolation { id: string; impact?: string | null; help: string; nodes: AxeNode[] }

/**
 * axe scan (the shared axeFindings, which attaches the full result), split per
 * node. A serious or critical node on the known list becomes a known-issue
 * annotation. Every other serious or critical node is returned in `blocking`,
 * so callers still assert on it. A rule with one known node and one new node
 * still fails on the new one.
 */
export async function axeBeyondKnown(page: Page, testInfo: TestInfo, name: string): Promise<{ blocking: string[]; moderate: string[]; knownNodes: number }> {
  const f = await axeFindings(page, testInfo, name);
  const att = [...testInfo.attachments].reverse().find((a) => a.name === `${name}-axe.json`);
  // axeFindings attaches its result as a file (path); older runs used a body.
  const raw = att?.path ? readFileSync(att.path, "utf8") : att?.body?.toString();
  if (!raw) throw new Error(`no axe result attached for ${name}`);
  const violations = JSON.parse(raw) as AxeViolation[];
  const blocking: string[] = [];
  let knownNodes = 0;
  for (const v of violations.filter((x) => x.impact === "serious" || x.impact === "critical")) {
    const unknown: AxeNode[] = [];
    for (const n of v.nodes) {
      const k = KNOWN_AXE.find((e) => e.rule === v.id && e.html.test(n.html));
      if (k) {
        knownNodes++;
        knownIssue(testInfo, k.what);
      } else unknown.push(n);
    }
    if (unknown.length) {
      const targets = unknown.slice(0, 3).map((n) => `${n.target.map(String).join(" ")} ${n.html.slice(0, 120)}`).join(", ");
      blocking.push(`${v.id} (${v.impact}, ${unknown.length} node${unknown.length === 1 ? "" : "s"} not on the known list): ${v.help} [${targets}${unknown.length > 3 ? `, +${unknown.length - 3} more` : ""}]`);
    }
  }
  return { blocking, moderate: f.moderate, knownNodes };
}
