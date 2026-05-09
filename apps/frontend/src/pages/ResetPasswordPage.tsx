import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { API_BASE } from "../auth.js";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Reset failed");
    },
    onSuccess: () => {
      // Redirect to login with a success hint
      void navigate({ to: "/auth/login" });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Reset failed");
    },
  });

  if (!token) {
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
          <h1 style={{ color: "var(--color-error)", fontSize: "1.5rem", marginBottom: "var(--space-md)" }}>
            Missing reset token
          </h1>
          <p style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
            This page needs a token from a password reset email.
          </p>
          <Link to="/auth/forgot-password" style={{ textDecoration: "none" }}>
            <button style={{ width: "100%", justifyContent: "center" }}>
              Request a reset link
            </button>
          </Link>
        </div>
      </div>
    );
  }

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
        <h1 style={{
          fontSize: "1.5rem",
          fontWeight: 800,
          color: "var(--color-primary)",
          textAlign: "center",
          marginBottom: "var(--space-xl)",
        }}>
          Choose a new password
        </h1>

        <form onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (password.length < 8) {
            setError("Password must be at least 8 characters");
            return;
          }
          if (password !== confirm) {
            setError("Passwords do not match");
            return;
          }
          mutation.mutate();
        }}>
          <div style={{ marginBottom: "var(--space-md)" }}>
            <label htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: "var(--space-md)" }}>
            <label htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
            />
          </div>

          {error && (
            <p style={{
              color: "var(--color-error)",
              fontSize: "0.875rem",
              marginBottom: "var(--space-md)",
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            style={{ width: "100%", justifyContent: "center", marginBottom: "var(--space-md)" }}
          >
            {mutation.isPending ? "Resetting..." : "Reset password"}
          </button>

          <p style={{
            textAlign: "center",
            fontSize: "0.875rem",
            color: "var(--color-on-surface-variant)",
          }}>
            <Link to="/auth/login">Back to sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
