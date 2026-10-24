import { describe, it, expect } from "vitest";
import { parseReportQuery, pageInfo, REPORT_PER_PAGE_DEFAULT, REPORT_PER_PAGE_MAX, type FeedbackFilterName } from "./report-params";

/**
 * Layer 1: the report paths' query parser (slice 9, S9-P1). Every branch:
 * defaults, each filter's accept and refuse, aliases, repeats, unknown
 * names, and the one-message-for-every-failure rule.
 */

const ALL: readonly FeedbackFilterName[] = ["intent_id", "trace_id", "search_id", "agent_id", "since", "recipe_book"];
const q = (o: Record<string, string | string[]>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));
const ID = "0b7d9a1e-4c2f-4a8b-9e3d-5f6a7b8c9d0e";
const INTENT = "int_" + "a".repeat(24);

describe("parseReportQuery", () => {
  it("defaults to page 1 of 50 with no filters", () => {
    const r = parseReportQuery({}, ALL);
    expect(r).toEqual({ ok: true, paging: { page: 1, perPage: REPORT_PER_PAGE_DEFAULT, offset: 0 }, filters: {} });
  });

  it("computes the offset from page and per_page", () => {
    const r = parseReportQuery(q({ page: "3", per_page: "20" }), []);
    expect(r.ok && r.paging).toEqual({ page: 3, perPage: 20, offset: 40 });
  });

  it("accepts every filter in its valid form", () => {
    const r = parseReportQuery(q({
      intent_id: INTENT, trace_id: ID.toUpperCase(), search_id: ID, agent_id: " a-drafts-9 ",
      since: "2026-10-24T09:30:00Z", recipe_book: "soupnet-oss",
    }), ALL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters).toEqual({
      intentId: INTENT, traceId: ID, searchId: ID, agentId: "a-drafts-9",
      since: new Date("2026-10-24T09:30:00Z"), recipeBook: "soupnet-oss",
    });
  });

  it("accepts a bare date, a leap day, and an offset without a colon for since", () => {
    for (const since of ["2026-10-24", "2028-02-29", "2026-10-24T09:30+0200", "2026-10-24T09:30:00.123456-05:00"]) {
      expect(parseReportQuery(q({ since }), ["since"]).ok, since).toBe(true);
    }
  });

  it("takes recipe_id as an alias of trace_id", () => {
    const r = parseReportQuery(q({ recipe_id: ID }), ALL);
    expect(r.ok && r.filters.traceId).toBe(ID);
  });

  it("refuses trace_id and recipe_id together", () => {
    const r = parseReportQuery(q({ trace_id: ID, recipe_id: ID }), ALL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("given more than once");
  });

  it("refuses a repeated parameter", () => {
    const r = parseReportQuery(q({ page: ["1", "2"] }), []);
    expect(r.ok === false && r.fields).toEqual(["page"]);
  });

  it("refuses a filter the path does not take, naming what it takes", () => {
    const r = parseReportQuery(q({ intent_id: INTENT }), []);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fields).toEqual(["intent_id"]);
      expect(r.error).toContain("this path takes page, per_page");
    }
  });

  it("refuses recipe_id where trace_id is not taken", () => {
    const r = parseReportQuery(q({ recipe_id: ID }), []);
    expect(r.ok === false && r.fields).toEqual(["recipe_id"]);
  });

  it("refuses ?key= with the Bearer hint", () => {
    const r = parseReportQuery(q({ key: "sk_x" }), ALL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Authorization: Bearer");
  });

  it.each([
    ["page", "0"], ["page", "-1"], ["page", "1.5"], ["page", "abc"], ["page", "100001"],
    ["per_page", "0"], ["per_page", String(REPORT_PER_PAGE_MAX + 1)],
    ["intent_id", "int_short"], ["intent_id", "abc"],
    ["trace_id", "abc"], ["search_id", "1234"],
    ["agent_id", ""], ["agent_id", "x".repeat(201)],
    ["recipe_book", ""], ["recipe_book", "x".repeat(201)],
    ["since", "yesterday"], ["since", "2026-10-24T09:30:00"], ["since", "2026-13-45"],
    ["since", "2026-02-30"], ["since", "2026-04-31T00:00:00Z"], ["since", "2025-02-29"],
  ])("refuses %s=%s", (field, value) => {
    const r = parseReportQuery(q({ [field]: value }), ALL);
    expect(r.ok === false && r.fields).toEqual([field]);
  });

  it("names every failing parameter in one message", () => {
    const r = parseReportQuery(q({ per_page: "0", since: "yesterday", trace_id: "abc", intentid: INTENT }), ALL);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fields.sort()).toEqual(["intentid", "per_page", "since", "trace_id"]);
      for (const f of ["intentid", "per_page", "since", "trace_id"]) expect(r.error).toContain(f);
    }
  });
});

describe("pageInfo", () => {
  it("rounds total pages up and gives zero pages for zero rows", () => {
    expect(pageInfo(101, { page: 2, perPage: 50, offset: 50 })).toEqual({ total: 101, page: 2, perPage: 50, totalPages: 3 });
    expect(pageInfo(0, { page: 1, perPage: 50, offset: 0 })).toEqual({ total: 0, page: 1, perPage: 50, totalPages: 0 });
  });
});
