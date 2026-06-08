// ═══════════════════════════════════════════════════════════════════
// OccurrenceView — D3-based occurrence chart.
//
// Replaces the matplotlib PNG that came from /api/viz/occurrence.
// Receives raw occurrence values from /api/data/occurrence and draws
// an interactive line/area chart with React-rendered SVG. We use D3's
// pure data submodules (`d3-scale`, `d3-shape`, `d3-array`) rather
// than visx — visx 3.x still pins React ≤ 18 as a peer dep, which
// conflicts with the React 19 we're on.
//
// Interactivity:
//   - The chart resizes responsively via ResizeObserver.
//   - Hovering the chart shows a vertical guide line + a tooltip with
//     the IFP id and its occurrence value.
//   - Clicking selects that IFP — the parent receives the IFP index
//     (the position in the aggregated data, not the raw IFP id), which
//     is what the rest of the app calls `networkFrame`.
//   - The currently selected IFP is highlighted with a pink vertical
//     guide independent of the hover guide.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import { line, area } from "d3-shape";
import { extent, max as d3max, bisector } from "d3-array";

const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  border: "#2d3348",
  accent: "#6c7bd4",
  pink: "#f472b6",
  text: "#e2e8f0",
  textDim: "#8892a8",
  textMuted: "#4a5568",
};

// Bottom margin reserves room for both the X axis (40 px) and the
// structural-cluster band below it (24 px = 18 band + 6 gap).
const MARGIN = { top: 16, right: 24, bottom: 64, left: 48 };
// Visual constants for the cluster band beneath the X axis.
const CLUSTER_BAND_HEIGHT = 14;
const CLUSTER_BAND_SELECTED_EXTRA = 6;   // selected segments stick out by this much
const CLUSTER_BAND_GAP = 10;             // gap between X axis labels and band

export default function OccurrenceView({
  data,             // { occurrence, ifp_ids, ... } from /api/data/occurrence
  selectedIndex,    // number — currently selected IFP index (a.k.a. networkFrame)
  onSelectIndex,    // (i) => void
  clusterData,      // optional: { cluster_id_per_ifp, clusters, ... } from /api/data/clusters
  clusterColors,    // optional: { colorOf(cid), nearestTopOf(cid), distanceToTop(cid), topCount }
  selectedClusters, // optional: number[] of selected cluster ids
  onSelectCluster,  // optional: (cid) => void
  siblingIndices,   // optional: number[] of IFP indices in same cluster as selectedIndex
  matchingIfps,     // optional: Set<number> of IFP indices matching residue discovery
  rangeFilter,      // optional: { start, end } | null — drives x-axis zoom
  onSetRange,       // optional: (start, end) => void — called when user brushes a zoom range
}) {
  const wrapperRef = useRef(null);
  const [size, setSize] = useState({ width: 600, height: 280 });
  const [hoverIdx, setHoverIdx] = useState(null);
  // Separate hover state for the cluster band — set on mouse-move over
  // the band rect, cleared on leave. Keeps the line/area hover (above)
  // independent so both can coexist.
  const [hoverBandIdx, setHoverBandIdx] = useState(null);
  // Brush state. `mode` decides what happens on release:
  //   'zoom'    — default drag, applies a range filter via onSetRange
  //   'cluster' — Shift-drag, picks all clusters touching the range
  //              (legacy Phase B4 behaviour)
  const [brush, setBrush] = useState(null); // { start, end, mode } | null

  // ── X-axis zoom animation ──
  // We animate the x-scale's domain via requestAnimationFrame so the
  // user sees a smooth zoom-in/out when a range filter is applied or
  // cleared. `animatedDomain` is the *currently rendered* domain;
  // `animationRef` tracks the same value outside of React so the rAF
  // loop can read it without retriggering effects.
  //
  // `lastRangeRef` is the rangeFilter we last animated to. We only run
  // the rAF animation when this rangeFilter *actually changes* between
  // effect runs — first mount, tab re-mount, or n-change set the view
  // instantly without animating. That way switching tabs or clicking
  // around with an active range filter doesn't keep replaying the
  // zoom-in animation.
  const animationRef = useRef(null);
  const lastRangeRef = useRef({ start: undefined, end: undefined });
  const [animatedDomain, setAnimatedDomain] = useState(null);
  const n = data?.occurrence?.length ?? 0;
  useEffect(() => {
    if (!n) return;
    const target = rangeFilter
      ? [rangeFilter.start, rangeFilter.end]
      : [0, n - 1];
    const newStart = rangeFilter?.start ?? null;
    const newEnd = rangeFilter?.end ?? null;
    const isFirst = lastRangeRef.current.start === undefined;
    const rangeChanged = !isFirst
      && (lastRangeRef.current.start !== newStart
          || lastRangeRef.current.end !== newEnd);
    lastRangeRef.current = { start: newStart, end: newEnd };

    if (isFirst || !rangeChanged) {
      // First mount, tab re-mount, or n-change: snap to target.
      animationRef.current = target;
      setAnimatedDomain(target);
      return;
    }
    const start = [...(animationRef.current || target)];
    const t0 = performance.now();
    const duration = 350;
    let raf;
    const tick = (now) => {
      const u = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - u, 3); // ease-out cubic
      const d = [
        start[0] + (target[0] - start[0]) * e,
        start[1] + (target[1] - start[1]) * e,
      ];
      animationRef.current = d;
      setAnimatedDomain(d);
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rangeFilter?.start, rangeFilter?.end, n]);

  // Track wrapper size so the SVG fills the visible area.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize({ width, height });
        }
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Derived geometry — memoised so we don't recompute on hover.
  const geometry = useMemo(() => {
    if (!data?.occurrence?.length) return null;
    const occ = data.occurrence;
    const indices = occ.map((_, i) => i);
    const totalObs = data.total_observations
      || occ.reduce((acc, v) => acc + v, 0)
      || 1;
    const peakOcc = data.max_occurrence ?? d3max(occ) ?? 0;

    // Cumulative curve scaled to the same y-range as the occurrence
    // line — purely visual, mirrors the original matplotlib version
    // (`np.cumsum(occ) / np.sum(occ) * np.max(occ)`).
    const cumScaled = [];
    let runningSum = 0;
    for (const v of occ) {
      runningSum += v;
      cumScaled.push((runningSum / totalObs) * peakOcc);
    }

    const innerW = Math.max(50, size.width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(40, size.height - MARGIN.top - MARGIN.bottom);

    const xScale = scaleLinear()
      .domain(animatedDomain || extent(indices))
      .range([0, innerW]);
    const yScale = scaleLinear()
      .domain([0, peakOcc * 1.05 || 1])
      .nice()
      .range([innerH, 0]);

    const linePath = line()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d))(occ);

    const areaPath = area()
      .x((_, i) => xScale(i))
      .y0(innerH)
      .y1((d) => yScale(d))(occ);

    const cumPath = line()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d))(cumScaled);

    return {
      occ, indices, cumScaled, peakOcc, totalObs,
      xScale, yScale, linePath, areaPath, cumPath, innerW, innerH,
    };
  }, [data, size.width, size.height, animatedDomain]);

  // Map mouse X → nearest IFP index. We use d3-bisector so it scales
  // to large datasets without per-point hit testing.
  const xBisector = useMemo(() => bisector((d) => d).left, []);

  const handleMouseMove = (evt) => {
    if (!geometry) return;
    const svgRect = evt.currentTarget.getBoundingClientRect();
    const xRel = evt.clientX - svgRect.left - MARGIN.left;
    if (xRel < 0 || xRel > geometry.innerW) {
      setHoverIdx(null);
      return;
    }
    const dataX = geometry.xScale.invert(xRel);
    const i = Math.max(0, Math.min(
      geometry.occ.length - 1,
      xBisector(geometry.indices, dataX)
    ));
    setHoverIdx(i);
    updateBrushOnMove(i);
  };
  const handleMouseLeave = () => {
    setHoverIdx(null);
    setHoverBandIdx(null);
  };
  const handleClick = () => {
    if (hoverIdx != null) onSelectIndex?.(hoverIdx);
  };

  // ── Brush handlers ──
  // Default drag: zoom to range (applyRangeFilter via onSetRange).
  // Shift-drag: legacy Phase B4 behaviour — pick every cluster touched
  // by the range (additive selection).
  const handleMouseDown = (evt) => {
    if (!geometry) return;
    if (hoverIdx == null) return;
    const mode = evt.shiftKey ? "cluster" : "zoom";
    if (mode === "cluster" && (!onSelectCluster
        || !clusterData?.cluster_id_per_ifp)) return;
    if (mode === "zoom" && !onSetRange) return;
    setBrush({ start: hoverIdx, end: hoverIdx, mode });
  };
  const updateBrushOnMove = (i) => {
    if (brush == null) return;
    setBrush(b => b ? { ...b, end: i } : null);
  };
  const handleMouseUp = () => {
    if (!brush) return;
    const lo = Math.min(brush.start, brush.end);
    const hi = Math.max(brush.start, brush.end);
    const mode = brush.mode;
    setBrush(null);
    if (hi - lo < 1) return; // treat as single click — handled by onClick
    if (mode === "zoom") {
      onSetRange?.(lo, hi);
    } else if (mode === "cluster") {
      const cids = clusterData.cluster_id_per_ifp;
      const seen = new Set();
      for (let k = lo; k <= hi; k++) seen.add(cids[k]);
      seen.forEach(cid => onSelectCluster(cid, true));
    }
  };

  // Y-axis ticks — keep simple (5 ticks)
  const yTicks = geometry ? geometry.yScale.ticks(5) : [];
  // X-axis ticks — adapt count to width
  const xTickCount = geometry ? Math.max(2, Math.min(10,
    Math.floor(geometry.innerW / 80))) : 5;
  const xTicks = geometry ? geometry.xScale.ticks(xTickCount) : [];

  // Hover/Select markers
  const hoverX = (geometry && hoverIdx != null)
    ? geometry.xScale(hoverIdx) : null;
  const hoverY = (geometry && hoverIdx != null)
    ? geometry.yScale(geometry.occ[hoverIdx]) : null;
  const selectX = (geometry && selectedIndex != null
    && selectedIndex >= 0 && selectedIndex < geometry.occ.length)
    ? geometry.xScale(selectedIndex) : null;

  // For every selected cluster, expose its IFP indices + its colour.
  // When ≥1 cluster is selected, these markers replace the frame-based
  // `siblingIndices` markers — they answer the question "which IFPs in
  // the trajectory belong to the cluster(s) I picked?" and use distinct
  // cluster colours so multiple selected clusters can be told apart.
  const selectedClusterMarkers = useMemo(() => {
    if (!selectedClusters?.length
        || !clusterData?.clusters
        || !clusterColors) return null;
    // Map cluster_id -> cluster (clusters[] is sorted by frame_count, so
    // we can't just index by cid).
    const byId = new Map(
      clusterData.clusters.map(c => [c.cluster_id, c]));
    const out = [];
    for (const cid of selectedClusters) {
      const cluster = byId.get(cid);
      if (!cluster) continue;
      const color = clusterColors.colorOf(cid);
      for (const ifp of cluster.ifp_indices || []) {
        out.push({ ifp, color, cid });
      }
    }
    return out.length ? out : null;
  }, [selectedClusters, clusterData, clusterColors]);
  const hasSelectedClusters = selectedClusterMarkers != null;

  return (
    <div ref={wrapperRef} style={{
      width: "100%", height: "100%", minHeight: 220,
      position: "relative", background: C.surface,
      borderRadius: 8, border: `1px solid ${C.border}`,
    }}>
      {!geometry ? (
        <div style={{ padding: 20, color: C.textDim, fontSize: 12 }}>
          Keine Daten
        </div>
      ) : (
        <svg width={size.width} height={size.height}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { handleMouseLeave(); setBrush(null); }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          style={{ display: "block",
                   cursor: brush ? "ew-resize"
                         : hoverIdx != null ? "pointer" : "default",
                   userSelect: "none" }}>
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            {/* Y gridlines */}
            {yTicks.map((t, i) => (
              <line key={`yg${i}`}
                x1={0} x2={geometry.innerW}
                y1={geometry.yScale(t)} y2={geometry.yScale(t)}
                stroke={C.border} strokeOpacity={0.5} />
            ))}

            {/* Occurrence area + line */}
            <path d={geometry.areaPath} fill={C.accent}
              fillOpacity={0.15} />
            <path d={geometry.linePath} fill="none"
              stroke={C.accent} strokeWidth={1.5} />

            {/* Cumulative line (dashed pink) */}
            <path d={geometry.cumPath} fill="none"
              stroke={C.pink} strokeWidth={1.5}
              strokeDasharray="5,4" />

            {/* Brush rectangle — translucent span shown while dragging.
                Colour depends on the brush mode (zoom = accent/blue,
                cluster = pink) so the user knows what release will do. */}
            {brush && (() => {
              const lo = Math.min(brush.start, brush.end);
              const hi = Math.max(brush.start, brush.end);
              const x0 = geometry.xScale(lo);
              const x1 = geometry.xScale(hi);
              const col = brush.mode === "zoom" ? C.accent : C.pink;
              return (
                <rect x={x0} y={0}
                  width={Math.max(1, x1 - x0)} height={geometry.innerH}
                  fill={col} fillOpacity={0.10}
                  stroke={col} strokeOpacity={0.6}
                  strokeWidth={1} pointerEvents="none" />
              );
            })()}

            {/* Discovery-match markers (Phase B2b) — white rings on
                every datapoint whose cluster matches the active residue
                discovery. Visually distinct from sibling-pink (filled)
                and selected (line). */}
            {matchingIfps && matchingIfps.size > 0
              && Array.from(matchingIfps).map((i) => {
                if (i < 0 || i >= geometry.occ.length) return null;
                const cx = geometry.xScale(i);
                const cy = geometry.yScale(geometry.occ[i]);
                return (
                  <circle key={`mat${i}`} cx={cx} cy={cy} r={4.5}
                    fill="none"
                    stroke="#ffffff" strokeWidth={1.2}
                    strokeOpacity={0.85}
                    pointerEvents="none" />
                );
              })}

            {/* Selected-cluster markers — one filled circle per IFP that
                belongs to any selected cluster, painted in the cluster's
                own colour. With multi-select, distinct clusters end up in
                distinct colours, so the user can see which IFPs in the
                trajectory belong to which selected cluster. */}
            {hasSelectedClusters && selectedClusterMarkers.map(
              ({ ifp, color, cid }) => {
                if (ifp === selectedIndex) return null;   // primary gets its own line
                if (ifp < 0 || ifp >= geometry.occ.length) return null;
                const cx = geometry.xScale(ifp);
                const cy = geometry.yScale(geometry.occ[ifp]);
                return (
                  <circle key={`sc${cid}-${ifp}`} cx={cx} cy={cy} r={3}
                    fill={color} fillOpacity={0.7}
                    stroke={color} strokeWidth={1}
                    pointerEvents="none" />
                );
              })}

            {/* Sibling-frame markers — fallback when no cluster is
                selected but a frame is. Shows the frame's cluster mates
                in pink so the user can see "where else does this binding
                mode occur?" without having to formally select the
                cluster. */}
            {!hasSelectedClusters && siblingIndices?.length > 1
              && siblingIndices.map((i) => {
              if (i === selectedIndex) return null;     // primary gets its own line
              if (i < 0 || i >= geometry.occ.length) return null;
              const cx = geometry.xScale(i);
              const cy = geometry.yScale(geometry.occ[i]);
              return (
                <circle key={`sib${i}`} cx={cx} cy={cy} r={3}
                  fill={C.pink} fillOpacity={0.45}
                  stroke={C.pink} strokeWidth={1}
                  pointerEvents="none" />
              );
            })}

            {/* Selected IFP marker */}
            {selectX != null && (
              <line x1={selectX} x2={selectX}
                y1={0} y2={geometry.innerH}
                stroke={C.pink} strokeWidth={1.5} />
            )}

            {/* Hover guide */}
            {hoverX != null && (
              <>
                <line x1={hoverX} x2={hoverX}
                  y1={0} y2={geometry.innerH}
                  stroke={C.text} strokeOpacity={0.4}
                  strokeDasharray="3,3" />
                <circle cx={hoverX} cy={hoverY} r={4}
                  fill={C.accent} stroke={C.text} strokeWidth={1.5} />
              </>
            )}

            {/* Y axis */}
            <line x1={0} x2={0} y1={0} y2={geometry.innerH}
              stroke={C.border} />
            {yTicks.map((t, i) => (
              <g key={`yt${i}`}
                 transform={`translate(0, ${geometry.yScale(t)})`}>
                <line x1={-4} x2={0} stroke={C.textDim} />
                <text x={-8} dy="0.32em" textAnchor="end"
                  fontSize={10} fill={C.textDim}>{t}</text>
              </g>
            ))}
            <text x={-MARGIN.left + 4} y={-4}
              fontSize={10} fill={C.textDim}>Occurrence</text>

            {/* X axis */}
            <line x1={0} x2={geometry.innerW}
              y1={geometry.innerH} y2={geometry.innerH}
              stroke={C.border} />
            {xTicks.map((t, i) => (
              <g key={`xt${i}`} transform={
                `translate(${geometry.xScale(t)}, ${geometry.innerH})`}>
                <line y1={0} y2={4} stroke={C.textDim} />
                <text y={16} textAnchor="middle"
                  fontSize={10} fill={C.textDim}>{t}</text>
              </g>
            ))}
            <text x={geometry.innerW} y={geometry.innerH + 30}
              textAnchor="end" fontSize={10} fill={C.textDim}>
              IFP-Index
            </text>

            {/* ── Cluster band (structural aggregation, Phase B1) ── */}
            {clusterData?.cluster_id_per_ifp?.length === geometry.occ.length
              && clusterColors && (() => {
              const cids = clusterData.cluster_id_per_ifp;
              const bandY = geometry.innerH + CLUSTER_BAND_GAP + 16; // 16 ≈ X-tick label
              const selSet = new Set(selectedClusters || []);
              return (
                <g transform={`translate(0, ${bandY})`}>
                  {cids.map((cid, i) => {
                    const x0 = geometry.xScale(i);
                    const x1 = i + 1 < cids.length
                      ? geometry.xScale(i + 1) : geometry.innerW;
                    const w = Math.max(0.5, x1 - x0);
                    const isSel = selSet.has(cid);
                    return (
                      <rect key={i}
                        x={x0}
                        y={isSel ? -CLUSTER_BAND_SELECTED_EXTRA / 2 : 0}
                        width={w}
                        height={CLUSTER_BAND_HEIGHT
                                + (isSel ? CLUSTER_BAND_SELECTED_EXTRA : 0)}
                        fill={clusterColors.colorOf(cid)}
                        shapeRendering="crispEdges" />
                    );
                  })}
                  {/* Transparent hit layer for hover/click on the band */}
                  <rect x={0} y={-CLUSTER_BAND_SELECTED_EXTRA / 2}
                    width={geometry.innerW}
                    height={CLUSTER_BAND_HEIGHT
                            + CLUSTER_BAND_SELECTED_EXTRA}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const xRel = e.clientX - rect.left;
                      const dataX = geometry.xScale.invert(xRel);
                      const i = Math.max(0, Math.min(cids.length - 1,
                        Math.round(dataX)));
                      setHoverBandIdx(i);
                    }}
                    onMouseLeave={() => setHoverBandIdx(null)}
                    onClick={(e) => {
                      e.stopPropagation();   // don't also fire chart-area click
                      if (hoverBandIdx == null) return;
                      const cid = cids[hoverBandIdx];
                      onSelectCluster?.(cid,
                        e.metaKey || e.ctrlKey || e.shiftKey);
                    }} />
                  {/* Discovery-match outlines (Phase B2b) — white tick
                      *under* the band for every IFP matching the active
                      residue discovery. Different vertical lane than
                      sibling ticks (above), so both can coexist. */}
                  {matchingIfps && matchingIfps.size > 0
                    && Array.from(matchingIfps).map((i) => {
                      if (i < 0 || i >= cids.length) return null;
                      const x0 = geometry.xScale(i);
                      const x1 = i + 1 < cids.length
                        ? geometry.xScale(i + 1) : geometry.innerW;
                      return (
                        <rect key={`mb${i}`}
                          x={x0} y={CLUSTER_BAND_HEIGHT
                                  + CLUSTER_BAND_SELECTED_EXTRA / 2 + 1}
                          width={Math.max(0.5, x1 - x0)}
                          height={2}
                          fill="#ffffff" fillOpacity={0.85}
                          pointerEvents="none" />
                      );
                    })}

                  {/* Selected-cluster ticks above the band — one tick
                      per IFP belonging to any selected cluster, in the
                      cluster's own colour. */}
                  {hasSelectedClusters && selectedClusterMarkers.map(
                    ({ ifp, color, cid }) => {
                      if (ifp === selectedIndex) return null;
                      if (ifp < 0 || ifp >= cids.length) return null;
                      const cx = geometry.xScale(ifp)
                        + (ifp + 1 < cids.length
                           ? (geometry.xScale(ifp + 1) - geometry.xScale(ifp)) / 2
                           : 0);
                      return (
                        <line key={`bt${cid}-${ifp}`}
                          x1={cx} x2={cx}
                          y1={-CLUSTER_BAND_SELECTED_EXTRA / 2 - 4}
                          y2={-CLUSTER_BAND_SELECTED_EXTRA / 2 - 1}
                          stroke={color} strokeWidth={1.2}
                          pointerEvents="none" />
                      );
                    })}

                  {/* Sibling ticks fallback — pink marks at every IFP in
                      the current frame's cluster when nothing is
                      explicitly selected. */}
                  {!hasSelectedClusters && siblingIndices?.length > 1
                    && siblingIndices.map((i) => {
                    if (i === selectedIndex) return null;
                    if (i < 0 || i >= cids.length) return null;
                    const cx = geometry.xScale(i)
                      + (i + 1 < cids.length
                         ? (geometry.xScale(i + 1) - geometry.xScale(i)) / 2
                         : 0);
                    return (
                      <line key={`bt${i}`}
                        x1={cx} x2={cx}
                        y1={-CLUSTER_BAND_SELECTED_EXTRA / 2 - 4}
                        y2={-CLUSTER_BAND_SELECTED_EXTRA / 2 - 1}
                        stroke={C.pink} strokeWidth={1.2}
                        pointerEvents="none" />
                    );
                  })}

                  {/* Position marker in the band (matches the line above) */}
                  {selectX != null && (
                    <line x1={selectX} x2={selectX}
                      y1={-CLUSTER_BAND_SELECTED_EXTRA / 2}
                      y2={CLUSTER_BAND_HEIGHT
                          + CLUSTER_BAND_SELECTED_EXTRA / 2}
                      stroke={C.pink} strokeWidth={1.5} />
                  )}
                </g>
              );
            })()}
          </g>

          {/* Tooltip — extended with cluster info when clusters are loaded. */}
          {hoverIdx != null && (() => {
            const tx = MARGIN.left + hoverX + 8;
            const ty = MARGIN.top + Math.max(hoverY - 8, 12);
            const ifpId = data.ifp_ids?.[hoverIdx] ?? hoverIdx;
            const occVal = geometry.occ[hoverIdx];
            const cumPct = (geometry.cumScaled[hoverIdx]
              / geometry.peakOcc * 100);
            const cid = clusterData?.cluster_id_per_ifp?.[hoverIdx];
            const cluster = cid != null
              ? clusterData?.clusters?.[cid] : null;
            const hasCluster = cluster != null && clusterColors;
            const w = 160, h = hasCluster ? 62 : 46;
            const flipped = tx + w > size.width;
            const tooltipX = flipped ? tx - w - 16 : tx;
            return (
              <g transform={`translate(${tooltipX}, ${ty})`}
                pointerEvents="none">
                <rect width={w} height={h} rx={4}
                  fill={C.bg} stroke={C.accent} opacity={0.95} />
                <text x={8} y={16} fontSize={10}
                  fill={C.text}>IFP #{ifpId}</text>
                <text x={8} y={30} fontSize={10}
                  fill={C.accent}>{occVal}× Vorkommen</text>
                <text x={8} y={42} fontSize={9}
                  fill={C.pink}>{cumPct.toFixed(1)}% kumulativ</text>
                {hasCluster && (
                  <g>
                    <rect x={8} y={48} width={10} height={10} rx={2}
                      fill={clusterColors.colorOf(cid)} />
                    <text x={22} y={57} fontSize={9} fill={C.textDim}>
                      Cluster {cid} · {cluster.frame_count}f
                      {" "}({(cluster.frame_fraction * 100).toFixed(1)}%)
                      {cluster.ifp_count > 1 && (
                        ` · ${cluster.ifp_count} Geschwister`
                      )}
                    </text>
                  </g>
                )}
              </g>
            );
          })()}

          {/* Cluster-band tooltip (separate from the chart-area hover). */}
          {hoverBandIdx != null
            && clusterData?.cluster_id_per_ifp
            && clusterColors && (() => {
              const cid = clusterData.cluster_id_per_ifp[hoverBandIdx];
              const cluster = clusterData.clusters?.[cid];
              if (!cluster) return null;
              const bandY = MARGIN.top + (size.height - MARGIN.top - MARGIN.bottom)
                + CLUSTER_BAND_GAP + 16;
              const cx = MARGIN.left + geometry.xScale(hoverBandIdx);
              const w = 200;
              const flipped = cx + w + 8 > size.width;
              const tx = flipped ? cx - w - 12 : cx + 12;
              const isTop = clusterColors.topCount > 0
                && cid < clusterColors.topCount;
              const nearestTop = clusterColors.nearestTopOf(cid);
              const dToTop = clusterColors.distanceToTop(cid);
              const h = isTop ? 48 : 62;
              return (
                <g transform={`translate(${tx}, ${bandY - h - 8})`}
                  pointerEvents="none">
                  <rect width={w} height={h} rx={4}
                    fill={C.bg} stroke={clusterColors.colorOf(cid)}
                    opacity={0.95} />
                  <rect x={8} y={8} width={10} height={10} rx={2}
                    fill={clusterColors.colorOf(cid)} />
                  <text x={22} y={17} fontSize={10} fill={C.text}>
                    Cluster {cid}
                    {isTop ? ` (Top ${cid + 1})` : ""}
                  </text>
                  <text x={8} y={32} fontSize={9} fill={C.accent}>
                    {cluster.frame_count} Frames
                    {" "}({(cluster.frame_fraction * 100).toFixed(1)}%)
                    {" · "}{cluster.n_active} Interaktionen
                  </text>
                  {!isTop && nearestTop != null && (
                    <text x={8} y={46} fontSize={9} fill={C.textDim}>
                      Variante von Top {nearestTop + 1} · {dToTop} Diff
                    </text>
                  )}
                  {isTop && (
                    <text x={8} y={46} fontSize={9} fill={C.textDim}>
                      Klick: Cluster auswählen
                    </text>
                  )}
                </g>
              );
            })()}
        </svg>
      )}

      {/* Legend */}
      <div style={{
        position: "absolute", top: 6, right: 10,
        display: "flex", gap: 12, fontSize: 10,
        color: C.textDim, pointerEvents: "none",
      }}>
        <span><span style={{ color: C.accent }}>━</span> Occurrence</span>
        <span><span style={{ color: C.pink }}>┄</span> Cumulative</span>
        {onSetRange && (
          <span style={{ color: C.textMuted }}>
            Drag = Zoom · ⇧+Drag = Cluster
          </span>
        )}
      </div>
    </div>
  );
}
