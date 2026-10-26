import { useState } from "react";
import { startGoogleSignIn } from "../lib/google-sign-in.js";
import type { GoogleReturnTarget } from "../lib/google-sign-in.js";

/**
 * "Continue with Google" (stream SSO, SSO-U1, SSO-U2). Starts the round trip
 * with a fresh tab secret and leaves for Google; where the person lands
 * afterwards is the return target, validated again by the backend.
 */
export function GoogleSignInButton({ target, label = "Continue with Google" }: { target: GoogleReturnTarget | null; label?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    setPending(true);
    try {
      window.location.assign(await startGoogleSignIn(target));
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : "Google sign-in isn't available right now.");
    }
  }

  return (
    <div style={{ marginBottom: "var(--space-md)" }}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void go()}
        disabled={pending}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-sm)" }}
      >
        <GoogleMark />
        {pending ? "Opening Google…" : label}
      </button>
      {error && (
        <p role="alert" style={{ color: "var(--color-error, #c0392b)", fontSize: "0.85rem", marginTop: "var(--space-xs)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Google's "G", per its sign-in branding guidance (the four-colour mark). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
