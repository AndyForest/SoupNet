import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { API_BASE } from "../auth.js";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async (addr: string) => {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr }),
      });
      return (await res.json()) as { ok: boolean; data?: { message?: string } };
    },
    onSuccess: () => setSubmitted(true),
  });

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
      }}>
        <div style={{ textAlign: "center", marginBottom: "var(--space-xl)" }}>
          <h1 style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            color: "var(--color-primary)",
            marginBottom: "var(--space-xs)",
          }}>
            Reset your password
          </h1>
          <p style={{
            color: "var(--color-on-surface-variant)",
            fontSize: "0.9rem",
          }}>
            We&apos;ll email you a link to choose a new password.
          </p>
        </div>

        {submitted ? (
          <>
            <p style={{
              color: "var(--color-on-surface-variant)",
              marginBottom: "var(--space-lg)",
              lineHeight: 1.5,
              textAlign: "center",
            }}>
              If an account exists for <strong>{email}</strong>, we&apos;ve sent
              a reset link. Check your inbox (and spam folder). The link expires
              in 1 hour.
            </p>
            <Link to="/auth/login" style={{ textDecoration: "none" }}>
              <button className="btn-secondary" style={{ width: "100%", justifyContent: "center" }}>
                Back to sign in
              </button>
            </Link>
          </>
        ) : (
          <form onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(email);
          }}>
            <div style={{ marginBottom: "var(--space-md)" }}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={mutation.isPending}
              style={{ width: "100%", justifyContent: "center", marginBottom: "var(--space-md)" }}
            >
              {mutation.isPending ? "Sending..." : "Send reset link"}
            </button>

            <p style={{
              textAlign: "center",
              fontSize: "0.875rem",
              color: "var(--color-on-surface-variant)",
            }}>
              Remembered it?{" "}
              <Link to="/auth/login">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
