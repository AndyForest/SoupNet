import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import { authFetch } from "../auth.js";
import type { UmapWorkerInput, UmapWorkerOutput } from "../workers/umap.worker.js";

// ── Types matching GET /traces/map response ──────────────────────────────────

export interface MapCluster {
  exemplarTraceId: string;
  exemplarText: string;
  memberCount: number;
  avgSimilarity: number;
  memberTraceIds: string[];
  memberPreviews?: Array<{ id: string; text: string }>;
  exemplarVector: number[] | null;
}

export interface UnclusteredTrace {
  id: string;
  claimText: string;
  createdAt: string;
  vector: number[] | null;
}

interface ConceptAxesData {
  axisA: string;
  axisB: string;
  positions: Record<string, { x: number; y: number }>;
}

interface MapResponse {
  ok: boolean;
  data: {
    clusters: MapCluster[];
    unclustered: UnclusteredTrace[];
    conceptAxes?: ConceptAxesData | undefined;
    meta: {
      totalTraces: number;
      tracesInScope: number;
      k: number;
      searchMode: string;
    };
  };
}

// ── Positioned items (after UMAP projection) ─────────────────────────────────

export interface PositionedCluster extends MapCluster {
  x: number;
  y: number;
}

export interface PositionedTrace extends UnclusteredTrace {
  x: number;
  y: number;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useTraceMap(params: {
  k?: number | undefined;
  filter?: string | undefined;
  query?: string | undefined;
  axes?: string | undefined;
  traceIds?: string[] | undefined;
  groupId?: string | undefined;
  groupIds?: string[] | undefined;
  strategy?: string | undefined;
}) {
  const { k = 5, filter, query, axes, traceIds, groupId, groupIds, strategy } = params;
  const [clusters, setClusters] = useState<PositionedCluster[]>([]);
  const [unclustered, setUnclustered] = useState<PositionedTrace[]>([]);
  const [isProjecting, setIsProjecting] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Build query string. groupId (singular) takes precedence over groupIds — when
  // the user picks a specific focus group it narrows within any broader scope.
  const queryParams = new URLSearchParams();
  queryParams.set("k", String(k));
  if (filter) queryParams.set("filter", filter);
  if (query) queryParams.set("query", query);
  if (axes) queryParams.set("axes", axes);
  if (groupId) queryParams.set("groupId", groupId);
  else if (groupIds && groupIds.length > 0) queryParams.set("groupIds", groupIds.join(","));
  if (strategy) queryParams.set("strategy", strategy);
  if (traceIds && traceIds.length > 0) queryParams.set("traceIds", traceIds.join(","));

  const mapQuery = useQuery<MapResponse>({
    queryKey: ["traces-map", k, filter, query, axes, groupId, groupIds?.join(","), strategy, traceIds?.join(",")],
    queryFn: async () => {
      const res = await authFetch(`/traces/map?${queryParams.toString()}`);
      return (await res.json()) as MapResponse;
    },
  });

  // Run UMAP projection when data arrives (skip if concept axes are available)
  useEffect(() => {
    if (!mapQuery.data?.data) return;

    const { clusters: rawClusters, unclustered: rawUnclustered, conceptAxes: serverAxes } = mapQuery.data.data;

    // If server provided concept-axis positions, use those directly (no UMAP needed)
    if (serverAxes && Object.keys(serverAxes.positions).length > 0) {
      const positionedClusters: PositionedCluster[] = rawClusters.map((c) => {
        const pos = serverAxes.positions[c.exemplarTraceId];
        return { ...c, x: pos?.x ?? 0, y: pos?.y ?? 0 };
      });
      const positionedTraces: PositionedTrace[] = rawUnclustered.map((t) => {
        const pos = serverAxes.positions[t.id];
        return { ...t, x: pos?.x ?? 0, y: pos?.y ?? 0 };
      });
      setClusters(positionedClusters);
      setUnclustered(positionedTraces);
      setIsProjecting(false);
      return;
    }

    // Collect all vectors for projection
    const vectors: number[][] = [];
    const sources: Array<{ type: "cluster" | "trace"; index: number }> = [];

    for (let i = 0; i < rawClusters.length; i++) {
      const vec = rawClusters[i]!.exemplarVector;
      if (vec) {
        vectors.push(vec);
        sources.push({ type: "cluster", index: i });
      }
    }

    for (let i = 0; i < rawUnclustered.length; i++) {
      const vec = rawUnclustered[i]!.vector;
      if (vec) {
        vectors.push(vec);
        sources.push({ type: "trace", index: i });
      }
    }

    if (vectors.length < 2) {
      // Not enough points to project — place at origin
      setClusters(rawClusters.map((c) => ({ ...c, x: 0, y: 0 })));
      setUnclustered(rawUnclustered.map((t) => ({ ...t, x: 0, y: 0 })));
      return;
    }

    // Run UMAP in Web Worker
    setIsProjecting(true);
    setProjectionError(null);

    // Clean up previous worker
    if (workerRef.current) workerRef.current.terminate();

    const worker = new Worker(
      new URL("../workers/umap.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<UmapWorkerOutput>) => {
      setIsProjecting(false);

      if (e.data.error) {
        setProjectionError(e.data.error);
        return;
      }

      const positions = e.data.positions!;

      // Map positions back to clusters and traces
      const positionedClusters: PositionedCluster[] = rawClusters.map((c) => ({ ...c, x: 0, y: 0 }));
      const positionedTraces: PositionedTrace[] = rawUnclustered.map((t) => ({ ...t, x: 0, y: 0 }));

      for (let i = 0; i < sources.length; i++) {
        const src = sources[i]!;
        const [x, y] = positions[i]!;
        if (src.type === "cluster") {
          positionedClusters[src.index]!.x = x;
          positionedClusters[src.index]!.y = y;
        } else {
          positionedTraces[src.index]!.x = x;
          positionedTraces[src.index]!.y = y;
        }
      }

      setClusters(positionedClusters);
      setUnclustered(positionedTraces);
    };

    worker.onerror = (err) => {
      setIsProjecting(false);
      setProjectionError(err.message);
    };

    worker.postMessage({
      vectors,
      nNeighbors: Math.min(15, vectors.length - 1),
    } satisfies UmapWorkerInput);

    return () => {
      worker.terminate();
    };
  }, [mapQuery.data]);

  const drillInto = useCallback((memberTraceIds: string[]) => {
    // This would be called by the parent to update traceIds and trigger a re-fetch
    // The parent manages traceIds state and passes it to this hook
    return memberTraceIds;
  }, []);

  return {
    clusters,
    unclustered,
    meta: mapQuery.data?.data?.meta,
    conceptAxes: mapQuery.data?.data?.conceptAxes,
    isLoading: mapQuery.isLoading,
    isProjecting,
    error: mapQuery.error?.message ?? projectionError,
    drillInto,
  };
}
