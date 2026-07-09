import { useQuery } from "@tanstack/react-query";
import { authFetch } from "../auth.js";

/**
 * The recipe books the signed-in user is a member of.
 *
 * Four pages still fetch `/recipe-books` inline with their own locally-declared
 * shapes (GroupsPage, DashboardPage, ApiKeysPage, RecipeMapPage). Migrating them
 * onto this hook is tracked in docs/backlog.md; it's mechanical and disjoint
 * from the move feature that introduced the hook.
 */
export interface RecipeBook {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  organization_id: string;
  member_role: string;
  daily_read: boolean;
  daily_write: boolean;
}

/**
 * Roles that may have a recipe written into their book.
 *
 * Mirrors the server's canWriteToBook() allowlist rather than assuming every
 * membership implies write access. A read-only `viewer` role is a live backlog
 * proposal — when it lands, this fails closed and the server rejects anyway.
 * Client-side filtering is a courtesy, never the authorization.
 */
const WRITE_ROLES = ["owner", "admin", "member"];

export function canWriteToBook(role: string | null | undefined): boolean {
  return !!role && WRITE_ROLES.includes(role);
}

export function useRecipeBooks() {
  return useQuery<RecipeBook[]>({
    queryKey: ["recipe-books"],
    queryFn: async () => {
      const res = await authFetch("/recipe-books");
      const json = (await res.json()) as { ok: boolean; data: RecipeBook[] };
      if (!json.ok) throw new Error("Failed to load recipe books");
      return json.data;
    },
  });
}
