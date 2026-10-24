import { useQuery } from "@tanstack/react-query";
import { authFetch } from "../auth.js";
import type { TraceFeedbackRow } from "./useTraces.js";

/**
 * One of the person's declared intents and a page of its lineage
 * (drafts-and-triage slice 9), from GET /me/intents/:id. Null when the intent
 * is not theirs, does not exist, or the id is malformed: the server answers
 * all three alike.
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

export function useIntent(intentId: string, page: number) {
  return useQuery<IntentData | null>({
    queryKey: ["intent", intentId, page],
    queryFn: async () => {
      const res = await authFetch(`/me/intents/${encodeURIComponent(intentId)}?page=${page}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { ok: boolean; data: IntentData };
      return json.ok ? json.data : null;
    },
    enabled: !!intentId,
  });
}
