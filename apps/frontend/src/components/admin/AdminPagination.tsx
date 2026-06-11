import type { CSSProperties } from "react";

interface AdminPaginationProps {
  total: number;
  offset: number;
  pageSize: number;
  onOffsetChange: (offset: number) => void;
}

// Style lifted verbatim from the original AdminUsersPage pagination — the
// incumbent admin design language.
function buttonStyle(disabled: boolean): CSSProperties {
  return {
    background: "var(--color-surface-container-low)",
    color: disabled ? "var(--color-on-surface-variant)" : "var(--color-on-surface)",
    border: "none",
    padding: "0.4rem 0.75rem",
    fontFamily: "inherit",
    fontSize: "0.75rem",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer",
    borderRadius: 0,
    opacity: disabled ? 0.5 : 1,
  };
}

/** Standard footer for paginated admin tables: "x–y of z" + Prev/Next. */
export function AdminPagination({ total, offset, pageSize, onOffsetChange }: AdminPaginationProps) {
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + pageSize, total);
  const prevDisabled = offset === 0;
  const nextDisabled = offset + pageSize >= total;

  return (
    <div
      style={{
        marginTop: "var(--space-md)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: "0.75rem",
        color: "var(--color-on-surface-variant)",
      }}
    >
      <div>
        {pageStart}–{pageEnd} of {total}
      </div>
      <div style={{ display: "flex", gap: "var(--space-xs)" }}>
        <button
          type="button"
          disabled={prevDisabled}
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
          style={buttonStyle(prevDisabled)}
        >
          ‹ Prev
        </button>
        <button
          type="button"
          disabled={nextDisabled}
          onClick={() => onOffsetChange(offset + pageSize)}
          style={buttonStyle(nextDisabled)}
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
