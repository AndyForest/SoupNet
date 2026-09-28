// Cloudflare Turnstile site key, only when the build sets one. Pages that
// send an email to an address the visitor may not own (sign-up, password
// reset, verification resend, a waitlisted sign-in's re-send) show the
// widget when it's set; the backend checks the token when it has the secret.
export const TURNSTILE_SITE_KEY = (import.meta.env["VITE_TURNSTILE_SITE_KEY"] as string | undefined) || undefined;
