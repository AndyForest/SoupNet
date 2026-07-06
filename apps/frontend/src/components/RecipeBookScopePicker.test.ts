import { describe, it, expect } from "vitest";
import { toggleReadId, toggleWriteId, selectAllRead, selectAllWrite } from "./RecipeBookScopePicker.js";
import type { ScopeState } from "./RecipeBookScopePicker.js";

const empty: ScopeState = { readIds: [], writeIds: [], defaultWriteId: "" };

describe("toggleWriteId — default-write auto-follow (operator-flagged bug: blank default silently disables Authorize)", () => {
  it("adopts the first checked write book as default when none is set yet", () => {
    const next = toggleWriteId(empty, "book-a", false);
    expect(next.writeIds).toEqual(["book-a"]);
    expect(next.defaultWriteId).toBe("book-a");
  });

  it("does not clobber an existing default when a second book is checked", () => {
    const state: ScopeState = { readIds: [], writeIds: ["book-a"], defaultWriteId: "book-a" };
    const next = toggleWriteId(state, "book-b", false);
    expect(next.writeIds).toEqual(["book-a", "book-b"]);
    expect(next.defaultWriteId).toBe("book-a");
  });

  it("moves the default to a remaining write book when the current default is unchecked", () => {
    const state: ScopeState = { readIds: [], writeIds: ["book-a", "book-b"], defaultWriteId: "book-a" };
    const next = toggleWriteId(state, "book-a", false);
    expect(next.writeIds).toEqual(["book-b"]);
    expect(next.defaultWriteId).toBe("book-b");
  });

  it("clears the default when the last write book is unchecked", () => {
    const state: ScopeState = { readIds: [], writeIds: ["book-a"], defaultWriteId: "book-a" };
    const next = toggleWriteId(state, "book-a", false);
    expect(next.writeIds).toEqual([]);
    expect(next.defaultWriteId).toBe("");
  });

  it("leaves the default alone when unchecking a non-default write book", () => {
    const state: ScopeState = { readIds: [], writeIds: ["book-a", "book-b"], defaultWriteId: "book-a" };
    const next = toggleWriteId(state, "book-b", false);
    expect(next.writeIds).toEqual(["book-a"]);
    expect(next.defaultWriteId).toBe("book-a");
  });
});

describe("toggleWriteId — read independence (API Keys page: enforceWriteImpliesRead=false)", () => {
  it("does not add the book to read when checking write", () => {
    const next = toggleWriteId(empty, "book-a", false);
    expect(next.readIds).toEqual([]);
  });
});

describe("toggleWriteId — write implies read (OAuth consent screen: enforceWriteImpliesRead=true)", () => {
  it("adds the book to read when checking write if not already read", () => {
    const next = toggleWriteId(empty, "book-a", true);
    expect(next.readIds).toEqual(["book-a"]);
    expect(next.writeIds).toEqual(["book-a"]);
  });

  it("does not duplicate an already-read book when checking write", () => {
    const state: ScopeState = { readIds: ["book-a"], writeIds: [], defaultWriteId: "" };
    const next = toggleWriteId(state, "book-a", true);
    expect(next.readIds).toEqual(["book-a"]);
  });
});

describe("toggleReadId", () => {
  it("adds and removes a book from read (independent mode, no write cascade)", () => {
    const added = toggleReadId(empty, "book-a", false);
    expect(added.readIds).toEqual(["book-a"]);
    const removed = toggleReadId(added, "book-a", false);
    expect(removed.readIds).toEqual([]);
  });

  it("independent mode: unchecking read does not touch write, even if the book is write-enabled", () => {
    const state: ScopeState = { readIds: ["book-a"], writeIds: ["book-a"], defaultWriteId: "book-a" };
    const next = toggleReadId(state, "book-a", false);
    expect(next.readIds).toEqual([]);
    expect(next.writeIds).toEqual(["book-a"]);
    expect(next.defaultWriteId).toBe("book-a");
  });

  it("enforceWriteImpliesRead: unchecking read also drops the book from write and moves the default", () => {
    const state: ScopeState = { readIds: ["book-a", "book-b"], writeIds: ["book-a", "book-b"], defaultWriteId: "book-a" };
    const next = toggleReadId(state, "book-a", true);
    expect(next.readIds).toEqual(["book-b"]);
    expect(next.writeIds).toEqual(["book-b"]);
    expect(next.defaultWriteId).toBe("book-b");
  });

  it("enforceWriteImpliesRead: checking read does not touch write", () => {
    const next = toggleReadId(empty, "book-a", true);
    expect(next.readIds).toEqual(["book-a"]);
    expect(next.writeIds).toEqual([]);
  });
});

describe("selectAllRead", () => {
  const allIds = ["book-a", "book-b"];

  it("selects all when not all are selected", () => {
    const next = selectAllRead(empty, allIds, false);
    expect(next.readIds).toEqual(allIds);
  });

  it("independent mode: deselects all read without touching write", () => {
    const state: ScopeState = { readIds: allIds, writeIds: ["book-a"], defaultWriteId: "book-a" };
    const next = selectAllRead(state, allIds, false);
    expect(next.readIds).toEqual([]);
    expect(next.writeIds).toEqual(["book-a"]);
    expect(next.defaultWriteId).toBe("book-a");
  });

  it("enforceWriteImpliesRead: deselecting all read cascades to clear write and default", () => {
    const state: ScopeState = { readIds: allIds, writeIds: ["book-a"], defaultWriteId: "book-a" };
    const next = selectAllRead(state, allIds, true);
    expect(next.readIds).toEqual([]);
    expect(next.writeIds).toEqual([]);
    expect(next.defaultWriteId).toBe("");
  });
});

describe("selectAllWrite", () => {
  const allIds = ["book-a", "book-b"];

  it("selects all write books and adopts the first as default when none is set", () => {
    const next = selectAllWrite(empty, allIds, false);
    expect(next.writeIds).toEqual(allIds);
    expect(next.defaultWriteId).toBe("book-a");
  });

  it("keeps an existing valid default when selecting all", () => {
    const state: ScopeState = { readIds: [], writeIds: ["book-b"], defaultWriteId: "book-b" };
    const next = selectAllWrite(state, allIds, false);
    expect(next.defaultWriteId).toBe("book-b");
  });

  it("independent mode: does not expand read when selecting all write", () => {
    const next = selectAllWrite(empty, allIds, false);
    expect(next.readIds).toEqual([]);
  });

  it("enforceWriteImpliesRead: expands read to cover every selected write book", () => {
    const state: ScopeState = { readIds: ["book-a"], writeIds: [], defaultWriteId: "" };
    const next = selectAllWrite(state, allIds, true);
    expect(next.readIds).toEqual(expect.arrayContaining(allIds));
    expect(new Set(next.readIds).size).toBe(allIds.length);
  });

  it("deselects all write and clears the default", () => {
    const state: ScopeState = { readIds: allIds, writeIds: allIds, defaultWriteId: "book-a" };
    const next = selectAllWrite(state, allIds, false);
    expect(next.writeIds).toEqual([]);
    expect(next.defaultWriteId).toBe("");
  });
});
