import { describe, it, expect } from "vitest";
import { embedQuery } from "./local-client";
import { fitTo3072, EMBEDDING_DIM } from "./dims";

/**
 * Real semantic smoke test for the `local` embedding provider.
 *
 * The default gate (test:ci / CI quality job) runs the STUB provider —
 * deterministic and download-free, but by design it cannot verify semantic
 * ranking (stub vectors are near-orthogonal between distinct texts). This is the
 * one test that asserts real retrieval quality: the actual model embeds a query,
 * a paraphrase, and an unrelated sentence and checks the ordering.
 *
 * Skipped unless EMBEDDINGS_PROVIDER=local so it never runs (and never downloads
 * a model) in the default suite. Run it via the `local-embeddings-smoke` CI job
 * or locally with:
 *   EMBEDDINGS_PROVIDER=local npx vitest run apps/backend/src/lib/embeddings/local-client.smoke.test.ts
 * First run downloads the default model (~23 MB) from the HF hub into HF_HOME.
 *
 * It imports local-client + dims directly (not the provider seam) so it needs no
 * DB/gemini import chain — just the model. The seam's `.map(fitTo3072)` dispatch
 * is covered by typecheck and the end-to-end check; here we compose the same fit.
 */

const IS_LOCAL = (process.env["EMBEDDINGS_PROVIDER"] ?? "").toLowerCase() === "local";
const NATIVE_DIM = 384; // bge-small-en-v1.5 / all-MiniLM-L6-v2

/** Cosine similarity — the fit vectors are unit-norm, so this is just the dot product. */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

async function embedFit(text: string): Promise<number[]> {
  const v = await embedQuery(text);
  expect(v).not.toBeNull();
  return fitTo3072(v as number[]);
}

describe.skipIf(!IS_LOCAL)("local embedding provider — semantic smoke", () => {
  it(
    "embeds into halfvec(3072) with a zero tail beyond the native model dim",
    { timeout: 120_000 },
    async () => {
      const v = await embedFit("As a backend developer, I chose Hono for the API server.");
      expect(v.length).toBe(EMBEDDING_DIM); // 3072
      expect(v.slice(0, NATIVE_DIM).some((x) => x !== 0)).toBe(true); // real signal in the head
      expect(v.slice(NATIVE_DIM).every((x) => x === 0)).toBe(true); // exact zero tail (isometry)
    },
  );

  it(
    "ranks a paraphrase above an unrelated sentence",
    { timeout: 60_000 },
    async () => {
      const query = await embedFit(
        "As a web backend engineer, I picked Hono instead of Express for my HTTP service to keep it lean.",
      );
      const paraphrase = await embedFit(
        "As a backend developer, I chose Hono over Express for the HTTP API server because it is lightweight.",
      );
      const unrelated = await embedFit(
        "As a home gardener, I prefer planting tomatoes in raised beds so the soil drains well.",
      );
      const simParaphrase = dot(query, paraphrase);
      const simUnrelated = dot(query, unrelated);
      expect(simParaphrase).toBeGreaterThan(simUnrelated);
      expect(simParaphrase).toBeGreaterThan(0.6); // strong semantic match, not a coin flip
    },
  );
});
