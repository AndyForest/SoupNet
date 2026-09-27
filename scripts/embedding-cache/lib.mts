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

/**
 * Which backups may be deleted, oldest first, keeping the newest `keep`.
 * At least two are always kept, so the newest has a verified predecessor.
 */
export function selectPrunable(names: string[], keep: number): string[] {
  if (keep < 2) throw new Error("keep must be at least 2");
  const backups = names.filter(isBackupName).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
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
}

/**
 * Merge two sorted key streams and report every key of `older` that `newer`
 * lacks. The cache only ever gains rows, so a newer backup missing any key
 * means something went wrong and the older backup must be kept.
 */
export async function compareKeyStreams(
  older: AsyncIterable<string>,
  newer: AsyncIterable<string>,
  sampleSize = 10,
): Promise<KeyComparison> {
  const o = older[Symbol.asyncIterator]();
  const n = newer[Symbol.asyncIterator]();
  const result: KeyComparison = { olderCount: 0, newerCount: 0, missingCount: 0, missingSample: [] };
  let lastO: string | undefined;
  let lastN: string | undefined;

  const nextO = async () => {
    const r = await o.next();
    if (r.done) return undefined;
    if (lastO !== undefined && !before(lastO, r.value)) throw new Error(`older key list is not sorted at "${r.value}"`);
    lastO = r.value;
    result.olderCount++;
    return r.value;
  };
  const nextN = async () => {
    const r = await n.next();
    if (r.done) return undefined;
    if (lastN !== undefined && !before(lastN, r.value)) throw new Error(`newer key list is not sorted at "${r.value}"`);
    lastN = r.value;
    result.newerCount++;
    return r.value;
  };
  const miss = (k: string) => {
    result.missingCount++;
    if (result.missingSample.length < sampleSize) result.missingSample.push(k);
  };

  let a = await nextO();
  let b = await nextN();
  while (a !== undefined) {
    if (b === undefined || before(a, b)) {
      miss(a);
      a = await nextO();
    } else if (a === b) {
      a = await nextO();
      b = await nextN();
    } else {
      b = await nextN();
    }
  }
  while (b !== undefined) b = await nextN();
  return result;
}
