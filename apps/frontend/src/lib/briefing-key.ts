/**
 * Client-side briefing key substitution.
 *
 * The backend never puts a raw API key in a briefing: every composed briefing
 * renders the literal placeholder below wherever a key belongs (see
 * packages/domain recipe-guide-content.ts BRIEFING_KEY_PLACEHOLDER — the two
 * literals must stay identical). The dashboard's copy-briefing flows are the
 * one consumer that wants a real key inline, and they already hold the raw
 * key client-side (freshly minted or creation-time state) — so the
 * substitution happens here, in the browser, at copy time. Raw keys never
 * transit a URL or appear in a server response.
 */
export const BRIEFING_KEY_PLACEHOLDER = "YOUR_API_KEY";

/**
 * Replace every occurrence of the placeholder with the caller's raw key.
 * Call this on the /keys/briefing response text just before handing it to
 * the clipboard, so the pasted artifact works standalone for web-only agents.
 */
export function substituteBriefingKey(briefingText: string, rawKey: string): string {
  return briefingText.replaceAll(BRIEFING_KEY_PLACEHOLDER, rawKey);
}
