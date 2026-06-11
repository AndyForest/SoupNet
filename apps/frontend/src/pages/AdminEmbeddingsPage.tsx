import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { authFetch } from "../auth.js";
import { Icon } from "../components/Icon.js";

interface VectorStat {
  strategy_id: string;
  status: string;
  count: number;
}

interface TraceCoverage {
  strategy_id: string;
  traces_with_strategy: number;
}

interface FailedVector {
  id: string;
  error: string;
  retryCount: number;
  updatedAt: string;
  strategyId: string;
}

interface ErrorGroup {
  error: string;
  count: number;
  lastSeen: string;
  strategies: string[];
}

interface StuckProcessing {
  id: string;
  retryCount: number;
  updatedAt: string;
  strategyId: string;
  ageSeconds: number;
}

interface EmbeddingsResponse {
  ok: boolean;
  data: {
    vectorStats: VectorStat[];
    traceCoverage: TraceCoverage[];
    totalTraces: number;
    failedVectors: FailedVector[];
    errorGrouping: ErrorGroup[];
    stuckProcessing: StuckProcessing[];
    queriedAt: string;
  };
}

const STATE_COLORS: Record<string, string> = {
  pending: "#888",
  processing: "#3b82f6",
  complete: "#22c55e",
  failed: "#ef4444",
};

function StateBadge({ state, count }: { state: string; count: number }) {
  const color = STATE_COLORS[state] ?? "#888";
  return (
    <span style={{
      display: "inline-block",
      padding: "2px var(--space-sm)",
      background: `${color}22`,
      color,
      borderRadius: "var(--radius-sm)",
      fontSize: "0.8rem",
      fontFamily: "var(--font-mono)",
      marginRight: "var(--space-xs)",
    }}>
      {state}: {count.toLocaleString()}
    </span>
  );
}

function formatAgeSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function AdminEmbeddingsPage() {
  const queryClient = useQueryClient();
  const [retryAllStrategy, setRetryAllStrategy] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: { id: string; email: string; role: string } } };
      if (!json.ok || !json.data) throw new Error("Failed");
      return json.data.user;
    },
  });

  const embeddingsQuery = useQuery({
    queryKey: ["admin", "workers", "embeddings"],
    queryFn: async () => {
      const res = await authFetch("/admin/workers/embeddings");
      return (await res.json()) as EmbeddingsResponse;
    },
    enabled: meQuery.data?.role === "system",
    refetchInterval: 10_000,
  });

  const retryMutation = useMutation({
    mutationFn: async (vectorId: string) => {
      const res = await authFetch(`/admin/workers/embeddings/retry/${vectorId}`, {
        method: "POST",
      });
      return await res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "workers", "embeddings"] });
    },
  });

  // The embeddings kill-switch lives here, with the pipeline it governs —
  // there is deliberately no generic admin "Settings" page.
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const res = await authFetch("/admin/settings");
      const json = (await res.json()) as { ok: boolean; data?: { embeddingsEnabled: boolean } };
      if (!json.ok || !json.data) throw new Error("Failed to load settings");
      return json.data;
    },
    enabled: meQuery.data?.role === "system",
  });

  const toggleEmbeddingsMutation = useMutation({
    mutationFn: async (embeddingsEnabled: boolean) => {
      const res = await authFetch("/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeddingsEnabled }),
      });
      return await res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
  });

  const retryAllMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const res = await authFetch(`/admin/workers/embeddings/retry-all/${strategyId}`, {
        method: "POST",
      });
      return await res.json();
    },
    onSuccess: () => {
      setRetryAllStrategy(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "workers", "embeddings"] });
    },
  });

  if (meQuery.isLoading) {
    return <div style={{ padding: "var(--space-lg)" }}>Loading...</div>;
  }

  if (meQuery.data?.role !== "system") {
    return (
      <div style={{ padding: "var(--space-lg)", maxWidth: 600 }}>
        <h1>Admin</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-md)" }}>
          You don't have access to this page. System admin role required.
        </p>
      </div>
    );
  }

  // Group vector stats by strategy
  const vectorsByStrategy = new Map<string, VectorStat[]>();
  for (const stat of embeddingsQuery.data?.data.vectorStats ?? []) {
    const list = vectorsByStrategy.get(stat.strategy_id) ?? [];
    list.push(stat);
    vectorsByStrategy.set(stat.strategy_id, list);
  }

  const traceCoverage = embeddingsQuery.data?.data.traceCoverage ?? [];
  const totalTraces = embeddingsQuery.data?.data.totalTraces ?? 0;
  const failedVectors = embeddingsQuery.data?.data.failedVectors ?? [];
  const errorGrouping = embeddingsQuery.data?.data.errorGrouping ?? [];
  const stuckProcessing = embeddingsQuery.data?.data.stuckProcessing ?? [];

  // Strategies that have any failed vectors (for retry-all buttons)
  const strategiesWithFailures = new Set(failedVectors.map((v) => v.strategyId));

  return (
    <div style={{ padding: "var(--space-lg)", maxWidth: 1100 }}>
      <div style={{ marginBottom: "var(--space-md)" }}>
        <Link to="/admin" style={{ color: "var(--color-primary)", fontSize: "0.85rem", textDecoration: "none" }}>
          <Icon name="arrow-left" size={14} /> Back to admin
        </Link>
      </div>

      <h1>Embedding Pipeline</h1>
      <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
        Strategy coverage, vector status, recovery operations. Auto-refreshes every 10 seconds.
      </p>
      {embeddingsQuery.data && (
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)", fontFamily: "var(--font-mono)" }}>
          Last updated: {new Date(embeddingsQuery.data.data.queriedAt).toLocaleTimeString()}
        </p>
      )}

      {embeddingsQuery.isLoading && <p>Loading embedding stats...</p>}
      {embeddingsQuery.error && <p style={{ color: "var(--color-error)" }}>Error loading embedding stats</p>}

      {/* ── Kill switch ──────────────────────────────────── */}
      <section style={{ marginTop: "var(--space-lg)" }}>
        <label style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", fontSize: "0.875rem", fontWeight: 400 }}>
          <input
            type="checkbox"
            checked={settingsQuery.data?.embeddingsEnabled ?? true}
            disabled={!settingsQuery.data || toggleEmbeddingsMutation.isPending}
            onChange={(e) => toggleEmbeddingsMutation.mutate(e.target.checked)}
            style={{ width: "auto", minWidth: 0 }}
          />
          Embeddings enabled — uncheck to pause Gemini API calls (and spend) without stopping the app
        </label>
      </section>

      {/* ── Strategy coverage ────────────────────────────── */}
      <section style={{ marginTop: "var(--space-xl)" }}>
        <h2 style={{ fontSize: "1.1rem" }}>Strategy coverage</h2>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
          Traces total: <strong>{totalTraces.toLocaleString()}</strong>. Each strategy should match this count once fully backfilled.
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
              <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Strategy</th>
              <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>Traces</th>
              <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>Coverage</th>
              <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Vector statuses</th>
              <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {traceCoverage.map((row) => {
              const pct = totalTraces > 0 ? Math.round((row.traces_with_strategy / totalTraces) * 100) : 0;
              const vectorStats = vectorsByStrategy.get(row.strategy_id) ?? [];
              const hasFailures = strategiesWithFailures.has(row.strategy_id);
              return (
                <tr key={row.strategy_id} style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                    {row.strategy_id}
                  </td>
                  <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                    {row.traces_with_strategy.toLocaleString()}
                  </td>
                  <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)", color: pct === 100 ? "var(--color-primary)" : "var(--color-on-surface-variant)" }}>
                    {pct}%
                  </td>
                  <td style={{ padding: "var(--space-sm)" }}>
                    {vectorStats.map((s) => <StateBadge key={s.status} state={s.status} count={s.count} />)}
                  </td>
                  <td style={{ padding: "var(--space-sm)", textAlign: "right" }}>
                    {hasFailures && (
                      retryAllStrategy === row.strategy_id ? (
                        <span style={{ display: "inline-flex", gap: "var(--space-xs)", alignItems: "center" }}>
                          <button
                            onClick={() => retryAllMutation.mutate(row.strategy_id)}
                            disabled={retryAllMutation.isPending}
                            style={{ fontSize: "0.7rem", padding: "2px var(--space-sm)", background: "var(--color-error)", color: "white" }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setRetryAllStrategy(null)}
                            className="btn-ghost"
                            style={{ fontSize: "0.7rem", padding: "2px var(--space-sm)" }}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setRetryAllStrategy(row.strategy_id)}
                          className="btn-ghost"
                          style={{ fontSize: "0.7rem", padding: "2px var(--space-sm)" }}
                        >
                          Retry failed
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ── Stuck processing ────────────────────────────── */}
      {stuckProcessing.length > 0 && (
        <section style={{ marginTop: "var(--space-xl)" }}>
          <h2 style={{ fontSize: "1.1rem", color: "var(--color-error)" }}>Stuck processing ({stuckProcessing.length})</h2>
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
            Vectors in <code>processing</code> for over 5 minutes. The strategy sweep auto-resets these after 10 minutes (up to 3 retries).
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Strategy</th>
                <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>Stuck for</th>
                <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>Retries</th>
              </tr>
            </thead>
            <tbody>
              {stuckProcessing.slice(0, 10).map((v) => (
                <tr key={v.id} style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {v.strategyId}
                  </td>
                  <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {formatAgeSeconds(v.ageSeconds)}
                  </td>
                  <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {v.retryCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stuckProcessing.length > 10 && (
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
              + {stuckProcessing.length - 10} more
            </p>
          )}
        </section>
      )}

      {/* ── Error grouping ────────────────────────────── */}
      {errorGrouping.length > 0 && (
        <section style={{ marginTop: "var(--space-xl)" }}>
          <h2 style={{ fontSize: "1.1rem" }}>Error patterns</h2>
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
            Failed vectors clustered by error message. Identifies systemic issues vs one-offs.
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>Count</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Error</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Strategies</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {errorGrouping.map((g, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                  <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                    {g.count}
                  </td>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", maxWidth: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {g.error}
                  </td>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--color-on-surface-variant)" }}>
                    {g.strategies.join(", ")}
                  </td>
                  <td style={{ padding: "var(--space-sm)", fontSize: "0.75rem", color: "var(--color-on-surface-variant)" }}>
                    {new Date(g.lastSeen).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Recently failed vectors ────────────────────────────── */}
      {failedVectors.length > 0 && (
        <section style={{ marginTop: "var(--space-xl)" }}>
          <h2 style={{ fontSize: "1.1rem" }}>Recent failures</h2>
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
            Last 50 failed vectors. Click Retry to reset to pending — the worker will pick it up on the next sweep.
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Strategy</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Error</th>
                <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>Retries</th>
                <th style={{ textAlign: "left", padding: "var(--space-sm)" }}>Updated</th>
                <th style={{ textAlign: "right", padding: "var(--space-sm)" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {failedVectors.map((v) => (
                <tr key={v.id} style={{ borderBottom: "1px solid var(--color-outline-variant)" }}>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {v.strategyId}
                  </td>
                  <td style={{ padding: "var(--space-sm)", fontFamily: "var(--font-mono)", fontSize: "0.7rem", maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.error}
                  </td>
                  <td style={{ padding: "var(--space-sm)", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {v.retryCount}
                  </td>
                  <td style={{ padding: "var(--space-sm)", fontSize: "0.7rem", color: "var(--color-on-surface-variant)" }}>
                    {new Date(v.updatedAt).toLocaleString()}
                  </td>
                  <td style={{ padding: "var(--space-sm)", textAlign: "right" }}>
                    <button
                      onClick={() => retryMutation.mutate(v.id)}
                      disabled={retryMutation.isPending}
                      className="btn-ghost"
                      style={{ fontSize: "0.7rem", padding: "2px var(--space-sm)" }}
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
