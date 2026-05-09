import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useDeleteTrace, useGroupTraces } from "../hooks/useTraces.js";
import type { GroupTrace } from "../hooks/useTraces.js";
import { Icon } from "../components/Icon.js";
import { DeleteTraceConfirmModal } from "../components/DeleteTraceConfirmModal.js";

/**
 * Per-group moderation list. Any group member can view; per-row delete
 * affordance is gated on canDelete (server-computed: trace owner, group
 * owner/admin, or system role).
 *
 * Use case: a group owner suspects malformed traces in the corpus and wants
 * to scan + prune. Outdated-but-correct recipes should NOT be deleted —
 * see design-thinking.md §"Correcting the record".
 */
export function GroupTracesPage() {
  const { groupId } = useParams({ strict: false }) as { groupId: string };
  const { data, isLoading, isError } = useGroupTraces(groupId);
  const deleteTrace = useDeleteTrace();
  const [confirmTrace, setConfirmTrace] = useState<GroupTrace | null>(null);

  if (isLoading) {
    return <p style={{ color: "var(--color-on-surface-variant)" }}>Loading group traces…</p>;
  }

  if (isError) {
    return <p style={{ color: "var(--color-error)" }}>Failed to load group traces.</p>;
  }

  if (!Array.isArray(data)) {
    const errMsg = data?.error ?? "Forbidden";
    return (
      <div>
        <BackLink />
        <p style={{ color: "var(--color-error)", marginTop: "var(--space-md)" }}>
          {errMsg}
        </p>
      </div>
    );
  }

  const traces = data;
  const groupName = traces[0]?.groupName ?? "this group";

  return (
    <div>
      <BackLink />

      <header style={{ marginBottom: "var(--space-2xl)" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "var(--space-xs)" }}>
          Traces in {groupName}
        </h1>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
          All traces in this group, regardless of author. Group owners and admins can delete malformed
          entries — every member can scan. Outdated-but-correct recipes should not be deleted; log a
          fresh recipe and let temporal weighting de-emphasize the old one.
        </p>
      </header>

      {traces.length === 0 ? (
        <p style={{ color: "var(--color-on-surface-variant)" }}>No traces in this group yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {traces.map((trace) => (
            <TraceRow
              key={trace.id}
              trace={trace}
              onDelete={() => setConfirmTrace(trace)}
            />
          ))}
        </div>
      )}

      {confirmTrace && (
        <DeleteTraceConfirmModal
          claimText={confirmTrace.claimText}
          onCancel={() => setConfirmTrace(null)}
          onConfirm={async (reason) => {
            await deleteTrace.mutateAsync({
              traceId: confirmTrace.id,
              ...(reason ? { reason } : {}),
            });
            setConfirmTrace(null);
          }}
          pending={deleteTrace.isPending}
          error={deleteTrace.error instanceof Error ? deleteTrace.error.message : null}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <button
      className="btn-ghost"
      onClick={() => window.history.back()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        marginBottom: "var(--space-lg)",
        fontSize: "0.85rem",
        padding: 0,
      }}
    >
      <Icon name="arrow-left" size={16} />
      Back
    </button>
  );
}

function TraceRow({
  trace,
  onDelete,
}: {
  trace: GroupTrace;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "var(--space-md)",
        padding: "var(--space-md)",
        background: "var(--color-surface-container-lowest)",
        borderRadius: "var(--radius-md)",
        alignItems: "start",
      }}
    >
      <div>
        <Link
          to="/app/traces/$traceId"
          params={{ traceId: trace.id }}
          style={{ color: "var(--color-on-surface)", textDecoration: "none" }}
        >
          <p style={{ marginBottom: "var(--space-xs)" }}>{trace.claimText}</p>
        </Link>
        <div
          className="text-xs"
          style={{
            display: "flex",
            gap: "var(--space-md)",
            color: "var(--color-on-surface-variant)",
            flexWrap: "wrap",
          }}
        >
          <span>{new Date(trace.createdAt).toLocaleString()}</span>
          {trace.userEmail && <span>by {trace.userEmail}</span>}
          {trace.apiKeyLabel && (
            <span style={{ color: "var(--color-outline-variant)" }}>
              via {trace.apiKeyLabel}
            </span>
          )}
          <span style={{ color: "var(--color-outline-variant)" }}>
            {trace.evidenceCount ?? 0} evidence
          </span>
        </div>
      </div>

      {trace.canDelete && (
        <button
          className="btn-ghost"
          onClick={onDelete}
          style={{
            color: "var(--color-error)",
            fontSize: "0.8rem",
            padding: "var(--space-xs) var(--space-sm)",
          }}
          aria-label={`Delete trace: ${trace.claimText.slice(0, 60)}`}
        >
          Delete
        </button>
      )}
    </div>
  );
}
