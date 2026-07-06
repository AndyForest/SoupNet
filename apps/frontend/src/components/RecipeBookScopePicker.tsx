import type { Dispatch, SetStateAction } from "react";

/**
 * Shared recipe-book read/write/default-write scope picker. Extracted from
 * ApiKeysPage (2026-07-06) so the OAuth consent screen (OAuthAuthorizePage)
 * doesn't drift behind it — operator flagged the consent screen was missing
 * the select-all/none column headers and left the default-write radio empty
 * with no explanation for why Authorize stayed disabled.
 *
 * The pure selection-logic functions below are exported and unit-tested
 * independently of React (recipe-book-scope-logic.test.ts).
 */

export interface RecipeBookScopeOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface ScopeState {
  readIds: string[];
  writeIds: string[];
  defaultWriteId: string;
}

// ── Pure selection logic ─────────────────────────────────────────────────
//
// `enforceWriteImpliesRead` preserves each page's pre-extraction behavior
// exactly: the API Keys page allows a scoped key to write without read
// (matches the backend, which does not require write ⊆ read for /keys/scoped),
// while the OAuth consent screen has always required write access to imply
// read access (an agent that can write a book but never read it back is a
// confusing grant to reason about when picking what to share with a third
// party). Rather than duplicate the picker to preserve that one difference,
// it's a flag.

export function toggleReadId(state: ScopeState, id: string, enforceWriteImpliesRead: boolean): ScopeState {
  const isRemoving = state.readIds.includes(id);
  const nextRead = isRemoving ? state.readIds.filter((x) => x !== id) : [...state.readIds, id];

  if (!enforceWriteImpliesRead || !isRemoving) {
    return { ...state, readIds: nextRead };
  }

  // Removing id from read while write must stay a subset of read — drop it
  // from write too, and move the default off it if it was the default.
  const nextWrite = state.writeIds.filter((x) => x !== id);
  const nextDefault = state.defaultWriteId === id ? (nextWrite[0] ?? "") : state.defaultWriteId;
  return { readIds: nextRead, writeIds: nextWrite, defaultWriteId: nextDefault };
}

export function toggleWriteId(state: ScopeState, id: string, enforceWriteImpliesRead: boolean): ScopeState {
  const isRemoving = state.writeIds.includes(id);
  const nextWrite = isRemoving ? state.writeIds.filter((x) => x !== id) : [...state.writeIds, id];

  if (isRemoving) {
    // Un-checked this book. If it was the default, move default to whatever
    // write book remains (empty = no default) rather than leaving it blank —
    // the operator-flagged bug: a blank default silently disables Authorize.
    const nextDefault = state.defaultWriteId === id ? (nextWrite[0] ?? "") : state.defaultWriteId;
    return { ...state, writeIds: nextWrite, defaultWriteId: nextDefault };
  }

  // Just checked this book. If there's no default yet, adopt this one so the
  // default radio has a useful value immediately instead of staying empty.
  const nextRead = enforceWriteImpliesRead && !state.readIds.includes(id)
    ? [...state.readIds, id]
    : state.readIds;
  const nextDefault = state.defaultWriteId || id;
  return { readIds: nextRead, writeIds: nextWrite, defaultWriteId: nextDefault };
}

export function selectAllRead(state: ScopeState, allIds: string[], enforceWriteImpliesRead: boolean): ScopeState {
  const allSelected = allIds.length > 0 && allIds.every((id) => state.readIds.includes(id));
  if (allSelected) {
    if (!enforceWriteImpliesRead) return { ...state, readIds: [] };
    // Write must remain a subset of read — clearing all read clears write too.
    return { readIds: [], writeIds: [], defaultWriteId: "" };
  }
  return { ...state, readIds: [...allIds] };
}

export function selectAllWrite(state: ScopeState, allIds: string[], enforceWriteImpliesRead: boolean): ScopeState {
  const allSelected = allIds.length > 0 && allIds.every((id) => state.writeIds.includes(id));
  if (allSelected) {
    return { ...state, writeIds: [], defaultWriteId: "" };
  }
  const nextRead = enforceWriteImpliesRead
    ? [...new Set([...state.readIds, ...allIds])]
    : state.readIds;
  const nextDefault = state.defaultWriteId && allIds.includes(state.defaultWriteId)
    ? state.defaultWriteId
    : (allIds[0] ?? "");
  return { readIds: nextRead, writeIds: [...allIds], defaultWriteId: nextDefault };
}

// ── Component ─────────────────────────────────────────────────────────────

export interface RecipeBookScopePickerProps {
  books: RecipeBookScopeOption[];
  readIds: string[];
  writeIds: string[];
  defaultWriteId: string;
  setReadIds: Dispatch<SetStateAction<string[]>>;
  setWriteIds: Dispatch<SetStateAction<string[]>>;
  setDefaultWriteId: Dispatch<SetStateAction<string>>;
  /**
   * When true, write access implies read access (OAuth consent screen). When
   * false (default), read and write are independent (API Keys page — matches
   * the backend's /keys/scoped contract).
   */
  enforceWriteImpliesRead?: boolean;
  /** Label above the picker. Defaults to "Recipe book permissions". */
  label?: string;
}

export function RecipeBookScopePicker({
  books,
  readIds,
  writeIds,
  defaultWriteId,
  setReadIds,
  setWriteIds,
  setDefaultWriteId,
  enforceWriteImpliesRead = false,
  label = "Recipe book permissions",
}: RecipeBookScopePickerProps) {
  const state: ScopeState = { readIds, writeIds, defaultWriteId };
  const allIds = books.map((b) => b.id);
  const allReadSelected = books.length > 0 && books.every((b) => readIds.includes(b.id));
  const allWriteSelected = books.length > 0 && books.every((b) => writeIds.includes(b.id));
  const gridCols = "minmax(0, 1fr) 70px 70px 70px";

  function applyRead(id: string) {
    const next = toggleReadId(state, id, enforceWriteImpliesRead);
    setReadIds(next.readIds);
    setWriteIds(next.writeIds);
    setDefaultWriteId(next.defaultWriteId);
  }

  function applyWrite(id: string) {
    const next = toggleWriteId(state, id, enforceWriteImpliesRead);
    setReadIds(next.readIds);
    setWriteIds(next.writeIds);
    setDefaultWriteId(next.defaultWriteId);
  }

  function applySelectAllRead() {
    const next = selectAllRead(state, allIds, enforceWriteImpliesRead);
    setReadIds(next.readIds);
    setWriteIds(next.writeIds);
    setDefaultWriteId(next.defaultWriteId);
  }

  function applySelectAllWrite() {
    const next = selectAllWrite(state, allIds, enforceWriteImpliesRead);
    setReadIds(next.readIds);
    setWriteIds(next.writeIds);
    setDefaultWriteId(next.defaultWriteId);
  }

  if (books.length === 0) return null;

  return (
    <div>
      <label className="text-label" style={{ marginBottom: "var(--space-xs)", display: "block" }}>{label}</label>

      {books.length > 1 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          gap: "var(--space-sm)",
          alignItems: "center",
          padding: "0 var(--space-md) var(--space-xs)",
        }}>
          <span></span>
          <div className="text-xs" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", color: "var(--color-on-surface-variant)" }}>
            <span>Read</span>
            <button type="button" className="btn-ghost" style={{ fontSize: "0.7rem", padding: "1px 6px" }} onClick={applySelectAllRead}>
              {allReadSelected ? "none" : "all"}
            </button>
          </div>
          <div className="text-xs" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", color: "var(--color-on-surface-variant)" }}>
            <span>Write</span>
            <button type="button" className="btn-ghost" style={{ fontSize: "0.7rem", padding: "1px 6px" }} onClick={applySelectAllWrite}>
              {allWriteSelected ? "none" : "all"}
            </button>
          </div>
          <span className="text-xs" style={{ textAlign: "center", color: "var(--color-on-surface-variant)" }}>Default</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        {books.map((b) => {
          const hasRead = readIds.includes(b.id);
          const hasWrite = writeIds.includes(b.id);
          const isDefault = defaultWriteId === b.id;
          return (
            <div
              key={b.id}
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                gap: "var(--space-sm)",
                alignItems: "center",
                padding: "var(--space-sm) var(--space-md)",
                background: hasRead || hasWrite ? "var(--color-surface-container)" : "var(--color-surface-container-low)",
                borderRadius: "var(--radius-sm)",
                border: isDefault ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>{b.name}</span>
                {b.description && (
                  <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.description}
                  </p>
                )}
              </div>
              <label style={{ display: "flex", justifyContent: "center", fontSize: "0.8rem", cursor: "pointer" }}>
                <input type="checkbox" checked={hasRead} onChange={() => applyRead(b.id)} aria-label={`Read access to ${b.name}`} />
              </label>
              <label style={{ display: "flex", justifyContent: "center", fontSize: "0.8rem", cursor: "pointer" }}>
                <input type="checkbox" checked={hasWrite} onChange={() => applyWrite(b.id)} aria-label={`Write access to ${b.name}`} />
              </label>
              <div style={{ display: "flex", justifyContent: "center" }}>
                {hasWrite ? (
                  <label style={{ display: "flex", alignItems: "center", cursor: "pointer", color: isDefault ? "var(--color-primary)" : "inherit" }}>
                    <input
                      type="radio"
                      name="defaultWriteRecipeBook"
                      checked={isDefault}
                      onChange={() => setDefaultWriteId(b.id)}
                      aria-label={`Default write to ${b.name}`}
                    />
                  </label>
                ) : (
                  <span className="text-xs" style={{ color: "var(--color-outline-variant)" }}>—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)" }}>
        Default write recipe book is where recipes go unless the agent specifies otherwise.
      </p>
    </div>
  );
}
