import type { ReactNode } from "react";

export interface AdminColumn<Row> {
  key: string;
  header: string;
  sortable?: boolean;
  width?: string | number;
  align?: "left" | "right" | "center";
  render: (row: Row) => ReactNode;
}

interface AdminTableProps<Row> {
  rows: Row[];
  columns: AdminColumn<Row>[];
  rowKey: (row: Row) => string;
  sortBy?: string | undefined;
  sortDir?: "asc" | "desc" | undefined;
  onSortChange?: ((sortBy: string, sortDir: "asc" | "desc") => void) | undefined;
  empty?: ReactNode | undefined;
}

export function AdminTable<Row>({
  rows,
  columns,
  rowKey,
  sortBy,
  sortDir,
  onSortChange,
  empty,
}: AdminTableProps<Row>) {
  function handleHeaderClick(col: AdminColumn<Row>) {
    if (!col.sortable || !onSortChange) return;
    if (sortBy === col.key) {
      onSortChange(col.key, sortDir === "asc" ? "desc" : "asc");
    } else {
      onSortChange(col.key, "desc");
    }
  }

  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.8125rem",
          color: "var(--color-on-surface)",
        }}
      >
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sortBy === col.key;
              const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
              return (
                <th
                  key={col.key}
                  onClick={() => handleHeaderClick(col)}
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "var(--color-surface-container-low)",
                    textAlign: col.align ?? "left",
                    padding: "0.6rem 0.75rem",
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: "0.7rem",
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--color-on-surface-variant)",
                    cursor: col.sortable ? "pointer" : "default",
                    width: col.width,
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col.header}
                  {arrow}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              style={{ transition: "background 0.1s" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background =
                  "var(--color-surface-container-low)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = "transparent";
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={{
                    padding: "0.55rem 0.75rem",
                    textAlign: col.align ?? "left",
                    verticalAlign: "middle",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
