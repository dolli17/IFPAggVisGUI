import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as api from "./api";
import NetworkView from "./NetworkView";
import OccurrenceView from "./OccurrenceView";
import HeatmapView from "./HeatmapView";
import CircleView from "./CircleView";
import ClusterTableView from "./ClusterTableView";
import UmapView from "./UmapView";
import ComparisonTab from "./ComparisonTab";
import { buildClusterColors, CLUSTER_TOP_K } from "./clusterColors";
import { C, FS, SP, R, BLUE1, BLUE2 } from "./comparison/theme";
import { Button as Btn, Spinner, EmptyState } from "./ui";

// ─── Reusable small components ───────────────────────────────────
// Cluster strip: thin horizontal band that mirrors the slider, one
// coloured tick per IFP. Same colours as the OccurrenceView band.
// Hover = tooltip, click = jump to that frame (or to the cluster's
// representative if Shift/Cmd/Ctrl).
function ClusterStrip({
  cids, clusterColors, selectedClusters,
  currentFrame, onSelectFrame, onSelectCluster,
  siblingIndices,    // optional: indices of frames in same cluster as currentFrame
  matchingIfps,      // optional: Set<number> of IFP indices matching residue discovery
}) {
  const ref = useRef(null);
  const [width, setWidth] = useState(600);
  const [hoverIdx, setHoverIdx] = useState(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.contentRect.width > 0) setWidth(e.contentRect.width);
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  if (!cids?.length || !clusterColors) return null;
  const H = 10;
  const SEL = 4;
  const innerW = Math.max(20, width);
  const xOf = (i) => (i / cids.length) * innerW;
  const wOf = (i) => Math.max(0.5, xOf(i + 1) - xOf(i));
  const selSet = new Set(selectedClusters || []);
  const handleMove = (e) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const xRel = e.clientX - rect.left;
    const i = Math.max(0, Math.min(cids.length - 1,
      Math.floor((xRel / innerW) * cids.length)));
    setHoverIdx(i);
  };
  const handleClick = (e) => {
    if (hoverIdx == null) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      // Cmd/Ctrl/Shift+klick on the strip toggles the cluster in the
      // selection set — same semantics as cluster band / table row.
      onSelectCluster?.(cids[hoverIdx], true);
    } else {
      onSelectFrame?.(hoverIdx);
    }
  };
  const hovCid = hoverIdx != null ? cids[hoverIdx] : null;
  const markerX = (currentFrame != null && currentFrame >= 0
                   && currentFrame < cids.length)
    ? xOf(currentFrame) + wOf(currentFrame) / 2 : null;
  // Reserve space above (sibling ticks) and below (discovery marks).
  const TICK_SPACE = 4;
  const BELOW_SPACE = 3;
  return (
    <div ref={ref} style={{
      position: "relative", padding: "0 16px 6px",
    }}>
      <svg width="100%" height={H + SEL + TICK_SPACE + BELOW_SPACE + 6}
        style={{ display: "block", cursor: "pointer", overflow: "visible" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={handleClick}>
        <g transform={`translate(0, ${SEL / 2 + TICK_SPACE})`}>
          {cids.map((cid, i) => {
            const isSel = selSet.has(cid);
            return (
              <rect key={i}
                x={xOf(i)}
                y={isSel ? -SEL / 2 : 0}
                width={wOf(i)}
                height={H + (isSel ? SEL : 0)}
                fill={clusterColors.colorOf(cid)}
                shapeRendering="crispEdges" />
            );
          })}
          {/* Discovery-match marks — thin white bar UNDER the strip
              for every IFP matching the active residue discovery. */}
          {matchingIfps && matchingIfps.size > 0
            && Array.from(matchingIfps).map((i) => {
              if (i < 0 || i >= cids.length) return null;
              return (
                <rect key={`m${i}`}
                  x={xOf(i)} y={H}
                  width={wOf(i)} height={2}
                  fill="#ffffff" fillOpacity={0.85}
                  pointerEvents="none" />
              );
            })}

          {/* Sibling-frame ticks — above the strip, one per IFP in the
              current frame's cluster (except the active one). */}
          {siblingIndices?.length > 1 && siblingIndices.map((i) => {
            if (i === currentFrame) return null;
            if (i < 0 || i >= cids.length) return null;
            const cx = xOf(i) + wOf(i) / 2;
            return (
              <line key={`sib${i}`}
                x1={cx} x2={cx}
                y1={-SEL / 2 - 3} y2={-SEL / 2 - 0.5}
                stroke={C.pink} strokeWidth={1.2}
                pointerEvents="none" />
            );
          })}

          {markerX != null && (
            <line x1={markerX} x2={markerX}
              y1={-SEL / 2 - 1} y2={H + SEL / 2 + 1}
              stroke={C.pink} strokeWidth={1.5} />
          )}
        </g>
      </svg>
      {hoverIdx != null && hovCid != null && (
        <div style={{
          position: "absolute", left: 16, top: -4,
          transform: "translateY(-100%)",
          background: C.bg, border: `1px solid ${clusterColors.colorOf(hovCid)}`,
          padding: "3px 7px", borderRadius: 4, fontSize: 10,
          color: C.text, pointerEvents: "none", whiteSpace: "nowrap",
          zIndex: 10,
        }}>
          IFP #{hoverIdx} · Structural IFP {hovCid}
          <span style={{ color: C.textDim, marginLeft: 6 }}>
            Klick = Frame · ⌘/Ctrl+Klick = Structural IFP
          </span>
        </div>
      )}
    </div>
  );
}

// SelectionStatusBar — sticky bar under the tab strip, only visible
// when *something* is selected. Centralises the answer to "what am I
// looking at right now?" so the user never has to scan four panels to
// find their selection state. Each pill has an "×" to remove that
// particular axis without affecting the others.
function SelectionStatusBar({
  residues,                  // string[]
  onRemoveResidue,
  onClearResidues,
  discoveryMode,             // "AND" | "OR"
  onToggleDiscoveryMode,
  matchingIfpsCount,         // number | null
  matchingClustersCount,     // number | null
  selectedClusters,          // number[]
  onRemoveCluster,
  clusterColors,
  currentFrame,
  totalFrames,
  onClearFrame,
  rangeFilter,               // { start, end } | null
  onClearRange,
  onClearAll,
}) {
  const anyResidue = residues.length > 0;
  const anyCluster = selectedClusters.length > 0;
  const anyRange = rangeFilter != null;
  const hasFrameInfo = currentFrame != null && totalFrames > 0;
  if (!anyResidue && !anyCluster && !anyRange) {
    // Compact hint bar when nothing is selected — explains the three axes
    return null;
  }
  return (
    <div style={{
      display: "flex", alignItems: "flex-start",
      gap: 10, padding: "6px 16px",
      background: C.surfaceLight,
      borderBottom: `1px solid ${C.border}`,
      fontSize: 11,
    }}>
      <span style={{ color: C.textDim, fontWeight: 600, flexShrink: 0, paddingTop: 2 }}>
        🔎 Aktiv:
      </span>
      {/* Scrollbarer Pill-Bereich — kappt die Höhe bei vielen Pills (z.B.
          viele Cluster), damit die Visualisierungen darunter nicht gestaucht
          werden. Inhalt scrollt vertikal, "Alles löschen" bleibt fixiert. */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", flexWrap: "wrap",
        gap: 10, maxHeight: 60, overflowY: "auto",
      }}>

      {/* Residue pills */}
      {anyResidue && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {residues.map((r) => (
            <span key={r} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 4px 2px 8px", borderRadius: 10,
              background: C.pinkDim, color: C.pink,
              border: `1px solid ${C.pink}`,
              fontSize: 10, fontWeight: 600,
            }}>
              {r}
              <span onClick={() => onRemoveResidue(r)}
                style={{
                  cursor: "pointer", padding: "0 4px", fontSize: 12,
                  lineHeight: 1, opacity: 0.8,
                }} title="Residuum entfernen">×</span>
            </span>
          ))}
          {residues.length > 1 && (
            <button onClick={onToggleDiscoveryMode}
              title={`Modus wechseln — ${discoveryMode === "AND" ? "alle Residuen müssen vorkommen" : "mindestens eine Residuum"}`}
              style={{
                padding: "2px 8px", borderRadius: 4,
                background: discoveryMode === "AND" ? C.accent : C.pink,
                color: "#fff", border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 600,
              }}>
              {discoveryMode}
            </button>
          )}
          {matchingIfpsCount != null && (
            <span style={{ color: C.text, fontSize: 10 }}>
              {" → "}
              <span style={{ color: C.pink, fontWeight: 600 }}>
                {matchingIfpsCount}
              </span>
              {" IFPs in "}
              <span style={{ color: C.pink, fontWeight: 600 }}>
                {matchingClustersCount}
              </span>
              {" Structural IFPs"}
            </span>
          )}
        </div>
      )}

      {/* Vertical separator */}
      {anyResidue && anyCluster && (
        <span style={{ color: C.border, fontSize: 14 }}>│</span>
      )}

      {/* Cluster pills */}
      {anyCluster && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <span style={{ color: C.textDim, fontSize: 10 }}>Structural IFP:</span>
          {selectedClusters.map((cid) => (
            <span key={cid} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 4px 2px 6px", borderRadius: 10,
              background: clusterColors?.colorOf(cid) || C.surface,
              color: "#fff", fontSize: 10, fontWeight: 600,
              border: "1px solid rgba(255,255,255,0.2)",
            }}>
              {cid}
              <span onClick={() => onRemoveCluster(cid)}
                style={{
                  cursor: "pointer", padding: "0 4px", fontSize: 12,
                  lineHeight: 1, opacity: 0.8,
                }} title="Structural IFP entfernen">×</span>
            </span>
          ))}
        </div>
      )}

      {/* Range filter pill */}
      {anyRange && (
        <>
          {(anyResidue || anyCluster) && (
            <span style={{ color: C.border, fontSize: 14 }}>│</span>
          )}
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 4px 2px 8px", borderRadius: 10,
            background: "rgba(108,123,212,0.15)", color: C.accent,
            border: `1px solid ${C.accent}`,
            fontSize: 10, fontWeight: 600,
          }}
          title="Aktiver IFP-Bereich (Brush in Vorkommen oder Distanzmatrix)">
            IFPs {rangeFilter.start}–{rangeFilter.end}
            {" "}
            <span style={{ color: C.textMuted, fontWeight: 400 }}>
              ({rangeFilter.end - rangeFilter.start + 1})
            </span>
            <span onClick={onClearRange}
              style={{
                cursor: "pointer", padding: "0 4px", fontSize: 12,
                lineHeight: 1, opacity: 0.85,
              }} title="Bereichsfilter entfernen">×</span>
          </span>
        </>
      )}

      {/* Frame info */}
      {hasFrameInfo && (anyResidue || anyCluster || anyRange) && (
        <>
          <span style={{ color: C.border, fontSize: 14 }}>│</span>
          <span style={{ color: C.textDim, fontSize: 10 }}>
            Frame: <span style={{ color: C.accent, fontWeight: 600 }}>{currentFrame}</span>
            <span style={{ color: C.textMuted }}>/{totalFrames - 1}</span>
          </span>
        </>
      )}

      </div>

      <button onClick={onClearAll}
        title="Alle Selektionen zurücksetzen"
        style={{
          padding: "2px 10px", borderRadius: 4,
          background: "transparent", color: C.textDim,
          border: `1px solid ${C.border}`, cursor: "pointer",
          fontSize: 10, fontWeight: 600, flexShrink: 0,
        }}>
        ✕ Alles löschen
      </button>
    </div>
  );
}

function SectionHeader({ label, open, onToggle }) {
  return (
    <div onClick={onToggle} style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`,
      background: C.surfaceLight, userSelect: "none",
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: C.text, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
      <span style={{ color: C.textDim, fontSize: 12, transform: open ? "rotate(0)" : "rotate(-90deg)", transition: "transform .15s" }}>&#9662;</span>
    </div>
  );
}

function Slider({ label, value, onChange, min, max, step }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2, fontSize: 11 }}>
        <span style={{ color: C.textDim }}>{label}</span>
        <span style={{ color: C.accent, fontWeight: 600 }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step || 1} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%" }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 3D VIEWER COMPONENT
// ═══════════════════════════════════════════════════════════════════
// Residuum-Label ("MN400", "ASP42.A") → 3Dmol-resi-Nummer (oder null).
function resiOf(label) {
  const match = String(label).replace(/\..+$/, "").match(/^([A-Z]+)(\d+)$/);
  return match ? parseInt(match[2]) : null;
}

// Lineare Interpolation zwischen zwei Hex-Farben (t∈[0,1]) → "#rrggbb".
function lerpHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

// residueColors: optionale { [resi:number]: colorString } — Difference-Map
// o.ä. Wird unter den (pinken) highlightResidues gezeichnet, sodass die
// aktive Cluster-/Hover-Auswahl die Flächenfärbung überlagert.
function Viewer3D({ pdbData, highlightResidues, residueColors, baseColor = "#6c7bd4" }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !window.$3Dmol) return;
    // Rotation/Zoom über pdbData-Updates (z.B. Trajektorien-Frame) halten:
    // vor dem Leeren die aktuelle Kamera merken und danach wiederherstellen.
    // zoomTo() läuft nur bei der allerersten Ausrichtung.
    let savedView = null;
    if (viewerRef.current) {
      savedView = viewerRef.current.getView();
      viewerRef.current.clear();
    } else {
      viewerRef.current = window.$3Dmol.createViewer(containerRef.current, {
        // Weißer Hintergrund: Protein- und Ligandenstruktur heben sich
        // deutlich besser ab als auf dem dunklen App-Hintergrund.
        backgroundColor: "#ffffff",
      });
    }
    if (pdbData) {
      viewerRef.current.addModel(pdbData, "pdb");
      viewerRef.current.setStyle({}, { cartoon: { color: baseColor } });
      viewerRef.current.setStyle({ hetflag: true }, { stick: { colorscheme: "greenCarbon" } });
      if (savedView) {
        viewerRef.current.setView(savedView);
      } else {
        viewerRef.current.zoomTo();
      }
      viewerRef.current.render();
    }
    // baseColor bewusst NICHT als Dep: Farbwechsel (Modus-Umschaltung) wird vom
    // zweiten Effekt angewandt; dieser Effekt soll nur bei pdbData neu laden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdbData]);

  // Styling-Layer: Basis-Style → Δ-Färbung (residueColors) → Highlight (pink).
  // Vorherige Selektion wird durch erneutes Setzen des Basis-Styles verworfen.
  useEffect(() => {
    if (!viewerRef.current || !pdbData) return;
    viewerRef.current.setStyle({}, { cartoon: { color: baseColor } });
    viewerRef.current.setStyle({ hetflag: true }, { stick: { colorscheme: "greenCarbon" } });
    if (residueColors) {
      for (const [resi, color] of Object.entries(residueColors)) {
        viewerRef.current.addStyle({ resi: parseInt(resi) },
          { cartoon: { color }, stick: { color } });
      }
    }
    for (const label of highlightResidues || []) {
      const resi = resiOf(label);
      if (resi != null) {
        viewerRef.current.addStyle({ resi }, { stick: { color: "#f472b6" } });
      }
    }
    viewerRef.current.render();
  }, [highlightResidues, residueColors, pdbData, baseColor]);

  return (
    <div ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative", background: "#ffffff" }} />
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  // ── Session state ──
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState({});
  const [error, setError] = useState(null);
  const [ligandNameModal, setLigandNameModal] = useState(null); // { file, isSecond, name } | null

  // ── UI state ──
  const [tab, setTab] = useState("overview");
  const [viewMode, setViewMode] = useState("ligand"); // "ligand" or "comparison"
  const [activeLigand, setActiveLigand] = useState(1);
  const [sections, setSections] = useState({ data: true, pipeline: true, filter: true });
  const [networkFrame, setNetworkFrame] = useState(0);
  const [x1Filter, setX1Filter] = useState(1.0);
  const [x2Filter, setX2Filter] = useState(0.2);
  const [viewerWidth, setViewerWidth] = useState(280);
  const isDragging = useRef(false);

  // ── Visualization data ──
  const [vizData, setVizData] = useState({});
  const [pdbData, setPdbData] = useState(null);
  // Vergleichs-Modus: beide Liganden-Strukturen gleichzeitig im rechten
  // Panel (Dual-Viewer). `viewer3dMode` schaltet die Struktur-Färbung um:
  //   "cluster" — aktive Residuen des selektierten Clusters (pink)
  //   "diff"    — Difference-Map (Belegung L1 vs L2, ligandenfarbig)
  const [comparisonPdb, setComparisonPdb] = useState({ 1: null, 2: null });
  const [viewer3dMode, setViewer3dMode] = useState("cluster");
  // Transientes Residuum aus Hover über Residuen-/Chord-View (beide Viewer).
  const [hoverResidue3D, setHoverResidue3D] = useState(null);
  // Multi-selection: array of residue labels. The *last* element is the
  // "primary" — that's what the 3D viewer focuses and what the circle
  // chart's focus pane shows. All elements get highlighted in the
  // network view and the circle sidebar.
  const [highlightResidues, setHighlightResidues] = useState([]);
  const primaryResidue = highlightResidues.length
    ? highlightResidues[highlightResidues.length - 1] : null;

  // Helper: toggle a residue in the selection.
  //   additive=false  -> replace selection with [label]   (plain click)
  //   additive=true   -> add or remove (Cmd/Ctrl/Shift+click)
  const selectResidue = useCallback((label, additive) => {
    if (!label) {
      setHighlightResidues([]);
      return;
    }
    setHighlightResidues(prev => {
      if (!additive) return [label];
      if (prev.includes(label)) return prev.filter(l => l !== label);
      return [...prev, label];
    });
  }, []);

  // Structural cluster selection — third linked-view axis alongside
  // highlightResidues and networkFrame. Selecting a cluster propagates:
  //   - networkFrame ← cluster.representative_ifp (drives 3D viewer too)
  //   - highlightResidues ← cluster.active_residues (drives circle/network highlight)
  const [selectedClusters, setSelectedClusters] = useState([]);
  // Pending cross-ligand selection from the comparison view: when an IFP
  // of the *other* ligand is clicked we first switch activeLigand + load
  // its cluster payload, then apply the selection once that data is ready.
  const [pendingClusterSelect, setPendingClusterSelect] = useState(null);
  // Residue-discovery mode: AND = cluster must contain *all* highlighted
  // residues, OR = at least one. Default AND (more selective).
  const [discoveryMode, setDiscoveryMode] = useState("AND");

  // Range-Filter (Phase B5) — { start, end } | null.
  // Set when the user brushes a range on the occurrence plot or
  // distance matrix. Everything downstream (occurrence/heatmap zoom,
  // frame slider clamp, cluster table filter) reads this. Cleared via
  // the status-bar × pill.
  const [rangeFilter, setRangeFilter] = useState(null);
  const clearRangeFilter = useCallback(() => setRangeFilter(null), []);
  const applyRangeFilter = useCallback((start, end) => {
    if (start == null || end == null) { setRangeFilter(null); return; }
    const lo = Math.max(0, Math.min(start, end) | 0);
    const hi = Math.max(start, end) | 0;
    if (hi - lo < 1) { setRangeFilter(null); return; }
    setRangeFilter({ start: lo, end: hi });
    // Pull networkFrame into the range if it sits outside, so the
    // 3D viewer doesn't keep showing a frame the user just zoomed away
    // from. Set inside the callback so we don't subscribe to
    // networkFrame in deps.
    setNetworkFrame(f => {
      if (f >= lo && f <= hi) return f;
      return lo;
    });
  }, []);

  // Configurable "N" values (defaults reproduce the previous fixed
  // behaviour exactly). clusterTopK colours the single-ligand cluster
  // views (frontend-only recolour); cmpClusterTopK and chordMax gate
  // backend slices and trigger a targeted refetch of their view.
  const [clusterTopK, setClusterTopK] = useState(CLUSTER_TOP_K);
  const [cmpClusterTopK, setCmpClusterTopK] = useState(30);
  const [chordMax, setChordMax] = useState(600);

  // Resolve cluster colours for the active ligand's cluster payload.
  // Memoised so the (Hamming + HSL-shift) ramp only runs when the
  // cluster data or the chosen top-K actually changes, not on every
  // keystroke.
  const clusterData = vizData[`clusters_${activeLigand}`];
  const clusterColors = useMemo(
    () => buildClusterColors(clusterData?.clusters, clusterTopK),
    [clusterData, clusterTopK],
  );

  // Filtered cluster data for ClusterTableView when a range filter is
  // active. Filters clusters to those that have ≥1 IFP in the range
  // and *recomputes* per-cluster frame_count / frame_fraction /
  // ifp_count / ifp_indices / n_active etc. on the range — so the
  // cluster table reflects "what binding modes are dominant within
  // this window?" instead of trajectory-global totals.
  // Occurrence values per IFP come from the occurrence payload; if
  // it's not loaded yet we fall back to ifp-count as the frame proxy
  // so the table still renders sanely.
  const filteredClusterData = useMemo(() => {
    if (!rangeFilter || !clusterData) return clusterData;
    const { start, end } = rangeFilter;
    const cpi = clusterData.cluster_id_per_ifp || [];
    const occ = vizData[`occurrence_${activeLigand}`]?.occurrence || null;
    // Tally IFP indices per cluster within [start, end]
    const perCluster = new Map();
    let totalFrames = 0;
    for (let i = start; i <= end && i < cpi.length; i++) {
      const cid = cpi[i];
      if (cid == null || cid < 0) continue;
      const w = occ ? (occ[i] || 0) : 1;
      totalFrames += w;
      let entry = perCluster.get(cid);
      if (!entry) {
        entry = { ifp_indices: [], frame_count: 0 };
        perCluster.set(cid, entry);
      }
      entry.ifp_indices.push(i);
      entry.frame_count += w;
    }
    // Build cluster summaries, keeping the original sort order
    // (frame_count desc within the range).
    const out = [];
    for (const c of clusterData.clusters) {
      const e = perCluster.get(c.cluster_id);
      if (!e) continue;
      out.push({
        ...c,
        ifp_indices: e.ifp_indices,
        ifp_count: e.ifp_indices.length,
        frame_count: e.frame_count,
        frame_fraction: totalFrames ? e.frame_count / totalFrames : 0,
        representative_ifp: e.ifp_indices[0],
      });
    }
    out.sort((a, b) => b.frame_count - a.frame_count);
    return {
      ...clusterData,
      clusters: out,
      n_clusters: out.length,
      total_frames: totalFrames,
      n_ifps: end - start + 1,
      // cluster_id_per_ifp + interaction_columns stay global — they
      // are used by other views for absolute IFP-index positioning.
    };
  }, [clusterData, rangeFilter, vizData, activeLigand]);

  // ── Sibling frames in the same structural cluster as the current
  // frame. Derived; no state. Used to mark "the other Frames that
  // share this binding mode" in OccurrenceView, the cluster strip,
  // and the frame-slider status line. Empty if there's no cluster
  // data yet or the cluster is a singleton.
  const currentClusterId = clusterData?.cluster_id_per_ifp?.[networkFrame] ?? null;
  const currentClusterSiblings = useMemo(() => {
    if (currentClusterId == null || !clusterData?.clusters) return null;
    return clusterData.clusters[currentClusterId]?.ifp_indices ?? null;
  }, [clusterData, currentClusterId]);
  // Position of the current frame within the sibling list (1-based for
  // display), and convenience handlers for "previous/next sibling".
  const siblingPos = useMemo(() => {
    if (!currentClusterSiblings) return null;
    const i = currentClusterSiblings.indexOf(networkFrame);
    return i < 0 ? null : i;
  }, [currentClusterSiblings, networkFrame]);
  const jumpSibling = useCallback((dir) => {
    if (!currentClusterSiblings?.length || siblingPos == null) return;
    const n = currentClusterSiblings.length;
    const next = (siblingPos + dir + n) % n;
    setNetworkFrame(currentClusterSiblings[next]);
  }, [currentClusterSiblings, siblingPos]);

  // ── Residue discovery (Phase B2b) ──
  // When the user has selected one or more residues, derive which IFPs
  // and clusters actually contain (all/any of) them. These drive the
  // "matching" outlines in Occurrence/Slider/Cluster-Table — the user
  // can then see *where* in the trajectory their residues of interest
  // co-occur. Memoised on (residues, clusters, mode).
  const matchingClusters = useMemo(() => {
    if (!clusterData?.clusters?.length || !highlightResidues.length) {
      return null;
    }
    const wanted = highlightResidues;
    const test = discoveryMode === "AND"
      ? (resList) => wanted.every(r => resList.includes(r))
      : (resList) => wanted.some(r => resList.includes(r));
    const out = new Set();
    for (const c of clusterData.clusters) {
      if (test(c.active_residues || [])) out.add(c.cluster_id);
    }
    return out;
  }, [clusterData, highlightResidues, discoveryMode]);

  const matchingIfps = useMemo(() => {
    if (!matchingClusters || !clusterData?.cluster_id_per_ifp) return null;
    const out = new Set();
    const cpi = clusterData.cluster_id_per_ifp;
    for (let i = 0; i < cpi.length; i++) {
      if (matchingClusters.has(cpi[i])) out.add(i);
    }
    return out;
  }, [matchingClusters, clusterData]);

  // Click on a cluster (band segment / slider strip / table row)
  // - plain click       → replace selection with [cid] AND drive the
  //                       frame view to that cluster's representative IFP
  // - Cmd/Ctrl/Shift+   → toggle cid in the cluster selection set
  //   click                (compare mode); frame stays put
  //
  // Residue-Discovery (`highlightResidues`) is *explicitly not* triggered
  // by a cluster click anymore. Earlier behaviour auto-highlighted the
  // cluster's active_residues, which then made matchingIfps light up IFPs
  // belonging to *other* clusters that happened to share/superset those
  // residues — visually conflating "IFPs in this cluster" with "IFPs
  // anywhere that share these residues". Discovery is now a separate
  // workflow driven explicitly via the residue cloud / network clicks.
  const selectCluster = useCallback((cid, additive) => {
    if (cid == null || cid < 0) {
      setSelectedClusters([]);
      return;
    }
    if (additive) {
      setSelectedClusters(prev =>
        prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]);
      return;
    }
    if (!clusterData?.clusters) return;
    const cluster = clusterData.clusters[cid];
    if (!cluster) return;
    setSelectedClusters([cid]);
    setHighlightResidues([]);
    if (cluster.representative_ifp != null) {
      setNetworkFrame(cluster.representative_ifp);
    }
  }, [clusterData]);

  // ── Parameter state (local, synced on change) ──
  const [params, setParams] = useState({
    identical_threshold: [0],
    similarity_threshold: [1, 5],
    dissimilarity_threshold: [6],
    fontsize: 12,
    node_size: 460,
    font_size_nodes: 6,
    cmap_name: "viridis",
    dpi: 150,
  });

  // ── 3D viewer resize drag ──
  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setViewerWidth(Math.max(150, Math.min(newWidth, 800)));
    };
    const onMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── Load session on mount ──
  useEffect(() => {
    api.getSession().then(setSession).catch(() => {});
  }, []);

  // Update params from session
  useEffect(() => {
    if (session?.parameters) {
      setParams(p => ({ ...p, ...session.parameters }));
    }
  }, [session]);

  const refreshSession = useCallback(() => {
    api.getSession().then(setSession).catch(() => {});
  }, []);

  const setLoadingKey = (key, val) => setLoading(p => ({ ...p, [key]: val }));

  const withLoading = async (key, fn) => {
    setLoadingKey(key, true);
    setError(null);
    try {
      const result = await fn();
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoadingKey(key, false);
    }
  };

  // ── File upload handlers ──
  // CSV-Upload: Statt eines Browser-prompt() öffnen wir ein In-App-Modal
  // zur Benennung des Liganden. Standardname aus dem Dateinamen abgeleitet.
  const handleCSVUpload = (e, isSecond = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fallback = isSecond ? "Ligand_2" : "Ligand_1";
    const fromFile = file.name.replace(/\.[^.]+$/, "");
    setLigandNameModal({ file, isSecond, name: fromFile || fallback });
    e.target.value = "";
  };

  const confirmLigandUpload = async () => {
    const m = ligandNameModal;
    if (!m || !m.name.trim()) return;
    setLigandNameModal(null);
    await withLoading("upload", () => api.uploadCSV(m.file, m.name.trim(), m.isSecond));
    refreshSession();
  };

  const handlePDBUpload = async (e, ligand = 1) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await withLoading("pdb", () => api.uploadPDB(file, ligand));
    // Load PDB content for viewer if this is the active ligand
    if (ligand === activeLigand) {
      const data = await api.getPDB(ligand);
      setPdbData(data.pdb);
    }
    refreshSession();
    e.target.value = "";
  };

  // ── Trajectory upload (GRO + XTC) ──
  const trajGroRef = useRef(null);
  const trajXtcRef = useRef(null);
  const trajGroRef2 = useRef(null);
  const trajXtcRef2 = useRef(null);

  const handleTrajectoryUpload = async (ligand = 1) => {
    const groRef = ligand === 2 ? trajGroRef2 : trajGroRef;
    const xtcRef = ligand === 2 ? trajXtcRef2 : trajXtcRef;
    const groFile = groRef.current?.files?.[0];
    const xtcFiles = xtcRef.current?.files;
    if (!groFile || !xtcFiles?.length) return;
    await withLoading("trajectory", async () => {
      await api.uploadTrajectory(groFile, Array.from(xtcFiles), ligand);
      // Load first frame for viewer if this is the active ligand
      if (ligand === activeLigand) {
        const data = await api.getPDB(ligand);
        setPdbData(data.pdb);
      }
    });
    refreshSession();
  };

  // ── Sync 3D viewer with network frame ──
  const [currentTrajectoryFrame, setCurrentTrajectoryFrame] = useState(-1);
  const lastLoadedFrame = useRef(-1);

  const hasActiveTrajectory = activeLigand === 2 ? session?.has_trajectory_2 : session?.has_trajectory;
  const activeTrajectoryNFrames = activeLigand === 2 ? session?.trajectory_n_frames_2 : session?.trajectory_n_frames;
  const hasActivePdb = activeLigand === 2 ? session?.has_pdb_2 : session?.has_pdb;

  const loadTrajectoryFrame = useCallback(async (frame) => {
    if (!hasActiveTrajectory) return;
    if (frame === lastLoadedFrame.current) return;
    lastLoadedFrame.current = frame;
    setCurrentTrajectoryFrame(frame);
    try {
      const data = await api.getTrajectoryFrame(frame, activeLigand);
      setPdbData(data.pdb);
    } catch (e) {
      console.error("Failed to load trajectory frame:", e);
    }
  }, [hasActiveTrajectory, activeLigand]);

  // ── Switch 3D viewer when active ligand changes ──
  useEffect(() => {
    lastLoadedFrame.current = -1;
    setCurrentTrajectoryFrame(-1);
    const lig = activeLigand;
    const hasTraj = lig === 2 ? session?.has_trajectory_2 : session?.has_trajectory;
    const hasPdbLig = lig === 2 ? session?.has_pdb_2 : session?.has_pdb;
    if (hasTraj || hasPdbLig) {
      api.getPDB(lig).then(data => setPdbData(data.pdb)).catch(() => setPdbData(null));
    } else {
      setPdbData(null);
    }
  }, [activeLigand, session?.has_trajectory, session?.has_trajectory_2, session?.has_pdb, session?.has_pdb_2]);

  // ── Vergleichs-Modus: beide Strukturen für den Dual-Viewer laden ──
  useEffect(() => {
    if (viewMode !== "comparison") return;
    for (const lig of [1, 2]) {
      const hasTraj = lig === 2 ? session?.has_trajectory_2 : session?.has_trajectory;
      const hasPdbLig = lig === 2 ? session?.has_pdb_2 : session?.has_pdb;
      if (!(hasTraj || hasPdbLig)) {
        setComparisonPdb(prev => (prev[lig] ? { ...prev, [lig]: null } : prev));
        continue;
      }
      api.getPDB(lig)
        .then(data => setComparisonPdb(prev => ({ ...prev, [lig]: data.pdb })))
        .catch(() => setComparisonPdb(prev => ({ ...prev, [lig]: null })));
    }
  }, [viewMode, session?.has_trajectory, session?.has_trajectory_2, session?.has_pdb, session?.has_pdb_2]);

  // ── Pipeline actions ──
  const handleAggregate = async (isSecond = false) => {
    await withLoading("aggregate", () => api.runAggregation(isSecond, x1Filter, x2Filter));
    refreshSession();
  };

  const handleCompare = async () => {
    await withLoading("compare", () => api.runComparison());
    refreshSession();
  };

  const handleGenerateTestData = async () => {
    await withLoading("testdata", async () => {
      await api.generateTestData();
      await api.runAggregation(false);
    });
    refreshSession();
  };

  // ── Visualization loading ──
  const loadViz = useCallback(async (vizTab, opts = {}) => {
    const lig = opts.ligand || 1;
    const cacheKey = vizTab.startsWith("comparison") ? vizTab : `${vizTab}_${lig}`;
    const loadingKey = `viz_${vizTab}`;
    return await withLoading(loadingKey, async () => {
      let data;
      switch (vizTab) {
        case "network":
          // NEW: Cytoscape-based client-side rendering. The payload is
          // raw graph data (nodes/edges/positions), no PNG.
          data = await api.getDataNetwork(opts.frame || 0, lig);
          break;
        case "circle":
          // NEW: client-side D3/SVG rendering. Returns run-length data
          // for all residues; the frontend handles the focus/sidebar UI.
          data = await api.getDataCircle(lig);
          break;
        case "heatmap":
          // NEW: client-side Canvas + SVG rendering. Returns the raw
          // distance matrix; the frontend handles colour mapping and hit-testing.
          data = await api.getDataHeatmap(lig);
          break;
        case "occurrence":
          // NEW: client-side D3/SVG rendering. Returns occurrence values
          // and ifp_ids; the cumulative curve is computed in the frontend.
          data = await api.getDataOccurrence(lig);
          break;
        case "comparison":
          data = await api.getDataComparison();
          break;
        case "comparison_clusters":
          data = await api.getComparisonClusters(opts.topK ?? 30);
          break;
        case "comparison_embedding":
          data = await api.getComparisonEmbedding();
          break;
        case "comparison_residues":
          data = await api.getComparisonResidues();
          break;
        case "comparison_chords":
          data = await api.getComparisonChords(opts.maxChords ?? 600);
          break;
        case "clusters":
          // Structural-aggregation payload: per-IFP cluster id +
          // per-cluster summary (frame_count, ifp_indices, etc).
          data = await api.getDataClusters(lig);
          break;
        case "umap":
          data = await api.getDataUmap(lig);
          break;
      }
      if (data) {
        setVizData(p => ({ ...p, [cacheKey]: data }));
      }
      return data;
    });
  }, []);

  // ── Refetch handlers for the backend-gated N values ──
  // Each stores the chosen N and reloads only its own comparison view;
  // loadViz overwrites just that cacheKey, so no other view is touched.
  const reloadComparisonClusters = useCallback((topK) => {
    setCmpClusterTopK(topK);
    loadViz("comparison_clusters", { topK });
  }, [loadViz]);
  const reloadComparisonChords = useCallback((maxChords) => {
    setChordMax(maxChords);
    loadViz("comparison_chords", { maxChords });
  }, [loadViz]);

  // ── Linked selection from the comparison view ──
  // The comparison shows both ligands, but selectedClusters / clusterData
  // are scoped to a single activeLigand. A click on an IFP therefore
  // selects its structural cluster *and* switches activeLigand to that
  // IFP's ligand, deferring the actual selection until the target
  // cluster payload has loaded.
  const selectComparisonIfp = useCallback((lig, cid, additive) => {
    if (cid == null || cid < 0) return;
    const ck = `clusters_${lig}`;
    if (!vizData[ck]) loadViz("clusters", { ligand: lig });
    if (lig !== activeLigand) setActiveLigand(lig);
    if (lig === activeLigand && vizData[ck]?.clusters) {
      selectCluster(cid, additive);
    } else {
      setPendingClusterSelect({ lig, cid, additive });
    }
  }, [vizData, activeLigand, loadViz, selectCluster]);

  // Apply a pending cross-ligand selection once its ligand is active and
  // the cluster payload has arrived.
  useEffect(() => {
    if (!pendingClusterSelect) return;
    const { lig, cid, additive } = pendingClusterSelect;
    if (lig !== activeLigand) return;
    if (!vizData[`clusters_${lig}`]?.clusters) return;
    selectCluster(cid, additive);
    setPendingClusterSelect(null);
  }, [pendingClusterSelect, activeLigand, vizData, selectCluster]);

  // ── Cluster → aktive Residuen (nur im Vergleich) ──
  // Im Einzelmodus ist Cluster→Residuen bewusst entkoppelt (selectCluster
  // löscht highlightResidues). Im Vergleich wollen wir die aktiven Residuen
  // des selektierten Clusters im 3D-Viewer sehen: deklarativ aus den
  // active_residues der selectedClusters des aktiven Liganden ableiten.
  useEffect(() => {
    if (viewMode !== "comparison") return;
    const cl = vizData[`clusters_${activeLigand}`]?.clusters;
    if (!cl) return;
    const set = new Set();
    for (const cid of selectedClusters) {
      for (const r of cl[cid]?.active_residues || []) set.add(r);
    }
    setHighlightResidues([...set]);
  }, [viewMode, selectedClusters, activeLigand, vizData]);

  // ── Frame-Sprung: aktiven Viewer auf die repräsentative Pose setzen ──
  // Hat der aktive Ligand eine Trajektorie, springt der Dual-Viewer beim
  // Cluster-Select auf den repräsentativen Frame (csv_mid) des Modus.
  useEffect(() => {
    if (viewMode !== "comparison" || !selectedClusters.length) return;
    const cl = vizData[`clusters_${activeLigand}`]?.clusters;
    const hasTraj = activeLigand === 2 ? session?.has_trajectory_2 : session?.has_trajectory;
    if (!cl || !hasTraj) return;
    const cid = selectedClusters[selectedClusters.length - 1];
    const frame = cl[cid]?.representative_frame;
    if (frame == null) return;
    api.getTrajectoryFrame(frame, activeLigand)
      .then(d => setComparisonPdb(prev => ({ ...prev, [activeLigand]: d.pdb })))
      .catch(() => {});
  }, [viewMode, selectedClusters, activeLigand, vizData, session?.has_trajectory, session?.has_trajectory_2]);

  // Difference-Map: signierter Belegungs-Δ je Residuum (Σ l1 − Σ l2) aus den
  // Vergleichs-Residuendaten → resi → Farbe (L1-dominant blau, L2-dominant
  // amber, Intensität ∝ |Δ|). Konsistent mit den Liganden-Identitätsfarben.
  const diffResidueColors = useMemo(() => {
    const res = vizData.comparison_residues?.residues;
    if (!res?.length) return null;
    const agg = new Map();
    for (const r of res) {
      const tok = String(r.name).split("_")[0];
      agg.set(tok, (agg.get(tok) || 0) + (r.l1 - r.l2));
    }
    let max = 1e-6;
    for (const v of agg.values()) max = Math.max(max, Math.abs(v));
    const colors = {};
    for (const [tok, v] of agg) {
      const resi = resiOf(tok);
      if (resi == null) continue;
      const t = 0.35 + 0.65 * Math.min(1, Math.abs(v) / max);
      colors[resi] = lerpHex("#4a5568", v >= 0 ? BLUE1 : BLUE2, t);
    }
    return colors;
  }, [vizData.comparison_residues]);

  // Residuendaten für die Difference-Map bei Bedarf nachladen.
  useEffect(() => {
    if (viewMode !== "comparison" || viewer3dMode !== "diff") return;
    if (!session?.has_comparison) return;
    if (!vizData.comparison_residues) loadViz("comparison_residues");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, viewer3dMode, session?.has_comparison, vizData.comparison_residues]);

  // Load viz when tab/ligand/viewMode changes (if aggregation is done)
  useEffect(() => {
    if (viewMode === "comparison") {
      if (!session?.has_comparison) return;
      if (!vizData["comparison"]) {
        loadViz("comparison");
      }
      return;
    }
    if (!session?.has_aggregation) return;
    if (activeLigand === 2 && !session?.has_second_aggregation) return;
    if (tab === "overview") {
      // Overview shows all four viz at once — pre-load every cache key
      // that's still empty. Fires in parallel; loadViz tracks its own
      // loading state per viz so the UI stays consistent.
      // `clusters` is fetched alongside so the occurrence panel and the
      // frame slider can colour-band by structural cluster.
      for (const t of ["network", "circle", "heatmap", "occurrence", "clusters"]) {
        const ck = `${t}_${activeLigand}`;
        if (!vizData[ck]) {
          loadViz(t, { frame: networkFrame, ligand: activeLigand });
        }
      }
      return;
    }
    // The dedicated cluster tab is the only place where the cluster
    // payload IS the primary cache key. For the other tabs cluster
    // data is auxiliary (band/strip colouring), so load it alongside.
    if (tab === "clusters") {
      const ck = `clusters_${activeLigand}`;
      if (!vizData[ck]) {
        loadViz("clusters", { ligand: activeLigand });
      }
      return;
    }
    const cacheKey = `${tab}_${activeLigand}`;
    if (!vizData[cacheKey]) {
      loadViz(tab, { frame: networkFrame, ligand: activeLigand });
    }
    // Cluster data is also needed for the occurrence tab and the network
    // tab's frame-slider strip. Cheap; load in parallel if missing.
    if (tab === "occurrence" || tab === "network" || tab === "heatmap"
        || tab === "umap") {
      const ck = `clusters_${activeLigand}`;
      if (!vizData[ck]) {
        loadViz("clusters", { ligand: activeLigand });
      }
    }
  }, [tab, session, activeLigand, viewMode]);

  // ── Auto-reload network panel when networkFrame changes ──
  // The other panels (circle/heatmap/occurrence) are frame-independent
  // and don't need a refetch. Only the network is frame-specific —
  // its cached payload carries `frame_index` from when it was loaded,
  // so when the user clicks a diagonal in the heatmap or a point in
  // occurrence (which only updates `networkFrame`), we have to refresh
  // the network cache too. Debounced so dragging the frame slider
  // doesn't fire a request per pixel.
  useEffect(() => {
    if (!session?.has_aggregation) return;
    if (activeLigand === 2 && !session?.has_second_aggregation) return;
    const ck = `network_${activeLigand}`;
    const cached = vizData[ck];
    // Skip until the panel has been loaded once; the main loading
    // effect above takes care of the initial fetch.
    if (!cached) return;
    if (cached.frame_index === networkFrame) return; // already in sync
    const t = setTimeout(async () => {
      const result = await loadViz("network", {
        frame: networkFrame, ligand: activeLigand,
      });
      // Reset 3D-trajectory frame state so the slider in the right
      // sidebar resyncs to the new IFP's CSV-frame range.
      lastLoadedFrame.current = -1;
      if (result?.mapped_frame) {
        loadTrajectoryFrame(result.mapped_frame.csv_mid);
      }
    }, 150);
    return () => clearTimeout(t);
    // We intentionally exclude `loadViz` and `loadTrajectoryFrame` —
    // they're recreated each render, so depending on them would
    // re-trigger the effect on every render and hammer the backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkFrame, activeLigand,
      session?.has_aggregation, session?.has_second_aggregation,
      vizData]);

  // ── Parameter sync ──
  const thresholdKeys = ["identical_threshold", "similarity_threshold", "dissimilarity_threshold"];

  const syncParam = async (key, value) => {
    setParams(p => ({ ...p, [key]: value }));
    await api.updateParameters({ [key]: value });

    if (thresholdKeys.includes(key)) {
      // Thresholds only affect comparison — invalidate comparison cache,
      // re-run classification, and refresh session status
      setVizData(p => { const next = { ...p }; delete next.comparison; return next; });
      if (session?.has_comparison) {
        await api.runComparison();
        refreshSession();
        loadViz("comparison");
      }
    } else {
      // Other params (fontsize, node_size, dpi, cmap) affect all visualizations
      setVizData({});
    }
  };

  // ── Toggle section ──
  const toggleSection = (key) => setSections(p => ({ ...p, [key]: !p[key] }));

  // ── Derived state ──
  const hasData = session?.has_data;
  const hasAgg = session?.has_aggregation;
  const hasSecond = session?.has_second_data;
  const hasSecondAgg = session?.has_second_aggregation;
  const hasComparison = session?.has_comparison;
  const hasPdb = session?.has_pdb;

  const vizTabs = [
    { id: "overview", label: "Übersicht" },
    { id: "network", label: "Netzwerk" },
    { id: "circle", label: "Kreisdiagramm" },
    { id: "heatmap", label: "Distanzmatrix" },
    { id: "occurrence", label: "Vorkommen" },
    { id: "clusters", label: "Structural IFP" },
    { id: "umap", label: "UMAP-Karte" },
  ];

  // Current cache key for the active viz
  const currentCacheKey = viewMode === "comparison" ? "comparison" : `${tab}_${activeLigand}`;

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column", background: C.bg }}>
      {/* ── ERROR BAR ── */}
      {error && (
        <div style={{ padding: "6px 16px", background: "#7f1d1d", color: C.red, fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <span onClick={() => setError(null)} style={{ cursor: "pointer", fontWeight: 700 }}>&#10005;</span>
        </div>
      )}

      {/* ── LIGAND-NAME-MODAL (ersetzt prompt() beim CSV-Upload) ── */}
      {ligandNameModal && (
        <div onClick={() => setLigandNameModal(null)}
          style={{ position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(0,0,0,0.55)", display: "flex",
            alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 360, maxWidth: "90vw", background: C.surface,
              border: `1px solid ${C.border}`, borderRadius: R.lg, padding: 20,
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>
            <div style={{ fontSize: FS.title, fontWeight: 700, color: C.text, marginBottom: 4 }}>
              Ligand benennen
            </div>
            <div style={{ fontSize: FS.small, color: C.textDim, marginBottom: 14 }}>
              Name für {ligandNameModal.isSecond ? "den zweiten" : "den ersten"} Liganden
              {" "}({ligandNameModal.file.name}).
            </div>
            <input autoFocus value={ligandNameModal.name}
              onChange={(e) => setLigandNameModal(m => ({ ...m, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmLigandUpload();
                if (e.key === "Escape") setLigandNameModal(null);
              }}
              placeholder="z.B. Inhibitor_A"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px",
                borderRadius: R.md, border: `1px solid ${C.border}`,
                background: C.bg, color: C.text, fontSize: FS.base,
                fontFamily: "inherit", marginBottom: 16 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Btn onClick={() => setLigandNameModal(null)}>Abbrechen</Btn>
              <Btn accent disabled={!ligandNameModal.name.trim()} onClick={confirmLigandUpload}>
                Hochladen
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN LAYOUT ── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* ════════ LEFT: Control Panel ════════ */}
        <div style={{ width: 220, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>

          {/* Title */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.accent }}>IFPAggVis</div>
            <div style={{ fontSize: 10, color: C.textDim }}>Analysis Dashboard</div>
          </div>

          {/* ── Data Section ── */}
          <SectionHeader label="Daten" open={sections.data} onToggle={() => toggleSection("data")} />
          {sections.data && (
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
              {hasData ? (
                <>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Simulation 1</div>
                  <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, marginBottom: 4 }}>{session.ligand_name_1}</div>
                  <div style={{ display: "flex", gap: 12, fontSize: 10, marginBottom: 8 }}>
                    <span><span style={{ color: C.textDim }}>Frames:</span> <span style={{ color: C.text }}>{session.frame_count}</span></span>
                    <span><span style={{ color: C.textDim }}>IFPs:</span> <span style={{ color: C.text }}>{session.ifp_count || "—"}</span></span>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>Keine Daten geladen</div>
              )}

              <label style={{ display: "block", marginBottom: 6, cursor: "pointer" }}>
                <div style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.textDim, fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                  {hasData ? "Andere CSV laden" : "CSV laden"}
                </div>
                <input type="file" accept=".csv" onChange={e => handleCSVUpload(e, false)}
                  style={{ display: "none" }} />
              </label>

              {hasAgg && (
                <>
                  <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
                  {hasSecond ? (
                    <>
                      <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Simulation 2</div>
                      <div style={{ fontSize: 11, color: C.pink, fontWeight: 600, marginBottom: 4 }}>{session.ligand_name_2}</div>
                      <div style={{ display: "flex", gap: 12, fontSize: 10, marginBottom: 8 }}>
                        <span><span style={{ color: C.textDim }}>Frames:</span> <span style={{ color: C.text }}>{session.frame_count_2}</span></span>
                        <span><span style={{ color: C.textDim }}>IFPs:</span> <span style={{ color: C.text }}>{session.ifp_count_2 || "—"}</span></span>
                      </div>
                    </>
                  ) : (
                    <label style={{ display: "block", cursor: "pointer" }}>
                      <div style={{ padding: "4px 10px", borderRadius: 6, border: `1px dashed ${C.border}`, background: "transparent", color: C.textDim, fontSize: 11, fontWeight: 600, textAlign: "center" }}>+ Zweite Simulation</div>
                      <input type="file" accept=".csv" onChange={e => handleCSVUpload(e, true)}
                        style={{ display: "none" }} />
                    </label>
                  )}
                </>
              )}

              <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>3D-Struktur — Simulation 1</div>

              {/* Trajectory upload Ligand 1 (GRO + XTC) */}
              <div style={{ marginBottom: 4 }}>
                <label style={{ display: "block", marginBottom: 3, cursor: "pointer" }}>
                  <div style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.textDim, fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                    {trajGroRef.current?.files?.[0] ? trajGroRef.current.files[0].name : "GRO laden"}
                  </div>
                  <input ref={trajGroRef} type="file" accept=".gro" onChange={() => setError(null)}
                    style={{ display: "none" }} />
                </label>
                <label style={{ display: "block", marginBottom: 3, cursor: "pointer" }}>
                  <div style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.textDim, fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                    {trajXtcRef.current?.files?.length
                      ? `${trajXtcRef.current.files.length} XTC Datei${trajXtcRef.current.files.length > 1 ? "en" : ""}`
                      : "XTC laden (mehrere moeglich)"}
                  </div>
                  <input ref={trajXtcRef} type="file" accept=".xtc" multiple onChange={() => setError(null)}
                    style={{ display: "none" }} />
                </label>
                <Btn small onClick={() => handleTrajectoryUpload(1)}
                  disabled={loading.trajectory}
                  style={{ width: "100%", marginBottom: 4 }}>
                  {loading.trajectory ? <><Spinner /> Laden...</> : "Trajektorie hochladen"}
                </Btn>
              </div>
              {session?.has_trajectory && (
                <div style={{ fontSize: 10, color: C.green, marginBottom: 4 }}>
                  Sim 1 Trajektorie geladen ({session.trajectory_n_frames} Frames)
                </div>
              )}
              {/* PDB fallback Ligand 1 */}
              <label style={{ display: "block", marginBottom: 4, cursor: "pointer" }}>
                <div style={{ padding: "4px 10px", borderRadius: 6, border: `1px dashed ${C.border}`, background: "transparent", color: C.textMuted, fontSize: 10, fontWeight: 600, textAlign: "center" }}>
                  Oder: PDB laden (Sim 1)
                </div>
                <input type="file" accept=".pdb" onChange={e => handlePDBUpload(e, 1)}
                  style={{ display: "none" }} />
              </label>

              {/* Trajectory upload Ligand 2 */}
              {hasSecond && (
                <>
                  <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>3D-Struktur — Simulation 2</div>
                  <div style={{ marginBottom: 4 }}>
                    <label style={{ display: "block", marginBottom: 3, cursor: "pointer" }}>
                      <div style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.textDim, fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                        {trajGroRef2.current?.files?.[0] ? trajGroRef2.current.files[0].name : "GRO laden"}
                      </div>
                      <input ref={trajGroRef2} type="file" accept=".gro" onChange={() => setError(null)}
                        style={{ display: "none" }} />
                    </label>
                    <label style={{ display: "block", marginBottom: 3, cursor: "pointer" }}>
                      <div style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.textDim, fontSize: 11, fontWeight: 600, textAlign: "center" }}>
                        {trajXtcRef2.current?.files?.length
                          ? `${trajXtcRef2.current.files.length} XTC Datei${trajXtcRef2.current.files.length > 1 ? "en" : ""}`
                          : "XTC laden (mehrere moeglich)"}
                      </div>
                      <input ref={trajXtcRef2} type="file" accept=".xtc" multiple onChange={() => setError(null)}
                        style={{ display: "none" }} />
                    </label>
                    <Btn small onClick={() => handleTrajectoryUpload(2)}
                      disabled={loading.trajectory}
                      style={{ width: "100%", marginBottom: 4 }}>
                      {loading.trajectory ? <><Spinner /> Laden...</> : "Trajektorie hochladen"}
                    </Btn>
                  </div>
                  {session?.has_trajectory_2 && (
                    <div style={{ fontSize: 10, color: C.green, marginBottom: 4 }}>
                      Sim 2 Trajektorie geladen ({session.trajectory_n_frames_2} Frames)
                    </div>
                  )}
                  <label style={{ display: "block", marginBottom: 4, cursor: "pointer" }}>
                    <div style={{ padding: "4px 10px", borderRadius: 6, border: `1px dashed ${C.border}`, background: "transparent", color: C.textMuted, fontSize: 10, fontWeight: 600, textAlign: "center" }}>
                      Oder: PDB laden (Sim 2)
                    </div>
                    <input type="file" accept=".pdb" onChange={e => handlePDBUpload(e, 2)}
                      style={{ display: "none" }} />
                  </label>
                </>
              )}
            </div>
          )}

          {/* ── Pipeline Section ── */}
          <SectionHeader label="Pipeline" open={sections.pipeline} onToggle={() => toggleSection("pipeline")} />
          {sections.pipeline && (
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
              {/* Aggregation status */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: hasAgg ? C.green : C.textMuted }} />
                <span style={{ fontSize: 11, color: hasAgg ? C.green : C.textDim }}>
                  Aggregation: {hasAgg ? "Abgeschlossen" : "Ausstehend"}
                </span>
              </div>

              {/* x1/x2 Filter Controls */}
              {hasData && (
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: C.textDim, display: "block", marginBottom: 4 }}>
                    x1 — Sliding Window (% der Trajektorie)
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="range" min="0" max="10" step="0.5" value={x1Filter}
                      onChange={e => setX1Filter(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: C.accent }} />
                    <span style={{ fontSize: 12, color: C.text, minWidth: 36, textAlign: "right" }}>{x1Filter}%</span>
                  </div>

                  <label style={{ fontSize: 11, color: C.textDim, display: "block", marginTop: 8, marginBottom: 4 }}>
                    x2 — Occurrence Filter (Schwellwert)
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="range" min="0" max="0.5" step="0.05" value={x2Filter}
                      onChange={e => setX2Filter(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: C.accent }} />
                    <span style={{ fontSize: 12, color: C.text, minWidth: 36, textAlign: "right" }}>{(x2Filter * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}

              {hasData && !hasAgg && (
                <Btn accent onClick={() => handleAggregate(false)} disabled={loading.aggregate}
                  style={{ width: "100%", marginBottom: 6 }}>
                  {loading.aggregate ? <><Spinner /> Aggregation...</> : "Aggregation starten"}
                </Btn>
              )}
              {hasAgg && (
                <Btn small onClick={() => handleAggregate(false)} disabled={loading.aggregate}
                  style={{ width: "100%", marginBottom: 6 }}>
                  {loading.aggregate ? <><Spinner /> ...</> : "Neu berechnen"}
                </Btn>
              )}

              {/* Second sim aggregation */}
              {hasSecond && !hasSecondAgg && (
                <Btn accent onClick={() => handleAggregate(true)} disabled={loading.aggregate}
                  style={{ width: "100%", marginBottom: 6 }}>
                  {loading.aggregate ? <><Spinner /> ...</> : "Sim 2 aggregieren"}
                </Btn>
              )}

              {/* Comparison */}
              {hasSecondAgg && (
                <>
                  <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: hasComparison ? C.green : C.textMuted }} />
                    <span style={{ fontSize: 11, color: hasComparison ? C.green : C.textDim }}>
                      Vergleich: {hasComparison ? "Abgeschlossen" : "Ausstehend"}
                    </span>
                  </div>
                  <Btn accent={!hasComparison} small={hasComparison}
                    onClick={handleCompare} disabled={loading.compare}
                    style={{ width: "100%" }}>
                    {loading.compare ? <><Spinner /> ...</> : hasComparison ? "Vergleich neu berechnen" : "Vergleich starten"}
                  </Btn>
                </>
              )}

              {/* Dev: test data — nur im Entwicklungsmodus sichtbar */}
              {import.meta.env.DEV && (
                <>
                  <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
                  <Btn small onClick={handleGenerateTestData} disabled={loading.testdata}
                    style={{ width: "100%", fontSize: 10, borderStyle: "dashed" }}>
                    {loading.testdata ? <><Spinner /> ...</> : "DEV: Testdaten generieren"}
                  </Btn>
                </>
              )}
            </div>
          )}

          {/* ── Filter & Parameters Section ── */}
          <SectionHeader label="Filter & Parameter" open={sections.filter} onToggle={() => toggleSection("filter")} />
          {sections.filter && (
            <div style={{ padding: "10px 12px" }}>
              {/* Thresholds */}
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Schwellenwerte</div>
              <Slider label="Identisch" value={params.identical_threshold?.[0] ?? 0}
                min={0} max={20} onChange={v => syncParam("identical_threshold", [v])} />
              <Slider label="Aehnlich (min)" value={params.similarity_threshold?.[0] ?? 1}
                min={0} max={20} onChange={v => syncParam("similarity_threshold", [v, params.similarity_threshold?.[1] ?? 5])} />
              <Slider label="Aehnlich (max)" value={params.similarity_threshold?.[1] ?? 5}
                min={0} max={20} onChange={v => syncParam("similarity_threshold", [params.similarity_threshold?.[0] ?? 1, v])} />
              <Slider label="Unaenlich" value={params.dissimilarity_threshold?.[0] ?? 6}
                min={0} max={20} onChange={v => syncParam("dissimilarity_threshold", [v])} />

              <div style={{ height: 1, background: C.border, margin: "10px 0" }} />
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Darstellung</div>
              <Slider label="Schriftgroesse" value={params.fontsize ?? 12}
                min={8} max={24} onChange={v => syncParam("fontsize", v)} />
              <Slider label="Knotengroesse" value={params.node_size ?? 460}
                min={200} max={1000} step={20} onChange={v => syncParam("node_size", v)} />
              <Slider label="DPI" value={params.dpi ?? 150}
                min={72} max={600} step={10} onChange={v => syncParam("dpi", v)} />
            </div>
          )}
        </div>

        {/* ════════ CENTER: Tabs + Viz ════════ */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Ligand toggle + Comparison button */}
          <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${C.border}`, background: C.surface, padding: "6px 12px", flexShrink: 0, gap: 6 }}>
            {/* Ligand pills */}
            <div style={{ display: "flex", gap: 4, flex: 1 }}>
              <div
                onClick={() => { setViewMode("ligand"); setActiveLigand(1); }}
                style={{
                  padding: "5px 14px", borderRadius: 16, fontSize: 12, cursor: "pointer",
                  background: viewMode === "ligand" && activeLigand === 1 ? C.accent : "transparent",
                  color: viewMode === "ligand" && activeLigand === 1 ? "#fff" : C.textDim,
                  border: `1px solid ${viewMode === "ligand" && activeLigand === 1 ? C.accent : C.border}`,
                  fontWeight: 600, transition: "all .15s",
                }}>
                {session?.ligand_name_1 || "Ligand 1"}
              </div>
              {hasSecondAgg && (
                <div
                  onClick={() => { setViewMode("ligand"); setActiveLigand(2); }}
                  style={{
                    padding: "5px 14px", borderRadius: 16, fontSize: 12, cursor: "pointer",
                    background: viewMode === "ligand" && activeLigand === 2 ? C.pink : "transparent",
                    color: viewMode === "ligand" && activeLigand === 2 ? "#fff" : C.textDim,
                    border: `1px solid ${viewMode === "ligand" && activeLigand === 2 ? C.pink : C.border}`,
                    fontWeight: 600, transition: "all .15s",
                  }}>
                  {session?.ligand_name_2 || "Ligand 2"}
                </div>
              )}
            </div>
            {/* Comparison button — separate */}
            {hasComparison && (
              <div
                onClick={() => setViewMode("comparison")}
                style={{
                  padding: "5px 14px", borderRadius: 16, fontSize: 12, cursor: "pointer",
                  background: viewMode === "comparison" ? C.green : "transparent",
                  color: viewMode === "comparison" ? "#000" : C.textDim,
                  border: `1px solid ${viewMode === "comparison" ? C.green : C.border}`,
                  fontWeight: 600, transition: "all .15s",
                }}>
                Vergleich
              </div>
            )}
          </div>

          {/* Viz tab bar (only in ligand mode) */}
          {viewMode === "ligand" && (
            <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${C.border}`, background: C.surface, padding: "0 12px", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 2, flex: 1 }}>
                {vizTabs.map(t => {
                  const disabled = !hasAgg || (activeLigand === 2 && !hasSecondAgg);
                  return (
                    <div key={t.id}
                      onClick={() => !disabled && setTab(t.id)}
                      style={{
                        padding: "10px 14px", fontSize: 12, cursor: disabled ? "default" : "pointer",
                        color: tab === t.id ? C.accent : C.textDim,
                        borderBottom: `2px solid ${tab === t.id ? C.accent : "transparent"}`,
                        fontWeight: tab === t.id ? 600 : 400,
                        background: tab === t.id ? C.accentDim : "transparent",
                        opacity: disabled ? 0.35 : 1,
                        transition: "all .15s",
                      }}>{t.label}</div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selection status bar (Phase B2b) — sticky reminder of what
              is currently selected across all three axes, with controls
              to clear each axis individually. */}
          {viewMode === "ligand" && hasAgg && (
            <SelectionStatusBar
              residues={highlightResidues}
              onRemoveResidue={(r) => setHighlightResidues(prev => prev.filter(x => x !== r))}
              onClearResidues={() => setHighlightResidues([])}
              discoveryMode={discoveryMode}
              onToggleDiscoveryMode={() => setDiscoveryMode(m => m === "AND" ? "OR" : "AND")}
              matchingIfpsCount={matchingIfps?.size ?? null}
              matchingClustersCount={matchingClusters?.size ?? null}
              selectedClusters={selectedClusters}
              onRemoveCluster={(cid) => setSelectedClusters(prev => prev.filter(x => x !== cid))}
              clusterColors={clusterColors}
              currentFrame={networkFrame}
              totalFrames={clusterData?.n_ifps ?? 0}
              onClearFrame={() => setNetworkFrame(0)}
              rangeFilter={rangeFilter}
              onClearRange={clearRangeFilter}
              onClearAll={() => {
                setHighlightResidues([]);
                setSelectedClusters([]);
                clearRangeFilter();
              }}
            />
          )}

          {/* Viz controls bar — frame slider for network AND overview tab.
              The overview shows the network as one of four panels, so the
              frame slider must be reachable there too; both tabs read
              from the same `network_${activeLigand}` cache. */}
          {viewMode === "ligand" && hasAgg
              && (tab === "network" || tab === "overview")
              && vizData[`network_${activeLigand}`] && (
            <div style={{ borderBottom: `1px solid ${C.border}`, background: C.surface }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px" }}>
                <span style={{ fontSize: 11, color: C.textDim, flexShrink: 0 }}>Frame:</span>
                <input type="range"
                  min={rangeFilter?.start ?? 0}
                  max={rangeFilter?.end
                       ?? ((vizData[`network_${activeLigand}`].total_frames || 1) - 1)}
                  value={networkFrame}
                  onChange={e => setNetworkFrame(Number(e.target.value))}
                  style={{ flex: 1,
                           accentColor: rangeFilter ? C.accent : undefined }} />
                <span style={{ fontSize: 11, color: C.accent, fontWeight: 600, minWidth: 40, flexShrink: 0 }}>{networkFrame}</span>
                {rangeFilter && (
                  <span style={{
                    fontSize: 10, color: C.accent, fontWeight: 600,
                    flexShrink: 0,
                    padding: "1px 6px", borderRadius: 4,
                    background: "rgba(108,123,212,0.15)",
                    border: `1px solid ${C.accent}`,
                  }} title="Slider auf gefilterten Bereich beschränkt">
                    [{rangeFilter.start}–{rangeFilter.end}]
                  </span>
                )}
                {/* Sibling navigation — only when the current frame has
                    more than one cluster mate. Wraps around. */}
                {currentClusterSiblings?.length > 1 && (
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <div onClick={() => jumpSibling(-1)}
                      title="Vorheriger Frame im selben Structural IFP"
                      style={{
                        padding: "3px 7px", borderRadius: 4, fontSize: 10,
                        background: C.pinkDim, color: C.pink,
                        border: `1px solid ${C.pink}`, cursor: "pointer",
                        fontWeight: 600, lineHeight: 1,
                      }}>◀</div>
                    <div onClick={() => jumpSibling(+1)}
                      title="Nächster Frame im selben Structural IFP"
                      style={{
                        padding: "3px 7px", borderRadius: 4, fontSize: 10,
                        background: C.pinkDim, color: C.pink,
                        border: `1px solid ${C.pink}`, cursor: "pointer",
                        fontWeight: 600, lineHeight: 1,
                      }}>▶</div>
                  </div>
                )}
                <Btn small style={{ minWidth: 56 }} onClick={async () => {
                  const result = await loadViz("network", { frame: networkFrame, ligand: activeLigand });
                  // Reset 3D frame state so slider syncs to new IFP range
                  lastLoadedFrame.current = -1;
                  if (result?.mapped_frame) {
                    loadTrajectoryFrame(result.mapped_frame.csv_mid);
                  }
                }}
                  disabled={loading.viz_network}>
                  {loading.viz_network ? <Spinner /> : "Laden"}
                </Btn>
              </div>
              {/* Cluster status line — visible whenever the current
                  frame has a cluster assignment. Tells the user which
                  binding mode they're in and how many sibling frames
                  share it. */}
              {currentClusterId != null && clusterColors && (
                <div style={{
                  padding: "2px 16px 4px", fontSize: 10,
                  color: C.textDim, display: "flex", gap: 8,
                  alignItems: "center",
                }}>
                  <span style={{
                    display: "inline-block", width: 9, height: 9,
                    borderRadius: 2,
                    background: clusterColors.colorOf(currentClusterId),
                  }} />
                  <span>Structural IFP {currentClusterId}</span>
                  {currentClusterSiblings?.length > 1 && siblingPos != null && (
                    <span style={{ color: C.pink, fontWeight: 600 }}>
                      {siblingPos + 1}/{currentClusterSiblings.length} Geschwister
                    </span>
                  )}
                  {currentClusterSiblings?.length === 1 && (
                    <span style={{ color: C.textMuted }}>(einziges IFP)</span>
                  )}
                </div>
              )}
              {/* Cluster strip under the frame slider — same colour
                  encoding as the occurrence-plot band. Each IFP is one
                  thin rect; click jumps to that frame. */}
              {clusterData?.cluster_id_per_ifp?.length > 0 && (
                <ClusterStrip
                  cids={clusterData.cluster_id_per_ifp}
                  clusterColors={clusterColors}
                  selectedClusters={selectedClusters}
                  currentFrame={networkFrame}
                  onSelectFrame={(i) => setNetworkFrame(i)}
                  onSelectCluster={selectCluster}
                  siblingIndices={currentClusterSiblings}
                  matchingIfps={matchingIfps}
                />
              )}
              {vizData[`network_${activeLigand}`].mapped_frame && (
                <div style={{ padding: "2px 16px 4px", fontSize: 10, color: C.textMuted, display: "flex", gap: 12 }}>
                  <span>CSV-Frames: {vizData[`network_${activeLigand}`].mapped_frame.csv_start}–{vizData[`network_${activeLigand}`].mapped_frame.csv_end}</span>
                  <span>Mitte: {vizData[`network_${activeLigand}`].mapped_frame.csv_mid}</span>
                  <span>({vizData[`network_${activeLigand}`].mapped_frame.occurence}x)</span>
                </div>
              )}
              {vizData[`network_${activeLigand}`].active_residues && (
                <div style={{ padding: "0 16px 8px", fontSize: 10, color: C.textDim, lineHeight: 1.8, flexWrap: "wrap", display: "flex", gap: 2, alignItems: "center" }}>
                  <span>Aktiv:</span>
                  {[...new Set(vizData[`network_${activeLigand}`].active_residues)].map((r, i) => (
                    <span key={i}
                      onClick={(e) => selectResidue(r, e.metaKey || e.ctrlKey || e.shiftKey)}
                      style={{ color: highlightResidues.includes(r) ? C.pink : C.accent, cursor: "pointer", marginLeft: 4, fontWeight: 600 }}>{r}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Old residue-button bar for the circle tab is gone — the
              new <CircleView> has its own sidebar with all residues. */}

          {/* Main viz area */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, minHeight: 0, overflow: "auto" }}>
            {!hasAgg ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, color: C.textDim, marginBottom: 12 }}>Daten laden und Aggregation ausfuehren</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>oder Testdaten generieren (links unter Pipeline)</div>
              </div>
            ) : viewMode === "ligand" && activeLigand === 2 && !hasSecondAgg ? (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 14, color: C.textDim }}>Aggregation fuer zweite Simulation ausfuehren</div>
              </div>
            ) : loading[viewMode === "comparison" ? "viz_comparison" : `viz_${tab}`] ? (
              <div style={{ textAlign: "center" }}>
                <Spinner />
                <div style={{ fontSize: 12, color: C.textDim, marginTop: 8 }}>Visualisierung wird berechnet...</div>
              </div>
            ) : viewMode === "comparison" ? (
              vizData.comparison?.ifps ? (
                <div style={{ width: "100%", height: "100%", position: "relative" }}>
                  <ComparisonTab
                    data={vizData.comparison}
                    encodings={{
                      clusters: vizData.comparison_clusters,
                      embedding: vizData.comparison_embedding,
                      residues: vizData.comparison_residues,
                      chords: vizData.comparison_chords,
                    }}
                    onLoadEncoding={(kind) => loadViz(`comparison_${kind}`)}
                    selectedClusters={selectedClusters}
                    activeLigand={activeLigand}
                    onSelectCluster={selectComparisonIfp}
                    onHoverResidue={setHoverResidue3D}
                    cmpClusterTopK={cmpClusterTopK}
                    onCmpClusterTopKChange={reloadComparisonClusters}
                    chordMax={chordMax}
                    onChordMaxChange={reloadComparisonChords}
                  />
                </div>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, color: C.textDim }}>
                    {!hasComparison ? "Vergleich zuerst ausfuehren (Pipeline-Bereich)" : "Visualisierung laden..."}
                  </div>
                </div>
              )
            ) : tab === "overview" ? (
              // ── 2×2 grid: all four viz at once, fully linked ──
              // Selection state (highlightResidue, networkFrame) is shared,
              // so a click in any panel updates the other three live.
              // Comparison view is intentionally excluded from this grid.
              (() => {
                const netData    = vizData[`network_${activeLigand}`];
                const circleData = vizData[`circle_${activeLigand}`];
                const heatData   = vizData[`heatmap_${activeLigand}`];
                const occData    = vizData[`occurrence_${activeLigand}`];
                const Panel = ({ title, children, loading: pLoading }) => (
                  <div style={{
                    display: "flex", flexDirection: "column", minWidth: 0,
                    minHeight: 0, border: `1px solid ${C.border}`,
                    borderRadius: 8, background: C.surface,
                    overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "6px 12px", fontSize: 11, fontWeight: 600,
                      color: C.text, borderBottom: `1px solid ${C.border}`,
                      background: C.surfaceLight, flexShrink: 0,
                      display: "flex", justifyContent: "space-between",
                      alignItems: "center",
                    }}>
                      <span>{title}</span>
                      {pLoading && <Spinner />}
                    </div>
                    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                      {children}
                    </div>
                  </div>
                );
                return (
                  <div style={{
                    width: "100%", height: "100%",
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gridTemplateRows: "1fr 1fr",
                    gap: 8,
                  }}>
                    <Panel title="Netzwerk"
                      loading={loading.viz_network && !netData}>
                      {netData?.nodes ? (
                        <NetworkView
                          data={netData}
                          selectedLabels={highlightResidues}
                          onSelect={(label, additive) => selectResidue(label, additive)}
                          onBackgroundClick={() => setHighlightResidues([])}
                        />
                      ) : (
                        <div style={{ padding: 16, fontSize: 11,
                                      color: C.textDim }}>Lädt …</div>
                      )}
                    </Panel>
                    <Panel title="Kreisdiagramm"
                      loading={loading.viz_circle && !circleData}>
                      {circleData?.rings_by_residue ? (
                        <CircleView
                          data={circleData}
                          selectedLabels={highlightResidues}
                          onSelect={(label, additive) => selectResidue(label, additive)}
                          compact
                        />
                      ) : (
                        <div style={{ padding: 16, fontSize: 11,
                                      color: C.textDim }}>Lädt …</div>
                      )}
                    </Panel>
                    <Panel title="Distanzmatrix"
                      loading={loading.viz_heatmap && !heatData}>
                      {heatData?.distances ? (
                        <HeatmapView
                          data={heatData}
                          selectedIndex={networkFrame}
                          onSelectIndex={(i) => setNetworkFrame(i)}
                          clusterData={clusterData}
                          clusterColors={clusterColors}
                          siblingIndices={currentClusterSiblings}
                          matchingIfps={matchingIfps}
                          rangeFilter={rangeFilter}
                          onSetRange={applyRangeFilter}
                        />
                      ) : (
                        <div style={{ padding: 16, fontSize: 11,
                                      color: C.textDim }}>Lädt …</div>
                      )}
                    </Panel>
                    <Panel title="Vorkommen"
                      loading={loading.viz_occurrence && !occData}>
                      {occData?.occurrence ? (
                        <OccurrenceView
                          data={occData}
                          selectedIndex={networkFrame}
                          onSelectIndex={(i) => setNetworkFrame(i)}
                          clusterData={clusterData}
                          clusterColors={clusterColors}
                          selectedClusters={selectedClusters}
                          onSelectCluster={selectCluster}
                          siblingIndices={currentClusterSiblings}
                          matchingIfps={matchingIfps}
                          rangeFilter={rangeFilter}
                          onSetRange={applyRangeFilter}
                        />
                      ) : (
                        <div style={{ padding: 16, fontSize: 11,
                                      color: C.textDim }}>Lädt …</div>
                      )}
                    </Panel>
                  </div>
                );
              })()
            ) : tab === "network" && vizData[currentCacheKey]?.nodes ? (
              // Network: client-side Cytoscape rendering (no PNG)
              <div style={{ width: "100%", height: "100%" }}>
                <NetworkView
                  data={vizData[currentCacheKey]}
                  selectedLabels={highlightResidues}
                  onSelect={(label, additive) => selectResidue(label, additive)}
                  onBackgroundClick={() => setHighlightResidues([])}
                />
              </div>
            ) : tab === "occurrence" && vizData[currentCacheKey]?.occurrence ? (
              // Occurrence: client-side D3/SVG rendering (no PNG)
              <div style={{ width: "100%", height: "100%" }}>
                <OccurrenceView
                  data={vizData[currentCacheKey]}
                  selectedIndex={networkFrame}
                  onSelectIndex={(i) => setNetworkFrame(i)}
                  clusterData={clusterData}
                  clusterColors={clusterColors}
                  selectedClusters={selectedClusters}
                  onSelectCluster={selectCluster}
                  siblingIndices={currentClusterSiblings}
                  rangeFilter={rangeFilter}
                  onSetRange={applyRangeFilter}
                />
              </div>
            ) : tab === "heatmap" && vizData[currentCacheKey]?.distances ? (
              // Distance matrix: Canvas (matrix) + SVG (axes, hover, selection)
              <div style={{ width: "100%", height: "100%" }}>
                <HeatmapView
                  data={vizData[currentCacheKey]}
                  selectedIndex={networkFrame}
                  onSelectIndex={(i) => setNetworkFrame(i)}
                  clusterData={clusterData}
                  clusterColors={clusterColors}
                  siblingIndices={currentClusterSiblings}
                  matchingIfps={matchingIfps}
                  rangeFilter={rangeFilter}
                  onSetRange={applyRangeFilter}
                />
              </div>
            ) : tab === "circle" && vizData[currentCacheKey]?.rings_by_residue ? (
              // Circle: client-side D3/SVG rendering. Sidebar with all
              // residues, focus pane on the right (β layout).
              <div style={{ width: "100%", height: "100%" }}>
                <CircleView
                  data={vizData[currentCacheKey]}
                  selectedLabels={highlightResidues}
                  onSelect={(label, additive) => selectResidue(label, additive)}
                />
              </div>
            ) : tab === "clusters" && clusterData?.clusters ? (
              // Cluster tab (Phase B2): sortable table of all structural
              // clusters. Row click goes through the shared `selectCluster`
              // helper → drives 3D viewer, residue highlights, occurrence
              // band selection.
              <div style={{ width: "100%", height: "100%" }}>
                <ClusterTableView
                  data={filteredClusterData}
                  clusterColors={clusterColors}
                  selectedClusters={selectedClusters}
                  onSelectCluster={selectCluster}
                  currentClusterId={currentClusterId}
                  matchingClusters={matchingClusters}
                  highlightResidues={highlightResidues}
                  onToggleResidue={(r) => selectResidue(r, true)}
                  clusterTopK={clusterTopK}
                  onClusterTopKChange={setClusterTopK}
                />
              </div>
            ) : tab === "umap" && vizData[currentCacheKey]?.clusters ? (
              <div style={{ width: "100%", height: "100%" }}>
                <UmapView
                  data={vizData[currentCacheKey]}
                  clusterColors={clusterColors}
                  selectedClusters={selectedClusters}
                  onSelectCluster={selectCluster}
                  currentClusterId={currentClusterId}
                />
              </div>
            ) : vizData[currentCacheKey]?.image ? (
              <img src={`data:image/png;base64,${vizData[currentCacheKey].image}`}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }}
                alt={tab} />
            ) : (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 14, color: C.textDim }}>Visualisierung laden...</div>
              </div>
            )}
          </div>
        </div>

        {/* ════════ RESIZE HANDLE ════════ */}
        <div
          onMouseDown={() => {
            isDragging.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          style={{
            width: 5, cursor: "col-resize", background: C.border,
            flexShrink: 0, transition: "background .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = C.accent}
          onMouseLeave={e => { if (!isDragging.current) e.currentTarget.style.background = C.border; }}
        />

        {/* ════════ RIGHT: 3D Viewer ════════ */}
        <div style={{ width: viewerWidth, background: C.surface, display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {viewMode === "comparison" ? (() => {
            // Dual-Viewer: beide Liganden-Strukturen gestapelt. Der aktive
            // Ligand erhält das Cluster-Residuen-Highlight, der Hover wird in
            // beiden gezeigt; die Δ-Färbung gilt symmetrisch für beide.
            const ligName = (lig) => lig === 2 ? session?.ligand_name_2 : session?.ligand_name_1;
            const hlFor = (lig) => {
              // Im Δ-Modus kein Selektions-Pink — dort zählt nur die Δ-Färbung.
              const base = (viewer3dMode === "diff" || lig !== activeLigand)
                ? [] : highlightResidues;
              return hoverResidue3D ? [...base, hoverResidue3D] : base;
            };
            const colorsFor = () => viewer3dMode === "diff" ? diffResidueColors : null;
            // WICHTIG: als reine Render-Funktion aufrufen (renderPane(lig)),
            // NICHT als <Pane/>-Komponente. Eine inline definierte Komponente
            // erhält bei jedem Render eine neue Funktionsidentität → React
            // unmountet/remountet sie → der 3Dmol-Viewer würde neu erzeugt und
            // per zoomTo() die vom Nutzer gesetzte Rotation zurücksetzen.
            const renderPane = (lig) => (
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
                borderTop: lig === 2 ? `1px solid ${C.border}` : "none" }}>
                <div style={{ padding: "4px 10px", display: "flex", alignItems: "center",
                  gap: 6, fontSize: 10, color: C.textDim }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%",
                    background: lig === 1 ? BLUE1 : BLUE2, flexShrink: 0 }} />
                  <span style={{ color: lig === 1 ? BLUE1 : BLUE2, fontWeight: 600,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {ligName(lig) || `Ligand ${lig}`}
                  </span>
                  {lig === activeLigand && <span style={{ color: C.textMuted }}>· aktiv</span>}
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  {comparisonPdb[lig] ? (
                    <Viewer3D pdbData={comparisonPdb[lig]}
                      highlightResidues={hlFor(lig)} residueColors={colorsFor()}
                      baseColor={viewer3dMode === "diff" ? "#9aa0a6" : "#6c7bd4"} />
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                      height: "100%", padding: 12, textAlign: "center", fontSize: 10, color: C.textMuted }}>
                      Keine Struktur für {ligName(lig) || `Ligand ${lig}`}
                    </div>
                  )}
                </div>
              </div>
            );
            return (
              <>
                <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>3D Viewer · Vergleich</span>
                  <div style={{ display: "flex" }}>
                    {[["cluster", "Structural-IFP-Residuen"], ["diff", "Δ-Belegung"]].map(([m, lbl], i) => (
                      <div key={m} onClick={() => setViewer3dMode(m)} style={{
                        padding: "2px 8px", cursor: "pointer", fontSize: 10, fontWeight: 600,
                        borderRadius: 4, marginLeft: i === 0 ? 0 : -1,
                        background: viewer3dMode === m ? C.accent : "transparent",
                        color: viewer3dMode === m ? "#fff" : C.textDim,
                        border: `1px solid ${viewer3dMode === m ? C.accent : C.border}`,
                      }}>{lbl}</div>
                    ))}
                  </div>
                </div>
                {renderPane(1)}
                {renderPane(2)}
              </>
            );
          })() : (
            <>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text, flexShrink: 0 }}>3D Viewer</span>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 0 }}>
                  {/* Cluster info — visible whenever the current frame has
                      a cluster assignment. Mirrors the slider status line so
                      the user sees the binding-mode context next to the 3D
                      structure too. */}
                  {currentClusterId != null && clusterColors && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 5,
                      fontSize: 10, color: C.textDim,
                      maxWidth: "100%", overflow: "hidden",
                    }}>
                      <span style={{
                        display: "inline-block", width: 8, height: 8,
                        borderRadius: 2,
                        background: clusterColors.colorOf(currentClusterId),
                        flexShrink: 0,
                      }} />
                      <span style={{ whiteSpace: "nowrap" }}>
                        Cl {currentClusterId} · IFP {networkFrame}
                        {currentClusterSiblings?.length > 1 && siblingPos != null && (
                          ` (${siblingPos + 1}/${currentClusterSiblings.length})`
                        )}
                      </span>
                    </div>
                  )}
                  {highlightResidues.length > 0 && (
                    <span style={{ fontSize: 10, color: C.pink, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                      {highlightResidues.length === 1
                        ? highlightResidues[0]
                        : `${highlightResidues.length} Residuen`}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {pdbData ? (
                  <Viewer3D pdbData={pdbData} highlightResidues={highlightResidues} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 20, textAlign: "center" }}>
                    <div>
                      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>Keine PDB-Datei geladen</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>PDB laden im Daten-Bereich</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          {/* 3D Frame Slider — range within current IFP */}
          {hasActiveTrajectory && vizData[currentCacheKey]?.mapped_frame && (() => {
            const mf = vizData[currentCacheKey].mapped_frame;
            const jumpBtn = (label, frame) => (
              <div onClick={() => loadTrajectoryFrame(frame)}
                style={{
                  padding: "2px 6px", borderRadius: 4, fontSize: 9, cursor: "pointer",
                  background: currentTrajectoryFrame === frame ? C.accentDim : "transparent",
                  color: currentTrajectoryFrame === frame ? C.accent : C.textDim,
                  border: `1px solid ${currentTrajectoryFrame === frame ? C.accent : C.border}`,
                  fontWeight: 600, whiteSpace: "nowrap",
                }}>{label}</div>
            );
            return (
              <div style={{ padding: "6px 12px", borderTop: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: C.textDim, flexShrink: 0 }}>3D Frame:</span>
                  <input type="range"
                    min={mf.csv_start}
                    max={mf.csv_end}
                    value={Math.max(mf.csv_start, Math.min(currentTrajectoryFrame, mf.csv_end))}
                    onChange={e => loadTrajectoryFrame(Number(e.target.value))}
                    style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, minWidth: 28 }}>
                    {currentTrajectoryFrame >= 0 ? currentTrajectoryFrame : "—"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                  {jumpBtn("Start " + mf.csv_start, mf.csv_start)}
                  {jumpBtn("Mitte " + mf.csv_mid, mf.csv_mid)}
                  {jumpBtn("Ende " + mf.csv_end, mf.csv_end)}
                </div>
                <div style={{ fontSize: 9, color: C.textMuted }}>
                  CSV {mf.csv_start}–{mf.csv_end} ({mf.occurence} Frames)
                </div>
              </div>
            );
          })()}
          <div style={{ padding: "8px 12px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.textDim }}>
            {hasActiveTrajectory && currentTrajectoryFrame >= 0
              ? `Trajektorie Frame ${currentTrajectoryFrame} / ${(activeTrajectoryNFrames || 1) - 1} (${activeLigand === 2 ? session?.ligand_name_2 : session?.ligand_name_1})`
              : hasActivePdb
                ? "Residuum im Plot anklicken → 3D-Hervorhebung"
                : "PDB/Trajektorie laden im Daten-Bereich"}
          </div>
        </div>
      </div>
    </div>
  );
}
