import type { ReactNode } from "react";
import { columnsFor } from "@soupnet/domain";
import type { AdminListing, AdminViewer } from "@soupnet/domain";
import { AdminTable, type AdminColumn } from "./AdminTable.js";

/**
 * The users table the site console and the org console share (CN-M4, recipe
 * 1fa21e31). Its columns come from the domain column sets (`columnsFor`), so a
 * page can choose which of its viewer's columns to show and in what order,
 * but can't show one outside them; a key it asks for that the viewer isn't
 * entitled to is dropped. The backend applies the same sets to what it sends,
 * which is what actually protects a column; this keeps the two consoles from
 * drifting apart.
 *
 * Pages add their own row actions as `extra` columns and override how a
 * column renders or is titled where their page needs it.
 */
interface AdminUsersTableProps<Row extends { id: string }> {
  viewer: AdminViewer;
  listing: AdminListing;
  /** Column keys to show, in order. */
  show: readonly string[];
  rows: Row[];
  /** How a column renders, where the default (text, date or count) doesn't fit. */
  render?: Partial<Record<string, (row: Row) => ReactNode>>;
  /** Header text, where a page titles a column differently from its label. */
  headers?: Partial<Record<string, string>>;
  /** Columns that aren't data, such as row actions, appended after the data columns. */
  extra?: AdminColumn<Row>[];
  /** Column keys the backend can sort by. */
  sortable?: readonly string[];
  sortBy?: string | undefined;
  sortDir?: "asc" | "desc" | undefined;
  onSortChange?: ((sortBy: string, sortDir: "asc" | "desc") => void) | undefined;
  empty?: ReactNode | undefined;
}

const MONO = { fontFamily: "'Space Grotesk', sans-serif" } as const;
const MUTED = { color: "var(--color-on-surface-variant)" } as const;

export function fmtAdminDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function defaultRender(key: string, value: unknown): ReactNode {
  if (typeof value === "number") return <span style={MONO}>{value}</span>;
  if (key.endsWith("At")) return <span style={MUTED}>{fmtAdminDate(value as string | null)}</span>;
  if (value === null || value === undefined || value === "") return <span style={MUTED}>—</span>;
  return <span>{String(value)}</span>;
}

export function AdminUsersTable<Row extends { id: string }>({
  viewer,
  listing,
  show,
  rows,
  render = {},
  headers = {},
  extra = [],
  sortable = [],
  sortBy,
  sortDir,
  onSortChange,
  empty,
}: AdminUsersTableProps<Row>) {
  const allowed = new Map(columnsFor(viewer, listing).map((c) => [c.key, c]));

  const columns: AdminColumn<Row>[] = show.flatMap((key) => {
    const column = allowed.get(key);
    if (!column) return [];
    const custom = render[key];
    return [
      {
        key,
        header: headers[key] ?? column.label,
        sortable: sortable.includes(key),
        align: rows.some((r) => typeof (r as Record<string, unknown>)[key] === "number") ? "right" : "left",
        render: (row: Row) => (custom ? custom(row) : defaultRender(key, (row as Record<string, unknown>)[key])),
      } satisfies AdminColumn<Row>,
    ];
  });

  return (
    <AdminTable
      rows={rows}
      columns={[...columns, ...extra]}
      rowKey={(r) => r.id}
      sortBy={sortBy}
      sortDir={sortDir}
      onSortChange={onSortChange}
      empty={empty}
    />
  );
}
