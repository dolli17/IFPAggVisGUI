// ═══════════════════════════════════════════════════════════════════
// ComparisonView — interaktiver Six-Lane-Ligandenvergleich.
//
// Bildet das statische Plot aus dem Basis-Paper 1:1 nach: sechs
// horizontale Spuren (a–c = Ligand 1, d–f = Ligand 2). Linien
// verbinden IFPs, die zwischen oder innerhalb der Liganden identisch
// (cyan) oder ähnlich (rot bzw. ligandenblau) sind.
//
// Lane-Zuordnung wie im Original (`plot_similarity_between_ligands`):
//   within L1 identisch → 0–1 · within L1 ähnlich → 1–2
//   between (id. & ähnl.) → 2–3
//   within L2 ähnlich → 3–4 · within L2 identisch → 4–5
//
// Interaktion: Hover über eine IFP-Spalte hebt alle ihre Verbindungen
// hervor (Rest gedimmt) + Tooltip. Klick auf eine IFP-Spalte selektiert
// den darunterliegenden Struktur-Cluster → propagiert via App in alle
// anderen Tabs (Cross-Ligand: schaltet ggf. den aktiven Liganden um).
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { VizFrame, Swatch, Note } from "./comparison/VizChrome";
import { C } from "./comparison/theme";

// Farben 1:1 aus dem Matplotlib-Plot (tab20 / tab20c).
// Bewusst LOKAL (nicht aus theme.js): Six-Lane bleibt paper-treu.
const BLUE1 = "#1f77b4";  // Ligand 1 + Within-L1-Linien
const BLUE2 = "#6baed6";  // Ligand 2 + Within-L2-Linien
const RED = "#d62728";    // ähnlich zwischen Liganden
const CYAN = "#17becf";   // identisch zwischen Liganden

const LANE_LABELS = ["a)", "b)", "c)", "d)", "e)", "f)"];

// Welche zwei Spuren verbindet eine Connection? (src an [0], dst an [1])
function lanesFor(conn) {
  if (conn.scope === "between") return [2, 3];
  if (conn.lig === 1) return conn.category === "identical" ? [0, 1] : [1, 2];
  return conn.category === "identical" ? [4, 5] : [3, 4];
}

function colorFor(conn) {
  if (conn.scope === "between") return conn.category === "identical" ? CYAN : RED;
  return conn.lig === 1 ? BLUE1 : BLUE2;
}

export default function ComparisonView({
  data,                 // comparison payload
  selectedClusters,     // number[] — aktiver-Ligand-Cluster-IDs
  activeLigand,         // 1 | 2
  onSelectIfp,          // (lig, clusterId, additive) => void
}) {
  const svgRef = useRef(null);
  const wrapperRef = useRef(null);
  const [size, setSize] = useState({ width: 900, height: 520 });
  const [hover, setHover] = useState(null);   // { lig, local, merged, x, y }
  // Default: nur Inter-Ligand-Verbindungen — die eigentliche Vergleichs-
  // Aussage. Die Intra-Ligand-Verbindungen (typisch zehntausende, dominiert
  // von "ähnlich innerhalb") erschlügen sie sonst und sind über die anderen
  // Tabs ohnehin zugänglich. Per Toggle zuschaltbar.
  const [filters, setFilters] = useState({
    identical: true, similar: true, within: false, between: true,
  });

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setSize({ width, height });
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  const { width, height } = size;
  const plotH = height;

  const MARGIN = { top: 28, right: 24, bottom: 28, left: 56 };
  const innerW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(10, plotH - MARGIN.top - MARGIN.bottom);

  const n1 = data?.n1 ?? 0;
  const n2 = data?.n2 ?? 0;
  const xMax = Math.max(1, n1 - 1, n2 - 1);

  // Geometrie-Helfer
  const laneY = (i) => MARGIN.top + (i / 5) * innerH;
  const xScale = (local) => MARGIN.left + (local / xMax) * innerW;
  const localOf = (mi) => (mi < n1 ? mi : mi - n1);
  const mergedOf = (lig, local) => (lig === 1 ? local : n1 + local);

  // Gefilterte Connections (für Basis-Layer + Highlight-Lookup).
  const conns = useMemo(() => {
    const all = data?.connections || [];
    return all.filter((c) =>
      (c.category === "identical" ? filters.identical : filters.similar) &&
      (c.scope === "within" ? filters.within : filters.between));
  }, [data, filters]);

  // Adjazenz: merged_index → Indizes in `conns` (für schnelles Hover-Highlight).
  const adjacency = useMemo(() => {
    const m = new Map();
    conns.forEach((c, i) => {
      (m.get(c.src) || m.set(c.src, []).get(c.src)).push(i);
      (m.get(c.dst) || m.set(c.dst, []).get(c.dst)).push(i);
    });
    return m;
  }, [conns]);

  // Pfad-Segment einer Connection als SVG-Path-Befehl ("Mx yLx y").
  // Geht über `lanesFor` (src an Spur[0], dst an Spur[1]).
  const segCmd = (c) => {
    const [la, lb] = lanesFor(c);
    const x1 = xScale(localOf(c.src)), y1 = laneY(la);
    const x2 = xScale(localOf(c.dst)), y2 = laneY(lb);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };

  // ── Basis-Layer: alle Linien einer Stil-Gruppe (Farbe + Deckkraft)
  //    zu EINEM <path> zusammengefasst. So entstehen ~4 DOM-Knoten statt
  //    zehntausender <line>-Elemente — entscheidend für die Performance. ──
  const basePathGroups = useMemo(() => {
    const groups = new Map();
    for (const c of conns) {
      const color = colorFor(c);
      const op = c.scope === "between" ? 0.42 : 0.16;
      const key = `${color}|${op}`;
      let g = groups.get(key);
      if (!g) { g = { color, op, parts: [] }; groups.set(key, g); }
      g.parts.push(segCmd(c));
    }
    return [...groups.values()].map((g) => ({
      color: g.color, op: g.op, d: g.parts.join(""),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conns, innerW, innerH, n1, xMax]);

  // ── Highlight-Layer: nur die Verbindungen des gehoverten IFP, ebenfalls
  //    pro Farbe zu einem <path> gebündelt. ──
  const highlightIdx = useMemo(() => {
    if (!hover) return [];
    return adjacency.get(hover.merged) || [];
  }, [hover, adjacency]);

  const highlightPathGroups = useMemo(() => {
    if (!highlightIdx.length) return [];
    const groups = new Map();
    for (const ci of highlightIdx) {
      const c = conns[ci];
      const color = colorFor(c);
      let g = groups.get(color);
      if (!g) { g = []; groups.set(color, g); }
      g.push(segCmd(c));
    }
    return [...groups.entries()].map(([color, parts]) => ({
      color, d: parts.join(""),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightIdx, conns, innerW, innerH, n1, xMax]);

  // ── Selektierte IFPs (aus anderen Tabs gespiegelt): Cluster-ID des
  //    aktiven Liganden ∈ selectedClusters. ──
  const selectedMerged = useMemo(() => {
    const sel = new Set(selectedClusters || []);
    if (!sel.size) return [];
    const out = [];
    for (const ifp of data?.ifps || []) {
      if (ifp.lig === activeLigand && ifp.cluster_id != null
          && sel.has(ifp.cluster_id)) {
        out.push(ifp);
      }
    }
    return out;
  }, [data, selectedClusters, activeLigand]);

  if (!data) return null;

  // Maus-Handling pro Liganden-Band: nächstgelegenes IFP über x bestimmen.
  // Entprellt: solange die Maus in derselben IFP-Spalte bleibt, wird der
  // State NICHT geändert (React bricht das Re-Render ab) — verhindert ein
  // Re-Render pro Pixel.
  const handleBand = (lig, n) => (evt) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = evt.clientX - rect.left;
    let local = Math.round(((mx - MARGIN.left) / innerW) * xMax);
    local = Math.max(0, Math.min(n - 1, local));
    const merged = mergedOf(lig, local);
    const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
    setHover((prev) =>
      prev && prev.merged === merged && prev.lig === lig
        ? prev
        : { lig, local, merged, x, y });
  };

  const clickBand = (lig, n) => (evt) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = evt.clientX - rect.left;
    let local = Math.round(((mx - MARGIN.left) / innerW) * xMax);
    local = Math.max(0, Math.min(n - 1, local));
    const ifp = (data.ifps || [])[mergedOf(lig, local)];
    if (ifp && ifp.cluster_id != null) {
      onSelectIfp?.(lig, ifp.cluster_id, evt.metaKey || evt.ctrlKey || evt.shiftKey);
    }
  };

  const band1Top = laneY(0) - 8, band1Bot = laneY(2) + 8;
  const band2Top = laneY(3) - 8, band2Bot = laneY(5) + 8;

  const hoverIfp = hover ? (data.ifps || [])[hover.merged] : null;

  const FilterChip = ({ k, label, color }) => (
    <div onClick={() => setFilters((f) => ({ ...f, [k]: !f[k] }))}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "2px 8px", borderRadius: 4, cursor: "pointer",
        fontSize: 11, userSelect: "none",
        background: filters[k] ? C.surfaceLight : "transparent",
        border: `1px solid ${filters[k] ? C.border : "transparent"}`,
        color: filters[k] ? C.text : C.textMuted,
      }}>
      <span style={{ width: 14, height: 3, borderRadius: 2,
        background: color, opacity: filters[k] ? 1 : 0.3 }} />
      {label}
    </div>
  );

  const toolbar = (
    <>
      <FilterChip k="identical" label="identisch" color={CYAN} />
      <FilterChip k="similar" label="ähnlich" color={RED} />
      <span style={{ width: 1, height: 16, background: C.border }} />
      <FilterChip k="between" label="zwischen" color={C.text} />
      <FilterChip k="within" label="innerhalb" color={C.textDim} />
      <div style={{ flex: 1 }} />
      <span style={{ color: C.textMuted, fontSize: 10 }}>
        {data.stats?.identical_between ?? 0} ident. /{" "}
        {data.stats?.similar_between ?? 0} ähnl. zwischen Liganden ·{" "}
        {data.lig1_name} ({n1}) vs {data.lig2_name} ({n2})
      </span>
    </>
  );

  return (
    <VizFrame
      title="Six-Lane — Ligandenvergleich (Paper-Layout)"
      subtitle="Sechs Spuren: a–c = Ligand 1, d–f = Ligand 2. Linien verbinden IFPs, die zwischen oder innerhalb der Liganden identisch bzw. ähnlich sind. Hover hebt alle Verbindungen einer IFP hervor, Klick selektiert deren Structural IFP."
      toolbar={toolbar}
      legend={<>
        <Swatch shape="line" color={CYAN} label="identisch (zwischen Liganden)" />
        <Swatch shape="line" color={RED} label="ähnlich (zwischen Liganden)" />
        <Swatch shape="line" color={BLUE1} label="innerhalb Ligand 1" />
        <Swatch shape="line" color={BLUE2} label="innerhalb Ligand 2" />
        <Note>Auswahl aus anderen Tabs erscheint als rosa Markierung</Note>
      </>}
    >
      <div ref={wrapperRef} style={{ width: "100%", height: "100%", position: "relative" }}>
        <svg ref={svgRef} width={width} height={plotH}
          style={{ display: "block", background: C.bg }}>
          {/* Spuren */}
          {LANE_LABELS.map((lab, i) => {
            const lig = i < 3 ? 1 : 2;
            const n = lig === 1 ? n1 : n2;
            const y = laneY(i);
            return (
              <g key={i}>
                <line x1={MARGIN.left} y1={y}
                  x2={xScale(Math.max(0, n - 1))} y2={y}
                  stroke={lig === 1 ? BLUE1 : BLUE2} strokeWidth={2} />
                <text x={MARGIN.left - 12} y={y + 4}
                  textAnchor="end" fontSize={11} fill={C.textDim}>
                  {lab}
                </text>
              </g>
            );
          })}

          {/* Ligand-Beschriftung */}
          <text x={MARGIN.left - 44} y={laneY(1) + 4} fontSize={11}
            fill={BLUE1} fontWeight={600} transform={`rotate(-90 ${MARGIN.left - 44} ${laneY(1)})`}
            textAnchor="middle">{data.lig1_name}</text>
          <text x={MARGIN.left - 44} y={laneY(4) + 4} fontSize={11}
            fill={BLUE2} fontWeight={600} transform={`rotate(-90 ${MARGIN.left - 44} ${laneY(4)})`}
            textAnchor="middle">{data.lig2_name}</text>

          {/* Basis-Verbindungen (gedimmt), je Stil-Gruppe ein Path */}
          <g opacity={hover ? 0.35 : 1}>
            {basePathGroups.map((g, i) => (
              <path key={i} d={g.d} stroke={g.color} strokeWidth={0.6}
                fill="none" opacity={g.op} />
            ))}
          </g>

          {/* Selektierte IFP-Marker (aus anderen Tabs) */}
          {selectedMerged.map((ifp) => {
            const x = xScale(ifp.local_index);
            const yTop = ifp.lig === 1 ? laneY(0) : laneY(3);
            const yBot = ifp.lig === 1 ? laneY(2) : laneY(5);
            return (
              <line key={`sel-${ifp.merged_index}`} x1={x} y1={yTop} x2={x} y2={yBot}
                stroke={C.pink} strokeWidth={1.5} opacity={0.9} />
            );
          })}

          {/* Highlight-Verbindungen des gehoverten IFP (je Farbe ein Path) */}
          {highlightPathGroups.map((g, i) => (
            <path key={`hl-${i}`} d={g.d} stroke={g.color} strokeWidth={1.8}
              fill="none" opacity={1} />
          ))}

          {/* Gehoverte IFP-Spalte */}
          {hover && (() => {
            const x = xScale(hover.local);
            const yTop = hover.lig === 1 ? laneY(0) : laneY(3);
            const yBot = hover.lig === 1 ? laneY(2) : laneY(5);
            return (
              <line x1={x} y1={yTop} x2={x} y2={yBot}
                stroke="#fff" strokeWidth={1} opacity={0.7} pointerEvents="none" />
            );
          })()}

          {/* Maus-Bänder (transparent, fangen Hover + Klick ab) */}
          <rect x={MARGIN.left} y={band1Top}
            width={Math.max(0, xScale(Math.max(0, n1 - 1)) - MARGIN.left)}
            height={band1Bot - band1Top} fill="transparent"
            style={{ cursor: "pointer" }}
            onMouseMove={handleBand(1, n1)}
            onMouseLeave={() => setHover(null)}
            onClick={clickBand(1, n1)} />
          <rect x={MARGIN.left} y={band2Top}
            width={Math.max(0, xScale(Math.max(0, n2 - 1)) - MARGIN.left)}
            height={band2Bot - band2Top} fill="transparent"
            style={{ cursor: "pointer" }}
            onMouseMove={handleBand(2, n2)}
            onMouseLeave={() => setHover(null)}
            onClick={clickBand(2, n2)} />

          <text x={MARGIN.left} y={plotH - 8} fontSize={10} fill={C.textMuted}>
            IFP-Index →
          </text>
        </svg>

        {/* Tooltip */}
        {hover && hoverIfp && (
          <div style={{
            position: "absolute",
            left: Math.min(hover.x + 16, width - 200),
            top: hover.y + 12,
            padding: "6px 10px", borderRadius: 4,
            background: C.surface,
            border: `1px solid ${hover.lig === 1 ? BLUE1 : BLUE2}`,
            color: C.text, fontSize: 11, lineHeight: 1.5,
            pointerEvents: "none", zIndex: 5, minWidth: 150,
          }}>
            <div style={{ fontWeight: 600 }}>
              {hover.lig === 1 ? data.lig1_name : data.lig2_name} · IFP #{hover.local}
            </div>
            <div style={{ color: C.textDim }}>
              Structural IFP {hoverIfp.cluster_id ?? "—"} · {hoverIfp.occurence} Frames
            </div>
            <div style={{ color: C.textMuted, fontSize: 10 }}>
              {highlightIdx.length} Verbindung{highlightIdx.length === 1 ? "" : "en"}
              {hoverIfp.cluster_id != null ? " · Klick = Structural IFP selektieren" : ""}
            </div>
          </div>
        )}
      </div>
    </VizFrame>
  );
}
