import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE, clearSignupProof, getSignupProof, getToken, setEmailVerified, setToken } from "../auth.js";

interface VerifyResponse {
  ok: boolean;
  error?: string;
  message?: string;
  data?: { verified: boolean; email: string; waitlisted?: boolean; passwordRequired?: boolean; ownSession?: boolean; token?: string };
}

async function verifyRequest(body: { token: string; password?: string }): Promise<{ status: number; json: VerifyResponse }> {
  const session = getToken();
  const signupProof = getSignupProof();
  const res = await fetch(`${API_BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session}` } : {}) },
    body: JSON.stringify({ ...body, ...(signupProof ? { signupProof } : {}) }),
  });
  return { status: res.status, json: (await res.json()) as VerifyResponse };
}

export function VerifyPage() {
  const [status, setStatus] = useState<"loading" | "success" | "password" | "error">("loading");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [waitlisted, setWaitlisted] = useState(false);
  // Guard against React StrictMode double-invocation in dev. The /auth/verify
  // endpoint is idempotent on the backend, but firing twice would still
  // briefly flash an error before the second response lands. Belt and braces.
  const calledRef = useRef(false);

  function settle({ json }: { status: number; json: VerifyResponse }): boolean {
    if (!json.ok || !json.data) return false;
    setEmail(json.data.email);
    setWaitlisted(json.data.waitlisted === true);
    if (json.data.passwordRequired) {
      setStatus("password");
      return true;
    }
    setStatus("success");
    clearSignupProof();
    if (json.data.token) {
      // A correct password here is a sign-in. Clear the cache first, as the
      // login page does, so another account's data can't show under this one.
      queryClient.clear();
      setToken(json.data.token);
      setEmailVerified(true);
      setSignedIn(true);
      return true;
    }
    // The session in this tab was this account's, so update the cached flag:
    // subsequent navigation no longer redirects to /verify-pending.
    if (json.data.ownSession) setEmailVerified(true);
    return true;
  }

  function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return;
    setPasswordError(null);
    setSubmitting(true);
    verifyRequest({ token, password })
      .then((res) => {
        if (settle(res)) return;
        if (res.status === 429) setPasswordError("Too many tries. Wait 15 minutes and try again, or set a new password below.");
        else if (res.json.error === "wrong_password") setPasswordError(res.json.message ?? "That isn't this account's password.");
        else setStatus("error");
      })
      .catch(() => setPasswordError("Network error. Check your connection and try again."))
      .finally(() => setSubmitting(false));
  }

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      return;
    }

    verifyRequest({ token })
      .then((res) => {
        if (!settle(res)) setStatus("error");
      })
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "100vh",
      background: "var(--color-surface)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 400,
        background: "var(--color-surface-container-lowest)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-2xl) var(--space-xl)",
        textAlign: "center",
      }}>
        {status === "loading" && (
          <p style={{ color: "var(--color-on-surface-variant)" }}>Verifying your email...</p>
        )}

        {status === "success" && (
          <>
            <h1 style={{ color: "var(--color-primary)", fontSize: "1.5rem", marginBottom: "var(--space-md)" }}>
              {waitlisted ? "Your place is held" : "Email verified"}
            </h1>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
              {waitlisted
                ? `${email} is verified and your spot on the waitlist is held. We'll email you the moment a spot opens — nothing else to do for now.`
                : signedIn
                  ? `${email} is now verified, and you're signed in.`
                  : `${email} is now verified. You can sign in and start using Soup.net.`}
            </p>
            {signedIn && (
              <Link to="/app/dashboard" style={{ textDecoration: "none" }}>
                <button style={{ width: "100%", justifyContent: "center" }}>
                  Go to your dashboard
                </button>
              </Link>
            )}
            {!waitlisted && !signedIn && (
              <Link to="/auth/login" style={{ textDecoration: "none" }}>
                <button style={{ width: "100%", justifyContent: "center" }}>
                  Sign In
                </button>
              </Link>
            )}
          </>
        )}

        {status === "password" && (
          <>
            <h1 style={{ color: "var(--color-primary)", fontSize: "1.5rem", marginBottom: "var(--space-md)" }}>
              Confirm it&apos;s you
            </h1>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
              Someone signed up for Soup.net with {email}. Enter the password chosen at sign-up to verify this address.
            </p>
            <form onSubmit={submitPassword} style={{ textAlign: "left" }}>
              <label htmlFor="verify-password">Password</label>
              <input
                id="verify-password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={passwordError ? "verify-password-error" : undefined}
              />
              {passwordError && (
                <p id="verify-password-error" role="alert" style={{ color: "var(--color-error)", marginTop: "var(--space-sm)" }}>
                  {passwordError}
                </p>
              )}
              <button type="submit" disabled={submitting} style={{ width: "100%", justifyContent: "center", marginTop: "var(--space-md)" }}>
                {submitting ? "Verifying..." : "Verify email"}
              </button>
            </form>
            <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-lg)" }}>
              Didn&apos;t sign up, or don&apos;t know the password? <Link to="/auth/forgot-password">Set a new password</Link>. That
              verifies this address, replaces the old password and signs out every session on the account.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <h1 style={{ color: "var(--color-error)", fontSize: "1.5rem", marginBottom: "var(--space-md)" }}>
              Verification failed
            </h1>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
              This link may be expired or already used. Try signing in — if your email isn't verified, you can request a new link.
            </p>
            <Link to="/auth/login" style={{ textDecoration: "none" }}>
              <button className="btn-secondary" style={{ width: "100%", justifyContent: "center" }}>
                Back to sign in
              </button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
