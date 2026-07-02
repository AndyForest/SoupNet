/**
 * Recipe Map layout cache — in-memory, per-container.
 *
 * The map's expensive work (fetch + k-means over every trace vector in scope)
 * produces a layout that only changes when the corpus changes, so the cache
 * key embeds a corpus VERSION (trace count + newest created_at for the scoped
 * groups). A new trace changes the version, which changes the key, which is a
 * miss — no explicit invalidation, and stale entries age out of the small LRU.
 *
 * Per-container is deliberate: the deployment runs a single container (see
 * middleware/rate-limit.ts for the same assumption), and the cache is a pure
 * latency optimization — a cold container just recomputes.
 *
 * Pure module — no I/O; callers supply the version (one cheap COUNT/MAX query).
 */

const MAX_ENTRIES = 16;

const cache = new Map<string, unknown>();

/** Deterministic cache key from the map request's layout-relevant inputs. */
export function mapLayoutCacheKey(parts: {
  groupIds: string[];
  k: number | undefined;
  maxChars: number | undefined;
  expand: boolean;
  strategy: string | undefined;
  corpusVersion: string;
}): string {
  return JSON.stringify({
    g: [...parts.groupIds].sort(),
    k: parts.k ?? null,
    m: parts.maxChars ?? null,
    e: parts.expand,
    s: parts.strategy ?? null,
    v: parts.corpusVersion,
  });
}

export function getCachedMapLayout(key: string): unknown | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) {
    // LRU refresh: Map preserves insertion order; re-insert on access.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

export function setCachedMapLayout(key: string, value: unknown): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test seam. */
export function clearMapLayoutCache(): void {
  cache.clear();
}
