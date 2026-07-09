// ═══════════════════════════════════════════════════════════════════
// ResiduesView (D) — Belegungs-Vergleich pro Interaktion/Residuum.
//
// Scatter: x = Belegung in Ligand 1, y = Belegung in Ligand 2 (Anteil
// der Frames, in denen die Interaktion aktiv ist). Punkte auf der
// Diagonale = beide Liganden gleich, abseits = ligandenspezifisch.
// Chemisch direkt interpretierbar. Hover zeigt Residuum + Prozente.
// ═══════════════════════════════════════════════════════════════════
import { useRef, useState } from "react";
import { C, BLUE1, BLUE2, useResize, useLigandFilter } from "./theme";
import { VizFrame, LigandLegend, Swatch, Note, Tooltip } from "./VizChrome";
import { EmptyState, NumberControl } from "../ui";

export default function ResiduesView({ data, onHoverResidue }) {
  const hoverToken = (r) => onHoverResidue?.(r ? String(r.name).split("_")[0] : null);
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const { width, height } = useResize(wrapRef);
  const [hover, setHover] = useState(null);
  const [labelN, setLabelN] = useState(8);
  const filter = useLigandFilter();

  const residues = data?.residues || [];
  if (!residues.length) {
    return <EmptyState>Noch keine Residuen-Daten.</EmptyState>;
  }

  const M = { top: 24, right: 24, bottom: 44, left: 48 };
  const innerW = Math.max(10, width - M.left - M.right);
  const innerH = Math.max(10, height - M.top - M.bottom);
  const side = Math.min(innerW, innerH);  // quadratischer Plot
  const ox = M.left, oy = M.top;
  const sx = (v) => ox + v * side;
  const sy = (v) => oy + side - v * side;

  // Diagonal-Distanz für ligandenspezifische Färbung
  const domLig = (r) => (r.l1 >= r.l2 ? 1 : 2);
  const colorOf = (r) => (r.l1 >= r.l2 ? BLUE1 : BLUE2);
  const shown = (r) => !filter.isHidden(domLig(r));
  // Top-Unterschiede beschriften (data ist nach diff sortiert)

  return (
    <VizFrame
      title="Residuen — Belegungsvergleich"
      subtitle="Pro Interaktion ein Punkt: x = Anteil belegter Frames in Ligand 1, y = in Ligand 2. Auf der Diagonale = in beiden gleich, abseits = ligandenspezifisch."
      toolbar={
        <NumberControl label="Labels" value={labelN}
          min={0} max={Math.min(40, residues.length)} step={1}
          onChange={setLabelN} />
      }
      legend={<>
        <LigandLegend data={data} filter={filter} />
        <Swatch shape="dash" color={C.textMuted} label="Diagonale = gleiche Belegung" />
        <Note>{residues.length} Interaktionen · Farbe = dominanter Ligand</Note>
      </>}
    >
      <div ref={wrapRef} style={{ width: "100%", height: "100%", position: "relative" }}>
        <svg ref={svgRef} width={width} height={height}
          style={{ display: "block", background: C.bg }}>
        {/* Rahmen + Gitter */}
        <rect x={ox} y={oy} width={side} height={side}
          fill={C.surface} stroke={C.border} strokeWidth={1} />
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t}>
            <line x1={sx(t)} y1={oy} x2={sx(t)} y2={oy + side}
              stroke={C.border} strokeWidth={0.5} opacity={0.5} />
            <line x1={ox} y1={sy(t)} x2={ox + side} y2={sy(t)}
              stroke={C.border} strokeWidth={0.5} opacity={0.5} />
          </g>
        ))}
        {/* Diagonale (gleich in beiden) */}
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)}
          stroke={C.textMuted} strokeWidth={1} strokeDasharray="4 3" />

        {/* Achsen-Beschriftung */}
        <text x={ox + side / 2} y={oy + side + 32} textAnchor="middle"
          fontSize={11} fill={BLUE1}>Belegung in {data.lig1_name} →</text>
        <text x={ox - 34} y={oy + side / 2} textAnchor="middle" fontSize={11}
          fill={BLUE2} transform={`rotate(-90 ${ox - 34} ${oy + side / 2})`}>
          Belegung in {data.lig2_name} →
        </text>
        {[0, 0.5, 1].map((t) => (
          <g key={`ax-${t}`}>
            <text x={sx(t)} y={oy + side + 14} textAnchor="middle"
              fontSize={9} fill={C.textMuted}>{(t * 100).toFixed(0)}%</text>
            <text x={ox - 6} y={sy(t) + 3} textAnchor="end"
              fontSize={9} fill={C.textMuted}>{(t * 100).toFixed(0)}%</text>
          </g>
        ))}

        {/* Punkte */}
        {residues.map((r, i) => {
          if (!shown(r)) return null;
          const hov = hover === i;
          return (
            <circle key={i} cx={sx(r.l1)} cy={sy(r.l2)} r={hov ? 6 : 4}
              fill={colorOf(r)} fillOpacity={0.8}
              stroke={hov ? "#fff" : "rgba(0,0,0,0.4)"} strokeWidth={hov ? 1.5 : 0.75}
              style={{ cursor: "default" }}
              onMouseEnter={() => { setHover(i); hoverToken(r); }}
              onMouseLeave={() => { setHover(null); hoverToken(null); }} />
          );
        })}

        {/* Beschriftung der Top-Unterschiede */}
        {residues.slice(0, labelN).map((r, i) => shown(r) && (
          <text key={`lab-${i}`} x={sx(r.l1) + 7} y={sy(r.l2) + 3}
            fontSize={9} fill={C.textDim} pointerEvents="none">
            {r.name}
          </text>
        ))}
        </svg>

        {/* Tooltip */}
        {hover != null && shown(residues[hover]) && (() => {
          const r = residues[hover];
          return (
            <Tooltip color={colorOf(r)}
              left={Math.min(sx(r.l1) + 14, width - 190)}
              top={Math.min(sy(r.l2) + 14, height - 70)}>
              <div style={{ fontWeight: 600 }}>{r.name}</div>
              <div style={{ color: C.textDim }}>
                {data.lig1_name}: {(r.l1 * 100).toFixed(0)}% ·
                {" "}{data.lig2_name}: {(r.l2 * 100).toFixed(0)}%
              </div>
              <div style={{ color: C.textMuted, fontSize: 10 }}>
                Δ {(r.diff * 100).toFixed(0)} Prozentpunkte
              </div>
            </Tooltip>
          );
        })()}
      </div>
    </VizFrame>
  );
}
