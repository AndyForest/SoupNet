import { describe, it, expect } from "vitest";
import { readParams, renderPage } from "./check";

// Post-merge findings (2026-09-29): a headless key's forced draft box sat
// inside the collapsed "Advanced" section, so a reader of the page saw
// nothing about drafts until they opened it. The forced box now sits above
// Advanced; an ordinary key's optional box stays inside it.
describe("/check form: the draft box for a headless key", () => {
  const params = readParams((name) => (name === "key" ? "sk_test_key" : undefined));
  const draftBox = /<input type="checkbox" id="draft"[^>]*>/;
  const advanced = "<summary>Advanced</summary>";

  it("sits outside the collapsed Advanced section, checked and disabled, for a headless key", () => {
    const html = renderPage(params, undefined, undefined, undefined, undefined, undefined, undefined, true);
    const box = draftBox.exec(html);
    expect(box?.[0]).toContain("checked");
    expect(box?.[0]).toContain("disabled");
    expect(html.indexOf(advanced)).toBeGreaterThan(-1);
    expect(box!.index).toBeLessThan(html.indexOf(advanced));
    expect(html.match(/id="draft"/g)).toHaveLength(1);
  });

  it("stays inside Advanced, as a choice, for an ordinary key", () => {
    const html = renderPage(params);
    const box = draftBox.exec(html);
    expect(box?.[0]).not.toContain("disabled");
    expect(box!.index).toBeGreaterThan(html.indexOf(advanced));
  });

  // Slice 7 C2 (7b, S7-B4): the box's label says what a draft is, as the
  // draft parameter does, not that the person could not be asked.
  it("labels the optional box with what a draft is, for an ordinary key", () => {
    const html = renderPage(params);
    expect(html).toContain("Deposit as a draft &mdash; a high-impact, uncertain call you can't settle yet from the context you hold");
    expect(html).not.toMatch(/could not be asked|couldn't be asked|can(?:'|no)t be asked/);
  });
});
