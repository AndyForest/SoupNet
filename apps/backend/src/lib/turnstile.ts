/**
 * Cloudflare Turnstile verification for account registration: a bot check
 * that stops scripted signups, including ones that register other people's
 * email addresses (strangers then get verification emails they didn't ask
 * for, and mark them as spam).
 *
 * Optional and off by default: with no TURNSTILE_SECRET_KEY, every call
 * passes without contacting Cloudflare, so local development, CI and
 * self-hosters are unaffected. The SPA shows the widget only when built
 * with VITE_TURNSTILE_SITE_KEY.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult =
  | { ok: true; checked: boolean }
  | { ok: false; checked: true; reason: string };

export async function verifyTurnstile({
  secret,
  token,
  fetchImpl = fetch,
  timeoutMs = 5000,
}: {
  secret: string | undefined;
  token: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<TurnstileResult> {
  if (!secret) return { ok: true, checked: false };
  if (!token) return { ok: false, checked: true, reason: "missing-token" };

  let body: { success?: boolean; "error-codes"?: string[] };
  try {
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, checked: true, reason: "unreachable" };
    body = (await res.json()) as typeof body;
  } catch {
    // Fail closed: an outage must not become a window for bots. Signups
    // pause until Cloudflare answers again.
    return { ok: false, checked: true, reason: "unreachable" };
  }
  if (body.success === true) return { ok: true, checked: true };
  return { ok: false, checked: true, reason: body["error-codes"]?.[0] ?? "rejected" };
}
