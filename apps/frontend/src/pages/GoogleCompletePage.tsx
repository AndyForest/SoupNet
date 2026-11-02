import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE, setToken, setEmailVerified } from "../auth.js";
import { readCompleteFragment, takeTabSecret, googleSignInMessage } from "../lib/google-sign-in.js";
import { safeReturnTarget } from "../lib/return-target.js";

/**
 * /auth/google/complete — where the backend's Google callback lands (stream
 * SSO, SSO-U3). The fragment carries a single-use handoff code or a code from
 * the closed list of outcomes. The page exchanges the handoff together with
 * this tab's secret, forgets the secret, stores the session, and goes where
 * the sign-in started with `location.replace`, so the fragment's history
 * entry is gone and the app starts fresh with the stored session. A router
 * navigation from here lost the return path's query whenever this entry had
 * been replaced first (a raw history.replaceState, or the router's own
 * replace), so a consent page or an /app/drafts?ids= link came back bare
 * (browser verification, 2026-10-26). A failure stays on this page, so there
 * clearing the fragment with history.replaceState is safe.
 */
export function GoogleCompletePage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const fragment = readCompleteFragment(window.location.hash);
    const secret = takeTabSecret();
    const clearFragment = () => window.history.replaceState(window.history.state, "", window.location.pathname);

    if (!fragment) {
      setMessage(googleSignInMessage("expired"));
      clearFragment();
      return;
    }
    if ("directoryConnected" in fragment) {
      setConnected(true);
      clearFragment();
      return;
    }
    if ("error" in fragment) {
      setMessage(googleSignInMessage(fragment.error));
      clearFragment();
      return;
    }
    if (!secret) {
      setMessage(googleSignInMessage("expired"));
      clearFragment();
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
          clearFragment();
          return;
        }
        // A new person may be signing in on this browser: clear the cache
        // before the token, as password sign-in does.
        queryClient.clear();
        setToken(body.data.token);
        setEmailVerified(body.data.emailVerified);
        if (!body.data.emailVerified) {
          window.location.replace("/auth/verify-pending");
          return;
        }
        window.location.replace(safeReturnTarget(body.data.returnTo) ?? "/app/dashboard");
      } catch {
        setMessage(googleSignInMessage("failed"));
        clearFragment();
      }
    })();
  }, [queryClient]);

  return (
    <div style={{ maxWidth: 420, margin: "var(--space-2xl, 4rem) auto", padding: "0 var(--space-md)" }}>
      {connected ? (
        <div className="card">
          <h1 style={{ fontSize: "1.25rem", marginBottom: "var(--space-md)" }}>Directory connected</h1>
          <p style={{ marginBottom: "var(--space-md)" }}>
            Your organization's Google Workspace directory is connected. Members who are suspended or removed in Google lose access to Soup.net within the hour.
          </p>
          {/* The directory section lives on the org console's Members page (stream Console). */}
          <a href="/org#directory">Back to your organization's members</a>
        </div>
      ) : message ? (
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
