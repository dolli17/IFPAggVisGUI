// ═══════════════════════════════════════════════════════════════════
// ChordView — Residuen-Ko-Vorkommens-Netzwerk als Chord-Diagramm.
//
// Echtes Flareplot/Chord-Diagramm (vgl. GetContacts): Residuen auf dem
// Kreis (nach Sequenznummer), Bögen = wie oft zwei Residuen *gleichzeitig*
// engagiert sind. Knotenfarbe/-größe nach dominantem Liganden bzw.
// Gesamt-Engagement. Modus-Umschalter Beide / L1 / L2 / Differenz +
// Schwellwert-Slider gegen Überfüllung. Labels rotiert (kein Overlap).
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState } from "react";
import { C, BLUE1, BLUE2, useResize } from "./theme";
import { VizFrame, LigandLegend, Swatch, Note } from "./VizChrome";

const MODES = [
  { id: "both", label: "Beide" },
  { id: "l1", label: "Ligand 1" },
  { id: "l2", label: "Ligand 2" },
  { id: "diff", label: "Differenz" },
];

export default function ChordView({ data, onHoverResidue }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const { width, height } = useResize(wrapRef);
  const [mode, setMode] = useState("both");
  const [thr, setThr] = useState(0.25);
  const [hoverNode, setHoverNode] = useState(null);
  const [hoverChord, setHoverChord] = useState(null);

  const residues = data?.residues || [];
  const chords = data?.chords || [];
  const n = residues.length;

  // Wert/Farbe einer Kante je nach Modus
  const valOf = (c) =>
    mode === "l1" ? c.l1 : mode === "l2" ? c.l2 :
    mode === "diff" ? Math.abs(c.l1 - c.l2) : Math.max(c.l1, c.l2);
  const colOf = (c) =>
    mode === "l1" ? BLUE1 : mode === "l2" ? BLUE2 :
    (c.l1 >= c.l2 ? BLUE1 : BLUE2);

  const maxVal = useMemo(() => {
    let m = 0;
    for (const c of chords) m = Math.max(m, valOf(c));
    return m || 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chords, mode]);

  const visible = useMemo(
    () => chords.map((c, idx) => ({ ...c, idx, v: valOf(c) }))
      .filter((c) => c.v >= thr),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chords, mode, thr],
  );

  if (!n) return <div style={{ color: C.textDim, padding: 24 }}>Keine Daten.</div>;

  const plotH = height;
  const cx = width / 2, cy = plotH / 2;
  const R = Math.max(40, Math.min(width, plotH) / 2 - 78);

  const ang = (i) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  const engMax = Math.max(1e-6, ...residues.map((r) => Math.max(r.l1, r.l2)));

  // Nachbarschaft für Node-Hover
  const touches = (c) => hoverNode != null && (c.i === hoverNode || c.j === hoverNode);

  const wOf = (v) => 0.5 + (v / maxVal) * 4;

  const toolbar = (
    <>
      {MODES.map((m, i) => (
        <div key={m.id} onClick={() => setMode(m.id)} style={{
          padding: "2px 9px", cursor: "pointer", fontWeight: 600, borderRadius: 4,
          background: mode === m.id ? C.accent : "transparent",
          color: mode === m.id ? "#fff" : C.textDim,
          border: `1px solid ${mode === m.id ? C.accent : C.border}`,
          marginLeft: i === 0 ? 0 : -1,
        }}>{m.label}</div>
      ))}
      <span style={{ width: 1, height: 16, background: C.border, margin: "0 6px" }} />
      <span style={{ color: C.textDim }}>Kante ≥</span>
      <input type="range" min={0} max={Math.max(0.05, maxVal)} step={0.01} value={thr}
        onChange={(e) => setThr(parseFloat(e.target.value))} style={{ width: 110 }} />
      <span style={{ fontFamily: "ui-monospace, monospace", color: C.text }}>
        {(thr * 100).toFixed(0)}%
      </span>
      <span style={{ color: C.textMuted }}>· {visible.length} Kanten</span>
    </>
  );

  return (
    <VizFrame
      title="Chord — Residuen-Ko-Vorkommen"
      subtitle="Residuen auf dem Kreis (nach Sequenz). Ein Bogen verbindet zwei Residuen, die gleichzeitig kontaktiert werden; Knotenfarbe = dominanter Ligand, Knotengröße ∝ Engagement."
      toolbar={toolbar}
      legend={<>
        <LigandLegend data={data} />
        <Swatch shape="line" color={C.textDim} label="Bogen = gleichzeitig kontaktiert" />
        <Note>Knoten ∝ Engagement · {n} Residuen</Note>
      </>}
    >
    <div ref={wrapRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <svg ref={svgRef} width={width} height={plotH} style={{ display: "block", background: C.bg }}>
        {/* Chords */}
        {visible.map((c) => {
          const [x1, y1] = pt(R, ang(c.i));
          const [x2, y2] = pt(R, ang(c.j));
          const on = hoverChord === c.idx || touches(c);
          const dim = (hoverNode != null && !touches(c)) || (hoverChord != null && hoverChord !== c.idx);
          return (
            <path key={c.idx} d={`M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx} ${cy} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
              fill="none" stroke={colOf(c)} strokeWidth={on ? wOf(c.v) + 1 : wOf(c.v)}
              opacity={dim ? 0.05 : (on ? 0.95 : 0.12 + (c.v / maxVal) * 0.4)}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoverChord(c.idx)}
              onMouseLeave={() => setHoverChord(null)} />
          );
        })}

        {/* Knoten + Labels */}
        {residues.map((r, i) => {
          const a = ang(i);
          const [nx, ny] = pt(R, a);
          const dom = r.l1 >= r.l2 ? BLUE1 : BLUE2;
          const rad = 2 + Math.sqrt(Math.max(r.l1, r.l2) / engMax) * 5;
          const left = Math.cos(a) < 0;
          const deg = (a * 180) / Math.PI;
          const [lx, ly] = pt(R + 10, a);
          const faded = hoverNode != null && hoverNode !== i
            && !visible.some((c) => c.idx === hoverChord) ? 0.4 : 1;
          return (
            <g key={r.name} opacity={faded}>
              <circle cx={nx} cy={ny} r={rad} fill={dom}
                stroke={hoverNode === i ? "#fff" : "rgba(0,0,0,0.4)"}
                strokeWidth={hoverNode === i ? 1.5 : 0.75}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => { setHoverNode(i); onHoverResidue?.(String(r.name).split("_")[0]); }}
                onMouseLeave={() => { setHoverNode(null); onHoverResidue?.(null); }} />
              <text x={lx} y={ly}
                transform={`rotate(${left ? deg + 180 : deg} ${lx} ${ly})`}
                textAnchor={left ? "end" : "start"} dominantBaseline="middle"
                fontSize={9} fill={hoverNode === i ? C.text : C.textDim}
                style={{ cursor: "pointer", pointerEvents: "none" }}>
                {r.name}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip Kante */}
      {hoverChord != null && (() => {
        const c = chords[hoverChord];
        if (!c) return null;
        return (
          <div style={{ position: "absolute", left: 16, bottom: 28, padding: "6px 10px",
            borderRadius: 4, background: C.surface, border: `1px solid ${colOf(c)}`,
            color: C.text, fontSize: 11, lineHeight: 1.5, pointerEvents: "none", zIndex: 5 }}>
            <div style={{ fontWeight: 600 }}>
              {residues[c.i].name} ↔ {residues[c.j].name}
            </div>
            <div style={{ color: C.textDim }}>
              gleichzeitig engagiert · {data.lig1_name}: {(c.l1 * 100).toFixed(0)}% ·
              {" "}{data.lig2_name}: {(c.l2 * 100).toFixed(0)}%
            </div>
          </div>
        );
      })()}
    </div>
    </VizFrame>
  );
}
