/**
 * Whether a requested redirect_uri is registered for a client. One rule for
 * the authorization server and the consent page (F44), so they can't drift.
 *
 * Exact string match (RFC 6749 §3.1.2.3), deliberately: no origin-only
 * comparison, no prefix match, no trailing-slash forgiveness. The one exception
 * is RFC 8252 §7.3, for native apps listening on an ephemeral port: "The
 * authorization server MUST allow any port to be specified at the time of the
 * request for loopback IP redirect URIs". Only the port is ignored, and only
 * between two http URIs on the same loopback host, so https and every other
 * redirect stay exact. The three hosts never alias each other.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

/**
 * Whether a redirect ends in an app on this computer, over http. The consent
 * page warns on these (F129): nothing ties that app to the client's name.
 */
export function isHttpLoopbackUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The URI with its port removed, or null if it can't take the exception. A URI
 * must already be in the form the URL parser writes it, so `127.1`, `:80`,
 * `/a/../callback` and other spellings of a different string stay exact-only.
 */
function loopbackWithoutPort(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.href !== uri || uri.includes("#")) return null;
  if (!isHttpLoopbackUri(uri)) return null;
  if (url.username || url.password) return null;
  url.port = "";
  return url.href;
}

export function isRegisteredRedirectUri(redirectUri: string, registered: string[]): boolean {
  if (!redirectUri) return false;
  if (registered.includes(redirectUri)) return true;
  const requested = loopbackWithoutPort(redirectUri);
  return requested !== null && registered.some((uri) => loopbackWithoutPort(uri) === requested);
}
