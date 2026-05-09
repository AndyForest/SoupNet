import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { authFetch } from "../auth.js";

interface CheckEntry {
  id: string;
  traceId: string;
  claimText: string | null;
  occurredAt: string;
  metadata: {
    apiKeyId?: string;
    k?: number | null;
    maxChars?: number | null;
    filter?: string | null;
    searchMode?: string;
    resultCount?: number;
    clustered?: boolean;
    resultTraceIds?: string[];
  } | null;
}

interface CheckLogResponse {
  ok: boolean;
  data: {
    checks: CheckEntry[];
    total: number;
  };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function CheckLogPage() {
  const [page, setPage] = useState(0);
  const perPage = 20;

  const checksQuery = useQuery<CheckLogResponse>({
    queryKey: ["checks", page],
    queryFn: async () => {
      const res = await authFetch(`/traces/checks?limit=${perPage}&offset=${page * perPage}`);
      return (await res.json()) as CheckLogResponse;
    },
  });

  const checks = checksQuery.data?.data?.checks ?? [];
  const total = checksQuery.data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <header style={{ marginBottom: "var(--space-xl)" }}>
        <h1>Recipe Check Log</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
          Every recipe check your AI agents have made. Each entry shows what the agent submitted and what the system returned.
          Use "Map from here" to visualize the same query against your current recipe book; results may differ from what the agent
          originally saw as new recipes arrive.
        </p>
      </header>

      {checksQuery.isLoading && <p style={{ color: "var(--color-on-surface-variant)" }}>Loading...</p>}

      {checks.length === 0 && !checksQuery.isLoading && (
        <p style={{ color: "var(--color-on-surface-variant)" }}>
          No recipe checks logged yet. Checks are logged when AI agents use the recipe check API.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {checks.map((check) => (
          <div
            key={check.id}
            className="card"
            style={{ padding: "var(--space-md) var(--space-lg)" }}
          >
            <Link
              to="/app/traces/$traceId"
              params={{ traceId: check.traceId }}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <p style={{ lineHeight: 1.5, marginBottom: "var(--space-xs)" }}>
                {check.claimText
                  ? check.claimText.length > 200
                    ? check.claimText.slice(0, 200) + "..."
                    : check.claimText
                  : "(recipe text not available)"}
              </p>
            </Link>

            <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center", flexWrap: "wrap" }}>
              <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
                {timeAgo(check.occurredAt)}
              </span>

              {check.metadata?.searchMode && (
                <span className="pill" style={{ fontSize: "0.6rem" }}>
                  {check.metadata.searchMode}
                </span>
              )}

              {check.metadata?.resultCount !== null && check.metadata?.resultCount !== undefined && (
                <span className="pill" style={{ fontSize: "0.6rem" }}>
                  {check.metadata.resultCount} results
                </span>
              )}

              {check.metadata?.clustered && (
                <span className="pill" style={{ fontSize: "0.6rem" }}>
                  clustered
                </span>
              )}

              {check.metadata?.filter && (
                <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
                  filter: {check.metadata.filter}
                </span>
              )}

              {check.claimText && (
                <a
                  href={`/map?query=${encodeURIComponent(check.claimText)}`}
                  style={{ color: "var(--color-primary)", fontSize: "0.75rem", textDecoration: "none" }}
                >
                  Map from here →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: "flex",
          justifyContent: "center",
          gap: "var(--space-md)",
          marginTop: "var(--space-lg)",
          alignItems: "center",
        }}>
          <button
            className="btn-secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            style={{ fontSize: "0.85rem" }}
          >
            Previous
          </button>
          <span className="text-sm" style={{ color: "var(--color-on-surface-variant)" }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="btn-secondary"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            style={{ fontSize: "0.85rem" }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
