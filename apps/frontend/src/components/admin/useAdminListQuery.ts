import { useQuery } from "@tanstack/react-query";
import { authFetch } from "../../auth.js";

/**
 * One admin GET with the `{ ok, data, error }` envelope unwrapped, shared by
 * the admin list pages (CN-M4) so each page stops carrying its own copy.
 * `params` are sent as the query string and are part of the cache key.
 */
export function useAdminListQuery<Data>(options: {
  queryKey: readonly unknown[];
  path: string;
  params?: URLSearchParams;
  enabled: boolean;
  /** What the error says when the response carries none. */
  failure: string;
}) {
  const qs = options.params?.toString() ?? "";
  return useQuery({
    queryKey: [...options.queryKey, qs],
    queryFn: async () => {
      const res = await authFetch(qs ? `${options.path}?${qs}` : options.path);
      const json = (await res.json()) as { ok: boolean; data?: Data; error?: string; message?: string };
      if (!json.ok || !json.data) throw new Error(json.message ?? json.error ?? options.failure);
      return json.data;
    },
    enabled: options.enabled,
  });
}
