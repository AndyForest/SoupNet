import { useMemo, useState } from "react";
import { useRecipeBooks, canWriteToBook } from "../hooks/useRecipeBooks.js";
import type { GroupedEvidence } from "../hooks/useTraces.js";

/**
 * Re-file a recipe into another recipe book.
 *
 * Two deliberate choices, both about not leaking across the boundary:
 *
 * 1. The correction note names only the DESTINATION book. Moving from a more
 *    private book into a more shared one is the common direction, and the
 *    source book's own name is sensitive — the note renders to everyone who can
 *    read the destination.
 * 2. Evidence entries can be de-selected, and de-selecting REDACTS them: the
 *    server hard-deletes the entry and any reference it was the last link to.
 *    Hiding them instead would leave the leak open while appearing closed.
 *
 * Not a "danger zone" affordance. A move isn't destructive — but the redaction
 * inside it is, so that half says so plainly.
 */
export function MoveTraceModal({
  currentGroupId,
  evidence,
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  currentGroupId: string;
  evidence: GroupedEvidence[];
  onCancel: () => void;
  onConfirm: (params: {
    groupId: string;
    story: string;
    dropEvidenceIds: string[];
  }) => void;
  pending: boolean;
  error: string | null;
}) {
  const { data: books, isLoading } = useRecipeBooks();
  const [destId, setDestId] = useState("");
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [storyTail, setStoryTail] = useState("");

  const destinations = useMemo(
    () =>
      (books ?? []).filter(
        (b) => b.id !== currentGroupId && canWriteToBook(b.member_role),
      ),
    [books, currentGroupId],
  );

  const destBook = destinations.find((b) => b.id === destId);

  // Pre-filled, in the recipe format, with a trailing "so that " the human may
  // complete or leave. Never mentions where the recipe came from.
  const storyHead = destBook
    ? `As the owner of this recipe book, I re-filed this recipe into ${destBook.name} so that `
    : "";

  const toggle = (id: string) => {
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const redactCount = dropped.size;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Move recipe to another recipe book"
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
          maxWidth: "36rem",
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "var(--space-sm)" }}>
          Move to another recipe book
        </h3>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-lg)" }}>
          The recipe keeps its evidence, dates, and author. Search results follow it to the new book.
          A note is logged on the recipe so agents can see it was re-filed.
        </p>

        <label className="text-label" htmlFor="move-dest">Destination recipe book</label>
        <select
          id="move-dest"
          value={destId}
          onChange={(e) => setDestId(e.target.value)}
          disabled={isLoading || pending}
          style={{
            width: "100%", padding: "var(--space-sm)", marginTop: "var(--space-xs)",
            marginBottom: "var(--space-lg)", borderRadius: "var(--radius-sm)",
            background: "var(--color-surface-container)",
            color: "var(--color-on-surface)",
            border: "1px solid var(--color-surface-container-high)",
          }}
        >
          <option value="">{isLoading ? "Loading…" : "Choose a recipe book…"}</option>
          {destinations.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        {evidence.length > 0 && (
          <>
            <p className="text-label" style={{ marginBottom: "var(--space-xs)" }}>
              Evidence to carry across
            </p>
            <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
              Un-check anything private to the current book — internal snippets, client details.
              Un-checked entries are <strong>permanently deleted</strong>, not hidden, along with any
              quote only they cite. The recipe loses that supporting evidence.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginBottom: "var(--space-lg)" }}>
              {evidence.map((e) => {
                const isDropped = dropped.has(e.id);
                return (
                  <label
                    key={e.id}
                    style={{
                      display: "flex", gap: "var(--space-sm)", alignItems: "flex-start",
                      padding: "var(--space-sm)", borderRadius: "var(--radius-sm)",
                      background: "var(--color-surface-container-lowest)",
                      opacity: isDropped ? 0.5 : 1,
                      cursor: pending ? "default" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!isDropped}
                      disabled={pending}
                      onChange={() => toggle(e.id)}
                      style={{ marginTop: "3px" }}
                    />
                    <span
                      className="text-xs"
                      style={{ textDecoration: isDropped ? "line-through" : "none" }}
                    >
                      {e.content.slice(0, 160)}{e.content.length > 160 ? "…" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        <label className="text-label" htmlFor="move-story">Note (optional)</label>
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", margin: "var(--space-xs) 0" }}>
          Logged as feedback on this recipe. Visible to anyone who can read the destination book.
        </p>
        <div
          style={{
            border: "1px solid var(--color-surface-container-high)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-surface-container)",
            padding: "var(--space-sm)",
            marginBottom: "var(--space-lg)",
          }}
        >
          <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
            {storyHead || "Choose a destination book first…"}
          </span>
          {destBook && (
            <input
              id="move-story"
              value={storyTail}
              onChange={(e) => setStoryTail(e.target.value)}
              disabled={pending}
              placeholder="it's useful to my collaborators"
              style={{
                width: "100%", marginTop: "var(--space-xs)", padding: "4px 0",
                background: "transparent", border: "none",
                borderBottom: "1px solid var(--color-surface-container-high)",
                color: "var(--color-on-surface)",
              }}
            />
          )}
        </div>

        {error && (
          <p className="text-xs" style={{ color: "var(--color-error)", marginBottom: "var(--space-md)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!destId || pending}
            onClick={() =>
              onConfirm({
                groupId: destId,
                story: storyTail.trim() ? `${storyHead}${storyTail.trim()}` : "",
                dropEvidenceIds: [...dropped],
              })
            }
          >
            {pending
              ? "Moving…"
              : redactCount > 0
                ? `Move and delete ${redactCount} evidence ${redactCount === 1 ? "entry" : "entries"}`
                : "Move recipe"}
          </button>
        </div>
      </div>
    </div>
  );
}
