// ═══════════════════════════════════════════════════════════════════
// UmapView — 2D-Karte der Bindungsmodi.
//
// Ein Punkt pro Struktur-Cluster (UMAP auf den binären Pattern-Vektoren,
// Hamming-Distanz). Punktgröße = sqrt(frame_count). Punktfarbe =
// clusterColors.colorOf(cid). Optionaler Pfad: die zeit-aggregierten
// IFPs in chronologischer Reihenfolge mit dünner Linie verbunden —
// macht die Trajektorien-Wanderung durch den Modus-Raum sichtbar.
//
// Interaktion:
//   - Hover Punkt -> Tooltip mit cid, frame_count, n_active
//   - Click Punkt -> onSelectCluster(cid, multi)
//   - "Pfad anzeigen" Toggle blendet Trajektorien-Linie ein/aus
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";

const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  surfaceLight: "#22273a",
  border: "#2d3348",
  accent: "#6c7bd4",
  pink: "#f472b6",
  text: "#e2e8f0",
  textDim: "#8892a8",
  textMuted: "#5a6580",
};

const MARGIN = { top: 16, right: 24, bottom: 24, left: 24 };

export default function UmapView({
  data,                  // { clusters: [{cluster_id,x,y,frame_count,n_active}], path: [{ifp_index,cluster_id,x,y}], params }
  clusterColors,
  selectedClusters,      // number[]
  onSelectCluster,       // (cid, multi) => void
  currentClusterId,      // optional: cid des aktuellen Frames
}) {
  const [showPath, setShowPath] = useState(false);
  const [hoverCid, setHoverCid] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 720, height: 520 });
  const wrapperRef = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setSize({ width, height });
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  const { width, height } = size;
  // 24px Toolbar-Höhe reservieren wir oberhalb des Plots.
  const TOOLBAR_H = 28;
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom - TOOLBAR_H);

  const geometry = useMemo(() => {
    if (!data?.clusters?.length) return null;
    const xs = data.clusters.map((c) => c.x);
    const ys = data.clusters.map((c) => c.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xPad = (xMax - xMin) * 0.05 || 1;
    const yPad = (yMax - yMin) * 0.05 || 1;
    const xScale = (x) => ((x - xMin + xPad) / (xMax - xMin + 2 * xPad)) * innerW;
    const yScale = (y) => innerH - ((y - yMin + yPad) / (yMax - yMin + 2 * yPad)) * innerH;

    // Radius: sqrt(frame_count) skaliert auf [3, 14]
    const counts = data.clusters.map((c) => c.frame_count);
    const cMax = Math.max(...counts, 1);
    const rOf = (count) => 3 + Math.sqrt(count / cMax) * 11;

    return { xScale, yScale, rOf };
  }, [data, innerW, innerH]);

  const selSet = useMemo(() => new Set(selectedClusters || []), [selectedClusters]);

  // Pfad-Linien: Segmente zwischen aufeinanderfolgenden Punkten in path[].
  // Wir erzeugen ein einziges <path d="..."> für Performance bei vielen
  // Segmenten. Hook MUSS vor dem early-return stehen (Rules of Hooks).
  const pathD = useMemo(() => {
    if (!showPath || !data?.path?.length || !geometry) return null;
    let d = "";
    for (let i = 0; i < data.path.length; i++) {
      const p = data.path[i];
      const sx = geometry.xScale(p.x).toFixed(2);
      const sy = geometry.yScale(p.y).toFixed(2);
      d += (i === 0 ? "M" : "L") + sx + "," + sy;
    }
    return d;
  }, [showPath, data, geometry]);

  if (!data?.clusters?.length || !geometry) {
    return (
      <div style={{ color: C.textDim, padding: 24, fontSize: 13 }}>
        Keine UMAP-Daten — bitte Aggregation ausführen.
      </div>
    );
  }

  const hoverCluster = hoverCid != null
    ? data.clusters.find((c) => c.cluster_id === hoverCid) : null;

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Toolbar */}
      <div style={{
        position: "absolute", top: 6, left: MARGIN.left,
        display: "flex", alignItems: "center", gap: 12,
        fontSize: 11, color: C.textDim, zIndex: 2,
      }}>
        <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showPath}
            onChange={(e) => setShowPath(e.target.checked)} />
          Pfad anzeigen
          <span style={{ color: C.textMuted }}>
            ({data.path?.length || 0} Segmente)
          </span>
        </label>
        {data.params && (
          <span style={{ color: C.textMuted, fontSize: 10 }}>
            UMAP · n_neighbors={data.params.n_neighbors} · min_dist={data.params.min_dist} · {data.params.metric}
          </span>
        )}
      </div>

      <svg ref={svgRef} width={width} height={height}
        style={{ display: "block", background: C.bg }}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top + TOOLBAR_H})`}>
          {/* Pfad-Linie hinter den Punkten */}
          {pathD && (
            <path d={pathD}
              stroke={C.accent} strokeWidth={1} fill="none"
              opacity={0.35}
              strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* Cluster-Punkte */}
          {data.clusters.map((c) => {
            const cx = geometry.xScale(c.x);
            const cy = geometry.yScale(c.y);
            const r = geometry.rOf(c.frame_count);
            const isSel = selSet.has(c.cluster_id);
            const isCur = c.cluster_id === currentClusterId;
            const isHov = c.cluster_id === hoverCid;
            const fill = clusterColors?.colorOf(c.cluster_id) || C.accent;
            return (
              <circle key={c.cluster_id}
                cx={cx} cy={cy} r={r}
                fill={fill}
                stroke={isSel ? C.pink : (isCur ? C.accent : (isHov ? "#fff" : "rgba(0,0,0,0.4)"))}
                strokeWidth={isSel ? 2.5 : (isHov ? 2 : 1)}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => {
                  setHoverCid(c.cluster_id);
                  const rect = svgRef.current?.getBoundingClientRect();
                  if (rect) setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseMove={(e) => {
                  const rect = svgRef.current?.getBoundingClientRect();
                  if (rect) setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseLeave={() => setHoverCid(null)}
                onClick={(e) => onSelectCluster?.(c.cluster_id,
                  e.metaKey || e.ctrlKey || e.shiftKey)}
              />
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {hoverCluster && (
        <div style={{
          position: "absolute",
          left: Math.min(hoverPos.x + 12, width - 180),
          top: Math.min(hoverPos.y + 12, height - 80),
          padding: "6px 10px", borderRadius: 4,
          background: C.surface,
          border: `1px solid ${clusterColors?.colorOf(hoverCluster.cluster_id) || C.border}`,
          color: C.text, fontSize: 11, lineHeight: 1.4,
          pointerEvents: "none", zIndex: 3,
        }}>
          <div style={{ fontWeight: 600 }}>Cluster {hoverCluster.cluster_id}</div>
          <div style={{ color: C.textDim }}>
            {hoverCluster.frame_count}× Frames · {hoverCluster.n_active} aktive Residuen
          </div>
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 2 }}>
            Klick = auswählen · ⌘/Shift+Klick = toggeln
          </div>
        </div>
      )}
    </div>
  );
}

