/**
 * Loopback-origin detection for CORS in local development.
 *
 * The app-level CORS allowlist is exact-match on FRONTEND_URL/BACKEND_URL,
 * which breaks local dev whenever the browser origin drifts from the
 * canonical string — http://127.0.0.1:5273 instead of localhost, a Vite
 * auto-bumped port (5274), or the IPv6 loopback. The MCP router has allowed
 * loopback-on-any-port since the Origin-validation work (mcp.ts
 * isAllowedOrigin); this brings the app CORS to the same behavior.
 *
 * Scope: http loopback hosts only. Reflecting these with credentials is safe
 * here because auth rides in Authorization headers (JWT / API key), never
 * cookies — a page on another local origin cannot read this origin's
 * localStorage, and its requests carry no ambient credentials.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}
