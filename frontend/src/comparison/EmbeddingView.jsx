// ═══════════════════════════════════════════════════════════════════
// EmbeddingView (C) — geteiltes 2D-UMAP-Embedding beider Liganden.
//
// Ein Punkt pro Modus (Cluster), beide Liganden in EINEM Raum, Farbe =
// Ligand, Radius ∝ Verweildauer. Überlappende Farben ≙ geteilte Modi,
// einfarbige Inseln ≙ ligandenspezifisch. Klick selektiert den Cluster.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState } from "react";
import { C, ligColor, useResize, useLigandFilter } from "./theme";
import { VizFrame, LigandLegend, Note, Tooltip } from "./VizChrome";

export default function EmbeddingView({
  data, selectedClusters, activeLigand, onSelectCluster,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const { width, height } = useResize(wrapRef);
  const [hover, setHover] = useState(null);
  const filter = useLigandFilter();

  const points = data?.points || [];

  const layout = useMemo(() => {
    if (!points.length) return null;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const maxOcc = Math.max(1, ...points.map(p => p.occupancy));
    return { xMin, xMax, yMin, yMax, maxOcc };
  }, [points]);

  if (!points.length || !layout) {
    return <div style={{ color: C.textDim, padding: 24 }}>Kein Embedding.</div>;
  }

  const M = 28;
  const innerW = Math.max(10, width - 2 * M);
  const innerH = Math.max(10, height - 2 * M);
  const { xMin, xMax, yMin, yMax, maxOcc } = layout;
  const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.05 || 1;
  const sx = (v) => M + ((v - xMin + xPad) / (xMax - xMin + 2 * xPad)) * innerW;
  const sy = (v) => M + innerH - ((v - yMin + yPad) / (yMax - yMin + 2 * yPad)) * innerH;
  const rOf = (occ) => 2.5 + Math.sqrt(occ / maxOcc) * 15;

  const selSet = new Set(selectedClusters || []);
  const isSel = (p) => p.lig === activeLigand && selSet.has(p.cluster_id);

  // Größte zuerst zeichnen, damit kleine Punkte oben liegen; ausgeblendete
  // Liganden (interaktive Legende) werden weggelassen.
  const order = points.map((_, i) => i)
    .filter((i) => !filter.isHidden(points[i].lig))
    .sort((a, b) => points[b].occupancy - points[a].occupancy);

  return (
    <VizFrame
      title="Embedding"
      subtitle="Geteiltes 2D-UMAP — ein Punkt pro Modus, Farbe = Ligand, Radius ∝ Verweildauer. Überlappende Farben = geteilte Modi, einfarbige Inseln = ligandenspezifisch."
      legend={<>
        <LigandLegend data={data} filter={filter} />
        <Note>{points.length} Modi · Größe ∝ Verweildauer · Achsen = UMAP-Dimensionen (einheitslos)</Note>
      </>}
    >
      <div ref={wrapRef} style={{ width: "100%", height: "100%", position: "relative" }}>
        <svg ref={svgRef} width={width} height={height}
          style={{ display: "block", background: C.bg }}>
          {order.map((i) => {
            const p = points[i];
            const sel = isSel(p);
            const hov = hover === i;
            return (
              <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={rOf(p.occupancy)}
                fill={ligColor(p.lig)} fillOpacity={0.72}
                stroke={sel ? C.pink : (hov ? "#fff" : "rgba(0,0,0,0.35)")}
                strokeWidth={sel ? 2.5 : (hov ? 1.5 : 0.75)}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelectCluster?.(p.lig, p.cluster_id)} />
            );
          })}
        </svg>

        {/* Tooltip */}
        {hover != null && !filter.isHidden(points[hover].lig) && (() => {
          const p = points[hover];
          return (
            <Tooltip color={ligColor(p.lig)}
              left={Math.min(sx(p.x) + 14, width - 170)}
              top={Math.min(sy(p.y) + 14, height - 70)}>
              <div style={{ fontWeight: 600 }}>
                {p.lig === 1 ? data.lig1_name : data.lig2_name} · Cluster {p.cluster_id}
              </div>
              <div style={{ color: C.textDim }}>{p.occupancy} Frames</div>
            </Tooltip>
          );
        })()}
      </div>
    </VizFrame>
  );
}
