import { useState } from "react";

/**
 * Typed-confirmation modal for hard-deleting a trace. Used by both the
 * trace details page (delete one) and the group-traces moderation page
 * (delete from a list row). Caller wires the actual mutation.
 */
export function DeleteTraceConfirmModal({
  claimText,
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  claimText: string;
  onCancel: () => void;
  onConfirm: (reason: string | undefined) => void;
  pending: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const required = "DELETE";
  const matches = typed === required;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "grid", placeItems: "center", zIndex: 100, padding: "var(--space-md)",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-xl)",
          maxWidth: "32rem",
          width: "100%",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "var(--space-sm)" }}>Delete this trace?</h3>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-md)" }}>
          Hard delete. Linked evidence and references that have no other recipes referencing them are also pruned.
          The vector cache is content-hash keyed and preserved. An audit-log entry is written.
        </p>
        <blockquote style={{
          background: "var(--color-surface-container-lowest)",
          padding: "var(--space-sm) var(--space-md)",
          borderLeft: "3px solid var(--color-error)",
          marginBottom: "var(--space-md)",
          fontStyle: "italic",
        }}>
          {claimText}
        </blockquote>

        <label style={{ display: "block", marginBottom: "var(--space-md)" }}>
          <span className="text-xs" style={{ display: "block", marginBottom: "var(--space-xs)" }}>
            Reason (optional — appears in audit log)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. wrong voice, hallucinated content"
            style={{ width: "100%", fontFamily: "inherit", fontSize: "0.9rem" }}
          />
        </label>

        <label style={{ display: "block", marginBottom: "var(--space-md)" }}>
          <span className="text-xs" style={{ display: "block", marginBottom: "var(--space-xs)" }}>
            Type <code>{required}</code> to confirm
          </span>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            style={{ width: "100%", fontFamily: "var(--font-mono, monospace)" }}
          />
        </label>

        {error && (
          <p className="text-xs" style={{ color: "var(--color-error)", marginBottom: "var(--space-md)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onCancel} disabled={pending}>Cancel</button>
          <button
            onClick={() => onConfirm(reason.trim() ? reason.trim() : undefined)}
            disabled={!matches || pending}
            style={{
              background: matches ? "var(--color-error)" : "var(--color-surface-container-high)",
              color: matches ? "white" : "var(--color-on-surface-variant)",
              border: "none",
              padding: "var(--space-xs) var(--space-md)",
              borderRadius: "var(--radius-sm)",
              cursor: matches && !pending ? "pointer" : "not-allowed",
            }}
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
