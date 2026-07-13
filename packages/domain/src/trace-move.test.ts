import { describe, it, expect } from "vitest";
import {
  canWriteToBook,
  authorizeTraceMove,
  moveFeedbackStory,
  MOVE_FEEDBACK,
} from "./trace-move";

describe("canWriteToBook", () => {
  it.each(["owner", "admin", "member"])("allows %s", (role) => {
    expect(canWriteToBook(role)).toBe(true);
  });

  it("denies a non-member (no role)", () => {
    expect(canWriteToBook(null)).toBe(false);
    expect(canWriteToBook(undefined)).toBe(false);
    expect(canWriteToBook("")).toBe(false);
  });

  // The point of the allowlist: a role added later must fail closed without
  // anyone remembering to revisit this file.
  it("denies an unknown future role such as viewer", () => {
    expect(canWriteToBook("viewer")).toBe(false);
    expect(canWriteToBook("reader")).toBe(false);
  });
});

describe("authorizeTraceMove", () => {
  const base = {
    isTraceOwner: false,
    sourceRole: null as string | null,
    destRole: null as string | null,
    isSystem: false,
  };

  it("lets the trace author move their own recipe into a book they belong to", () => {
    const r = authorizeTraceMove({
      ...base,
      isTraceOwner: true,
      sourceRole: "member",
      destRole: "member",
    });
    expect(r).toEqual({ allowed: true, actorRelation: "owner" });
  });

  it("lets a source-book admin move someone else's recipe", () => {
    const r = authorizeTraceMove({
      ...base,
      sourceRole: "admin",
      destRole: "member",
    });
    expect(r).toEqual({ allowed: true, actorRelation: "book_admin" });
  });

  it("lets a source-book owner move someone else's recipe", () => {
    const r = authorizeTraceMove({
      ...base,
      sourceRole: "owner",
      destRole: "owner",
    });
    expect(r).toEqual({ allowed: true, actorRelation: "book_admin" });
  });

  it("reports owner relation when the author is also a book admin", () => {
    const r = authorizeTraceMove({
      ...base,
      isTraceOwner: true,
      sourceRole: "admin",
      destRole: "admin",
    });
    expect(r).toEqual({ allowed: true, actorRelation: "owner" });
  });

  it("denies a plain member moving another author's recipe out of the book", () => {
    const r = authorizeTraceMove({
      ...base,
      sourceRole: "member",
      destRole: "member",
    });
    expect(r).toEqual({ allowed: false, reason: "forbidden_source" });
  });

  it("denies a non-member of the source book", () => {
    const r = authorizeTraceMove({ ...base, destRole: "member" });
    expect(r).toEqual({ allowed: false, reason: "forbidden_source" });
  });

  // The edge a delete does not have: authority to take a recipe OUT of a book
  // says nothing about authority to put it INTO another one.
  it("denies the trace author moving into a book they do not belong to", () => {
    const r = authorizeTraceMove({
      ...base,
      isTraceOwner: true,
      sourceRole: "member",
      destRole: null,
    });
    expect(r).toEqual({ allowed: false, reason: "forbidden_destination" });
  });

  it("denies a source-book admin moving into a book they do not belong to", () => {
    const r = authorizeTraceMove({ ...base, sourceRole: "owner", destRole: null });
    expect(r).toEqual({ allowed: false, reason: "forbidden_destination" });
  });

  it("denies moving into a book where the actor is a future read-only viewer", () => {
    const r = authorizeTraceMove({
      ...base,
      isTraceOwner: true,
      sourceRole: "member",
      destRole: "viewer",
    });
    expect(r).toEqual({ allowed: false, reason: "forbidden_destination" });
  });

  it("checks the source gate before the destination gate", () => {
    // A stranger to both books gets forbidden_source, never a hint about
    // whether the destination exists or who belongs to it.
    const r = authorizeTraceMove({ ...base, sourceRole: null, destRole: null });
    expect(r).toEqual({ allowed: false, reason: "forbidden_source" });
  });

  it("lets the system role bypass both gates", () => {
    const r = authorizeTraceMove({ ...base, isSystem: true });
    expect(r).toEqual({ allowed: true, actorRelation: "system" });
  });

  it("lets the system role move into a book it has no membership in", () => {
    const r = authorizeTraceMove({
      ...base,
      isSystem: true,
      sourceRole: null,
      destRole: null,
    });
    expect(r.allowed).toBe(true);
  });
});

describe("moveFeedbackStory", () => {
  it("names only the destination book", () => {
    expect(moveFeedbackStory("SoupNet")).toBe(
      "As the owner of this recipe book, I re-filed this recipe into SoupNet so that "
    );
  });

  // Moving private -> shared is the common direction; the source book's name is
  // itself sensitive and must never appear in a note the destination can read.
  it("never leaks the source book name", () => {
    const story = moveFeedbackStory("Public Book");
    expect(story).not.toContain("from");
    expect(story.toLowerCase()).not.toContain("private");
  });

  it("leaves a trailing 'so that ' for the human to complete", () => {
    expect(moveFeedbackStory("Any Book").endsWith(" so that ")).toBe(true);
  });
});

describe("MOVE_FEEDBACK", () => {
  it("does not assert a story_fulfilled judgment the human never made", () => {
    expect(MOVE_FEEDBACK.storyFulfilled).toBe("unknown");
  });

  it("marks the row as a correction", () => {
    expect(MOVE_FEEDBACK.disposition).toBe("corrected");
  });
});
