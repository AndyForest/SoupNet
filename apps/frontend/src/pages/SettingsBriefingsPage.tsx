import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "../auth.js";

/**
 * /app/settings/briefings — preferences that shape the Copy briefing buttons.
 *
 * Today: cluster count (k) for the exemplar section of the unified briefing.
 * Sub-cluster count is stored but not yet used by the pipeline — UI is
 * disabled with a "Coming soon" note so the preference key is reserved.
 */
interface ResolvedPrefs {
  briefing: {
    clusterCount: number;
    subClusterCount: number;
  };
  features: {
    synthesize: boolean;
  };
}

export function SettingsBriefingsPage() {
  const queryClient = useQueryClient();
  const [clusterInput, setClusterInput] = useState("5");
  const [justSaved, setJustSaved] = useState(false);

  const prefsQuery = useQuery<ResolvedPrefs>({
    queryKey: ["me-preferences"],
    queryFn: async () => {
      const res = await authFetch("/me/preferences");
      const json = (await res.json()) as { ok: boolean; data: ResolvedPrefs };
      if (!json.ok) throw new Error("Failed to load preferences");
      return json.data;
    },
  });

  // Premium gate for the synthesis opt-in: the flag only makes sense (and the
  // server only honours it) for premium users, so the Premium features card is
  // rendered only when /auth/me reports premium. Non-premium users see nothing.
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: { premium?: boolean } } };
      if (!json.ok || !json.data) throw new Error("Failed to load account");
      return json.data.user;
    },
  });

  // Initialise the input only once after the first successful load, then let
  // the user edit freely. Resetting on every refetch would clobber their typing.
  useEffect(() => {
    if (prefsQuery.data) {
      setClusterInput(String(prefsQuery.data.briefing.clusterCount));
    }
  }, [prefsQuery.data]);

  const synthesizeMutation = useMutation({
    mutationFn: async (synthesize: boolean) => {
      const res = await authFetch("/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { synthesize } }),
      });
      const json = (await res.json()) as { ok: boolean; data?: ResolvedPrefs; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Save failed");
      return json.data!;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["me-preferences"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (clusterCount: number) => {
      const res = await authFetch("/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefing: { clusterCount } }),
      });
      const json = (await res.json()) as { ok: boolean; data?: ResolvedPrefs; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Save failed");
      return json.data!;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["me-preferences"] });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    },
  });

  function handleSave() {
    const parsed = parseInt(clusterInput, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 20) return;
    saveMutation.mutate(parsed);
  }

  const dirty = prefsQuery.data
    ? String(prefsQuery.data.briefing.clusterCount) !== clusterInput
    : false;

  return (
    <div>
      <header style={{ marginBottom: "var(--space-xl)" }}>
        <h1>Briefings</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
          Defaults for the agent briefing copied from the Dashboard, API Keys, and Recipe Book pages.
          The Recipe Map page can override these per-copy with its clustering controls.
        </p>
      </header>

      <section className="card" style={{ marginBottom: "var(--space-lg)" }}>
        <h3 style={{ marginBottom: "var(--space-md)" }}>Cluster sample</h3>

        {prefsQuery.isLoading && <p style={{ color: "var(--color-on-surface-variant)" }}>Loading...</p>}
        {prefsQuery.data && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-lg)" }}>
            <div>
              <label htmlFor="clusterCount" style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                Number of clusters
              </label>
              <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
                How many exemplar recipes to include in the briefing. More clusters = wider view of your
                corpus shape, at the cost of context-window space. Range 1–20.
              </p>
              <input
                id="clusterCount"
                type="number"
                min="1"
                max="20"
                value={clusterInput}
                onChange={(e) => setClusterInput(e.target.value)}
                style={{ width: 80 }}
              />
            </div>

            <div style={{ opacity: 0.5 }}>
              <label htmlFor="subClusterCount" style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                Number of sub-clusters
              </label>
              <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
                Drill into each cluster and pick N sub-exemplars. <strong>Coming soon</strong> — the
                preference is reserved but the briefing pipeline ignores it for now.
              </p>
              <input
                id="subClusterCount"
                type="number"
                min="1"
                max="10"
                defaultValue={prefsQuery.data.briefing.subClusterCount}
                disabled
                style={{ width: 80 }}
              />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", marginTop: "var(--space-lg)" }}>
          <button
            onClick={handleSave}
            disabled={!dirty || saveMutation.isPending}
            style={{ fontSize: "0.85rem" }}
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </button>
          {justSaved && (
            <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
              Saved.
            </span>
          )}
          {saveMutation.isError && (
            <span style={{ color: "var(--color-error)", fontSize: "0.8rem" }}>
              {(saveMutation.error as Error).message}
            </span>
          )}
        </div>
      </section>

      {meQuery.data?.premium && prefsQuery.data && (
        <section className="card" style={{ marginBottom: "var(--space-lg)" }}>
          <h3 style={{ marginBottom: "var(--space-md)" }}>Premium features</h3>
          <label style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={prefsQuery.data.features.synthesize}
              disabled={synthesizeMutation.isPending}
              onChange={(e) => synthesizeMutation.mutate(e.target.checked)}
              style={{ marginTop: "0.2rem" }}
            />
            <span>
              <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Retrieval synthesis</span>
              <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
                When enabled, a server-side LLM distills your check results into a short current-preference
                profile whenever your agent passes <code>synthesize</code> on a check. Agents opt in per call,
                so this switch only decides whether the option is available to them.
              </p>
              {synthesizeMutation.isError && (
                <span style={{ color: "var(--color-error)", fontSize: "0.8rem" }}>
                  {(synthesizeMutation.error as Error).message}
                </span>
              )}
            </span>
          </label>
        </section>
      )}
    </div>
  );
}
