import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "../auth.js";
import {
  AdminLayout,
  AdminPageHeader,
  AdminFilterBar,
  AdminField,
  AdminTextInput,
  AdminSelect,
  AdminTable,
  AdminEmptyState,
  AdminPagination,
  useAdminGate,
  type AdminColumn,
} from "../components/admin/index.js";

interface EmailLogRow {
  id: string;
  toEmail: string;
  kind: string;
  subject: string;
  status: string;
  error: string | null;
  createdAt: string;
}

interface EmailsResponse {
  emails: EmailLogRow[];
  total: number;
  limit: number;
  offset: number;
  sortDir: "asc" | "desc";
}

// Mirrors the EmailKind union in apps/backend/src/services/email.service.ts.
// Doubles as the filter options and the always-visible "what sends email"
// explainer — when adding a kind to the backend, add it here too.
const EMAIL_KINDS: Array<{ value: string; label: string; trigger: string }> = [
  { value: "verification", label: "Verification", trigger: "sent when someone registers (or re-requests the link)" },
  { value: "password_reset", label: "Password reset", trigger: "sent from the forgot-password flow" },
  { value: "waitlist_spot_open", label: "Waitlist spot open", trigger: "sent by the Notify action on the Signups page" },
  { value: "invitation", label: "Invitation", trigger: "currently unused — admin invites return a link to share manually" },
];

const PAGE_SIZE = 50;

export function AdminEmailsPage() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);

  const { gate, isAdmin } = useAdminGate();

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (kind) params.set("kind", kind);
  if (status) params.set("status", status);
  params.set("sortDir", sortDir);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));

  const emailsQuery = useQuery({
    queryKey: ["admin", "emails", params.toString()],
    queryFn: async () => {
      const res = await authFetch(`/admin/emails?${params.toString()}`);
      const json = (await res.json()) as { ok: boolean; data?: EmailsResponse; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Failed to load the email log");
      return json.data;
    },
    enabled: isAdmin,
  });

  if (gate) return gate;

  function resetOffset(fn: () => void) {
    setOffset(0);
    fn();
  }

  const columns: AdminColumn<EmailLogRow>[] = [
    {
      key: "createdAt",
      header: "Sent",
      sortable: true,
      render: (row) => (
        <span style={{ color: "var(--color-on-surface-variant)" }}>
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "toEmail",
      header: "To",
      render: (row) => (
        <a href={`mailto:${row.toEmail}`} style={{ color: "var(--color-on-surface)" }}>
          {row.toEmail}
        </a>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      render: (row) => (
        <span style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: "0.7rem",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--color-on-surface-variant)",
        }}>
          {row.kind}
        </span>
      ),
    },
    { key: "subject", header: "Subject", render: (row) => row.subject },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span
          title={row.error ?? ""}
          style={{
            color: row.status === "sent" ? "var(--color-success)" : "var(--color-error)",
            fontWeight: 500,
          }}
        >
          {row.status}
          {row.error ? " ⓘ" : ""}
        </span>
      ),
    },
  ];

  const total = emailsQuery.data?.total ?? 0;
  const rows = emailsQuery.data?.emails ?? [];

  return (
    <AdminLayout>
      <AdminPageHeader
        title="Emails"
        subtitle="Every email the system sends — metadata only, never bodies. Kept 60 days, then purged."
      />

      <div style={{
        padding: "0 var(--space-lg) var(--space-md)",
        fontSize: "0.8125rem",
        color: "var(--color-on-surface-variant)",
        maxWidth: 720,
      }}>
        <span style={{ fontWeight: 500, color: "var(--color-on-surface)" }}>What sends email: </span>
        {EMAIL_KINDS.map((k, i) => (
          <span key={k.value}>
            <strong>{k.label}</strong> — {k.trigger}
            {i < EMAIL_KINDS.length - 1 ? "; " : "."}
          </span>
        ))}
      </div>

      <AdminFilterBar>
        <AdminField label="Recipient">
          <AdminTextInput
            value={q}
            onChange={(v) => resetOffset(() => setQ(v))}
            placeholder="search…"
          />
        </AdminField>
        <AdminField label="Kind">
          <AdminSelect
            value={kind}
            onChange={(v) => resetOffset(() => setKind(v))}
            options={[
              { value: "", label: "Any" },
              ...EMAIL_KINDS.map((k) => ({ value: k.value, label: k.label })),
            ]}
          />
        </AdminField>
        <AdminField label="Status">
          <AdminSelect
            value={status}
            onChange={(v) => resetOffset(() => setStatus(v))}
            options={[
              { value: "", label: "Any" },
              { value: "sent", label: "Sent" },
              { value: "failed", label: "Failed" },
            ]}
          />
        </AdminField>
      </AdminFilterBar>

      <div style={{ padding: "var(--space-md) var(--space-lg) var(--space-lg)" }}>
        {emailsQuery.isLoading ? (
          <div style={{ color: "var(--color-on-surface-variant)" }}>Loading email log…</div>
        ) : emailsQuery.error ? (
          <div style={{ color: "var(--color-error, #ef4444)" }}>
            {(emailsQuery.error as Error).message}
          </div>
        ) : (
          <>
            <AdminTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              sortBy="createdAt"
              sortDir={sortDir}
              onSortChange={(_by, nextDir) => {
                setOffset(0);
                setSortDir(nextDir);
              }}
              empty={
                <AdminEmptyState
                  title="No emails match these filters"
                  body={total === 0 && !q && !kind && !status
                    ? "Nothing has been sent yet (or everything sent has aged past the 60-day retention)."
                    : "Try clearing the filters."}
                />
              }
            />
            <AdminPagination
              total={total}
              offset={offset}
              pageSize={PAGE_SIZE}
              onOffsetChange={setOffset}
            />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
