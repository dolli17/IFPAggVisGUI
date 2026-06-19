// ═══════════════════════════════════════════════════════════════════
// BipartiteView (B) — bipartiter Modus-Graph L1 ↔ L2.
//
// Links die Modi (Cluster) von Ligand 1, rechts die von Ligand 2,
// je ∝ Verweildauer (Occupancy) groß. Kanten verbinden ähnliche Modi
// (Distanz ≤ Schwellwert), Deckkraft ∝ Ähnlichkeit. Teilt sich die
// Datengrundlage (Cluster-Kreuzmatrix) mit der Heatmap.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState } from "react";
import { C, BLUE1, BLUE2, useResize, useLigandFilter } from "./theme";
import { VizFrame, LigandLegend, Swatch, Note, Tooltip } from "./VizChrome";

export default function BipartiteView({
  data, selectedClusters, activeLigand, onSelectCluster,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const { width, height } = useResize(wrapRef);
  const [hover, setHover] = useState(null);   // { side, idx, x, y }
  const [thresh, setThresh] = useState(data?.thresholds?.similar_upper ?? 6);
  const filter = useLigandFilter();

  const clusters1 = data?.clusters1 || [];
  const clusters2 = data?.clusters2 || [];
  const matrix = data?.matrix || [];
  const n1 = clusters1.length, n2 = clusters2.length;

  const maxOcc = useMemo(() => Math.max(
    1, ...clusters1.map(c => c.occupancy), ...clusters2.map(c => c.occupancy),
  ), [clusters1, clusters2]);

  const { dmin, dmax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const row of matrix) for (const v of row) {
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    return { dmin: lo === Infinity ? 0 : lo, dmax: hi === -Infinity ? 1 : hi };
  }, [matrix]);

  // Kanten unter Schwellwert
  const edges = useMemo(() => {
    const out = [];
    for (let i = 0; i < n1; i++)
      for (let j = 0; j < n2; j++) {
        const v = matrix[i][j];
        if (v <= thresh) out.push({ i, j, v });
      }
    return out;
  }, [matrix, thresh, n1, n2]);

  if (!n1 || !n2) {
    return <div style={{ color: C.textDim, padding: 24 }}>Keine Cluster-Daten.</div>;
  }

  const plotH = height;
  const padTop = 24, padBot = 20;
  const xL = Math.max(60, width * 0.28);
  const xR = Math.min(width - 60, width * 0.72);

  const yOf = (k, n) => padTop + (n <= 1 ? (plotH - padTop - padBot) / 2
    : (k / (n - 1)) * (plotH - padTop - padBot));
  const rOf = (occ) => 3 + Math.sqrt(occ / maxOcc) * 16;
  const closeness = (v) => (dmax > dmin ? 1 - (v - dmin) / (dmax - dmin) : 0.5);

  const selSet = new Set(selectedClusters || []);
  const isSel = (lig, cid) => activeLigand === lig && selSet.has(cid);

  const hoveredEdges = hover
    ? edges.filter(e => (hover.side === 1 ? e.i : e.j) === hover.idx)
    : [];
  const hoverSet = new Set(hoveredEdges.map(e => `${e.i}-${e.j}`));
  // Eine Kante ist sichtbar, solange keiner ihrer beiden Liganden ausgeblendet ist.
  const edgeVisible = !filter.isHidden(1) && !filter.isHidden(2);

  const toolbar = (
    <>
      <span style={{ color: C.textDim }}>Kante wenn Distanz ≤</span>
      <input type="range" min={dmin} max={dmax} step={0.5} value={thresh}
        onChange={(e) => setThresh(parseFloat(e.target.value))}
        style={{ width: 120 }} />
      <span style={{ fontFamily: "ui-monospace, monospace", color: C.text }}>
        {thresh.toFixed(1)}
      </span>
      <span style={{ color: C.textMuted }}>· {edges.length} Kanten</span>
    </>
  );

  return (
    <VizFrame
      title="Bipartit — Modus-Graph L1 ↔ L2"
      subtitle="Links die Modi von Ligand 1, rechts von Ligand 2 (Größe ∝ Verweildauer). Eine Kante verbindet ähnliche Modi (Distanz ≤ Schwellwert), Deckkraft ∝ Ähnlichkeit."
      toolbar={toolbar}
      legend={<>
        <LigandLegend data={data} filter={filter} />
        <Swatch shape="line" color={C.accent} label="Kante = ähnlicher Modus" />
        <Note>Knotengröße ∝ Verweildauer</Note>
      </>}
    >
    <div ref={wrapRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <svg ref={svgRef} width={width} height={plotH}
        style={{ display: "block", background: C.bg }}>
        <text x={xL} y={14} textAnchor="middle" fontSize={11} fill={BLUE1}>
          {data.lig1_name}
        </text>
        <text x={xR} y={14} textAnchor="middle" fontSize={11} fill={BLUE2}>
          {data.lig2_name}
        </text>

        {/* Kanten */}
        {edgeVisible && edges.map((e, k) => {
          const on = hoverSet.has(`${e.i}-${e.j}`);
          const base = 0.08 + closeness(e.v) * 0.4;
          return (
            <line key={k}
              x1={xL} y1={yOf(e.i, n1)} x2={xR} y2={yOf(e.j, n2)}
              stroke={on ? C.pink : C.accent}
              strokeWidth={on ? 1.8 : 0.6 + closeness(e.v) * 1.2}
              opacity={hover ? (on ? 1 : 0.06) : base} />
          );
        })}

        {/* Knoten links (L1) */}
        {!filter.isHidden(1) && clusters1.map((c, i) => (
          <g key={`l-${i}`}>
            <circle cx={xL} cy={yOf(i, n1)} r={rOf(c.occupancy)}
              fill={BLUE1}
              stroke={isSel(1, c.cluster_id) ? C.pink : "rgba(0,0,0,0.4)"}
              strokeWidth={isSel(1, c.cluster_id) ? 2.5 : 1}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => {
                const r = svgRef.current.getBoundingClientRect();
                setHover({ side: 1, idx: i, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelectCluster?.(1, c.cluster_id)} />
          </g>
        ))}

        {/* Knoten rechts (L2) */}
        {!filter.isHidden(2) && clusters2.map((c, j) => (
          <g key={`r-${j}`}>
            <circle cx={xR} cy={yOf(j, n2)} r={rOf(c.occupancy)}
              fill={BLUE2}
              stroke={isSel(2, c.cluster_id) ? C.pink : "rgba(0,0,0,0.4)"}
              strokeWidth={isSel(2, c.cluster_id) ? 2.5 : 1}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => {
                const r = svgRef.current.getBoundingClientRect();
                setHover({ side: 2, idx: j, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelectCluster?.(2, c.cluster_id)} />
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hover && (() => {
        const c = hover.side === 1 ? clusters1[hover.idx] : clusters2[hover.idx];
        const name = hover.side === 1 ? data.lig1_name : data.lig2_name;
        return (
          <Tooltip color={hover.side === 1 ? BLUE1 : BLUE2}
            left={Math.min(hover.x + 14, width - 180)}
            top={Math.min(hover.y + 14, height - 80)}>
            <div style={{ fontWeight: 600 }}>{name} · Cluster {c.cluster_id}</div>
            <div style={{ color: C.textDim }}>{c.occupancy} Frames · {c.size} IFPs</div>
            <div style={{ color: C.textMuted, fontSize: 10 }}>
              {hoveredEdges.length} ähnliche Modi · Klick = selektieren
            </div>
          </Tooltip>
        );
      })()}
    </div>
    </VizFrame>
  );
}
