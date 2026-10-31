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

// F110 follow-up (2026-10-26): the page does not link a page the server
// refuses. On the last page within the listing depth, "next" is gone and the
// label says why.
describe("/check pager at the listing depth", () => {
  const params = readParams((name) => (name === "key" ? "sk_test_key" : name === "filter" ? "author:me" : undefined));
  const result = (page: number, totalPages: number, listing: boolean) => ({
    results: [{ id: "4a517f5b-4d75-49f3-b37d-7dbafaa5607b", claimText: "A claim.", createdAt: new Date("2026-10-26T00:00:00Z"), rank: 0 }],
    totalResults: totalPages * 50,
    currentPage: page,
    totalPages,
    ...(listing ? { listing: { order: "judgment" as const, perPage: 50, times: {} } } : {}),
  });
  const enriched = [{ id: "4a517f5b-4d75-49f3-b37d-7dbafaa5607b", claimText: "A claim.", createdAt: "2026-01-15T00:00:00.000Z", semanticScore: null, evidence: [] }];

  it("links page 200 from 199 and nothing past 200 on the flat list", () => {
    expect(renderPage(params, result(199, 300, true), enriched)).toContain("page=200");
    const last = renderPage(params, result(200, 300, true), enriched);
    expect(last).not.toContain("page=201");
    expect(last).toContain("the last page a search reaches");
    expect(last).toContain("page=199");
  });

  it("stops ranked results at page 500 (20 a page), and leaves an ordinary last page alone", () => {
    expect(renderPage(params, result(500, 900, false), enriched)).not.toContain("page=501");
    const ordinary = renderPage(params, result(3, 3, true), enriched);
    expect(ordinary).not.toContain("page=4");
    expect(ordinary).not.toContain("the last page a search reaches");
  });
});
