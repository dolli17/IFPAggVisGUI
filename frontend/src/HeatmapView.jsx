// ═══════════════════════════════════════════════════════════════════
// HeatmapView — Canvas + SVG hybrid renderer for the distance matrix.
//
// Replaces the matplotlib PNG that came from /api/viz/heatmap. The
// matrix can grow to a few hundred IFPs in each dimension; that's too
// many SVG <rect>s for smooth interaction (DOM cost ≈ N²), so the
// numeric pixels go on a <canvas> and the chart chrome (axes, hover
// crosshair, selection guides, tooltip) stays in <svg> on top.
//
// Interaction (UX option C agreed with user):
//   - Click on the diagonal (i == j)  -> select IFP i (`networkFrame`).
//   - Click off-diagonal              -> only show the distance value
//                                         in the tooltip; no selection.
//   - Hover anywhere                  -> crosshair + tooltip with
//                                         IFP-id pair and distance.
//   - When `selectedIndex` is set, row+col are marked with pink guides.
//
// Color scale:
//   Hard-coded viridis stops (matplotlib default), linearly interpolated
//   in RGB. Avoids pulling in `d3-scale-chromatic` just for one ramp.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";

const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  border: "#2d3348",
  accent: "#6c7bd4",
  pink: "#f472b6",
  text: "#e2e8f0",
  textDim: "#8892a8",
};

const MARGIN = { top: 16, right: 24, bottom: 36, left: 56 };

// Matplotlib `viridis` colormap, sampled at 9 stops. Linearly interpolated
// in RGB at lookup time. Same ramp the original PNG path used.
const VIRIDIS = [
  [68,  1,  84],   // 0.000
  [72, 35, 116],   // 0.125
  [64, 67, 135],   // 0.250
  [52, 94, 141],   // 0.375
  [41, 120, 142],  // 0.500
  [32, 144, 140],  // 0.625
  [34, 167, 132],  // 0.750
  [68, 190, 112],  // 0.875
  [253, 231, 36],  // 1.000
];

function viridisAt(t) {
  if (!Number.isFinite(t)) return [0, 0, 0];
  if (t <= 0) return VIRIDIS[0];
  if (t >= 1) return VIRIDIS[VIRIDIS.length - 1];
  const f = t * (VIRIDIS.length - 1);
  const i = Math.floor(f);
  const u = f - i;
  const a = VIRIDIS[i], b = VIRIDIS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

export default function HeatmapView({
  data,             // { distances, ifp_ids, occurrence, n, max_distance, min_distance }
  selectedIndex,    // number — currently selected IFP index (a.k.a. networkFrame)
  onSelectIndex,    // (i) => void
}) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 600, height: 400 });
  const [hover, setHover] = useState(null); // {i, j, x, y}
  // Zoom state. `scale` is multiplicative (1 = fit-to-container, default
  // viewport); `tx`/`ty` are pan offsets in CSS pixels relative to the
  // top-left of the matrix area. We only allow scale ≥ 1 — zooming below
  // 1 just shrinks the matrix to the upper-left of the viewport, which
  // looks weird for a heatmap.
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ tx: 0, ty: 0 });
  const dragRef = useRef(null); // { startX, startY, origTx, origTy }

  // Wrapper resize
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

  // Geometry — keep the matrix square so distances "look" symmetric.
  // `baseSide` is the unzoomed fit-to-container size; `side` applies
  // the current zoom level. `cellSize` is in CSS pixels for the current
  // zoom. `pan` is clamped so the matrix can't be panned out of view.
  const geometry = useMemo(() => {
    if (!data?.distances?.length) return null;
    const n = data.n || data.distances.length;
    const innerW = Math.max(80, size.width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(80, size.height - MARGIN.top - MARGIN.bottom);
    const baseSide = Math.max(40, Math.min(innerW, innerH));
    const side = baseSide * scale;
    const cellSize = side / n;
    const maxD = data.max_distance || 1;
    // Clamp pan: the matrix should never leave the inner area entirely.
    const minTx = Math.min(0, innerW - side);
    const minTy = Math.min(0, innerH - side);
    const tx = Math.max(minTx, Math.min(0, pan.tx));
    const ty = Math.max(minTy, Math.min(0, pan.ty));
    return { n, innerW, innerH, baseSide, side, cellSize, maxD, tx, ty };
  }, [data, size.width, size.height, scale, pan]);

  // Canvas paint pass — repaint whenever data or geometry changes.
  // We render at off-screen pixel resolution (= n × n) and let CSS
  // scale to display size; that keeps the redraw fast even for big N
  // and gives crisp blocks without anti-aliasing fuzz.
  useEffect(() => {
    if (!geometry || !canvasRef.current || !data?.distances) return;
    const cv = canvasRef.current;
    const n = geometry.n;
    cv.width = n;
    cv.height = n;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(n, n);
    const dists = data.distances;
    const maxD = geometry.maxD || 1;
    let p = 0;
    for (let i = 0; i < n; i++) {
      const row = dists[i];
      for (let j = 0; j < n; j++) {
        const v = row[j] / maxD;
        const [r, g, b] = viridisAt(v);
        img.data[p++] = r;
        img.data[p++] = g;
        img.data[p++] = b;
        img.data[p++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [data, geometry]);

  // Mouse → cell mapping. Coordinates are stored relative to the
  // unzoomed inner area; we subtract the pan offset to get matrix-space
  // coordinates and divide by `cellSize` (already includes zoom).
  const handleMouseMove = (evt) => {
    if (!geometry) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const xInner = evt.clientX - rect.left - MARGIN.left;
    const yInner = evt.clientY - rect.top - MARGIN.top;
    // Drag-to-pan
    if (dragRef.current) {
      const d = dragRef.current;
      setPan({
        tx: d.origTx + (xInner - d.startX),
        ty: d.origTy + (yInner - d.startY),
      });
      return;
    }
    // Convert from inner-area to matrix-space (account for pan)
    const xMat = xInner - geometry.tx;
    const yMat = yInner - geometry.ty;
    if (xInner < 0 || xInner > geometry.innerW
        || yInner < 0 || yInner > geometry.innerH
        || xMat < 0 || xMat > geometry.side
        || yMat < 0 || yMat > geometry.side) {
      setHover(null);
      return;
    }
    const j = Math.max(0, Math.min(geometry.n - 1,
      Math.floor(xMat / geometry.cellSize)));
    const i = Math.max(0, Math.min(geometry.n - 1,
      Math.floor(yMat / geometry.cellSize)));
    setHover({ i, j, x: xInner, y: yInner });
  };
  const handleMouseLeave = () => {
    setHover(null);
    dragRef.current = null;
  };

  const handleMouseDown = (evt) => {
    if (!geometry) return;
    // Only initialise drag if we're inside the matrix area; small click
    // movements (< 4 px) still count as a click for selection.
    const rect = evt.currentTarget.getBoundingClientRect();
    const xInner = evt.clientX - rect.left - MARGIN.left;
    const yInner = evt.clientY - rect.top - MARGIN.top;
    if (xInner < 0 || xInner > geometry.innerW
        || yInner < 0 || yInner > geometry.innerH) return;
    dragRef.current = {
      startX: xInner, startY: yInner,
      origTx: geometry.tx, origTy: geometry.ty,
      moved: false, downX: evt.clientX, downY: evt.clientY,
    };
  };
  const handleMouseUp = (evt) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const dx = Math.abs(evt.clientX - d.downX);
    const dy = Math.abs(evt.clientY - d.downY);
    if (dx < 4 && dy < 4 && hover && hover.i === hover.j) {
      // Treated as a click; UX option (c): only diagonal selects.
      onSelectIndex?.(hover.i);
    }
  };

  // Wheel zoom — zoom around the cursor so the cell under the pointer
  // stays put (same trick most map UIs use).
  const handleWheel = (evt) => {
    if (!geometry) return;
    evt.preventDefault();
    const rect = evt.currentTarget.getBoundingClientRect();
    const xInner = evt.clientX - rect.left - MARGIN.left;
    const yInner = evt.clientY - rect.top - MARGIN.top;
    if (xInner < 0 || xInner > geometry.innerW
        || yInner < 0 || yInner > geometry.innerH) return;
    const factor = Math.exp(-evt.deltaY * 0.001);
    const nextScale = Math.max(1, Math.min(20, scale * factor));
    if (nextScale === scale) return;
    // Anchor the zoom on the cursor: pan adjusts so the matrix-space
    // point under the cursor doesn't move.
    const ratio = nextScale / scale;
    const nextTx = xInner - (xInner - geometry.tx) * ratio;
    const nextTy = yInner - (yInner - geometry.ty) * ratio;
    setScale(nextScale);
    setPan({ tx: nextTx, ty: nextTy });
  };

  const resetView = () => {
    setScale(1);
    setPan({ tx: 0, ty: 0 });
  };

  // Axis ticks — adapt to side length so labels don't collide.
  const tickCount = geometry ? Math.max(2, Math.min(10,
    Math.floor(geometry.side / 60))) : 5;
  const ticks = useMemo(() => {
    if (!geometry) return [];
    const n = geometry.n;
    if (n <= tickCount) {
      return Array.from({ length: n }, (_, i) => i);
    }
    const step = (n - 1) / (tickCount - 1);
    return Array.from({ length: tickCount },
      (_, k) => Math.round(k * step));
  }, [geometry, tickCount]);

  // Selection guides
  const selX = (geometry && selectedIndex != null
    && selectedIndex >= 0 && selectedIndex < geometry.n)
    ? (selectedIndex + 0.5) * geometry.cellSize : null;

  // Tooltip placement helper (flip near right/bottom edges)
  let tooltip = null;
  if (geometry && hover) {
    const ifpI = data.ifp_ids?.[hover.i] ?? hover.i;
    const ifpJ = data.ifp_ids?.[hover.j] ?? hover.j;
    const dist = data.distances[hover.i][hover.j];
    const w = 160, h = (hover.i === hover.j) ? 46 : 60;
    const rawX = MARGIN.left + hover.x + 12;
    const rawY = MARGIN.top + hover.y + 12;
    const flipX = rawX + w > size.width;
    const flipY = rawY + h > size.height;
    tooltip = {
      x: flipX ? rawX - w - 24 : rawX,
      y: flipY ? rawY - h - 24 : rawY,
      w, h, ifpI, ifpJ, dist,
      isDiag: hover.i === hover.j,
    };
  }

  return (
    <div ref={wrapperRef} style={{
      width: "100%", height: "100%", minHeight: 280,
      position: "relative", background: C.surface,
      borderRadius: 8, border: `1px solid ${C.border}`,
    }}>
      {!geometry ? (
        <div style={{ padding: 20, color: C.textDim, fontSize: 12 }}>
          Keine Daten
        </div>
      ) : (
        <>
          {/* Clip the canvas to the inner area so panned-out portions
              don't draw outside the chart. */}
          <div style={{
            position: "absolute",
            left: MARGIN.left, top: MARGIN.top,
            width: geometry.innerW, height: geometry.innerH,
            overflow: "hidden", pointerEvents: "none",
          }}>
            <canvas ref={canvasRef}
              style={{
                position: "absolute",
                left: geometry.tx, top: geometry.ty,
                width: geometry.side, height: geometry.side,
                imageRendering: "pixelated",
              }} />
          </div>

          {/* SVG overlay: axes, hover crosshair, selection, tooltip */}
          <svg width={size.width} height={size.height}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            style={{
              position: "relative", display: "block",
              cursor: dragRef.current ? "grabbing"
                : hover && hover.i === hover.j ? "pointer"
                : (scale > 1 ? "grab" : "default"),
            }}>
            <defs>
              {/* Clip so the inside of the matrix area stays inside */}
              <clipPath id="hm-inner-clip">
                <rect x={0} y={0}
                  width={geometry.innerW} height={geometry.innerH} />
              </clipPath>
            </defs>
            <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
              {/* All in-matrix overlays live inside the clip so they
                  don't draw past the inner area when zoomed/panned. */}
              <g clipPath="url(#hm-inner-clip)">
                {/* Selection guides (row + col), translated by pan offset */}
                {selX != null && (
                  <>
                    <line
                      x1={geometry.tx + selX} x2={geometry.tx + selX}
                      y1={geometry.ty} y2={geometry.ty + geometry.side}
                      stroke={C.pink} strokeWidth={1.2} opacity={0.8} />
                    <line
                      x1={geometry.tx} x2={geometry.tx + geometry.side}
                      y1={geometry.ty + selX} y2={geometry.ty + selX}
                      stroke={C.pink} strokeWidth={1.2} opacity={0.8} />
                  </>
                )}

                {/* Hover cell */}
                {hover && (
                  <rect
                    x={geometry.tx + hover.j * geometry.cellSize}
                    y={geometry.ty + hover.i * geometry.cellSize}
                    width={geometry.cellSize}
                    height={geometry.cellSize}
                    fill="none"
                    stroke={C.text} strokeWidth={1.5} />
                )}
              </g>

              {/* Frame around the inner area (not the matrix) — stays
                  put while you pan/zoom, marks the chart bounds. */}
              <rect x={0} y={0}
                width={geometry.innerW} height={geometry.innerH}
                fill="none" stroke={C.border} />

              {/* Axes — only render ticks for cells inside the visible
                  matrix area; positions translated by the pan offset. */}
              {/* Y axis ticks (rows / IFP-i) */}
              {ticks.map((t, k) => {
                const y = geometry.ty + (t + 0.5) * geometry.cellSize;
                if (y < 0 || y > geometry.innerH) return null;
                return (
                  <g key={`yt${k}`} transform={`translate(0, ${y})`}>
                    <line x1={-4} x2={0} stroke={C.textDim} />
                    <text x={-8} dy="0.32em" textAnchor="end"
                      fontSize={10} fill={C.textDim}>
                      {data.ifp_ids?.[t] ?? t}
                    </text>
                  </g>
                );
              })}
              <text x={-MARGIN.left + 4} y={-4}
                fontSize={10} fill={C.textDim}>IFP i</text>

              {/* X axis ticks (cols / IFP-j) */}
              {ticks.map((t, k) => {
                const x = geometry.tx + (t + 0.5) * geometry.cellSize;
                if (x < 0 || x > geometry.innerW) return null;
                return (
                  <g key={`xt${k}`}
                    transform={`translate(${x}, ${geometry.innerH})`}>
                    <line y1={0} y2={4} stroke={C.textDim} />
                    <text y={16} textAnchor="middle"
                      fontSize={10} fill={C.textDim}>
                      {data.ifp_ids?.[t] ?? t}
                    </text>
                  </g>
                );
              })}
              <text x={geometry.innerW} y={geometry.innerH + 30}
                textAnchor="end" fontSize={10} fill={C.textDim}>
                IFP j
              </text>
            </g>

            {/* Tooltip (outside the inner-translate so coords are absolute) */}
            {tooltip && (
              <g transform={`translate(${tooltip.x}, ${tooltip.y})`}
                pointerEvents="none">
                <rect width={tooltip.w} height={tooltip.h} rx={4}
                  fill={C.bg} stroke={C.accent} opacity={0.95} />
                <text x={8} y={16} fontSize={10} fill={C.text}>
                  IFP #{tooltip.ifpI}{tooltip.isDiag ? "" : ` × #${tooltip.ifpJ}`}
                </text>
                <text x={8} y={30} fontSize={10} fill={C.accent}>
                  Distanz: {tooltip.dist}
                </text>
                {!tooltip.isDiag && (
                  <text x={8} y={44} fontSize={9} fill={C.textDim}>
                    (Diagonale klicken zum Auswählen)
                  </text>
                )}
                {tooltip.isDiag && (
                  <text x={8} y={44} fontSize={9} fill={C.pink}>
                    Klick: IFP auswählen
                  </text>
                )}
              </g>
            )}
          </svg>

          {/* Color-scale legend (top-right corner) */}
          <div style={{
            position: "absolute", top: 8, right: 12,
            display: "flex", flexDirection: "column", alignItems: "flex-end",
            gap: 4, fontSize: 10, color: C.textDim,
          }}>
            <span style={{ pointerEvents: "none" }}>Distanz</span>
            <div style={{
              width: 110, height: 10, borderRadius: 2,
              background: `linear-gradient(to right, ${
                VIRIDIS.map((c, k) => `rgb(${c.join(",")}) ${k * 12.5}%`).join(",")
              })`,
              border: `1px solid ${C.border}`,
              pointerEvents: "none",
            }} />
            <div style={{ display: "flex", justifyContent: "space-between",
                          width: 110, pointerEvents: "none" }}>
              <span>0</span>
              <span>{Math.round(geometry.maxD)}</span>
            </div>
            {/* Zoom hint + reset */}
            <div style={{ display: "flex", alignItems: "center", gap: 6,
                          marginTop: 2 }}>
              <span style={{ pointerEvents: "none" }}>
                Zoom: {scale.toFixed(1)}×
              </span>
              {(scale > 1 || pan.tx !== 0 || pan.ty !== 0) && (
                <button onClick={resetView} style={{
                  padding: "1px 6px", fontSize: 9, fontWeight: 600,
                  borderRadius: 3, cursor: "pointer",
                  background: "transparent", color: C.textDim,
                  border: `1px solid ${C.border}`,
                  fontFamily: "inherit",
                }}>Reset</button>
              )}
            </div>
            <span style={{ fontSize: 9, opacity: 0.6,
                           pointerEvents: "none" }}>
              Mausrad = Zoom · Drag = Pan
            </span>
          </div>
        </>
      )}
    </div>
  );
}
