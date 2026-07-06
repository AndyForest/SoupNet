/**
 * Synthesis provider abstraction — the single seam behind the premium
 * `synthesize` feature's one LLM call. Mirrors lib/embeddings/provider.ts:
 * one env var (SYNTHESIS_PROVIDER) chooses the provider process-wide, and the
 * model swaps by a second env var (SYNTHESIS_MODEL) so a Gemini-class model
 * change is config, not code.
 *
 *   gemini  — real Gemini generateContent via gemini-client.ts generateText
 *             (default; uses the same GEMINI_API_KEY as embeddings).
 *   stub    — deterministic profile via @soupnet/domain stubSynthesis. No
 *             network. Same input → same text, so CI stays LLM-free and
 *             integration tests can assert the returned recipe ids appear.
 *
 * The prompt shape and the stub both live in @soupnet/domain (synthesis.ts) —
 * this module owns only the provider selection and the real API call, keeping
 * the pure prompt/stub side testable without a network. See
 * docs/planning/premium-llm-features.md.
 */

import { buildSynthesisPrompt, stubSynthesis } from "@soupnet/domain";
import type { SynthesisInput } from "@soupnet/domain";
import { generateText } from "../gemini-client";

/** Default model — a Gemini-class flash tier, overridable via SYNTHESIS_MODEL. */
const DEFAULT_SYNTHESIS_MODEL = "gemini-3.5-flash";

export type SynthesisProviderId = "gemini" | "stub";

let cachedProvider: SynthesisProviderId | null = null;

function selectProvider(): SynthesisProviderId {
  if (cachedProvider) return cachedProvider;
  const raw = (process.env["SYNTHESIS_PROVIDER"] ?? "gemini").toLowerCase();
  if (raw === "stub") {
    cachedProvider = "stub";
  } else if (raw === "gemini") {
    cachedProvider = "gemini";
  } else {
    throw new Error(
      `Invalid SYNTHESIS_PROVIDER=${raw}. Must be "gemini" or "stub".`,
    );
  }
  return cachedProvider;
}

export function getSynthesisProviderId(): SynthesisProviderId {
  return selectProvider();
}

function synthesisModel(): string {
  return process.env["SYNTHESIS_MODEL"] ?? DEFAULT_SYNTHESIS_MODEL;
}

/**
 * Distil a check's exemplars into a "current preference profile" paragraph.
 * Returns null on provider failure (missing key, API error, timeout) so the
 * caller degrades to a soft notice — an LLM hiccup never fails the check. The
 * stub provider never returns null.
 */
export async function synthesizeProfile(
  input: SynthesisInput,
): Promise<string | null> {
  if (selectProvider() === "stub") {
    return Promise.resolve(stubSynthesis(input));
  }
  return generateText(buildSynthesisPrompt(input), synthesisModel());
}
