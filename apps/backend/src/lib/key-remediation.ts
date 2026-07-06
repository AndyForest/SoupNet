/**
 * Shared invalid/expired-API-key error copy with remediation.
 *
 * Field finding (2026-07-05 qualitative evals — the #1 recurring failure
 * across every track): a dead key produced either a silent anonymous page
 * (web /check, HTTP 200) or a bare "Invalid or expired API key" (MCP), and
 * agents abandoned the tool or silently substituted other taste sources.
 * Daily keys expire every 24h, so this is the day-2 experience of every
 * web-chatbot user. Errors are agent-facing copy — they carry the recovery
 * path inline.
 *
 * Anti-enumeration invariant: invalid and expired keys render identically
 * on every surface (same message, same status). validateKey() already
 * collapses the two cases; nothing downstream may distinguish them.
 */

export function frontendBaseUrl(): string {
  return process.env["FRONTEND_URL"] ?? "https://soup.net";
}

export function backendBaseUrl(): string {
  return (
    process.env["BACKEND_URL"] ??
    `http://localhost:${process.env["PORT"] ?? "3101"}`
  );
}

/** The keys-management page a signed-in human mints keys from. */
export function keysPageUrl(): string {
  return `${frontendBaseUrl()}/app/keys`;
}

/**
 * One-string invalid-key error with remediation — used verbatim by the MCP
 * tools, the /check and /briefing surfaces, and the trace service, so the
 * stdio proxy (which passes backend `error` strings through) inherits the
 * same copy.
 */
export function invalidKeyMessage(): string {
  return (
    "Invalid or expired API key. " +
    `To recover: ask your human to sign in at ${keysPageUrl()} and mint a new key ` +
    "(daily keys expire every 24 hours, so yesterday's briefing URL carries a dead key). " +
    `A fresh key works immediately on the web check page — ${backendBaseUrl()}/check?key=NEW_KEY&format=json — ` +
    "with no MCP reconnect needed. Invalid and expired keys are deliberately indistinguishable."
  );
}
