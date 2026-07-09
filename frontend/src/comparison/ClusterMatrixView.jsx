// ═══════════════════════════════════════════════════════════════════
// ClusterMatrixView (A) — Kreuz-Distanzmatrix L1-Cluster × L2-Cluster.
//
// Heatmap der struktur-aggregierten Distanzen zwischen den häufigsten
// Modi beider Liganden. Dunkel = klein/ähnlich. Zeilen = Ligand 1,
// Spalten = Ligand 2 (je nach Occupancy absteigend sortiert).
// Klick auf Zeilen-/Spalten-Label selektiert den Cluster (→ andere Tabs).
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState } from "react";
import { C, BLUE1, BLUE2, useResize } from "./theme";
import { VizFrame, Colorbar, Swatch, Note, Tooltip } from "./VizChrome";
import { EmptyState, NumberControl } from "../ui";

export default function ClusterMatrixView({
  data, selectedClusters, activeLigand, onSelectCluster, topK, onTopKChange,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const { width, height } = useResize(wrapRef);
  const [hover, setHover] = useState(null);   // { i, j, x, y }

  const clusters1 = data?.clusters1 || [];
  const clusters2 = data?.clusters2 || [];
  const matrix = data?.matrix || [];
  const n1 = clusters1.length, n2 = clusters2.length;

  const { dmin, dmax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const row of matrix) for (const v of row) {
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    return { dmin: lo === Infinity ? 0 : lo, dmax: hi === -Infinity ? 1 : hi };
  }, [matrix]);

  if (!n1 || !n2) {
    return <EmptyState>Noch keine Structural-IFP-Daten.</EmptyState>;
  }

  const simUpper = data?.thresholds?.similar_upper ?? 0;
  const identUpper = data?.thresholds?.identical ?? 0;

  const labelL = 52, labelT = 56, pad = 18;
  const gridW = Math.max(10, width - labelL - pad);
  const gridH = Math.max(10, height - labelT - pad);
  const cell = Math.max(7, Math.min(gridW / n2, gridH / n1, 26));

  // 1 = nah/ähnlich, 0 = fern. Akzent-Blau, Alpha ∝ Ähnlichkeit.
  const barColor = (t) => `rgba(108,123,212,${0.06 + t * 0.85})`;
  const colorOf = (v) =>
    barColor(dmax > dmin ? 1 - (v - dmin) / (dmax - dmin) : 0.5);

  const selSet = new Set(selectedClusters || []);
  const rowSel = (i) => activeLigand === 1 && selSet.has(clusters1[i].cluster_id);
  const colSel = (j) => activeLigand === 2 && selSet.has(clusters2[j].cluster_id);

  const showLabel = cell >= 12;

  const maxTopK = Math.max(
    data?.n_clusters1_total || 1, data?.n_clusters2_total || 1);

  return (
    <VizFrame
      title="Kreuzmatrix — Structural-IFP-Distanzen L1 × L2"
      subtitle="Heatmap der Distanz zwischen den häufigsten Modi beider Liganden. Zeilen = Ligand 1, Spalten = Ligand 2 (nach Verweildauer sortiert). Klick auf ein Label selektiert den Structural IFP."
      toolbar={onTopKChange && (
        <NumberControl label="Modi je Ligand" value={topK}
          min={1} max={maxTopK} step={1} onChange={onTopKChange} />
      )}
      legend={<>
        <Colorbar colorFn={barColor} caption="Distanz:" leftLabel="fern" rightLabel="ähnlich" />
        <Swatch shape="ring" color="#ffffff" label={`identisch (≤${identUpper})`} />
        <Swatch shape="ring" color={C.accent} label={`ähnlich (≤${simUpper})`} />
        <Note>Top {data.shown1}/{data.n_clusters1_total} × {data.shown2}/{data.n_clusters2_total} Modi</Note>
      </>}
    >
    <div ref={wrapRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <svg ref={svgRef} width={width} height={height}
        style={{ display: "block", background: C.bg }}>
        {/* Achsen-Titel */}
        <text x={labelL + gridW / 2} y={14} textAnchor="middle"
          fontSize={11} fill={BLUE2}>{data.lig2_name} — Structural IFP (Spalten)</text>
        <text x={14} y={labelT + gridH / 2} fontSize={11} fill={BLUE1}
          textAnchor="middle"
          transform={`rotate(-90 14 ${labelT + gridH / 2})`}>
          {data.lig1_name} — Structural IFP (Zeilen)
        </text>

        {/* Spalten-Labels */}
        {showLabel && clusters2.map((c, j) => (
          <text key={`cl-${j}`} x={labelL + j * cell + cell / 2} y={labelT - 6}
            textAnchor="start" fontSize={9}
            fill={colSel(j) ? C.pink : C.textDim}
            transform={`rotate(-60 ${labelL + j * cell + cell / 2} ${labelT - 6})`}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectCluster?.(2, c.cluster_id)}>
            {c.cluster_id}
          </text>
        ))}

        {/* Zeilen-Labels + Zellen */}
        {clusters1.map((rc, i) => (
          <g key={`row-${i}`}>
            {showLabel && (
              <text x={labelL - 6} y={labelT + i * cell + cell / 2 + 3}
                textAnchor="end" fontSize={9}
                fill={rowSel(i) ? C.pink : C.textDim}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectCluster?.(1, rc.cluster_id)}>
                {rc.cluster_id}
              </text>
            )}
            {clusters2.map((cc, j) => {
              const v = matrix[i][j];
              const ident = v <= identUpper;
              const sim = v <= simUpper;
              const hot = hover && hover.i === i && hover.j === j;
              return (
                <rect key={`c-${i}-${j}`}
                  x={labelL + j * cell} y={labelT + i * cell}
                  width={cell - 1} height={cell - 1}
                  fill={colorOf(v)}
                  stroke={hot ? "#fff" : (ident ? "#fff" : sim ? C.accent : "transparent")}
                  strokeWidth={hot ? 1.5 : (ident ? 1 : sim ? 0.75 : 0)}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => {
                    const r = svgRef.current.getBoundingClientRect();
                    setHover({ i, j, x: e.clientX - r.left, y: e.clientY - r.top });
                  }}
                  onMouseMove={(e) => {
                    const r = svgRef.current.getBoundingClientRect();
                    setHover({ i, j, x: e.clientX - r.left, y: e.clientY - r.top });
                  }}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelectCluster?.(1, rc.cluster_id)} />
              );
            })}
          </g>
        ))}

        {/* Highlight selektierte Zeile/Spalte */}
        {clusters1.map((rc, i) => rowSel(i) && (
          <rect key={`hr-${i}`} x={labelL} y={labelT + i * cell}
            width={n2 * cell} height={cell - 1} fill="none"
            stroke={C.pink} strokeWidth={1.5} pointerEvents="none" />
        ))}
        {clusters2.map((cc, j) => colSel(j) && (
          <rect key={`hc-${j}`} x={labelL + j * cell} y={labelT}
            width={cell - 1} height={n1 * cell} fill="none"
            stroke={C.pink} strokeWidth={1.5} pointerEvents="none" />
        ))}
      </svg>

      {/* Tooltip */}
      {hover && (() => {
        const rc = clusters1[hover.i], cc = clusters2[hover.j];
        const v = matrix[hover.i][hover.j];
        return (
          <Tooltip color={C.accent}
            left={Math.min(hover.x + 14, width - 190)}
            top={Math.min(hover.y + 14, height - 90)}>
            <div style={{ fontWeight: 600 }}>
              {data.lig1_name} C{rc.cluster_id} ↔ {data.lig2_name} C{cc.cluster_id}
            </div>
            <div style={{ color: C.textDim }}>Distanz: {v.toFixed(1)}</div>
            <div style={{ color: C.textMuted, fontSize: 10 }}>
              Occ. {rc.occupancy} / {cc.occupancy} Frames · Klick = L1-Structural-IFP selektieren
            </div>
          </Tooltip>
        );
      })()}
    </div>
    </VizFrame>
  );
}
