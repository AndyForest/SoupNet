import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  AdminTable,
  type AdminColumn,
  type AdminStatus,
} from "../components/admin/index.js";

interface AdminUser {
  id: string;
  email: string;
  role: string;
  emailVerifiedAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  activeKeyCount: number;
  recipeCount: number;
  groupCount: number;
}

interface UsersResponse {
  users: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}

interface StatsResponse {
  totalUsers: number;
  verifiedUsers: number;
  suspendedUsers: number;
  totalRecipes: number;
  recipes24h: number;
  recipes7d: number;
  activeApiKeys: number;
  registrations7d: number;
  pendingInvitations: number;
  signupCap: number;
  signupCapUsed: number;
}

const PAGE_SIZE = 50;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function userStatus(u: AdminUser): { status: AdminStatus; label: string } {
  if (u.suspendedAt) return { status: "error", label: "Suspended" };
  if (!u.emailVerifiedAt) return { status: "warning", label: "Unverified" };
  return { status: "healthy", label: "Active" };
}

export function AdminUsersPage() {
  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as {
        ok: boolean;
        data?: { user: { id: string; email: string; role: string } };
      };
      if (!json.ok || !json.data) throw new Error("Failed");
      return json.data.user;
    },
  });

  const [q, setQ] = useState("");
  const [verified, setVerified] = useState("");
  const [suspended, setSuspended] = useState("");
  const [hasKeys, setHasKeys] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (verified) params.set("verified", verified);
  if (suspended) params.set("suspended", suspended);
  if (hasKeys) params.set("hasKeys", hasKeys);
  params.set("sortBy", sortBy);
  params.set("sortDir", sortDir);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));

  const usersQuery = useQuery({
    queryKey: ["admin", "users", params.toString()],
    queryFn: async () => {
      const res = await authFetch(`/admin/users?${params.toString()}`);
      const json = (await res.json()) as { ok: boolean; data?: UsersResponse; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Failed to load users");
      return json.data;
    },
    enabled: meQuery.data?.role === "system",
  });

  const statsQuery = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: async () => {
      const res = await authFetch("/admin/stats");
      const json = (await res.json()) as { ok: boolean; data?: StatsResponse; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Failed to load stats");
      return json.data;
    },
    enabled: meQuery.data?.role === "system",
  });

  if (meQuery.isLoading) {
    return <div style={{ padding: "var(--space-lg)" }}>Loading...</div>;
  }

  if (meQuery.data?.role !== "system") {
    return (
      <div style={{ padding: "var(--space-lg)", maxWidth: 600 }}>
        <h1>Admin</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-md)" }}>
          You don't have access to this page. System admin role required.
        </p>
      </div>
    );
  }

  const columns: AdminColumn<AdminUser>[] = [
    {
      key: "email",
      header: "Email",
      sortable: true,
      render: (u) => (
        <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{u.email}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (u) => {
        const s = userStatus(u);
        return <AdminStatusDot status={s.status} label={s.label} />;
      },
    },
    {
      key: "role",
      header: "Role",
      render: (u) => (
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "0.7rem",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: u.role === "system" ? "#89CEFF" : "var(--color-on-surface-variant)",
          }}
        >
          {u.role}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (u) => (
        <span style={{ color: "var(--color-on-surface-variant)" }}>{fmtDate(u.createdAt)}</span>
      ),
    },
    {
      key: "lastLoginAt",
      header: "Last login",
      sortable: true,
      render: (u) => (
        <span style={{ color: "var(--color-on-surface-variant)" }}>{fmtDate(u.lastLoginAt)}</span>
      ),
    },
    {
      key: "activeKeyCount",
      header: "Keys",
      align: "right",
      render: (u) => (
        <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{u.activeKeyCount}</span>
      ),
    },
    {
      key: "recipeCount",
      header: "Recipes",
      align: "right",
      render: (u) => (
        <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{u.recipeCount}</span>
      ),
    },
    {
      key: "groupCount",
      header: "Recipe books",
      align: "right",
      render: (u) => (
        <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{u.groupCount}</span>
      ),
    },
  ];

  const total = usersQuery.data?.total ?? 0;
  const rows = usersQuery.data?.users ?? [];
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  function resetOffset(fn: () => void) {
    setOffset(0);
    fn();
  }

  return (
    <AdminLayout>
      <AdminPageHeader title="User Management" subtitle="Oversight and abuse response for trusted-tier users." />

      <div
        style={{
          display: "flex",
          gap: "var(--space-sm)",
          padding: "0 var(--space-lg) var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <AdminMetricCard
          label="Users"
          value={statsQuery.data?.totalUsers ?? "—"}
          hint={
            statsQuery.data
              ? `${statsQuery.data.verifiedUsers} verified · ${statsQuery.data.suspendedUsers} suspended`
              : undefined
          }
        />
        <AdminMetricCard
          label="Recipes 24h"
          value={statsQuery.data?.recipes24h ?? "—"}
          hint={statsQuery.data ? `${statsQuery.data.totalRecipes} total` : undefined}
        />
        <AdminMetricCard
          label="Active keys"
          value={statsQuery.data?.activeApiKeys ?? "—"}
        />
        <AdminMetricCard
          label="Signup cap"
          value={
            statsQuery.data
              ? `${statsQuery.data.signupCapUsed} / ${statsQuery.data.signupCap}`
              : "—"
          }
          hint={statsQuery.data ? `${statsQuery.data.pendingInvitations} pending invites` : undefined}
        />
      </div>

      <AdminFilterBar>
        <AdminField label="Email">
          <AdminTextInput
            value={q}
            onChange={(v) => resetOffset(() => setQ(v))}
            placeholder="search…"
          />
        </AdminField>
        <AdminField label="Verified">
          <AdminSelect
            value={verified}
            onChange={(v) => resetOffset(() => setVerified(v))}
            options={[
              { value: "", label: "Any" },
              { value: "yes", label: "Verified" },
              { value: "no", label: "Unverified" },
            ]}
          />
        </AdminField>
        <AdminField label="Suspended">
          <AdminSelect
            value={suspended}
            onChange={(v) => resetOffset(() => setSuspended(v))}
            options={[
              { value: "", label: "Any" },
              { value: "no", label: "Active" },
              { value: "yes", label: "Suspended" },
            ]}
          />
        </AdminField>
        <AdminField label="Has keys">
          <AdminSelect
            value={hasKeys}
            onChange={(v) => resetOffset(() => setHasKeys(v))}
            options={[
              { value: "", label: "Any" },
              { value: "yes", label: "With keys" },
              { value: "no", label: "No keys" },
            ]}
          />
        </AdminField>
      </AdminFilterBar>

      <div style={{ padding: "var(--space-md) var(--space-lg) var(--space-lg)" }}>
        {usersQuery.isLoading ? (
          <div style={{ color: "var(--color-on-surface-variant)" }}>Loading users…</div>
        ) : usersQuery.error ? (
          <div style={{ color: "var(--color-error, #ef4444)" }}>
            {(usersQuery.error as Error).message}
          </div>
        ) : (
          <>
            <AdminTable
              rows={rows}
              columns={columns}
              rowKey={(u) => u.id}
              sortBy={sortBy}
              sortDir={sortDir}
              onSortChange={(nextBy, nextDir) => {
                setOffset(0);
                setSortBy(nextBy);
                setSortDir(nextDir);
              }}
              empty={
                <AdminEmptyState
                  title="No users match these filters"
                  body="Try clearing filters, or send an invitation to bring someone in."
                />
              }
            />
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
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  style={paginationButtonStyle(offset === 0)}
                >
                  ‹ Prev
                </button>
                <button
                  type="button"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  style={paginationButtonStyle(offset + PAGE_SIZE >= total)}
                >
                  Next ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

function paginationButtonStyle(disabled: boolean): React.CSSProperties {
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
