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

const MARGIN = { top: 16, right: 24, bottom: 36, left: 48 };

export default function OccurrenceView({
  data,             // { occurrence, ifp_ids, ... } from /api/data/occurrence
  selectedIndex,    // number — currently selected IFP index (a.k.a. networkFrame)
  onSelectIndex,    // (i) => void
}) {
  const wrapperRef = useRef(null);
  const [size, setSize] = useState({ width: 600, height: 280 });
  const [hoverIdx, setHoverIdx] = useState(null);

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
      .domain(extent(indices))
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
  }, [data, size.width, size.height]);

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
  };
  const handleMouseLeave = () => setHoverIdx(null);
  const handleClick = () => {
    if (hoverIdx != null) onSelectIndex?.(hoverIdx);
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
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          style={{ display: "block", cursor: hoverIdx != null
                                              ? "pointer" : "default" }}>
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
          </g>

          {/* Tooltip */}
          {hoverIdx != null && (() => {
            const tx = MARGIN.left + hoverX + 8;
            const ty = MARGIN.top + Math.max(hoverY - 8, 12);
            const ifpId = data.ifp_ids?.[hoverIdx] ?? hoverIdx;
            const occVal = geometry.occ[hoverIdx];
            const cumPct = (geometry.cumScaled[hoverIdx]
              / geometry.peakOcc * 100);
            const w = 130, h = 46;
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
      </div>
    </div>
  );
}
