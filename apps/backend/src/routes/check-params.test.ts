import { describe, it, expect } from "vitest";
import { CHECK_PARAMS, buildQs, readParams, type PageParams } from "./check";

const empty: PageParams = {
  key: null, trace: null, ef: null,
  ea: undefined, sort: undefined, page: undefined, format: undefined,
  clusters: undefined, maxChars: undefined, expand: undefined, compact: undefined,
  axes: undefined, group: undefined, readGroups: undefined, decidedAt: undefined,
  imageFile: undefined,
};

function makeGet(map: Record<string, string>): (name: string) => string | undefined {
  return (name) => map[name];
}

describe("buildQs", () => {
  // The 2026-05-27 trace-dupe bug: a URL with `recipe_book=soup-net-development`
  // followed by the "Copy results for AI agent" button created two traces in
  // two different books because buildQs dropped `group` from the carry-forward
  // list. The second submission fell back to the api_key default → different
  // group_id → unique constraint correctly did not collapse them. Regression
  // guard.
  it("carries recipe_book (regression for 2026-05-27 trace-dupe bug)", () => {
    const qs = buildQs({ ...empty, key: "k", trace: "t", ef: "e", group: "soup-net-dev" });
    expect(qs).toContain("recipe_book=soup-net-dev");
  });

  it("carries every roundTrip-carry field when set", () => {
    for (const spec of CHECK_PARAMS) {
      if (spec.roundTrip === "override-only") continue;
      const params: PageParams = { ...empty, [spec.field]: "test-value" } as PageParams;
      const qs = buildQs(params);
      expect(qs, `field ${spec.field} should be carried as ${spec.wire}`).toContain(
        `${spec.wire}=test-value`,
      );
    }
  });

  it("emits canonical wire name when struct field differs", () => {
    const qs = buildQs({ ...empty, group: "x", readGroups: "y", maxChars: "100" });
    expect(qs).toContain("recipe_book=x");
    expect(qs).toContain("read_recipe_books=y");
    expect(qs).toContain("max_chars=100");
    expect(qs).not.toContain("group=");
    expect(qs).not.toContain("readGroups=");
    expect(qs).not.toContain("maxChars=");
  });

  it("override-only fields do not round-trip from params", () => {
    const qs = buildQs({
      ...empty, key: "k", page: "5", format: "json", expand: "true", compact: "false",
    });
    expect(qs).toContain("key=k");
    expect(qs).not.toContain("page=");
    expect(qs).not.toContain("format=");
    expect(qs).not.toContain("expand=");
    expect(qs).not.toContain("compact=");
  });

  it("overrides replace carry values", () => {
    const qs = buildQs({ ...empty, sort: "relevance" }, { sort: "recent" });
    expect(qs).toContain("sort=recent");
    expect(qs).not.toContain("sort=relevance");
  });

  it("expand override cancels clusters and max_chars", () => {
    const qs = buildQs(
      { ...empty, clusters: "5", maxChars: "2000", sort: "relevance" },
      { expand: "true" },
    );
    expect(qs).toContain("expand=true");
    expect(qs).toContain("sort=relevance"); // sort is unaffected by expand
    expect(qs).not.toContain("clusters=");
    expect(qs).not.toContain("max_chars=");
  });

  it("returns empty string when nothing to emit", () => {
    expect(buildQs(empty)).toBe("");
  });

  it("URL-encodes values", () => {
    const qs = buildQs({ ...empty, trace: "hello world & friends" });
    expect(qs).toContain("trace=hello%20world%20%26%20friends");
  });
});

describe("readParams", () => {
  it("reads canonical wire names", () => {
    const p = readParams(makeGet({ key: "K", trace: "T", ef: "E", recipe_book: "R" }));
    expect(p.key).toBe("K");
    expect(p.trace).toBe("T");
    expect(p.ef).toBe("E");
    expect(p.group).toBe("R");
  });

  it("falls through to aliases when wire name is unset", () => {
    const p = readParams(makeGet({
      recipe: "Hello",
      evidence: "World",
      group: "old-name",
      read_groups: "a,b",
      decided: "2024-03-15",
    }));
    expect(p.trace).toBe("Hello");
    expect(p.ef).toBe("World");
    expect(p.group).toBe("old-name");
    expect(p.readGroups).toBe("a,b");
    expect(p.decidedAt).toBe("2024-03-15");
  });

  it("wire name wins when both wire and alias are set", () => {
    const p = readParams(makeGet({ trace: "from-wire", recipe: "from-alias" }));
    expect(p.trace).toBe("from-wire");
  });

  it("missing nullable fields default to null", () => {
    const p = readParams(makeGet({}));
    expect(p.key).toBeNull();
    expect(p.trace).toBeNull();
    expect(p.ef).toBeNull();
  });

  it("missing non-nullable fields default to undefined", () => {
    const p = readParams(makeGet({}));
    expect(p.group).toBeUndefined();
    expect(p.readGroups).toBeUndefined();
    expect(p.axes).toBeUndefined();
    expect(p.sort).toBeUndefined();
  });

  it("preserves empty-string for nullable fields (matches `?? null` semantics)", () => {
    // `?recipe=` with explicit empty value: original GET reader returned ""
    // (via `c.req.query("trace") ?? c.req.query("recipe") ?? null` — `??`
    // only falls through on null/undefined). Downstream falsy-checks
    // (`if (params.trace && ...)`) treat "" and null the same anyway, but
    // we preserve the type contract.
    const p = readParams(makeGet({ trace: "" }));
    expect(p.trace).toBe("");
  });
});
