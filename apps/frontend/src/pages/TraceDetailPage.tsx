import { useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import {
  useDeleteTrace,
  useMoveTrace,
  useTraceDetail,
  useTraceFeedback,
  useSetTraceReaction,
  useSetFeedbackStar,
} from "../hooks/useTraces.js";
import type { GroupedReference, TraceFeedbackRow, TraceReaction } from "../hooks/useTraces.js";
import { Icon } from "../components/Icon.js";
import { UserBadge } from "../components/UserBadge.js";
import { ApiKeyBadge } from "../components/ApiKeyBadge.js";
import { DeleteTraceConfirmModal } from "../components/DeleteTraceConfirmModal.js";
import { MoveTraceModal } from "../components/MoveTraceModal.js";

export function TraceDetailPage() {
  const { traceId } = useParams({ strict: false }) as { traceId: string };
  const navigate = useNavigate();
  const { data: trace, isLoading, isError } = useTraceDetail(traceId);
  const { data: feedbackData } = useTraceFeedback(traceId);
  const setReaction = useSetTraceReaction(traceId);
  const deleteTrace = useDeleteTrace();
  const moveTrace = useMoveTrace();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

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
          {trace.decidedAt ? (
            <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
              Decided {new Date(trace.decidedAt).toLocaleString()} · logged {createdAt.toLocaleString()}
            </span>
          ) : (
            <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
              {createdAt.toLocaleString()}
            </span>
          )}
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
          {/* Beside the book it lives in, not in the Danger zone — a move is a
              correction, not a destructive act. Agents pick the book at check
              time and sometimes pick wrong. */}
          {trace.canMove && (
            <button
              className="btn-ghost"
              onClick={() => setMoveOpen(true)}
              style={{ fontSize: "0.75rem", padding: "2px 8px" }}
            >
              Move…
            </button>
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

        {/* Human reaction — one click per user, latest wins; clicking the
            active one clears it. The calibration signal for self-graded
            agent feedback (UVP Layer 3). */}
        <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-md)", alignItems: "center", flexWrap: "wrap" }}>
          <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
            Is this recipe still right?
          </span>
          {(["still_true", "stale", "wrong"] as TraceReaction[]).map((r) => {
            const active = feedbackData?.reactions.mine === r;
            const count = feedbackData?.reactions.counts[r] ?? 0;
            const label = r === "still_true" ? "Still true" : r === "stale" ? "Stale" : "Wrong";
            return (
              <button
                key={r}
                className="btn-ghost"
                onClick={() => setReaction.mutate(active ? null : r)}
                disabled={setReaction.isPending}
                aria-pressed={active}
                style={{
                  fontSize: "0.75rem",
                  padding: "2px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${active ? "var(--color-primary)" : "var(--color-surface-container-high)"}`,
                  color: active ? "var(--color-primary)" : "var(--color-on-surface-variant)",
                  background: active ? "var(--color-surface-container)" : "transparent",
                  cursor: "pointer",
                }}
              >
                {label}{count > 0 ? ` · ${count}` : ""}
              </button>
            );
          })}
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

      {feedbackData && feedbackData.feedback.length > 0 && (
        <section style={{ marginBottom: "var(--space-2xl)" }}>
          <h2 style={{ fontSize: "1.15rem", marginBottom: "var(--space-xs)" }}>
            Feedback ({feedbackData.feedback.length})
          </h2>
          <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-md)" }}>
            What agents did after checking this recipe — the check-to-outcome lineage — plus any corrections
            a human made to it. Star the rows that mattered.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {feedbackData.feedback.map((row) => (
              <FeedbackCard key={row.id} row={row} traceId={traceId} />
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

      {moveOpen && (
        <MoveTraceModal
          currentGroupId={trace.groupId}
          evidence={trace.evidence}
          onCancel={() => setMoveOpen(false)}
          onConfirm={async ({ groupId, story, dropEvidenceIds }) => {
            await moveTrace.mutateAsync({
              traceId,
              groupId,
              ...(story ? { story } : {}),
              ...(dropEvidenceIds.length ? { dropEvidenceIds } : {}),
            });
            setMoveOpen(false);
          }}
          pending={moveTrace.isPending}
          error={moveTrace.error instanceof Error ? moveTrace.error.message : null}
        />
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

/** Small labeled chip for feedback enum values. Impact gets a color accent —
 *  it's the value the human scans for. */
function FeedbackChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span
      className="text-xs"
      style={{
        display: "inline-flex",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface-container)",
        color: accent ? "var(--color-primary)" : "var(--color-on-surface-variant)",
        border: accent ? "1px solid var(--color-primary)" : "1px solid transparent",
      }}
    >
      <span style={{ color: "var(--color-outline-variant)" }}>{label}</span>
      {value}
    </span>
  );
}

function FeedbackCard({ row, traceId }: { row: TraceFeedbackRow; traceId: string }) {
  const setStar = useSetFeedbackStar(traceId);
  const createdAt = new Date(row.createdAt);
  // Human-origin rows (a re-filing correction) carry actorUserId and no api key.
  const byHuman = !!row.actorUserId;
  const agentBits = [row.agentId, row.model, row.harness && `${row.harness}${row.harnessVersion ? ` ${row.harnessVersion}` : ""}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{
      background: "var(--color-surface-container-lowest)",
      borderRadius: "var(--radius-lg)",
      padding: "var(--space-lg)",
      borderLeft: `3px solid ${byHuman ? "var(--color-success)" : "var(--color-primary)"}`,
    }}>
      <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
        {byHuman && <FeedbackChip label="by" value="human" accent />}
        <FeedbackChip label="impact" value={row.impact} accent={row.impact === "big" || row.impact === "new"} />
        <FeedbackChip label="disposition" value={row.disposition} />
        <FeedbackChip label="kind" value={row.kind} />
        <FeedbackChip label="fulfilled" value={row.storyFulfilled} />
        {row.topSimilarity !== null && (
          <FeedbackChip label="top match" value={`${Math.round(row.topSimilarity * 100)}%`} />
        )}
        <button
          className="btn-ghost"
          onClick={() => setStar.mutate({ feedbackId: row.id, starred: !row.starredByMe })}
          disabled={setStar.isPending}
          aria-pressed={row.starredByMe}
          title={row.starredByMe ? "Unstar — remove 'this one mattered'" : "Star — this one mattered"}
          style={{
            marginLeft: "auto",
            fontSize: "0.85rem",
            padding: "2px 8px",
            cursor: "pointer",
            color: row.starredByMe ? "var(--color-primary)" : "var(--color-outline-variant)",
          }}
        >
          {row.starredByMe ? "★" : "☆"}{row.starCount > 0 ? ` ${row.starCount}` : ""}
        </button>
      </div>

      <p style={{ marginTop: "var(--space-sm)" }}>{row.story}</p>
      {row.note && (
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
          {row.note}
        </p>
      )}

      {row.relatedTraceIds && row.relatedTraceIds.length > 0 && (
        <p className="text-xs" style={{ marginTop: "var(--space-xs)" }}>
          Related recipes:{" "}
          {row.relatedTraceIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <a href={`/app/traces/${id}`} style={{ color: "var(--color-primary)", textDecoration: "none", fontFamily: "var(--font-mono, monospace)" }}>
                {id.slice(0, 8)}…
              </a>
            </span>
          ))}
        </p>
      )}

      <p className="text-xs" style={{ color: "var(--color-outline-variant)", marginTop: "var(--space-sm)" }}>
        {byHuman && row.actorEmail ? `${row.actorEmail} · ` : ""}
        {agentBits ? `${agentBits} · ` : ""}
        {row.apiKeyLabel ? `key: ${row.apiKeyLabel} · ` : ""}
        {createdAt.toLocaleString()}
      </p>
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

