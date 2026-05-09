import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authFetch, clearToken, setEmailVerified } from "../auth.js";

/**
 * The only page an unverified-but-logged-in user can reach.
 *
 * The router's requireAuth guard redirects them here from any other
 * authed route. They have exactly three things they can do:
 *   1. Open the verification link from their email (in another tab)
 *   2. Resend the verification email
 *   3. Sign out
 *
 * After clicking the email link they need to refresh — we offer a
 * "I've verified my email, take me to the dashboard" button that re-checks
 * /auth/me and redirects on success.
 */
export function VerifyPendingPage() {
  const navigate = useNavigate();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: { email: string; emailVerified?: boolean } } };
      if (!json.ok || !json.data) throw new Error("Could not load account");
      // Sync the cached flag in case the user verified in another tab.
      const verified = json.data.user.emailVerified === true;
      setEmailVerified(verified);
      if (verified) {
        // Already verified — bounce to dashboard immediately.
        void navigate({ to: "/app/dashboard" });
      }
      return json.data.user;
    },
    refetchOnWindowFocus: true,
    refetchInterval: 10000, // poll every 10s in case they verified in another tab
  });

  const resendMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/auth/resend-verification", { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to send verification email");
    },
  });

  function handleSignOut() {
    clearToken();
    void navigate({ to: "/auth/login" });
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
        maxWidth: 480,
        background: "var(--color-surface-container-lowest)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-2xl) var(--space-xl)",
      }}>
        <div style={{ textAlign: "center", marginBottom: "var(--space-xl)" }}>
          <h1 style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            color: "var(--color-primary)",
            marginBottom: "var(--space-sm)",
          }}>
            Verify your email to continue
          </h1>
          <p style={{
            color: "var(--color-on-surface-variant)",
            fontSize: "0.95rem",
            lineHeight: 1.5,
          }}>
            We sent a verification link to{" "}
            {meQuery.data ? <strong>{meQuery.data.email}</strong> : "your inbox"}.
            Click the link to activate your account — once you do, you&apos;ll be
            able to create API keys, check recipes, and join groups.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <button
            onClick={() => meQuery.refetch()}
            disabled={meQuery.isFetching}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {meQuery.isFetching ? "Checking..." : "I've verified my email"}
          </button>

          <button
            className="btn-secondary"
            onClick={() => resendMutation.mutate()}
            disabled={resendMutation.isPending}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {resendMutation.isPending
              ? "Sending..."
              : resendMutation.isSuccess
                ? "Email sent — check your inbox"
                : "Resend verification email"}
          </button>

          <button
            className="btn-secondary"
            onClick={handleSignOut}
            style={{ width: "100%", justifyContent: "center" }}
          >
            Sign out
          </button>
        </div>

        <p style={{
          color: "var(--color-on-surface-variant)",
          fontSize: "0.8rem",
          marginTop: "var(--space-xl)",
          textAlign: "center",
          lineHeight: 1.5,
        }}>
          Don&apos;t see the email? Check your spam folder, or click resend
          above. The link expires after 24 hours.
        </p>
      </div>
    </div>
  );
}
