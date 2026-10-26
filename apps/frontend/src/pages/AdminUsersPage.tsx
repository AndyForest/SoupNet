import { useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

interface AdminUser {
  id: string;
  email: string;
  role: string;
  emailVerifiedAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  waitlistedAt: string | null;
  premiumAt: string | null;
  signupReason: string | null;
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

function userStatus(u: AdminUser): { status: AdminStatus; label: string } {
  if (u.suspendedAt) return { status: "error", label: "Suspended" };
  if (u.waitlistedAt) return { status: "warning", label: "Waitlisted" };
  if (!u.emailVerifiedAt) return { status: "warning", label: "Unverified" };
  return { status: "healthy", label: "Active" };
}

export function AdminUsersPage() {
  const { gate, isAdmin } = useAdminGate();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [verified, setVerified] = useState("");
  const [suspended, setSuspended] = useState("");
  const [premium, setPremium] = useState("");
  const [hasKeys, setHasKeys] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (verified) params.set("verified", verified);
  if (suspended) params.set("suspended", suspended);
  if (premium) params.set("premium", premium);
  if (hasKeys) params.set("hasKeys", hasKeys);
  params.set("sortBy", sortBy);
  params.set("sortDir", sortDir);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));

  const usersQuery = useAdminListQuery<UsersResponse>({
    queryKey: ["admin", "users"],
    path: "/admin/users",
    params,
    enabled: isAdmin,
    failure: "Failed to load users",
  });

  const statsQuery = useAdminListQuery<StatsResponse>({
    queryKey: ["admin", "stats"],
    path: "/admin/stats",
    enabled: isAdmin,
    failure: "Failed to load stats",
  });

  // Assign / revoke premium. Mirrors the Signups page Approve mutation:
  // authFetch → invalidate the users list so the row reflects the new state.
  const premiumMutation = useMutation({
    mutationFn: async ({ userId, premium: next }: { userId: string; premium: boolean }) => {
      const res = await authFetch(`/admin/users/${userId}/premium`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ premium: next }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to update premium");
      return json;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  if (gate) return gate;

  // The site operator's view of every account (CN-G3). Headers keep the
  // page's existing titles; the columns themselves come from the domain set.
  const render: Partial<Record<string, (u: AdminUser) => ReactNode>> = {
    email: (u) => <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{u.email}</span>,
    status: (u) => {
      const s = userStatus(u);
      return <AdminStatusDot status={s.status} label={s.label} />;
    },
    role: (u) => (
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
    premiumAt: (u) => {
      const isPremium = u.premiumAt !== null;
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-sm)" }}>
          <AdminStatusDot
            status={isPremium ? "healthy" : "idle"}
            label={isPremium ? "Premium" : "—"}
          />
          <button
            className="btn-secondary"
            disabled={premiumMutation.isPending}
            title={isPremium
              ? "Revoke premium — disables server-side LLM features for this user"
              : "Grant premium — unlocks the opt-in server-side LLM features"}
            onClick={() => premiumMutation.mutate({ userId: u.id, premium: !isPremium })}
            style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}
          >
            {isPremium ? "Revoke" : "Grant"}
          </button>
        </span>
      );
    },
  };

  const total = usersQuery.data?.total ?? 0;
  const rows = usersQuery.data?.users ?? [];

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
        <AdminField label="Premium">
          <AdminSelect
            value={premium}
            onChange={(v) => resetOffset(() => setPremium(v))}
            options={[
              { value: "", label: "Any" },
              { value: "yes", label: "Premium" },
              { value: "no", label: "Standard" },
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
            <AdminUsersTable
              viewer="site"
              listing="all"
              show={["email", "status", "role", "premiumAt", "createdAt", "lastLoginAt", "activeKeyCount", "recipeCount", "groupCount"]}
              rows={rows}
              render={render}
              headers={{ role: "Role", premiumAt: "Premium", activeKeyCount: "Keys", groupCount: "Recipe books" }}
              sortable={["email", "createdAt", "lastLoginAt"]}
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
