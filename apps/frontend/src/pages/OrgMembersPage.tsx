import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ADMIN_USER_STATUS_LABELS, orgActionRefusal } from "@soupnet/domain";
import type { AdminUserStatus, OrgMemberAction, OrgRole } from "@soupnet/domain";
import { authFetch } from "../auth.js";
import {
  AdminLayout,
  AdminPageHeader,
  AdminMetricCard,
  AdminStatusDot,
  AdminEmptyState,
  AdminFilterBar,
  AdminField,
  AdminTextInput,
  AdminSelect,
  AdminUsersTable,
  AdminPagination,
  useAdminGate,
  useAdminListQuery,
  type AdminStatus,
} from "../components/admin/index.js";

/** A member row as GET /organizations/:id/members returns it (the org column set). */
interface MemberRow {
  id: string;
  email: string;
  displayName: string | null;
  status: AdminUserStatus;
  orgRole: OrgRole;
  joinedVia: string;
  joinedAt: string;
  lastActiveAt: string | null;
  recipeCount: number;
  activeKeyCount: number;
  privateBookCount: number;
  orgWideBookCount: number;
}

interface MembersResponse {
  users: MemberRow[];
  total: number;
}

interface OrgOverview {
  name: string;
  yourRole: "owner" | "admin";
  seatLimit: number | null;
  members: number;
  activeMembers: number;
}

const PAGE_SIZE = 50;

const STATUS_DOT: Record<AdminUserStatus, AdminStatus> = { active: "healthy", disabled: "warning", suspended: "error" };

const JOINED_VIA: Record<string, string> = {
  created: "Named at creation",
  operator: "Added by Soup.net",
  domain: "Email domain",
  migrated: "Existing account",
};

/**
 * The org console's Members page (/org): every member with aggregates only,
 * and the actions an owner or admin may take on each (CN-U1 to CN-U4). The
 * columns come from the domain's org column set through AdminUsersTable.
 */
export function OrgMembersPage() {
  const { gate, isAdmin, me, organizationId } = useAdminGate("org");
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [orgRole, setOrgRole] = useState("");
  const [sortBy, setSortBy] = useState("joinedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (orgRole) params.set("orgRole", orgRole);
  params.set("sortBy", sortBy);
  params.set("sortDir", sortDir);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));

  const enabled = isAdmin && organizationId !== null;
  const overview = useAdminListQuery<OrgOverview>({
    queryKey: ["org", organizationId, "overview"],
    path: `/organizations/${organizationId}`,
    enabled,
    failure: "Failed to load the organization",
  });
  const members = useAdminListQuery<MembersResponse>({
    queryKey: ["org", organizationId, "members"],
    path: `/organizations/${organizationId}/members`,
    params,
    enabled,
    failure: "Failed to load members",
  });

  const act = useMutation({
    mutationFn: async ({ userId, action }: { userId: string; action: OrgMemberAction }) => {
      const base = `/organizations/${organizationId}/members/${userId}`;
      const res =
        action.kind === "set_role"
          ? await authFetch(base, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: action.role }) })
          : await authFetch(`${base}/${action.kind}`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (!json.ok) throw new Error(json.message ?? json.error ?? "That didn't work.");
    },
    onMutate: () => setActionError(null),
    onError: (err) => setActionError((err as Error).message),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["org", organizationId] });
    },
  });

  if (gate) return gate;

  const yourRole = overview.data?.yourRole ?? null;
  const allowed = (row: MemberRow, action: OrgMemberAction) =>
    orgActionRefusal(yourRole, row.orgRole, action, row.id === me?.id) === null;

  const rows = members.data?.users ?? [];

  function resetOffset(fn: () => void) {
    setOffset(0);
    fn();
  }

  return (
    <AdminLayout scope="org" heading={overview.data?.name}>
      <AdminPageHeader title="Members" subtitle="Who is in the organization and how much each person uses it. Private books are counted, never named." />

      <div style={{ display: "flex", gap: "var(--space-sm)", padding: "0 var(--space-lg) var(--space-md)", flexWrap: "wrap" }}>
        <AdminMetricCard label="Members" value={overview.data?.members ?? "—"} />
        <AdminMetricCard
          label="Seats in use"
          value={overview.data ? `${overview.data.activeMembers}${overview.data.seatLimit === null ? "" : ` / ${overview.data.seatLimit}`}` : "—"}
          hint="Disabled members don't take a seat. Soup.net sets the seat count."
        />
      </div>

      <AdminFilterBar>
        <AdminField label="Email">
          <AdminTextInput value={q} onChange={(v) => resetOffset(() => setQ(v))} placeholder="search…" />
        </AdminField>
        <AdminField label="Status">
          <AdminSelect
            value={status}
            onChange={(v) => resetOffset(() => setStatus(v))}
            options={[
              { value: "", label: "Any" },
              { value: "active", label: ADMIN_USER_STATUS_LABELS.active },
              { value: "disabled", label: ADMIN_USER_STATUS_LABELS.disabled },
              { value: "suspended", label: ADMIN_USER_STATUS_LABELS.suspended },
            ]}
          />
        </AdminField>
        <AdminField label="Role">
          <AdminSelect
            value={orgRole}
            onChange={(v) => resetOffset(() => setOrgRole(v))}
            options={[
              { value: "", label: "Any" },
              { value: "owner", label: "Owner" },
              { value: "admin", label: "Admin" },
              { value: "member", label: "Member" },
            ]}
          />
        </AdminField>
      </AdminFilterBar>

      <div style={{ padding: "var(--space-md) var(--space-lg) var(--space-lg)" }}>
        {actionError ? (
          <div role="alert" style={{ color: "var(--color-error, #ef4444)", marginBottom: "var(--space-sm)" }}>{actionError}</div>
        ) : null}
        {members.isLoading ? (
          <div style={{ color: "var(--color-on-surface-variant)" }}>Loading members…</div>
        ) : members.error ? (
          <div style={{ color: "var(--color-error, #ef4444)" }}>{(members.error as Error).message}</div>
        ) : (
          <>
            <AdminUsersTable
              viewer="org"
              listing="organization"
              show={["email", "displayName", "status", "orgRole", "joinedVia", "joinedAt", "lastActiveAt", "recipeCount", "privateBookCount", "orgWideBookCount", "activeKeyCount"]}
              rows={rows}
              sortable={["email", "joinedAt", "lastActiveAt"]}
              sortBy={sortBy}
              sortDir={sortDir}
              onSortChange={(nextBy, nextDir) => {
                setOffset(0);
                setSortBy(nextBy);
                setSortDir(nextDir);
              }}
              render={{
                status: (u) => <AdminStatusDot status={STATUS_DOT[u.status]} label={ADMIN_USER_STATUS_LABELS[u.status]} />,
                joinedVia: (u) => <span>{JOINED_VIA[u.joinedVia] ?? u.joinedVia}</span>,
                orgRole: (u) => {
                  const options = (["owner", "admin", "member"] as const).filter(
                    (r) => r === u.orgRole || allowed(u, { kind: "set_role", role: r }),
                  );
                  if (options.length < 2) return <span style={{ textTransform: "capitalize" }}>{u.orgRole}</span>;
                  return (
                    <select
                      aria-label={`Role for ${u.email}`}
                      value={u.orgRole}
                      disabled={act.isPending}
                      onChange={(e) => act.mutate({ userId: u.id, action: { kind: "set_role", role: e.target.value as OrgRole } })}
                    >
                      {options.map((r) => (
                        <option key={r} value={r}>{r[0]!.toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  );
                },
              }}
              extra={[
                {
                  key: "actions",
                  header: "",
                  render: (u) => {
                    // A site suspension is Soup.net's, so the org's switch can't lift it.
                    if (u.status === "suspended") return null;
                    const action: OrgMemberAction = u.status === "disabled" ? { kind: "enable" } : { kind: "disable" };
                    if (!allowed(u, action)) return null;
                    return (
                      <button
                        className="btn-secondary"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ userId: u.id, action })}
                        style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}
                        title={action.kind === "disable"
                          ? "Stops their sign-in and every API key at once. Re-enable to restore the same keys."
                          : "Restores their sign-in and the same API keys."}
                      >
                        {action.kind === "disable" ? "Disable" : "Re-enable"}
                      </button>
                    );
                  },
                },
              ]}
              empty={<AdminEmptyState title="No members match these filters" body="Try clearing the filters." />}
            />
            <AdminPagination total={members.data?.total ?? 0} offset={offset} pageSize={PAGE_SIZE} onOffsetChange={setOffset} />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
