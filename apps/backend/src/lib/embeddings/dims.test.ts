import { describe, it, expect } from "vitest";
import { fitTo3072, EMBEDDING_DIM } from "./dims";

/**
 * Deterministic PRNG (mulberry32) so the "property" tests are reproducible —
 * a failing seed fails every run, not one in a thousand.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomVector(dim: number, rand: () => number): number[] {
  const v: number[] = new Array(dim);
  for (let i = 0; i < dim; i++) {
    // Centered, non-trivial magnitude so norms are well away from zero.
    v[i] = (rand() - 0.5) * 2;
  }
  return v;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function cosine(a: number[], b: number[]): number {
  return dot(a, b) / (norm(a) * norm(b));
}

describe("EMBEDDING_DIM", () => {
  it("is 3072", () => {
    expect(EMBEDDING_DIM).toBe(3072);
  });
});

describe("fitTo3072", () => {
  describe("d < 3072 (zero-pad, isometric)", () => {
    it("preserves cosine similarity exactly for random pairs (property)", () => {
      const rand = mulberry32(0xc0ffee);
      const dims = [1, 2, 16, 128, 384, 768, 1024, 2560, 3071];
      for (const d of dims) {
        for (let trial = 0; trial < 25; trial++) {
          const a = randomVector(d, rand);
          const b = randomVector(d, rand);
          const before = cosine(a, b);
          const after = cosine(fitTo3072(a), fitTo3072(b));
          expect(Math.abs(after - before)).toBeLessThan(1e-9);
        }
      }
    });

    it("leaves the appended tail exactly zero", () => {
      const rand = mulberry32(42);
      for (const d of [1, 384, 768, 3071]) {
        const a = randomVector(d, rand);
        const fitted = fitTo3072(a);
        for (let i = d; i < EMBEDDING_DIM; i++) {
          expect(fitted[i]).toBe(0);
        }
      }
    });

    it("keeps the leading values identical to the input", () => {
      const rand = mulberry32(7);
      const a = randomVector(384, rand);
      const fitted = fitTo3072(a);
      for (let i = 0; i < a.length; i++) {
        expect(fitted[i]).toBe(a[i]);
      }
    });

    it("preserves the vector's norm exactly", () => {
      const rand = mulberry32(99);
      const a = randomVector(768, rand);
      expect(norm(fitTo3072(a))).toBeCloseTo(norm(a), 12);
    });

    it("returns length 3072", () => {
      const rand = mulberry32(1);
      for (const d of [1, 384, 768, 2560, 3071]) {
        expect(fitTo3072(randomVector(d, rand)).length).toBe(3072);
      }
    });
  });

  describe("d === 3072 (identity)", () => {
    it("returns a length-3072 vector unchanged", () => {
      const rand = mulberry32(555);
      const a = randomVector(3072, rand);
      const fitted = fitTo3072(a);
      expect(fitted.length).toBe(3072);
      expect(fitted).toEqual(a);
    });
  });

  describe("d > 3072 (truncate + L2-renormalize)", () => {
    it("returns a unit-norm vector of length 3072 (property)", () => {
      const rand = mulberry32(0xbadf00d);
      for (const d of [3073, 4096, 5000, 8192]) {
        for (let trial = 0; trial < 15; trial++) {
          const a = randomVector(d, rand);
          const fitted = fitTo3072(a);
          expect(fitted.length).toBe(3072);
          expect(norm(fitted)).toBeCloseTo(1, 12);
        }
      }
    });

    it("keeps the direction of the leading 3072 dims (renormalized slice)", () => {
      const rand = mulberry32(321);
      const a = randomVector(4096, rand);
      const head = a.slice(0, 3072);
      const headNorm = norm(head);
      const fitted = fitTo3072(a);
      for (let i = 0; i < 3072; i++) {
        expect(fitted[i]).toBeCloseTo(head[i]! / headNorm, 12);
      }
    });
  });
});
