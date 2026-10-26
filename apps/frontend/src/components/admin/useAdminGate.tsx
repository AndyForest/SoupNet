import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "../../auth.js";

/** Which console a page belongs to: the site operator's, or an organization's. */
export type AdminScope = "site" | "org";

interface AdminUser {
  id: string;
  email: string;
  role: string;
  /** The company organization managing this account (GET /auth/me), or null. */
  organization?: { id: string; name: string; role: "owner" | "admin" | "member" } | null;
}

const DENIED_COPY: Record<AdminScope, string> = {
  site: "You don't have access to this page. System admin role required.",
  org: "You don't have access to this page. Only your organization's owners and admins can open its console.",
};

/**
 * Shared access gate for admin pages: fetches /auth/me and hands back either
 * a ready-to-return loading/denied element or isAdmin=true.
 *
 * The site console needs the site operator's role. The org console needs an
 * owner or admin of the caller's own organization, and `organizationId` is
 * the one organization its queries may name; the backend decides again on
 * every request (CN-G1), so this gate only spares a page a round of 404s.
 *
 * Usage at the top of every admin page component:
 *   const { gate, isAdmin, me } = useAdminGate();          // site console
 *   const { gate, isAdmin, organizationId } = useAdminGate("org");
 *   ...queries with { enabled: isAdmin }...
 *   if (gate) return gate;
 */
export function useAdminGate(scope: AdminScope = "site"): {
  gate: ReactElement | null;
  isAdmin: boolean;
  me: AdminUser | undefined;
  organizationId: string | null;
} {
  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const res = await authFetch("/auth/me");
      const json = (await res.json()) as { ok: boolean; data?: { user: AdminUser } };
      if (!json.ok || !json.data) throw new Error("Failed");
      return json.data.user;
    },
  });

  const organization = meQuery.data?.organization ?? null;
  const isAdmin =
    scope === "site"
      ? meQuery.data?.role === "system"
      : organization !== null && (organization.role === "owner" || organization.role === "admin");

  let gate: ReactElement | null = null;
  if (meQuery.isLoading) {
    gate = <div style={{ padding: "var(--space-lg)" }}>Loading...</div>;
  } else if (!isAdmin) {
    gate = (
      <div style={{ padding: "var(--space-lg)", maxWidth: 600 }}>
        <h1>{scope === "org" ? "Organization" : "Admin"}</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-md)" }}>
          {DENIED_COPY[scope]}
        </p>
      </div>
    );
  }

  return {
    gate,
    isAdmin,
    me: meQuery.data,
    organizationId: scope === "org" && isAdmin ? (organization?.id ?? null) : null,
  };
}
