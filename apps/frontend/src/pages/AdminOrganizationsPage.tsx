import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { authFetch } from "../auth.js";
import {
  AdminLayout,
  AdminPageHeader,
  AdminEmptyState,
  AdminFilterBar,
  AdminField,
  AdminTextInput,
  AdminTable,
  AdminUsersTable,
  AdminPagination,
  fmtAdminDate,
  useAdminGate,
  useAdminListQuery,
  type AdminColumn,
} from "../components/admin/index.js";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
  created_at: string;
  owner_email: string;
  seat_limit: number | null;
  members: number;
  active_members: number;
}

async function send(path: string, method: string, body: unknown): Promise<void> {
  const res = await authFetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ok: boolean; message?: string; error?: string };
  if (!json.ok) throw new Error(json.message ?? json.error ?? "That didn't work.");
}

/**
 * The site operator's Organizations page (/admin/organizations): company
 * organizations with their seats, creating one with its first owner, and
 * setting the seat count (CN-S1; Core's routes).
 */
export function AdminOrganizationsPage() {
  const { gate, isAdmin } = useAdminGate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", slug: "", ownerEmail: "", seatLimit: "" });

  const orgs = useAdminListQuery<OrgRow[]>({
    queryKey: ["admin", "organizations"],
    path: "/admin/organizations",
    enabled: isAdmin,
    failure: "Failed to load organizations",
  });

  const create = useMutation({
    mutationFn: () =>
      send("/admin/organizations", "POST", {
        name: form.name,
        slug: form.slug,
        ownerEmail: form.ownerEmail,
        seatLimit: form.seatLimit ? Number(form.seatLimit) : null,
      }),
    onSuccess: () => setForm({ name: "", slug: "", ownerEmail: "", seatLimit: "" }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] }),
  });

  const seats = useMutation({
    mutationFn: ({ id, seatLimit }: { id: string; seatLimit: number | null }) => send(`/admin/organizations/${id}`, "PATCH", { seatLimit }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] }),
  });

  if (gate) return gate;

  const companies = (orgs.data ?? []).filter((o) => !o.is_personal);
  const columns: AdminColumn<OrgRow>[] = [
    {
      key: "name",
      header: "Organization",
      render: (o) => <Link to="/admin/organizations/$orgId" params={{ orgId: o.id }}>{o.name}</Link>,
    },
    {
      key: "seatLimit",
      header: "Seat limit",
      render: (o) => (
        <input
          aria-label={`Seat limit for ${o.name}`}
          type="number"
          min={1}
          defaultValue={o.seat_limit ?? ""}
          placeholder="none"
          style={{ width: "6rem", padding: "0.15rem 0.4rem" }}
          onBlur={(e) => {
            const next = e.target.value === "" ? null : Number(e.target.value);
            if (next !== o.seat_limit) seats.mutate({ id: o.id, seatLimit: next });
          }}
        />
      ),
    },
    { key: "owner", header: "Owner", render: (o) => <span>{o.owner_email}</span> },
    { key: "members", header: "Members", align: "right", render: (o) => <span>{o.members}</span> },
    {
      key: "seats",
      header: "Seats used",
      align: "right",
      render: (o) => <span>{o.active_members}{o.seat_limit === null ? "" : ` / ${o.seat_limit}`}</span>,
    },
    { key: "created", header: "Created", render: (o) => <span>{fmtAdminDate(o.created_at)}</span> },
  ];

  return (
    <AdminLayout>
      <AdminPageHeader title="Organizations" subtitle="Company organizations, their seats, and their first owners." />

      <AdminFilterBar>
        <AdminField label="Name">
          <AdminTextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Acme" />
        </AdminField>
        <AdminField label="Slug">
          <AdminTextInput value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} placeholder="acme" />
        </AdminField>
        <AdminField label="Owner's email (an existing account)">
          <AdminTextInput value={form.ownerEmail} onChange={(v) => setForm({ ...form, ownerEmail: v })} placeholder="owner@acme.example" />
        </AdminField>
        <AdminField label="Seats">
          <AdminTextInput value={form.seatLimit} onChange={(v) => setForm({ ...form, seatLimit: v })} placeholder="none" />
        </AdminField>
        <button disabled={create.isPending || !form.name || !form.slug || !form.ownerEmail} onClick={() => create.mutate()}>
          Create organization
        </button>
      </AdminFilterBar>
      {create.error ? <div role="alert" style={{ color: "var(--color-error, #ef4444)", padding: "0 var(--space-lg)" }}>{(create.error as Error).message}</div> : null}
      {seats.error ? <div role="alert" style={{ color: "var(--color-error, #ef4444)", padding: "0 var(--space-lg)" }}>{(seats.error as Error).message}</div> : null}

      <div style={{ padding: "var(--space-md) var(--space-lg) var(--space-lg)" }}>
        <AdminTable
          rows={companies}
          columns={columns}
          rowKey={(o) => o.id}
          empty={<AdminEmptyState title="No company organizations yet" body="Create one above; its owner must already have an account." />}
        />
      </div>
    </AdminLayout>
  );
}

const PAGE_SIZE = 50;

/** One organization's members as the site operator sees them: every column (CN-S1). */
export function AdminOrganizationMembersPage() {
  const { orgId } = useParams({ strict: false }) as { orgId: string };
  const { gate, isAdmin } = useAdminGate();
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  const members = useAdminListQuery<{ users: Array<Record<string, unknown> & { id: string }>; total: number }>({
    queryKey: ["admin", "organizations", orgId, "members"],
    path: `/admin/organizations/${orgId}/members`,
    params,
    enabled: isAdmin,
    failure: "Failed to load members",
  });

  if (gate) return gate;

  return (
    <AdminLayout>
      <AdminPageHeader title="Organization members" subtitle="Every column, as the site operator sees them." />
      <div style={{ padding: "var(--space-md) var(--space-lg) var(--space-lg)" }}>
        <p><Link to="/admin/organizations">All organizations</Link></p>
        {members.error ? (
          <div style={{ color: "var(--color-error, #ef4444)" }}>{(members.error as Error).message}</div>
        ) : (
          <>
            <AdminUsersTable
              viewer="site"
              listing="organization"
              show={["email", "status", "orgRole", "joinedVia", "joinedAt", "lastActiveAt", "recipeCount", "privateBookCount", "orgWideBookCount", "activeKeyCount", "suspendedReason", "premiumAt"]}
              rows={members.data?.users ?? []}
              empty={<AdminEmptyState title="No members" body="Add an existing account through the organization's join." />}
            />
            <AdminPagination total={members.data?.total ?? 0} offset={offset} pageSize={PAGE_SIZE} onOffsetChange={setOffset} />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
