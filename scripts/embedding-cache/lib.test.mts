import { describe, it, expect } from "vitest";
import { compareKeyStreams, keyOf, redactUrl, selectPrunable, backupName } from "./lib.mts";

async function* from(lines: string[]): AsyncGenerator<string> {
  for (const l of lines) yield l;
}

describe("compareKeyStreams — the check before an old backup may be deleted", () => {
  it("passes when every key of the older backup is in the newer one", async () => {
    const r = await compareKeyStreams(from(["a", "c"]), from(["a", "b", "c", "d"]));
    expect(r.missingCount, "a newer backup that only gained keys has nothing missing").toBe(0);
    expect(r.olderCount).toBe(2);
    expect(r.newerCount).toBe(4);
  });

  it("reports keys the newer backup lost, including at either end", async () => {
    const r = await compareKeyStreams(from(["a", "b", "m", "z"]), from(["b", "m"]));
    expect(r.missingCount, "keys dropped at the start and the end must both count").toBe(2);
    expect(r.missingSample).toEqual(["a", "z"]);
  });

  it("refuses unsorted input rather than trusting a merge over it", async () => {
    await expect(compareKeyStreams(from(["b", "a"]), from(["a", "b"])), "an unsorted key file cannot prove anything").rejects.toThrow(/not sorted/);
  });

  it("compares byte-wise, the order Postgres produces under COLLATE \"C\"", async () => {
    // Upper case sorts before lower case byte-wise; a locale-aware compare would disagree.
    const r = await compareKeyStreams(from(["B", "a"]), from(["B", "a"]));
    expect(r.missingCount).toBe(0);
  });
});

describe("selectPrunable", () => {
  const names = ["2026-09-01T000000Z", "2026-09-08T000000Z", "2026-09-15T000000Z", "2026-09-22T000000Z"];

  it("keeps the newest N and offers the rest, oldest first", () => {
    expect(selectPrunable(names, 3)).toEqual(["2026-09-01T000000Z"]);
    expect(selectPrunable([...names].reverse(), 2)).toEqual(["2026-09-01T000000Z", "2026-09-08T000000Z"]);
  });

  it("never offers anything when there are N or fewer", () => {
    expect(selectPrunable(names.slice(0, 2), 3)).toEqual([]);
  });

  it("refuses to keep fewer than 2, so a verified predecessor always survives", () => {
    expect(() => selectPrunable(names, 1)).toThrow(/at least 2/);
  });

  it("ignores directories that aren't backups", () => {
    expect(selectPrunable([...names, "notes", "tmp-2026"], 3)).toEqual(["2026-09-01T000000Z"]);
  });
});

describe("helpers", () => {
  it("backupName is sortable and matches what selectPrunable reads", () => {
    const n = backupName(new Date("2026-09-27T19:05:01.123Z"));
    expect(n).toBe("2026-09-27T190501Z");
    expect(selectPrunable([n, "2026-09-26T000000Z", "2026-09-25T000000Z"], 2)).toEqual(["2026-09-25T000000Z"]);
  });

  it("keyOf joins with tabs, which none of the three fields contain", () => {
    expect(keyOf({ content_hash: "ab12", model_id: "m", task_type: "RETRIEVAL_DOCUMENT" })).toBe("ab12\tm\tRETRIEVAL_DOCUMENT");
  });

  it("redactUrl hides the password in logs", () => {
    expect(redactUrl("postgresql://cache_writer:s3cret@localhost:5733/embedding_cache")).toBe(
      "postgresql://cache_writer:***@localhost:5733/embedding_cache",
    );
  });
});
