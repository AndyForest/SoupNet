import { describe, it, expect } from "vitest";
import { compareKeyStreams, keyOf, redactUrl, selectRetained, backupName, isBackupName } from "./lib.mts";

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

describe("helpers", () => {
  it("backupName is sortable and recognised as a backup", () => {
    const n = backupName(new Date("2026-09-27T19:05:01.123Z"));
    expect(n).toBe("2026-09-27T190501Z");
    expect(isBackupName(n)).toBe(true);
    expect(isBackupName(`${n}.partial`), "an interrupted backup is never treated as one").toBe(false);
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

describe("compareKeyStreams with vector fingerprints", () => {
  it("reports a key whose vector changed between backups", async () => {
    const r = await compareKeyStreams(
      from(["a\tm\tt\tf1", "b\tm\tt\tf2"]),
      from(["a\tm\tt\tf1", "b\tm\tt\tXX", "c\tm\tt\tf3"]),
    );
    expect(r.missingCount).toBe(0);
    expect(r.changedCount, "the same key with a different vector means a backup was altered").toBe(1);
    expect(r.changedSample).toEqual(["b\tm\tt"]);
  });

  it("compares presence only when a backup predates fingerprints", async () => {
    const r = await compareKeyStreams(from(["a\tm\tt", "b\tm\tt"]), from(["a\tm\tt\tf1", "b\tm\tt\tf2"]));
    expect(r.missingCount).toBe(0);
    expect(r.changedCount).toBe(0);
  });
});

describe("selectRetained — two dailies, a weekly and a monthly", () => {
  const DAY = 86_400_000;
  const start = Date.parse("2026-01-01T03:00:00Z");
  const at = (day: number) => new Date(start + day * DAY);

  it("keeps everything while there are four or fewer", () => {
    const backups = [0, 1, 2].map((d) => ({ name: backupName(at(d)), createdAt: at(d) }));
    expect(selectRetained(backups, at(2)).prune).toEqual([]);
  });

  it("over 120 nightly backups, always holds two dailies, one about a week old and one about a month old", () => {
    let kept: Array<{ name: string; createdAt: Date }> = [];
    for (let day = 0; day < 120; day++) {
      kept.push({ name: backupName(at(day)), createdAt: at(day) });
      const { keep, prune } = selectRetained(kept, at(day));
      kept = kept.filter((b) => !prune.includes(b.name));
      expect(kept.length, `day ${day}: at most four backups are kept`).toBeLessThanOrEqual(4);
      expect(keep.map((k) => k.name).sort(), `day ${day}: keep and prune partition the backups`).toEqual(kept.map((b) => b.name).sort());

      const ages = kept.map((b) => (at(day).getTime() - b.createdAt.getTime()) / DAY).sort((a, b) => a - b);
      expect(ages.slice(0, 2), `day ${day}: the two newest are kept`).toEqual(day === 0 ? [0] : [0, 1]);
      if (day >= 60) {
        expect(ages.some((a) => a >= 2 && a < 12), `day ${day}: one backup between 2 and 12 days old (ages ${ages})`).toBe(true);
        expect(ages.some((a) => a >= 12), `day ${day}: one backup at least 12 days old (ages ${ages})`).toBe(true);
        expect(Math.max(...ages), `day ${day}: the oldest is at most about two months old (ages ${ages})`).toBeLessThanOrEqual(57);
      }
    }
  });

  it("labels each kept backup with its slot", () => {
    const days = [0, 3, 20, 58, 59];
    const backups = days.map((d) => ({ name: backupName(at(d)), createdAt: at(d) }));
    const { keep, prune } = selectRetained(backups, at(59));
    expect(Object.fromEntries(keep.map((k) => [k.name, k.slot]))).toEqual({
      [backupName(at(59))]: "daily",
      [backupName(at(58))]: "daily",
      [backupName(at(20))]: "weekly",
      [backupName(at(3))]: "monthly",
    });
    expect(prune).toEqual([backupName(at(0))]);
  });
});
