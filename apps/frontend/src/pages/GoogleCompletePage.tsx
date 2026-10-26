import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE, setToken, setEmailVerified } from "../auth.js";
import { readCompleteFragment, takeTabSecret, googleSignInMessage } from "../lib/google-sign-in.js";
import { safeReturnTarget } from "../lib/return-target.js";

/**
 * /auth/google/complete — where the backend's Google callback lands (stream
 * SSO, SSO-U3). The fragment carries a single-use handoff code or a code from
 * the closed list of outcomes. The page takes the fragment out of the address
 * bar first, exchanges the handoff together with this tab's secret, forgets
 * the secret, stores the session, and goes where the sign-in started.
 */
export function GoogleCompletePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const fragment = readCompleteFragment(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname);
    const secret = takeTabSecret();

    if (!fragment) {
      setMessage(googleSignInMessage("expired"));
      return;
    }
    if ("error" in fragment) {
      setMessage(googleSignInMessage(fragment.error));
      return;
    }
    if (!secret) {
      setMessage(googleSignInMessage("expired"));
      return;
    }

    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/google/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handoff: fragment.handoff, secret }),
        });
        const body = (await res.json()) as {
          ok: boolean;
          error?: string;
          message?: string;
          data?: { token: string; emailVerified: boolean; returnTo: string };
        };
        if (!body.ok || !body.data) {
          setMessage(body.message ?? googleSignInMessage(body.error ?? "failed"));
          return;
        }
        // A new person may be signing in on this browser: clear the cache
        // before the token, as password sign-in does.
        queryClient.clear();
        setToken(body.data.token);
        setEmailVerified(body.data.emailVerified);
        if (!body.data.emailVerified) {
          void navigate({ to: "/auth/verify-pending" });
          return;
        }
        const next = safeReturnTarget(body.data.returnTo);
        if (next) void navigate({ href: next });
        else void navigate({ to: "/app/dashboard" });
      } catch {
        setMessage(googleSignInMessage("failed"));
      }
    })();
  }, [navigate, queryClient]);

  return (
    <div style={{ maxWidth: 420, margin: "var(--space-2xl, 4rem) auto", padding: "0 var(--space-md)" }}>
      {message ? (
        <div className="card">
          <h1 style={{ fontSize: "1.25rem", marginBottom: "var(--space-md)" }}>Couldn't sign you in</h1>
          <p role="alert" style={{ marginBottom: "var(--space-md)" }}>{message}</p>
          <Link to="/auth/login">Back to sign in</Link>
        </div>
      ) : (
        <p style={{ color: "var(--color-on-surface-variant)" }}>Signing you in…</p>
      )}
    </div>
  );
}
