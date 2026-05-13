import { useQuery, useMutation } from "@tanstack/react-query";
import { authFetch, clearToken } from "../auth.js";
import { useNavigate } from "@tanstack/react-router";

/**
 * /app/settings/account — identity, sign-out, data export.
 *
 * Extracted from the old monolithic SettingsPage. Agent Setup is gone (now in
 * the unified briefing). Privacy Defaults is gone (off roadmap). System Admin
 * — signup cap controls — moved entirely to /admin where they belong.
 */
export function SettingsAccountPage() {
  const navigate = useNavigate();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: { id: string; email: string; role: string; emailVerified?: boolean } } };
      if (!json.ok || !json.data) throw new Error("Failed");
      return json.data.user;
    },
  });

  function handleLogout() {
    clearToken();
    void navigate({ to: "/auth/login" });
  }

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/auth/me/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const disp = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disp);
      const filename = match?.[1] ?? `soupnet-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <div>
      <header style={{ marginBottom: "var(--space-xl)" }}>
        <h1>Account</h1>
      </header>

      <section className="card" style={{ marginBottom: "var(--space-lg)" }}>
        <h3 style={{ marginBottom: "var(--space-md)" }}>Account</h3>
        {meQuery.isLoading && <p style={{ color: "var(--color-on-surface-variant)" }}>Loading...</p>}
        {meQuery.data && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ fontFamily: "var(--font-headline)", fontWeight: 600 }}>{meQuery.data.email}</p>
              <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
                Role: {meQuery.data.role}
              </p>
            </div>
            <button className="btn-secondary" onClick={handleLogout} style={{ fontSize: "0.8rem" }}>
              Sign out
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginBottom: "var(--space-sm)" }}>Your Data</h3>
        <p style={{ color: "var(--color-on-surface-variant)", fontSize: "0.9rem", marginBottom: "var(--space-md)" }}>
          Your recipes, evidence, and references are yours. Export a full copy as JSON whenever you want —
          including your recipes, the evidence and references you've submitted with them, your recipe book memberships,
          and API key metadata. System-generated data (vectors, embeddings, audit logs) is not included since it's
          derived from what you contributed.
        </p>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            style={{ fontSize: "0.85rem" }}
          >
            {exportMutation.isPending ? "Preparing export..." : "Export my data (JSON)"}
          </button>
          {exportMutation.isError && (
            <span style={{ color: "var(--color-error)", fontSize: "0.8rem" }}>
              {(exportMutation.error as Error).message}
            </span>
          )}
          {exportMutation.isSuccess && !exportMutation.isPending && (
            <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
              Downloaded.
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
