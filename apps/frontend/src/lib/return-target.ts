/**
 * Where to go after signing in (drafts-and-triage slice 3, rubric S3-L5).
 *
 * A signed-out person who opens a link into the app (an agent's
 * `/app/drafts?ids=…` link above all) is sent to sign in with the link as
 * `?next=`; after signing in they land back on it. Only a same-origin path
 * under `/app/` is honoured: an absolute URL, a protocol-relative `//host`,
 * a backslash trick, a path that normalizes out of `/app/`, or anything
 * else is ignored, so the parameter can never redirect off the app (no open
 * redirect). Pure.
 */

const BASE = "https://soup.invalid";

/** The path to return to, or null when `raw` is not a safe in-app target. */
export function safeReturnTarget(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  // Only a root-relative path, never a scheme, a host, or a backslash (which
  // URL parsers treat as a slash).
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  // No control characters or whitespace.
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return null;
  // Percent-encoded separators and dots in the path ("%2F", "%5C", "%2E",
  // either case, or double-encoded as "%25…") are refused outright: a router
  // that decodes them before matching could otherwise land on a path other
  // than the one this check approved (fix pass after the slice 3 audit).
  const pathPart = raw.split(/[?#]/, 1)[0] ?? "";
  if (/%(2f|5c|2e|25)/i.test(pathPart)) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (!url.pathname.startsWith("/app/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The sign-in URL that returns to `target` afterwards (or plain sign-in when it is not safe). */
export function loginPathFor(target: string | null | undefined): string {
  const safe = safeReturnTarget(target);
  return safe ? `/auth/login?next=${encodeURIComponent(safe)}` : "/auth/login";
}
