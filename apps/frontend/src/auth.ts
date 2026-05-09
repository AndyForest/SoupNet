// API base URL. Full URL to the backend — cross-origin in both dev and prod.
// Dev default is the local backend at :3001 (backend CORS allows :5173 origin).
// Prod is set at build time via VITE_API_BASE (e.g. https://mcp.soup.net).
// Same-origin via a Vite proxy list was tried and removed 2026-04-19 — the
// proxy duplicated every backend route mount and failed silently when a new
// route wasn't added to the list.
export const API_BASE =
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? "http://localhost:3001" : "");

// Store JWT token in localStorage
const TOKEN_KEY = "claimnet_token";
// Cached email-verified flag — keeps the requireAuth route guard sync so it
// can redirect unverified users to /verify-pending without an extra fetch.
// Refreshed at login, after /auth/verify success, and on each /auth/me call.
const EMAIL_VERIFIED_KEY = "claimnet_email_verified";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_VERIFIED_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

/**
 * Cached email-verified flag.
 * - `true` — verified (only safe state to enter the rest of the app)
 * - `false` — explicitly unverified (redirect to /verify-pending)
 * - `null` — unknown / not yet checked (treat as unverified for safety)
 */
export function getEmailVerified(): boolean | null {
  const v = localStorage.getItem(EMAIL_VERIFIED_KEY);
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

export function setEmailVerified(verified: boolean): void {
  localStorage.setItem(EMAIL_VERIFIED_KEY, verified ? "true" : "false");
}

/**
 * Dev-only logger for authFetch. Prints method, url, status, and a short
 * token fingerprint so we can tell which user's session made the call.
 * Set `localStorage.__debugApi = "0"` in the console to silence.
 *
 * Example output:
 *   [api] GET /invitations/pending → 200 (2 rows) · tok=eyJhbGci...Bq8f
 */
function apiLog(method: string, url: string, status: number, tokenFingerprint: string, bodyPreview: string) {
  if (!import.meta.env.DEV) return;
  if (typeof localStorage !== "undefined" && localStorage.getItem("__debugApi") === "0") return;
  const style = status >= 400 ? "color:#c0392b" : "color:#27ae60";
  // eslint-disable-next-line no-console
  console.log(`%c[api] ${method} ${url} → ${status}%c · tok=${tokenFingerprint} · ${bodyPreview}`, style, "color:#888");
}

function tokenFingerprint(token: string | null): string {
  if (!token) return "<none>";
  if (token.length < 12) return token;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

// Authenticated fetch helper
export async function authFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const method = (options.method ?? "GET").toUpperCase();
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });

  // Clone so the caller can still read the body. `res.clone()` is cheap and
  // the whole thing is dev-only.
  if (import.meta.env.DEV) {
    try {
      const text = await res.clone().text();
      let preview = "";
      try {
        const j = JSON.parse(text) as { ok?: boolean; data?: unknown; error?: string };
        if (Array.isArray(j.data)) preview = `${j.data.length} rows`;
        else if (j.data) preview = "ok";
        else if (j.error) preview = `err: ${j.error}`;
        else preview = text.slice(0, 80);
      } catch {
        preview = text.slice(0, 80);
      }
      apiLog(method, url, res.status, tokenFingerprint(token), preview);
    } catch {
      apiLog(method, url, res.status, tokenFingerprint(token), "<unreadable>");
    }
  }

  return res;
}
