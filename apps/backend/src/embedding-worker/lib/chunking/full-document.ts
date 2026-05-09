/**
 * Full-document chunking strategy.
 *
 * Returns the entire source text as a single chunk. Used as the baseline
 * strategy for every embedding source — guarantees at least one chunk exists.
 */

import crypto from "node:crypto";

export interface ChunkResult {
  chunkText: string;
  chunkHash: string; // SHA-256 hex
  chunkPath: string;
  metadata: Record<string, unknown>;
}

export function chunkFullDocument(sourceText: string): ChunkResult[] {
  const hash = crypto.createHash("sha256").update(sourceText).digest("hex");
  return [{ chunkText: sourceText, chunkHash: hash, chunkPath: "doc", metadata: {} }];
}
