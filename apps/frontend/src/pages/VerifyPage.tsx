import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { API_BASE, getToken, setEmailVerified, isLoggedIn } from "../auth.js";

export function VerifyPage() {
  const [status, setStatus] = useState<"loading" | "confirm" | "success" | "full" | "error">("loading");
  const [email, setEmail] = useState("");
  const [waitlisted, setWaitlisted] = useState(false);
  // What the server says when this click joined an organization on a domain
  // it has verified, or when that organization had no free seat (stream
  // Domains, OD-J1, OD-C1). The copy comes from the server: the SPA doesn't
  // depend on @soupnet/domain.
  const [joinedNotice, setJoinedNotice] = useState<string | null>(null);
  const [fullLines, setFullLines] = useState<string[]>([]);
  const [googleSignInRemoved, setGoogleSignInRemoved] = useState(false);
  // Guard against React StrictMode double-invocation in dev. The /auth/verify
  // endpoint is idempotent on the backend, but firing twice would still
  // briefly flash an error before the second response lands. Belt and braces.
  const calledRef = useRef(false);

  const verify = (token: string, confirm: boolean) => {
    // This browser's session, if any, shows a Google sign-up that this click
    // comes from the same person. The backend ignores it otherwise.
    const session = getToken();
    fetch(`${API_BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session}` } : {}) },
      body: JSON.stringify({ token, ...(confirm ? { confirm: true } : {}) }),
    })
      .then((res) => res.json() as Promise<{ ok: boolean; error?: string; message?: string; detail?: string; data?: { email: string; waitlisted?: boolean; organization?: { name: string; notice: string } | null; googleSignInRemoved?: boolean; confirmationRequired?: boolean } }>)
      .then((data) => {
        if (!data.ok && data.error === "organization_full") {
          setFullLines([data.message ?? "", data.detail ?? ""].filter(Boolean));
          setStatus("full");
          return;
        }
        if (data.ok && data.data?.confirmationRequired) {
          setWaitlisted(data.data.waitlisted === true);
          setStatus("confirm");
        } else if (data.ok && data.data) {
          setStatus("success");
          setEmail(data.data.email);
          setWaitlisted(data.data.waitlisted === true);
          setJoinedNotice(data.data.organization?.notice ?? null);
          setGoogleSignInRemoved(data.data.googleSignInRemoved === true);
          // If the user is logged in in this tab, update the cached flag so
          // subsequent navigation no longer redirects to /verify-pending.
          if (isLoggedIn()) setEmailVerified(true);
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  };

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const token = new URLSearchParams(window.location.search).get("token");

    if (!token) {
      setStatus("error");
      return;
    }
    verify(token, false);
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

        {status === "confirm" && (
          <>
            <h1 style={{ color: "var(--color-primary)", fontSize: "1.5rem", marginBottom: "var(--space-md)" }}>
              One more step
            </h1>
            {waitlisted ? (
              <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
                This sign-up came through a Google account. Verifying holds your place on the waitlist and removes that Google account from this address. When your spot opens, you can set a password with the forgotten-password link on the sign-in page.
              </p>
            ) : (
              <>
                <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
                  This sign-up came through a Google account that isn't signed in on this browser. If you started it yourself, open this link in the browser you signed up in, and you'll keep signing in with Google.
                </p>
                <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
                  If you didn't start it, or can't open it there, verify here. That Google account will be removed from this address.
                </p>
              </>
            )}
            <button
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => {
                const token = new URLSearchParams(window.location.search).get("token");
                if (token) {
                  setStatus("loading");
                  verify(token, true);
                }
              }}
            >
              Verify and remove that Google account
            </button>
          </>
        )}

        {status === "success" && (
          <>
            <h1 style={{ color: "var(--color-primary)", fontSize: "1.5rem", marginBottom: "var(--space-md)" }}>
              {waitlisted ? "Your place is held" : "Email verified"}
            </h1>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
              {waitlisted
                ? `${email} is verified and your spot on the waitlist is held. We'll email you the moment a spot opens — nothing else to do for now.`
                : `${email} is now verified. You can sign in and start using Soup.net.`}
            </p>
            {joinedNotice && (
              <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
                {joinedNotice}
              </p>
            )}
            {googleSignInRemoved && (
              <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
                {waitlisted
                  ? "That Google account has been removed. When your spot opens, set a password with the forgotten-password link on the sign-in page, or use a Google Workspace account on this address."
                  : "That Google account has been removed. To sign in, set a password with the forgotten-password link on the next page, or use a Google Workspace account on this address."}
              </p>
            )}
            {!waitlisted && (
              <Link to="/auth/login" style={{ textDecoration: "none" }}>
                <button style={{ width: "100%", justifyContent: "center" }}>
                  Sign In
                </button>
              </Link>
            )}
          </>
        )}

        {status === "full" && (
          <>
            <h1 style={{ color: "var(--color-error)", fontSize: "1.5rem", marginBottom: "var(--space-md)" }}>
              No free seats
            </h1>
            {fullLines.map((line) => (
              <p key={line} style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-md)" }}>{line}</p>
            ))}
            <Link to="/auth/login" style={{ textDecoration: "none" }}>
              <button className="btn-secondary" style={{ width: "100%", justifyContent: "center", marginTop: "var(--space-md)" }}>
                Back to sign in
              </button>
            </Link>
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
