/**
 * Chunking strategy registry.
 *
 * Maps strategyId strings to chunking functions. When a new strategy is
 * implemented, add it here. Unknown strategies return null so the caller
 * can mark the chunk_strategy row as failed.
 */

import type { ChunkResult } from "./full-document";
import { chunkFullDocument } from "./full-document";

export type { ChunkResult };

type ChunkingFn = (sourceText: string) => ChunkResult[];

const strategies: Record<string, ChunkingFn> = {
  full_document: chunkFullDocument,
};

/**
 * Look up a chunking strategy by ID.
 * Returns null if the strategy is not implemented.
 */
export function getChunkingStrategy(strategyId: string): ChunkingFn | null {
  return strategies[strategyId] ?? null;
}
