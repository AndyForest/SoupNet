/**
 * Web Worker for UMAP 2D projection.
 * Runs off the main thread to avoid blocking the UI.
 *
 * Input: { vectors: number[][], nNeighbors?, minDist?, spread? }
 * Output: { positions: [number, number][] } or { error: string }
 */

import { UMAP } from "umap-js";

export interface UmapWorkerInput {
  vectors: number[][];
  nNeighbors?: number;
  minDist?: number;
  spread?: number;
}

export interface UmapWorkerOutput {
  positions?: [number, number][];
  error?: string;
}

self.onmessage = (e: MessageEvent<UmapWorkerInput>) => {
  try {
    const { vectors, nNeighbors = 15, minDist = 0.1, spread = 1.0 } = e.data;

    if (vectors.length < 2) {
      // Can't project fewer than 2 points
      const positions: [number, number][] = vectors.map(() => [0, 0]);
      self.postMessage({ positions } satisfies UmapWorkerOutput);
      return;
    }

    // Clamp nNeighbors to valid range
    const effectiveNeighbors = Math.min(nNeighbors, vectors.length - 1);

    const umap = new UMAP({
      nNeighbors: effectiveNeighbors,
      minDist,
      spread,
      nComponents: 2,
    });

    const embedding = umap.fit(vectors);

    const positions = embedding.map((point) => [point[0]!, point[1]!] as [number, number]);

    self.postMessage({ positions } satisfies UmapWorkerOutput);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    self.postMessage({ error: msg } satisfies UmapWorkerOutput);
  }
};
