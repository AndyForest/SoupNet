import { useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useDeleteTrace, useTraceDetail } from "../hooks/useTraces.js";
import type { GroupedReference } from "../hooks/useTraces.js";
import { Icon } from "../components/Icon.js";
import { UserBadge } from "../components/UserBadge.js";
import { ApiKeyBadge } from "../components/ApiKeyBadge.js";
import { DeleteTraceConfirmModal } from "../components/DeleteTraceConfirmModal.js";

export function TraceDetailPage() {
  const { traceId } = useParams({ strict: false }) as { traceId: string };
  const navigate = useNavigate();
  const { data: trace, isLoading, isError } = useTraceDetail(traceId);
  const deleteTrace = useDeleteTrace();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isLoading) {
    return <p style={{ color: "var(--color-on-surface-variant)" }}>Loading trace...</p>;
  }

  if (isError || !trace) {
    return <p style={{ color: "var(--color-error)" }}>Trace not found.</p>;
  }

  const createdAt = new Date(trace.createdAt);

  return (
    <div>
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

      <header style={{ marginBottom: "var(--space-2xl)" }}>
        <h1 style={{ fontSize: "1.75rem", lineHeight: 1.3, marginBottom: "var(--space-md)" }}>
          {trace.claimText}
        </h1>
        <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center", flexWrap: "wrap" }}>
          <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
            {createdAt.toLocaleString()}
          </span>
          {trace.formatAdherenceScore !== null && trace.formatAdherenceScore !== undefined && (
            <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
              Format score: {Math.round(trace.formatAdherenceScore * 100)}%
            </span>
          )}
          {trace.groupName && (
            <a
              href={`/app/recipe-books/${trace.groupId}/traces`}
              className="text-xs"
              style={{ color: "var(--color-primary)", textDecoration: "none" }}
            >
              Recipe book: {trace.groupName} →
            </a>
          )}
          <a
            href={`/map?query=${encodeURIComponent(trace.claimText)}`}
            style={{ color: "var(--color-primary)", fontSize: "0.8rem", textDecoration: "none" }}
          >
            Map from here →
          </a>
        </div>

        <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)", flexWrap: "wrap" }}>
          <UserBadge user={{ email: trace.userEmail }} />
          <ApiKeyBadge apiKey={{ id: trace.apiKeyId, label: trace.apiKeyLabel ?? null }} />
        </div>
      </header>

      <section style={{ marginBottom: "var(--space-2xl)" }}>
        <div className="card" style={{ textAlign: "center", maxWidth: "16rem" }}>
          <p className="text-label">Evidence entries</p>
          <p style={{ fontSize: "2rem", fontWeight: 700, color: "var(--color-success)", lineHeight: 1.2, marginTop: "var(--space-xs)" }}>
            {trace.evidence.length}
          </p>
        </div>
      </section>

      {trace.evidence.length > 0 && (
        <section style={{ marginBottom: "var(--space-2xl)" }}>
          <h2 style={{ fontSize: "1.15rem", marginBottom: "var(--space-md)" }}>Evidence</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {trace.evidence.map((e, i) => (
              <EvidenceCard key={i} evidence={e} />
            ))}
          </div>
        </section>
      )}

      {trace.canDelete && (
        <section style={{ marginTop: "var(--space-2xl)", paddingTop: "var(--space-lg)", borderTop: "1px solid var(--color-surface-container-high)" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "var(--space-sm)" }}>Danger zone</h2>
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-md)" }}>
            Delete this trace if it's malformed (wrong voice, off-format, hallucinated content). Outdated-but-correct
            recipes should NOT be deleted — log a fresh recipe instead and let temporal weighting de-emphasize the old one.
          </p>
          <button
            className="btn-ghost"
            onClick={() => setConfirmOpen(true)}
            style={{ color: "var(--color-error)", borderColor: "var(--color-error)" }}
          >
            Delete this trace
          </button>
        </section>
      )}

      {confirmOpen && (
        <DeleteTraceConfirmModal
          claimText={trace.claimText}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async (reason) => {
            await deleteTrace.mutateAsync({ traceId, ...(reason ? { reason } : {}) });
            setConfirmOpen(false);
            void navigate({ to: "/" });
          }}
          pending={deleteTrace.isPending}
          error={deleteTrace.error instanceof Error ? deleteTrace.error.message : null}
        />
      )}
    </div>
  );
}

function EvidenceCard({
  evidence,
}: {
  evidence: { content: string; references: GroupedReference[] };
}) {
  return (
    <div style={{
      background: "var(--color-surface-container-lowest)",
      borderRadius: "var(--radius-lg)",
      padding: "var(--space-lg)",
      borderLeft: "3px solid var(--color-success)",
    }}>
      <p style={{ marginBottom: "var(--space-sm)" }}>{evidence.content}</p>
      {evidence.references.length > 0 && (
        <div style={{ marginTop: "var(--space-sm)" }}>
          {evidence.references.map((ref, i) => (
            <div key={i} style={{ marginTop: "var(--space-xs)" }}>
              {ref.quote && (
                <blockquote style={{
                  fontStyle: "italic",
                  fontSize: "0.9rem",
                  color: "var(--color-on-surface-variant)",
                  paddingLeft: "var(--space-md)",
                  borderLeft: "2px solid var(--color-surface-container-high)",
                }}>
                  {ref.quote}
                </blockquote>
              )}
              {ref.source && (
                <p className="text-xs" style={{ color: "var(--color-outline-variant)", marginTop: "var(--space-xs)", paddingLeft: "var(--space-md)" }}>
                  — {ref.source}
                </p>
              )}
              {ref.fileUrl && <FileAttachment reference={ref} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Display metadata for an attached file. We do not serve the file itself —
 * uploads are opaque references — so the filename + hash + ROI box are the
 * audit trail viewers use to verify the recipe against their own source copy.
 */
function FileAttachment({ reference }: { reference: GroupedReference }) {
  const filename = reference.originalFilename || "(unnamed file)";
  const mime = reference.fileMimeType ?? "";
  const box = reference.regionMeta?.image_box;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div
      className="text-xs"
      style={{
        marginTop: "var(--space-xs)",
        marginLeft: "var(--space-md)",
        padding: "var(--space-xs) var(--space-sm)",
        background: "var(--color-surface-container)",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        color: "var(--color-on-surface-variant)",
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      <span>
        <span style={{ color: "var(--color-outline-variant)" }}>file:</span> {filename}
        {mime && <span style={{ color: "var(--color-outline-variant)" }}> ({mime})</span>}
      </span>
      {reference.fileHash && (
        <span style={{ color: "var(--color-outline-variant)" }}>
          sha256: {reference.fileHash.slice(0, 16)}…
        </span>
      )}
      {box && (
        <span style={{ color: "var(--color-outline-variant)" }}>
          region: x {pct(box.x0)}–{pct(box.x1)}, y {pct(box.y0)}–{pct(box.y1)}
        </span>
      )}
    </div>
  );
}

