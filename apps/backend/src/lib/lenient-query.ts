/**
 * Lenient query-string decoding for the agent-facing /check GET surface.
 *
 * Root cause of the "%97 em-dash" artifact (backlog 2026-06-10, reproduced
 * 2026-07-01 and 2026-07-05): Hono's query getter wraps decodeURIComponent
 * in a try/catch and returns the RAW, still-percent-encoded component when
 * decoding throws. Clients whose shell or runtime works in windows-1252
 * (curl on a cp1252 Windows console is the reproduced case) percent-encode
 * an em-dash as `%97` — byte 0x97 is not a valid UTF-8 sequence on its own,
 * so decodeURIComponent throws and the literal three characters "%97" flow
 * through into stored recipe text.
 *
 * Fix: parse the raw query string ourselves and decode each component in a
 * single pass from the wire bytes — percent-escapes become bytes, the byte
 * string is decoded as strict UTF-8 when valid, else as windows-1252 (the
 * WHATWG fallback encoding for the web). Single-pass decoding from the raw
 * wire form means there is no double-decode ambiguity: `%2597` stays the
 * literal text "%97", while a bare `%97` becomes the em-dash it was meant
 * to be.
 *
 * Known trade-off (documented, accepted): the UTF-8-vs-1252 choice is made
 * for the whole component, matching WHATWG's single-encoding model. A
 * component that mixes valid UTF-8 multibyte sequences WITH stray 1252
 * bytes decodes entirely as 1252 (mojibake for the UTF-8 runs). Real
 * clients encode consistently; the mixed case is malformed input for which
 * every answer is a guess.
 */

/** Decode one raw (still percent-encoded) query component leniently. */
export function decodeQueryComponentLenient(raw: string): string {
  // '+' means space in application/x-www-form-urlencoded query strings.
  const plusNormalized = raw.replace(/\+/g, " ");
  if (!plusNormalized.includes("%")) return plusNormalized;

  const bytes: number[] = [];
  for (let i = 0; i < plusNormalized.length; i++) {
    const ch = plusNormalized[i]!;
    if (
      ch === "%" &&
      /^[0-9a-fA-F]{2}$/.test(plusNormalized.slice(i + 1, i + 3))
    ) {
      bytes.push(parseInt(plusNormalized.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Literal (unescaped) characters contribute their UTF-8 bytes, so a
      // component mixing literal non-ASCII with escapes stays coherent.
      for (const b of Buffer.from(ch, "utf8")) bytes.push(b);
    }
  }

  const buf = Buffer.from(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // Not valid UTF-8 → interpret as windows-1252 (0x97 → em-dash, etc.).
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/**
 * Parse a raw query string (no leading "?") into a first-occurrence-wins
 * reader, decoding names and values leniently. Mirrors Hono's
 * `c.req.query(name)` lookup semantics minus the raw-on-failure fallback.
 */
export function parseLenientQuery(
  rawQuery: string,
): (name: string) => string | undefined {
  const map = new Map<string, string>();
  if (rawQuery) {
    for (const pair of rawQuery.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const rawName = eq === -1 ? pair : pair.slice(0, eq);
      const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
      const name = decodeQueryComponentLenient(rawName);
      if (!map.has(name)) {
        map.set(name, decodeQueryComponentLenient(rawValue));
      }
    }
  }
  return (name) => map.get(name);
}

/** Extract the raw (still-encoded) query string from a request URL. */
export function rawQueryOfUrl(url: string): string {
  const qIdx = url.indexOf("?");
  return qIdx === -1 ? "" : url.slice(qIdx + 1);
}
