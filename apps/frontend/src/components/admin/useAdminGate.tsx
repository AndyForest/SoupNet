import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "../../auth.js";

interface AdminUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Shared access gate for admin pages: fetches /auth/me and hands back either
 * a ready-to-return loading/denied element or isAdmin=true.
 *
 * Usage at the top of every admin page component:
 *   const { gate, isAdmin, me } = useAdminGate();
 *   ...queries with { enabled: isAdmin }...
 *   if (gate) return gate;
 */
export function useAdminGate(): {
  gate: ReactElement | null;
  isAdmin: boolean;
  me: AdminUser | undefined;
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

  const isAdmin = meQuery.data?.role === "system";

  let gate: ReactElement | null = null;
  if (meQuery.isLoading) {
    gate = <div style={{ padding: "var(--space-lg)" }}>Loading...</div>;
  } else if (!isAdmin) {
    gate = (
      <div style={{ padding: "var(--space-lg)", maxWidth: 600 }}>
        <h1>Admin</h1>
        <p style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-md)" }}>
          You don't have access to this page. System admin role required.
        </p>
      </div>
    );
  }

  return { gate, isAdmin, me: meQuery.data };
}
