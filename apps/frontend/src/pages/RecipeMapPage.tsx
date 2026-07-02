import { useState, useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTraceMap } from "../hooks/useTraceMap.js";
import type { PositionedCluster, PositionedTrace } from "../hooks/useTraceMap.js";
import { Link } from "@tanstack/react-router";
import { Icon } from "../components/Icon.js";
import { authFetch } from "../auth.js";
import { useClipboard } from "../hooks/useClipboard.js";
import { CUSTOM_BRIEFING_STORAGE_KEY, type CustomBriefingHandoff } from "./ApiKeysPage.js";

// ── Color palette for clusters ───────────────────────────────────────────────

const CLUSTER_COLORS = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

// ── Component ────────────────────────────────────────────────────────────────

type SelectedItem = { type: "cluster" | "trace"; data: PositionedCluster | PositionedTrace };

export function RecipeMapPage() {
  // k = the clustering parameter that triggers backend refetches.
  // pendingK = the slider's displayed value during drag. Only commit to k on
  // release (mouseup/touchend/keyup) so intermediate slider positions don't
  // each fire a slow /traces/map request.
  const [k, setK] = useState(5);
  const [pendingK, setPendingK] = useState(5);
  const commitK = useCallback(() => {
    if (pendingK !== k) setK(pendingK);
  }, [pendingK, k]);
  const [drillStack, setDrillStack] = useState<string[][]>([]);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [pinnedItem, setPinnedItem] = useState<SelectedItem | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Read URL params for "Map from here" links
  const urlParams = new URLSearchParams(window.location.search);
  const urlQuery = urlParams.get("query") || undefined;
  const initialGroupId = urlParams.get("groupId") || undefined;

  // Custom Briefing handoff — a one-shot ephemeral credential passed from the
  // API Keys page via sessionStorage so the raw key never touches the URL.
  // Read-once pattern: we grab it on mount, clear it from storage, and hold
  // it in component state. If the user navigates away and back, the key is
  // gone (matches the user's "if you leave the page, we don't need to
  // remember that key any more" framing).
  const [customBriefing, setCustomBriefing] = useState<CustomBriefingHandoff | null>(() => {
    try {
      const raw = sessionStorage.getItem(CUSTOM_BRIEFING_STORAGE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(CUSTOM_BRIEFING_STORAGE_KEY);
      return JSON.parse(raw) as CustomBriefingHandoff;
    } catch {
      return null;
    }
  });

  // Group selection — URL takes priority. When custom-briefing is active, the
  // default is "no single focus" (undefined) so the map fetches the UNION of
  // the key's read groups — otherwise keys with a mix of populated and empty
  // groups would silently land on an empty one. User can still narrow via the
  // dropdown.
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(initialGroupId);

  // Fetch user's groups for the dropdown
  const groupsQuery = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await authFetch("/recipe-books");
      const json = (await res.json()) as { ok: boolean; data: Array<{ id: string; name: string; slug: string }> };
      return json.ok ? json.data : [];
    },
  });

  // Embedding strategy for clustering experiments.
  // `strategy` is committed (used by useTraceMap); `pendingStrategy` is bound
  // to the Vectors select and commits via Apply, so changing the dropdown
  // doesn't refetch immediately — matches the flow for filter/axes/mode.
  const [strategy, setStrategy] = useState<string>("");
  const [pendingStrategy, setPendingStrategy] = useState<string>("");

  // All inputs are edited freely, then "Apply" commits them all at once
  const [filterInput, setFilterInput] = useState("");
  const [mode, setMode] = useState<"umap" | "concept">("umap");
  const [axisAInput, setAxisAInput] = useState("");
  const [axisBInput, setAxisBInput] = useState("");
  const [recentAxes, setRecentAxes] = useState<Array<{ a: string; b: string }>>(() => {
    try {
      const stored = localStorage.getItem("soupnet_recent_axes");
      return stored ? JSON.parse(stored) as Array<{ a: string; b: string }> : [];
    } catch { return []; }
  });

  // Committed state — what's actually fetched
  const [committed, setCommitted] = useState<{
    filter?: string | undefined;
    axes?: string | undefined;
    mode: "umap" | "concept";
  }>({ mode: "umap" });

  function applyChanges() {
    const f = filterInput.trim() || undefined;
    let ax: string | undefined;
    if (mode === "concept") {
      const a = axisAInput.trim();
      const b = axisBInput.trim();
      if (a && b) {
        ax = `${a},${b}`;
        // Save to recent
        setRecentAxes((prev) => {
          const updated = [{ a, b }, ...prev.filter((r) => !(r.a === a && r.b === b))].slice(0, 10);
          try { localStorage.setItem("soupnet_recent_axes", JSON.stringify(updated)); } catch { /* ignore */ }
          return updated;
        });
      }
    }
    setCommitted({ filter: f, axes: ax, mode });
    setStrategy(pendingStrategy);
  }

  function applyRecentAxes(a: string, b: string) {
    setAxisAInput(a);
    setAxisBInput(b);
    setCommitted((prev) => ({ ...prev, axes: `${a},${b}`, mode: "concept" }));
    setMode("concept");
  }

  // Detect if inputs differ from committed state
  const pendingFilter = (filterInput.trim() || undefined) !== committed.filter;
  const pendingMode = mode !== committed.mode;
  const pendingAxes = mode === "concept"
    ? `${axisAInput.trim()},${axisBInput.trim()}` !== (committed.axes ?? ",")
    : false;
  const pendingStrategyChange = pendingStrategy !== strategy;
  const hasChanges = pendingFilter || pendingMode || pendingAxes || pendingStrategyChange;
  const hasFocus = !!committed.filter || !!selectedGroupId;

  // UI collapse states. Help defaults to hidden — it's informational, not
  // essential, and eats above-the-fold space on small screens. User can
  // expand via the toggle below the map if they want it.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Copy briefing
  const queryClient = useQueryClient();
  const { copyAsync, copied } = useClipboard(2500);
  const [briefingPending, setBriefingPending] = useState<boolean>(false);

  // Mint or reuse a key, then fetch the unified briefing with the map's
  // current refinement params (axes, k, filter, strategy) passed through.
  // The backend composes the cluster-exemplars section using those params,
  // so this stays a one-shot fetch. Called inside copyAsync so the
  // ClipboardItem Promise keeps iOS Safari's gesture context alive across
  // both awaits.
  async function fetchBriefingText(): Promise<string> {
    // 1. Pick which key to brief with.
    //    - Custom Briefing flow: use the handed-off raw key (this key's
    //      specific read-group scope + label is the whole point of the flow).
    //    - Default flow: mint a fresh 24h key scoped to the focus group.
    let briefingKey: string;
    if (customBriefing) {
      briefingKey = customBriefing.rawKey;
    } else {
      const body = selectedGroupId ? { writeRecipeBookId: selectedGroupId } : undefined;
      const keyRes = await authFetch("/keys/daily", {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const keyJson = (await keyRes.json()) as { ok: boolean; data?: { key: string; searchUrl: string } };
      if (!keyJson.ok || !keyJson.data) throw new Error("Failed to generate key");
      briefingKey = keyJson.data.key;
    }

    // 2. Fetch unified briefing with map refinement params. The backend
    //    re-runs clustering with these inputs and composes the
    //    `## Context from <books>` section. No client-side post-processing.
    const params = new URLSearchParams();
    params.set("key", briefingKey);
    params.set("k", String(k));
    if (committed.mode === "concept" && committed.axes) params.set("axes", committed.axes);
    if (committed.filter) params.set("filter", committed.filter);
    if (strategy) params.set("strategy", strategy);
    if (selectedGroupId) {
      const targetSlug = (groupsQuery.data ?? []).find(g => g.id === selectedGroupId)?.slug;
      if (targetSlug) params.set("recipe_book", targetSlug);
    }

    const briefRes = await authFetch(`/keys/briefing?${params.toString()}`);
    const briefJson = (await briefRes.json()) as { ok: boolean; data?: { text: string } };
    if (!briefJson.ok || !briefJson.data) throw new Error("Failed to get briefing");

    void queryClient.invalidateQueries({ queryKey: ["keys"] });
    return briefJson.data.text;
  }

  async function handleCopyBriefing() {
    setBriefingPending(true);
    try {
      await copyAsync(() => fetchBriefingText(), "briefing");
    } finally {
      setBriefingPending(false);
    }
  }

  const currentTraceIds = drillStack.length > 0 ? drillStack[drillStack.length - 1] : undefined;

  const {
    clusters,
    unclustered,
    meta,
    conceptAxes,
    isLoading,
    isProjecting,
    error,
  } = useTraceMap({
    k,
    query: urlQuery,
    filter: committed.filter,
    axes: committed.mode === "concept" ? committed.axes : undefined,
    groupId: selectedGroupId,
    // Multi-group scope: when Custom Briefing is active and the user hasn't
    // picked a specific focus group, fetch the union of the key's read groups
    // so the map reflects the key's actual reach (Andy 2026-04-17 — empty
    // groups in the key were silently hiding the populated ones).
    groupIds: !selectedGroupId && customBriefing ? customBriefing.readRecipeBookIds : undefined,
    traceIds: currentTraceIds,
    strategy: strategy || undefined,
  });

  // The displayed item is the pinned one (if any), otherwise the hovered one
  const displayItem = pinnedItem ?? selectedItem;

  const handleDrillIn = useCallback((cluster: PositionedCluster) => {
    setDrillStack((prev) => [...prev, cluster.memberTraceIds]);
    setPinnedItem(null);
    setSelectedItem(null);
  }, []);

  const handleDrillOut = useCallback(() => {
    setDrillStack((prev) => prev.slice(0, -1));
    setPinnedItem(null);
    setSelectedItem(null);
  }, []);

  const handleZoomIn = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    d3.select(svg).transition().duration(300).call(zoomRef.current.scaleBy, 1.5);
  }, []);

  const handleZoomOut = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    d3.select(svg).transition().duration(300).call(zoomRef.current.scaleBy, 0.67);
  }, []);

  // ── D3 rendering ─────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (clusters.length === 0 && unclustered.length === 0) return;

    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;
    const viewMin = Math.min(width, height);
    const padding = viewMin * 0.15; // 15% padding relative to viewport (extra bottom room for labels)

    // Collect all positioned items
    const allPoints = [
      ...clusters.map((c, i) => ({ ...c, type: "cluster" as const, idx: i })),
      ...unclustered.map((t, i) => ({ ...t, type: "trace" as const, idx: i })),
    ];

    if (allPoints.length === 0) return;

    // Size scale for clusters — relative to viewport size (computed first for padding calc)
    const maxMembers = Math.max(1, ...clusters.map((c) => c.memberCount));
    const minRadius = viewMin * 0.06;  // 6% of viewport
    const maxRadius = viewMin * 0.22;  // 22% of viewport
    const sizeScale = d3.scaleSqrt().domain([1, maxMembers]).range([minRadius, maxRadius]);
    const fontSize = Math.max(10, viewMin * 0.015);

    // Scale x/y to SVG dimensions
    const xExtent = d3.extent(allPoints, (d) => d.x) as [number, number];
    const yExtent = d3.extent(allPoints, (d) => d.y) as [number, number];

    const xScale = d3.scaleLinear()
      .domain(xExtent[0] === xExtent[1] ? [xExtent[0] - 1, xExtent[1] + 1] : xExtent)
      .range([padding, width - padding]);

    // Extra bottom padding so labels below the largest circle aren't cut off
    const bottomPadding = padding + maxRadius * 0.3 + fontSize + 10;
    // Invert Y range so higher values are at the top (SVG y goes top-down)
    const yScale = d3.scaleLinear()
      .domain(yExtent[0] === yExtent[1] ? [yExtent[0] - 1, yExtent[1] + 1] : yExtent)
      .range([height - bottomPadding, padding]);

    // Clear previous
    const sel = d3.select(svg);
    sel.selectAll("*").remove();

    // Create zoom group (data points go here)
    const g = sel.append("g");

    // Concept axes elements (drawn above zoom group, updated on zoom)
    let xAxisGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
    let yAxisGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

    if (conceptAxes) {
      xAxisGroup = sel.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${height - padding * 0.6})`);
      xAxisGroup
        .call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.format(".0%")))
        .call((ag) => ag.selectAll("text").attr("fill", "var(--color-on-surface-variant)").attr("font-size", `${fontSize * 0.9}px`))
        .call((ag) => ag.selectAll("line, path").attr("stroke", "var(--color-outline-variant)"));

      sel.append("text")
        .attr("class", "x-label")
        .attr("x", width / 2)
        .attr("y", height - padding * 0.15)
        .attr("text-anchor", "middle")
        .attr("font-size", `${fontSize}px`)
        .attr("fill", "var(--color-on-surface)")
        .attr("font-family", "var(--font-headline)")
        .text(conceptAxes.axisA);

      yAxisGroup = sel.append("g")
        .attr("class", "y-axis")
        .attr("transform", `translate(${padding * 0.7},0)`);
      yAxisGroup
        .call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(".0%")))
        .call((ag) => ag.selectAll("text").attr("fill", "var(--color-on-surface-variant)").attr("font-size", `${fontSize * 0.9}px`))
        .call((ag) => ag.selectAll("line, path").attr("stroke", "var(--color-outline-variant)"));

      sel.append("text")
        .attr("class", "y-label")
        .attr("x", padding * 0.15)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("transform", `rotate(-90,${padding * 0.15},${height / 2})`)
        .attr("font-size", `${fontSize}px`)
        .attr("fill", "var(--color-on-surface)")
        .attr("font-family", "var(--font-headline)")
        .text(conceptAxes.axisB);
    }

    // Zoom behavior — scroll wheel + drag
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 20])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr("transform", event.transform.toString());

        // Update axes to reflect the zoom transform (concept mode only)
        if (xAxisGroup && yAxisGroup) {
          const newXScale = event.transform.rescaleX(xScale);
          const newYScale = event.transform.rescaleY(yScale);
          xAxisGroup.call(d3.axisBottom(newXScale).ticks(5).tickFormat(d3.format(".0%")))
            .call((ag) => ag.selectAll("text").attr("fill", "var(--color-on-surface-variant)").attr("font-size", `${fontSize * 0.9}px`))
            .call((ag) => ag.selectAll("line, path").attr("stroke", "var(--color-outline-variant)"));
          yAxisGroup.call(d3.axisLeft(newYScale).ticks(5).tickFormat(d3.format(".0%")))
            .call((ag) => ag.selectAll("text").attr("fill", "var(--color-on-surface-variant)").attr("font-size", `${fontSize * 0.9}px`))
            .call((ag) => ag.selectAll("line, path").attr("stroke", "var(--color-outline-variant)"));
        }
      });

    zoomRef.current = zoom;
    sel.call(zoom);

    // Click on background to dismiss pinned item
    sel.on("click", (event) => {
      if (event.target === svg) {
        setPinnedItem(null);
      }
    });

    // Draw cluster circles
    const clusterGroup = g.selectAll<SVGGElement, typeof clusters[number]>(".cluster")
      .data(clusters)
      .join("g")
      .attr("class", "cluster")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`)
      .style("cursor", "pointer");

    // Cluster circle
    clusterGroup.append("circle")
      .attr("r", (d) => sizeScale(d.memberCount))
      .attr("fill", (_d, i) => CLUSTER_COLORS[i % CLUSTER_COLORS.length]!)
      .attr("fill-opacity", 0.25)
      .attr("stroke", (_d, i) => CLUSTER_COLORS[i % CLUSTER_COLORS.length]!)
      .attr("stroke-width", 2);

    // Cluster exemplar dot (center)
    clusterGroup.append("circle")
      .attr("r", Math.max(4, viewMin * 0.012))
      .attr("fill", (_d, i) => CLUSTER_COLORS[i % CLUSTER_COLORS.length]!)
      .attr("fill-opacity", 0.9);

    // Cluster label
    clusterGroup.append("text")
      .text((d) => `${d.memberCount} recipes`)
      .attr("dy", (d) => sizeScale(d.memberCount) + fontSize + 4)
      .attr("text-anchor", "middle")
      .attr("font-size", `${fontSize}px`)
      .attr("fill", "var(--color-on-surface-variant)")
      .attr("font-family", "var(--font-mono)");

    // Cluster interactions — click to pin info + drill, hover to preview
    clusterGroup
      .on("click", (event, d) => {
        event.stopPropagation();
        // If this cluster is small enough to drill into, drill
        if (d.memberTraceIds.length > k) {
          handleDrillIn(d);
        } else {
          // At leaf level — pin the info panel
          setPinnedItem({ type: "cluster", data: d });
        }
      })
      .on("mouseenter", (_event, d) => {
        setSelectedItem({ type: "cluster", data: d });
      })
      .on("mouseleave", () => {
        setSelectedItem(null);
      });

    // Draw unclustered trace dots (leaf level)
    const traceDotRadius = Math.max(6, viewMin * 0.018);
    const traceGroup = g.selectAll<SVGCircleElement, typeof unclustered[number]>(".trace-dot")
      .data(unclustered)
      .join("circle")
      .attr("class", "trace-dot")
      .attr("cx", (d) => xScale(d.x))
      .attr("cy", (d) => yScale(d.y))
      .attr("r", traceDotRadius)
      .attr("fill", "var(--color-primary)")
      .attr("fill-opacity", 0.7)
      .attr("stroke", "var(--color-primary)")
      .attr("stroke-width", 1)
      .style("cursor", "pointer");

    traceGroup
      .on("click", (event, d) => {
        event.stopPropagation();
        setPinnedItem({ type: "trace", data: d });
      })
      .on("mouseenter", (_event, d) => {
        setSelectedItem({ type: "trace", data: d });
      })
      .on("mouseleave", () => {
        setSelectedItem(null);
      });

  }, [clusters, unclustered, handleDrillIn, k, conceptAxes]);

  // ── Render ───────────────────────────────────────────────────────────────
  const hasData = clusters.length > 0 || unclustered.length > 0;
  const showCanvas = !isLoading && !isProjecting && hasData;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 80px)" }}>
      {/* Header — title + status pills left, actions right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", marginBottom: "var(--space-sm)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-md)", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>Recipe Map</h1>
          {meta && (
            <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
              {meta.totalTraces} recipes · {meta.k} clusters
              {strategy ? ` · ${strategy}` : ""}
              {drillStack.length > 0 ? ` · depth ${drillStack.length}` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => void handleCopyBriefing()}
            disabled={briefingPending || clusters.length === 0}
            title={!selectedGroupId ? "Focus a recipe book first for best results" : undefined}
            style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}
          >
            {copied === "briefing"
              ? "Copied!"
              : briefingPending
                ? "Generating..."
                : `Copy agent briefing (${clusters.length})`}
          </button>
          {drillStack.length > 0 && (
            <button className="btn-secondary" onClick={handleDrillOut} style={{ fontSize: "0.85rem" }}>
              <Icon name="arrow-left" size={14} /> Back up
            </button>
          )}
        </div>
      </div>

      {urlQuery && (
        <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)", fontStyle: "italic" }}>
          Showing recipes similar to: "{urlQuery.length > 100 ? urlQuery.slice(0, 100) + "..." : urlQuery}"
          {" "}<a href="/app/map" style={{ color: "var(--color-primary)" }}>View full recipe book →</a>
        </p>
      )}

      {customBriefing ? (
        <div style={{
          padding: "var(--space-sm) var(--space-md)",
          marginBottom: "var(--space-sm)",
          background: "var(--color-surface-container)",
          border: "1px solid var(--color-primary)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          flexWrap: "wrap",
        }}>
          <span className="pill" style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: "0.7rem" }}>
            Custom Briefing
          </span>
          <span className="text-sm">
            Copy-briefing buttons will use API key{" "}
            {customBriefing.label
              ? <strong>{customBriefing.label}</strong>
              : <em>you just created</em>}
            {customBriefing.keyPrefix && (
              <> <span className="text-mono text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
                ({customBriefing.keyPrefix}…)
              </span></>
            )}
            {(() => {
              const groupNames = customBriefing.readRecipeBookIds
                .map((id) => (groupsQuery.data ?? []).find((g) => g.id === id)?.name)
                .filter((n): n is string => !!n);
              if (groupNames.length === 0) return null;
              if (groupNames.length === 1) return <> — read scope: <em>{groupNames[0]}</em>.</>;
              return <> — read scope: {groupNames.length} recipe books ({groupNames.join(", ")}). Map shows the union by default; the dropdown below narrows to one.</>;
            })()}
          </span>
          <button
            className="btn-ghost"
            style={{ fontSize: "0.75rem", padding: "2px var(--space-sm)", marginLeft: "auto" }}
            onClick={() => setCustomBriefing(null)}
            title="Clear the custom briefing state and revert to generating a fresh 24-hour key"
          >
            Clear
          </button>
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
          Copy-briefing buttons will mint a fresh 24-hour key scoped to the focused recipe book. Start from the <Link to="/app/keys" style={{ color: "var(--color-primary)" }}>API Keys page</Link> and click <em>Custom Briefing</em> to brief with a specific key instead.
        </p>
      )}

      {/* Control panel — two logical rows: scope (row 1) and visualization (row 2) */}
      <div style={{
        padding: "var(--space-sm) var(--space-md)",
        marginBottom: "var(--space-sm)",
        background: "var(--color-surface-container-low)",
        borderRadius: "var(--radius-md)",
      }}>
        {/* Row 1 — scope: which recipes are we looking at, plus commit/clear */}
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-sm)",
          alignItems: "center",
        }}>
          {/* Focus group. When Custom Briefing is active, the dropdown is
              scoped to the key's read groups so the user can't focus a group
              outside the briefing's actual reach — keeps UI scope and briefing
              scope in sync. */}
          <select
            value={selectedGroupId ?? ""}
            onChange={(e) => setSelectedGroupId(e.target.value || undefined)}
            style={{ fontSize: "0.78rem", padding: "3px var(--space-sm)", maxWidth: 220 }}
          >
            {customBriefing ? (
              <>
                <option value="">
                  All key recipe books ({customBriefing.readRecipeBookIds.length})
                </option>
                {(groupsQuery.data ?? [])
                  .filter((g) => customBriefing.readRecipeBookIds.includes(g.id))
                  .map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
              </>
            ) : (
              <>
                <option value="">All recipe books</option>
                {(groupsQuery.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </>
            )}
          </select>

          {/* Filter keywords */}
          <input
            placeholder="Filter keywords"
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyChanges(); }}
            style={{ minWidth: 100, maxWidth: 160, fontSize: "0.78rem", padding: "3px var(--space-sm)" }}
          />

          {/* Advanced toggle */}
          <button
            className="btn-ghost"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ fontSize: "0.72rem", padding: "2px var(--space-sm)", color: "var(--color-on-surface-variant)" }}
          >
            {showAdvanced ? "▾ Less" : "▸ Advanced"}
          </button>

          {hasFocus && (
            <button
              className="btn-ghost"
              onClick={() => { setFilterInput(""); setSelectedGroupId(undefined); setCommitted((prev) => ({ ...prev, filter: undefined })); }}
              style={{ fontSize: "0.72rem", padding: "2px var(--space-sm)", color: "var(--color-on-surface-variant)" }}
            >
              Clear
            </button>
          )}

          {/* Apply — commits pending changes from both rows. Margin-left: auto pushes it right. */}
          <button
            onClick={applyChanges}
            disabled={!hasChanges}
            style={{
              fontSize: "0.78rem",
              whiteSpace: "nowrap",
              marginLeft: "auto",
              opacity: hasChanges ? 1 : 0.4,
              transition: "opacity 0.15s",
            }}
          >
            Apply
          </button>
        </div>

        {/* Row 2 — visualization: projection mode + axes + clusters count. These all affect how the map is drawn, not which recipes are in it. */}
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-sm)",
          alignItems: "center",
          marginTop: "var(--space-xs)",
        }}>
          {/* Map mode toggle */}
          <div style={{ display: "flex", gap: "2px", background: "var(--color-surface-container)", borderRadius: "var(--radius-sm)", padding: 2 }}>
            <button
              className={mode === "umap" ? "" : "btn-ghost"}
              onClick={() => setMode("umap")}
              style={{ fontSize: "0.75rem", padding: "2px var(--space-sm)", borderRadius: "var(--radius-sm)" }}
            >
              Discovery
            </button>
            <button
              className={mode === "concept" ? "" : "btn-ghost"}
              onClick={() => setMode("concept")}
              style={{ fontSize: "0.75rem", padding: "2px var(--space-sm)", borderRadius: "var(--radius-sm)" }}
            >
              Concept Axes
            </button>
          </div>

          {/* Concept axes inputs (shown when concept mode active) — kept in the same row as the mode toggle so they stay visually grouped */}
          {mode === "concept" && (
            <>
              <input
                placeholder="X axis (e.g., accessibility)"
                value={axisAInput}
                onChange={(e) => setAxisAInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyChanges(); }}
                style={{ minWidth: 100, maxWidth: 160, fontSize: "0.78rem", padding: "3px var(--space-sm)" }}
              />
              <input
                placeholder="Y axis (e.g., performance)"
                value={axisBInput}
                onChange={(e) => setAxisBInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyChanges(); }}
                style={{ minWidth: 100, maxWidth: 160, fontSize: "0.78rem", padding: "3px var(--space-sm)" }}
              />
              {recentAxes.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const idx = parseInt(e.target.value, 10);
                    const r = recentAxes[idx];
                    if (r) applyRecentAxes(r.a, r.b);
                  }}
                  style={{ fontSize: "0.72rem", padding: "3px", maxWidth: 110 }}
                >
                  <option value="">Recent...</option>
                  {recentAxes.map((r, i) => (
                    <option key={i} value={i}>{r.a} / {r.b}</option>
                  ))}
                </select>
              )}
            </>
          )}

          {/* Clusters slider — label + input + value vertically centered */}
          <label htmlFor="cluster-k" style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", fontSize: "0.75rem", color: "var(--color-on-surface-variant)", whiteSpace: "nowrap", marginLeft: "auto" }}>
            Clusters:
            <input
              id="cluster-k"
              type="range"
              min="2"
              max="15"
              value={pendingK}
              onChange={(e) => setPendingK(parseInt(e.target.value, 10))}
              onMouseUp={commitK}
              onTouchEnd={commitK}
              onKeyUp={commitK}
              style={{ width: 70, verticalAlign: "middle" }}
            />
            <span style={{ fontFamily: "var(--font-mono)", minWidth: 16 }}>{pendingK}</span>
          </label>
        </div>
      </div>

      {/* Advanced row — embedding strategy (hidden by default) */}
      {showAdvanced && (
        <div style={{
          display: "flex",
          gap: "var(--space-sm)",
          alignItems: "center",
          padding: "var(--space-xs) var(--space-md)",
          marginBottom: "var(--space-sm)",
          background: "var(--color-surface-container-low)",
          borderRadius: "var(--radius-md)",
          flexWrap: "wrap",
        }}>
          <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>Vectors:</span>
          <select
            value={pendingStrategy}
            onChange={(e) => setPendingStrategy(e.target.value)}
            style={{ fontSize: "0.78rem", padding: "3px var(--space-sm)", maxWidth: 280 }}
          >
            <option value="">All strategies (best score wins)</option>
            <optgroup label="Production">
              <option value="full_document">Trace text only</option>
              <option value="full_recipe_context">Trace + evidence + references</option>
            </optgroup>
            <optgroup label="Experimental — trace only">
              {/* exp_trace_minimal removed 2026-07-01 — it was byte-identical
                  to full_document ("Trace text only" above IS the minimal
                  baseline). */}
              <option value="exp_trace_instructed">Instructed (with preamble)</option>
            </optgroup>
            <optgroup label="Experimental — trace + evidence">
              <option value="exp_trace_evidence_headed">Section-headed</option>
              <option value="exp_trace_evidence_weighted">Weighted instruction</option>
            </optgroup>
            <optgroup label="Experimental — full recipe">
              <option value="exp_full_headed">Section-headed</option>
              <option value="exp_full_weighted">Weighted instruction</option>
            </optgroup>
          </select>
          <span className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
            {pendingStrategy ? "Filtering to one strategy — traces without this vector won't appear (click Apply to re-cluster)" : ""}
          </span>
        </div>
      )}

      {/* Loading states */}
      {(isLoading || isProjecting) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--color-on-surface-variant)" }}>
          <p>{isLoading ? "Loading recipes..." : "Computing layout..."}</p>
        </div>
      )}

      {error && (
        <div style={{ padding: "var(--space-md)", background: "var(--color-error-container)", borderRadius: "var(--radius-md)", color: "var(--color-error)", fontSize: "0.85rem" }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isProjecting && !hasData && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "var(--color-on-surface-variant)" }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ marginBottom: "var(--space-md)" }}>No recipes with vectors yet.</p>
            <Link to="/app/check"><button>Check your first recipe</button></Link>
          </div>
        </div>
      )}

      {/* SVG canvas + overlays */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <svg
          ref={svgRef}
          style={{
            width: "100%",
            height: "100%",
            background: "var(--color-surface-container-low)",
            borderRadius: "var(--radius-lg)",
            display: showCanvas ? "block" : "none",
          }}
        />

        {/* Zoom controls */}
        {showCanvas && (
          <div style={{
            position: "absolute",
            bottom: "var(--space-md)",
            left: "var(--space-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}>
            <button
              className="btn-secondary"
              onClick={handleZoomIn}
              style={{ width: 36, height: 36, padding: 0, justifyContent: "center", fontSize: "1.2rem" }}
              title="Zoom in"
            >+</button>
            <button
              className="btn-secondary"
              onClick={handleZoomOut}
              style={{ width: 36, height: 36, padding: 0, justifyContent: "center", fontSize: "1.2rem" }}
              title="Zoom out"
            >-</button>
            <button
              className="btn-secondary"
              onClick={() => {
                const svg = svgRef.current;
                if (!svg) return;
                const serializer = new XMLSerializer();
                const svgStr = serializer.serializeToString(svg);
                const canvas = document.createElement("canvas");
                const rect = svg.getBoundingClientRect();
                const scale = 2; // 2x for retina
                canvas.width = rect.width * scale;
                canvas.height = rect.height * scale;
                const ctx = canvas.getContext("2d");
                if (!ctx) return;
                ctx.scale(scale, scale);
                const img = new Image();
                const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                img.onload = () => {
                  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-surface") || "#fff";
                  ctx.fillRect(0, 0, rect.width, rect.height);
                  ctx.drawImage(img, 0, 0, rect.width, rect.height);
                  URL.revokeObjectURL(url);
                  const a = document.createElement("a");
                  a.download = "recipe-map.png";
                  a.href = canvas.toDataURL("image/png");
                  a.click();
                };
                img.src = url;
              }}
              style={{ width: 36, height: 36, padding: 0, justifyContent: "center", fontSize: "0.7rem" }}
              title="Download as PNG"
            >
              <Icon name="download" size={16} />
            </button>
          </div>
        )}

        {/* Info panel — shown on hover (ephemeral) or click (pinned) */}
        {displayItem && (
          <div style={{
            position: "absolute",
            top: "var(--space-md)",
            right: "var(--space-md)",
            width: 300,
            maxHeight: "60%",
            overflow: "auto",
            background: "var(--color-surface-container-lowest)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-lg)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            pointerEvents: pinnedItem ? "auto" : "none", // prevent flicker on hover
          }}>
            {pinnedItem && (
              <button
                className="btn-ghost"
                onClick={() => setPinnedItem(null)}
                style={{ position: "absolute", top: 8, right: 8, padding: 4 }}
              >
                <Icon name="x" size={14} />
              </button>
            )}
            {displayItem.type === "cluster" ? (
              <ClusterDetail
                cluster={displayItem.data as PositionedCluster}
                canDrill={(displayItem.data as PositionedCluster).memberTraceIds.length > k}
              />
            ) : (
              <TraceDetail trace={displayItem.data as PositionedTrace} />
            )}
          </div>
        )}
      </div>

      {/* Help text — below the map so it doesn't eat above-the-fold space. */}
      <div style={{ marginTop: "var(--space-sm)" }}>
        <button
          className="btn-ghost"
          onClick={() => setShowHelp((v) => !v)}
          style={{ fontSize: "0.72rem", padding: "2px var(--space-sm)", color: "var(--color-on-surface-variant)" }}
        >
          {showHelp ? "▾ Hide help" : "ℹ What does this show?"}
        </button>
        {showHelp && (
          <div className="text-xs" style={{ color: "var(--color-on-surface-variant)", marginTop: "var(--space-xs)", lineHeight: 1.5, paddingLeft: "var(--space-sm)" }}>
            {mode === "concept" ? (
              <>
                <p style={{ marginBottom: "var(--space-xs)" }}>
                  Each recipe is positioned by how semantically similar it is to your two chosen concepts.
                  Recipes about both concepts land in the upper-right. Based on <a href="https://www.nature.com/articles/s41562-022-01316-8" target="_blank" rel="noopener" style={{ color: "var(--color-primary)" }}>Semantic Projection (Grand et al., 2022)</a>.
                </p>
                <p>
                  <strong>Tip:</strong> Try broad concepts first, then drill into a cluster and re-project with more specific concepts.
                </p>
              </>
            ) : (
              <>
                <p style={{ marginBottom: "var(--space-xs)" }}>
                  Recipes arranged by overall similarity using <a href="https://arxiv.org/abs/1802.03426" target="_blank" rel="noopener" style={{ color: "var(--color-primary)" }}>UMAP</a>.
                  Nearby recipes are semantically similar. Clusters show groups of related recipes. Scroll to zoom, drag to pan.
                </p>
                <p>
                  Axes have no inherent meaning — only relative distances are reliable. For interpretable axes, switch to Concept Axes.
                  See <a href="https://arxiv.org/html/2506.08725v2" target="_blank" rel="noopener" style={{ color: "var(--color-primary)" }}>Wang et al. 2025</a>.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detail panels ────────────────────────────────────────────────────────────

function ClusterDetail({ cluster, canDrill }: {
  cluster: PositionedCluster;
  canDrill: boolean;
}) {
  return (
    <div>
      <p className="text-label" style={{ marginBottom: "var(--space-xs)" }}>Exemplar recipe</p>
      <p style={{ fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "var(--space-sm)" }}>
        {cluster.exemplarText}
      </p>
      <div style={{ display: "flex", gap: "var(--space-md)", marginBottom: "var(--space-sm)", flexWrap: "wrap" }}>
        <span className="pill">{cluster.memberCount} recipes</span>
        <span className="pill">{Math.round(cluster.avgSimilarity * 100)}% similar</span>
      </div>
      {canDrill ? (
        <p className="text-sm" style={{ color: "var(--color-on-surface-variant)" }}>
          Click the cluster to explore {cluster.memberCount} recipes inside.
        </p>
      ) : (
        <div>
          <p className="text-sm" style={{ color: "var(--color-on-surface-variant)", marginBottom: "var(--space-sm)" }}>
            This cluster has {cluster.memberCount} recipe{cluster.memberCount === 1 ? "" : "s"}:
          </p>
          {(cluster.memberPreviews ?? cluster.memberTraceIds.map((id) => ({ id, text: id.slice(0, 8) + "..." }))).slice(0, 10).map((member) => (
            <Link
              key={member.id}
              to="/app/traces/$traceId"
              params={{ traceId: member.id }}
              style={{ display: "block", color: "var(--color-primary)", fontSize: "0.8rem", marginBottom: "var(--space-xs)", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {member.text} →
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function TraceDetail({ trace }: { trace: PositionedTrace }) {
  return (
    <div>
      <p className="text-label" style={{ marginBottom: "var(--space-xs)" }}>Recipe</p>
      <p style={{ fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "var(--space-sm)" }}>
        {trace.claimText}
      </p>
      <p className="text-xs" style={{ color: "var(--color-on-surface-variant)" }}>
        {new Date(trace.createdAt).toLocaleDateString()}
      </p>
      <Link
        to="/app/traces/$traceId"
        params={{ traceId: trace.id }}
        style={{ display: "block", marginTop: "var(--space-sm)", color: "var(--color-primary)", fontSize: "0.85rem" }}
      >
        View full recipe →
      </Link>
    </div>
  );
}
