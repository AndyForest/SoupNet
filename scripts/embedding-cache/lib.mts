// Pure helpers for scripts/embedding-cache.mts, kept apart so they can be
// tested without a database.

export interface CacheKey {
  content_hash: string;
  model_id: string;
  task_type: string;
}

/** One line of a backup's key list. None of the three fields contain a tab. */
export function keyOf(k: CacheKey): string {
  return `${k.content_hash}\t${k.model_id}\t${k.task_type}`;
}

export function redactUrl(url: string): string {
  return url.replace(/(\/\/[^:/@]+:)[^@]*@/, "$1***@");
}

/** Backup directory name: sortable, filesystem-safe on Windows (no colons). */
export function backupName(d: Date): string {
  return d.toISOString().replace(/:/g, "").replace(/\.\d{3}Z$/, "Z");
}

const BACKUP_NAME = /^\d{4}-\d{2}-\d{2}T\d{6}Z$/;

export function isBackupName(name: string): boolean {
  return BACKUP_NAME.test(name);
}

/** Byte-wise order, which is what Postgres produces under COLLATE "C". */
function before(a: string, b: string): boolean {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0;
}

export interface KeyComparison {
  olderCount: number;
  newerCount: number;
  missingCount: number;
  missingSample: string[];
  /** Keys present in both whose vector fingerprint differs. */
  changedCount: number;
  changedSample: string[];
}

/**
 * A key-list line is "hash<TAB>model<TAB>task" optionally followed by
 * "<TAB>fingerprint" (md5 of the vector's text form). Backups made before
 * fingerprints were added have three fields; they are compared by presence.
 */
function splitLine(line: string): { key: string; fingerprint: string | undefined } {
  const parts = line.split("	");
  if (parts.length >= 4) return { key: parts.slice(0, 3).join("	"), fingerprint: parts[3] };
  return { key: line, fingerprint: undefined };
}

/**
 * Merge two sorted key streams and report every key of `older` that `newer`
 * lacks, and every key whose vector fingerprint changed. The cache only ever
 * gains rows and never changes one, so either finding means the newer backup
 * must not replace the older one.
 */
export async function compareKeyStreams(
  older: AsyncIterable<string>,
  newer: AsyncIterable<string>,
  sampleSize = 10,
): Promise<KeyComparison> {
  const o = older[Symbol.asyncIterator]();
  const n = newer[Symbol.asyncIterator]();
  const result: KeyComparison = { olderCount: 0, newerCount: 0, missingCount: 0, missingSample: [], changedCount: 0, changedSample: [] };
  let lastO: string | undefined;
  let lastN: string | undefined;

  const next = async (it: AsyncIterator<string>, which: "older" | "newer") => {
    const r = await it.next();
    if (r.done) return undefined;
    const line = splitLine(r.value);
    const last = which === "older" ? lastO : lastN;
    if (last !== undefined && !before(last, line.key)) throw new Error(`${which} key list is not sorted at "${line.key}"`);
    if (which === "older") { lastO = line.key; result.olderCount++; } else { lastN = line.key; result.newerCount++; }
    return line;
  };

  let a = await next(o, "older");
  let b = await next(n, "newer");
  while (a !== undefined) {
    if (b === undefined || before(a.key, b.key)) {
      result.missingCount++;
      if (result.missingSample.length < sampleSize) result.missingSample.push(a.key);
      a = await next(o, "older");
    } else if (a.key === b.key) {
      if (a.fingerprint !== undefined && b.fingerprint !== undefined && a.fingerprint !== b.fingerprint) {
        result.changedCount++;
        if (result.changedSample.length < sampleSize) result.changedSample.push(a.key);
      }
      a = await next(o, "older");
      b = await next(n, "newer");
    } else {
      b = await next(n, "newer");
    }
  }
  while (b !== undefined) b = await next(n, "newer");
  return result;
}

export interface BackupRef {
  name: string;
  createdAt: Date;
}

export interface RetentionOptions {
  /** How many of the newest backups to keep. */
  daily?: number;
  /** The weekly slot holds a backup until it is this many days old, then takes the oldest daily-age one. */
  weeklyMaxDays?: number;
  /** The monthly slot holds a backup until it is this many days old and a younger replacement exists. */
  monthlyMaxDays?: number;
}

/**
 * Tiered retention: the newest `daily` backups, a weekly slot and a monthly
 * slot. With daily backups and the defaults, the weekly backup ages from
 * about 2 to 12 days, the monthly from about 12 to 55, so there is always one
 * about a week old and one about a month old. Backups of different ages are
 * what stop a bad backup from replacing every good one before it's noticed.
 *
 * Stateless: the slots are recomputed from ages on every run.
 * - weekly: the oldest non-daily backup younger than weeklyMaxDays (else the youngest non-daily).
 * - monthly: among the rest at least weeklyMaxDays old, the oldest younger than
 *   monthlyMaxDays (else the youngest), so the current monthly is held until an
 *   aged-out weekly can take over, and a fresh backup never replaces it.
 */
export function selectRetained(
  backups: BackupRef[],
  now: Date,
  { daily = 2, weeklyMaxDays = 12, monthlyMaxDays = 45 }: RetentionOptions = {},
): { keep: Array<BackupRef & { slot: "daily" | "weekly" | "monthly" }>; prune: string[] } {
  if (daily < 1) throw new Error("daily must be at least 1");
  const byAgeDesc = [...backups].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()); // newest first
  const ageDays = (b: BackupRef) => (now.getTime() - b.createdAt.getTime()) / 86_400_000;

  const keep: Array<BackupRef & { slot: "daily" | "weekly" | "monthly" }> = byAgeDesc.slice(0, daily).map((b) => ({ ...b, slot: "daily" }));
  let rest = byAgeDesc.slice(daily); // newest first

  const pick = (pool: BackupRef[], maxDays: number): BackupRef | undefined => {
    const young = pool.filter((b) => ageDays(b) < maxDays);
    return young.length ? young[young.length - 1] : pool[0]; // oldest young one, else the youngest
  };

  const weekly = pick(rest, weeklyMaxDays);
  if (weekly) {
    keep.push({ ...weekly, slot: "weekly" });
    rest = rest.filter((b) => b !== weekly);
  }
  // Only a backup that has aged out of the weekly slot may take the monthly
  // one; a fresh backup never replaces an old monthly.
  const aged = rest.filter((b) => ageDays(b) >= weeklyMaxDays);
  const monthly = aged.length ? pick(aged, monthlyMaxDays) : rest[rest.length - 1]; // warm-up: let the oldest age into it
  if (monthly) keep.push({ ...monthly, slot: "monthly" });

  const kept = new Set(keep.map((k) => k.name));
  return { keep, prune: byAgeDesc.filter((b) => !kept.has(b.name)).map((b) => b.name).reverse() };
}
