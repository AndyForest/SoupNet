import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { API_BASE, setEmailVerified, isLoggedIn } from "../auth.js";

export function VerifyPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [email, setEmail] = useState("");
  // Guard against React StrictMode double-invocation in dev. The /auth/verify
  // endpoint is idempotent on the backend, but firing twice would still
  // briefly flash an error before the second response lands. Belt and braces.
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      return;
    }

    fetch(`${API_BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json() as Promise<{ ok: boolean; data?: { email: string } }>)
      .then((data) => {
        if (data.ok && data.data) {
          setStatus("success");
          setEmail(data.data.email);
          // If the user is logged in in this tab, update the cached flag so
          // subsequent navigation no longer redirects to /verify-pending.
          if (isLoggedIn()) setEmailVerified(true);
        } else {
          setStatus("error");
        }
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
              Email verified
            </h1>
            <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
              {email} is now verified. You can sign in and start using Soup.net.
            </p>
            <Link to="/auth/login" style={{ textDecoration: "none" }}>
              <button style={{ width: "100%", justifyContent: "center" }}>
                Sign In
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
