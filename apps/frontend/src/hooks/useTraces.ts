import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "../auth.js";

export interface Trace {
  id: string;
  claimText: string;
  createdAt: string;
  formatAdherenceScore: number | null;
  groupId: string;
  groupName?: string | null;
  apiKeyId: string;
  apiKeyLabel?: string | null;
  evidenceCount?: number;
  referenceCount?: number;
}

interface RawEvidence {
  id: string;
  content: string;
  createdAt: string;
}

export interface ImageBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RegionMeta {
  image_box?: ImageBox;
}

interface RawReference {
  id: string;
  quote: string;
  source: string;
  createdAt: string;
  fileUrl?: string | null;
  fileMimeType?: string | null;
  originalFilename?: string | null;
  fileHash?: string | null;
  regionMeta?: RegionMeta | null;
}

interface EvidenceRefLink {
  evidenceId: string;
  referenceId: string;
}

interface RawTraceDetail extends Trace {
  updatedAt: string;
  userId: string;
  userEmail: string | null;
  groupName?: string | null;
  canDelete: boolean;
  evidence: RawEvidence[];
  references: RawReference[];
  evidenceReferences: EvidenceRefLink[];
}

export interface GroupedReference {
  quote: string;
  source: string;
  fileUrl: string | null | undefined;
  fileMimeType: string | null | undefined;
  originalFilename: string | null | undefined;
  fileHash: string | null | undefined;
  regionMeta: RegionMeta | null | undefined;
}

export interface GroupedEvidence {
  content: string;
  references: GroupedReference[];
}

export interface TraceDetail extends Trace {
  updatedAt: string;
  userId: string;
  userEmail: string | null;
  groupName?: string | null;
  canDelete: boolean;
  evidence: GroupedEvidence[];
}

export function useTraceCount() {
  return useQuery<number>({
    queryKey: ["traces-count"],
    queryFn: async () => {
      const res = await authFetch("/traces/count");
      if (!res.ok) return 0;
      const json = (await res.json()) as { ok: boolean; data: { count: number } };
      return json.ok ? json.data.count : 0;
    },
  });
}

export function useTraces(limit = 20) {
  return useQuery<Trace[]>({
    queryKey: ["traces", limit],
    queryFn: async () => {
      const res = await authFetch(`/traces?limit=${limit}`);
      if (!res.ok) return [];
      const json = (await res.json()) as { ok: boolean; data: Trace[] };
      return json.ok ? json.data : [];
    },
  });
}

export interface GroupTrace extends Trace {
  userId: string;
  userEmail: string | null;
  canDelete: boolean;
}

export function useGroupTraces(groupId: string, limit = 100) {
  return useQuery<GroupTrace[] | { error: string }>({
    queryKey: ["group-traces", groupId, limit],
    queryFn: async () => {
      const res = await authFetch(`/traces?groupId=${encodeURIComponent(groupId)}&limit=${limit}`);
      const json = (await res.json()) as { ok: boolean; data?: GroupTrace[]; error?: string };
      if (!res.ok || !json.ok) {
        return { error: json.error ?? `HTTP ${res.status}` };
      }
      return json.data ?? [];
    },
    enabled: !!groupId,
  });
}

export function useTraceDetail(traceId: string) {
  return useQuery<TraceDetail | null>({
    queryKey: ["trace", traceId],
    queryFn: async () => {
      const res = await authFetch(`/traces/${traceId}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { ok: boolean; data: RawTraceDetail };
      if (!json.ok) return null;

      const raw = json.data;
      const refMap = new Map(raw.references.map((r) => [r.id, r]));
      const linksByEvidence = new Map<string, string[]>();
      for (const link of raw.evidenceReferences) {
        const arr = linksByEvidence.get(link.evidenceId) ?? [];
        arr.push(link.referenceId);
        linksByEvidence.set(link.evidenceId, arr);
      }

      const evidence: GroupedEvidence[] = raw.evidence.map((e) => ({
        content: e.content,
        references: (linksByEvidence.get(e.id) ?? [])
          .map((refId) => refMap.get(refId))
          .filter((r): r is RawReference => !!r)
          .map((r) => ({
            quote: r.quote,
            source: r.source,
            fileUrl: r.fileUrl,
            fileMimeType: r.fileMimeType,
            originalFilename: r.originalFilename,
            fileHash: r.fileHash,
            regionMeta: r.regionMeta,
          })),
      }));

      return {
        ...raw,
        evidence,
      };
    },
    enabled: !!traceId,
  });
}

export function useDeleteTrace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { traceId: string; reason?: string }) => {
      const res = await authFetch(`/traces/${params.traceId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.reason ? { reason: params.reason } : {}),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `Delete failed (HTTP ${res.status})`);
      }
      return res.json() as Promise<{ ok: true }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["traces"] });
      void queryClient.invalidateQueries({ queryKey: ["traces-count"] });
      void queryClient.invalidateQueries({ queryKey: ["group-traces"] });
    },
  });
}
