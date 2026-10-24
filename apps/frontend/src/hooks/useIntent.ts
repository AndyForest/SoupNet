import { useQuery } from "@tanstack/react-query";
import { authFetch } from "../auth.js";
import type { TraceFeedbackRow } from "./useTraces.js";

/**
 * One of the person's declared intents and a page of its lineage
 * (drafts-and-triage slice 9), from GET /me/intents/:id. `notFound` when the
 * intent is not theirs, does not exist, or the id is malformed (the server
 * answers all three alike); `error` with the status for anything else, so an
 * expired sign-in or a server fault is not shown as "not found".
 */

export interface IntentSummary {
  id: string;
  story: string;
  agentId: string | null;
  apiKeyLabel: string | null;
  createdAt: string;
  lastUsedAt: string;
  counts: { shown: number; deposits: number; feedback: number };
}

export type IntentFeedbackRow = TraceFeedbackRow & { traceId: string | null; searchId: string | null };

export type LineageEntry =
  | { type: "shown"; traceId: string; at: string }
  | { type: "deposit"; traceId: string; at: string; draftState: string | null }
  | { type: "feedback"; at: string; feedback: IntentFeedbackRow };

export interface IntentData {
  intent: IntentSummary;
  lineage: LineageEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export type IntentResult =
  | { kind: "found"; data: IntentData }
  | { kind: "notFound" }
  | { kind: "error"; status: number };

export function useIntent(intentId: string, page: number) {
  return useQuery<IntentResult>({
    queryKey: ["intent", intentId, page],
    queryFn: async () => {
      const res = await authFetch(`/me/intents/${encodeURIComponent(intentId)}?page=${page}`);
      if (res.status === 404) return { kind: "notFound" };
      if (!res.ok) return { kind: "error", status: res.status };
      const json = (await res.json()) as { ok: boolean; data: IntentData };
      return json.ok ? { kind: "found", data: json.data } : { kind: "error", status: res.status };
    },
    enabled: !!intentId,
  });
}
