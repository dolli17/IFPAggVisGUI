// ═══════════════════════════════════════════════════════════════════
// ClusterTableView — quantitative overview of all structural clusters.
//
// Phase B2: the four existing visualisations already colour-band by
// cluster (Phase B1) but offer no list — this view answers
// "what *are* the dominant binding modes?" with a sortable table.
//
// Each row maps 1:1 to an entry in `clusterData.clusters` (already
// sorted desc by frame_count from the backend). Clicking a row selects
// the cluster via the shared `selectCluster` helper from the host —
// that propagates to 3D viewer (representative IFP), residue
// highlights (`active_residues`) and the cluster band/strip.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";

const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  surfaceLight: "#222738",
  border: "#2d3348",
  accent: "#6c7bd4",
  pink: "#f472b6",
  pinkDim: "rgba(244,114,182,0.15)",
  text: "#e2e8f0",
  textDim: "#8892a8",
  textMuted: "#4a5568",
};

const COLS = [
  { id: "rank",     label: "#",        align: "right",  width: 44 },
  { id: "color",    label: "",         align: "center", width: 30, sortable: false },
  { id: "pattern",  label: "Pattern",  align: "left",   width: 120, sortable: false },
  { id: "frames",   label: "Frames",   align: "right",  width: 80 },
  { id: "percent",  label: "%",        align: "right",  width: 110 },
  { id: "ifps",     label: "#IFPs",    align: "right",  width: 70 },
  { id: "active",   label: "#Res",     align: "right",  width: 64 },
  { id: "diff",     label: "Δ zu Top", align: "right",  width: 90 },
  { id: "residues", label: "Residuen", align: "left" },
];

// Stable, hash-derived colour per residue label. The same residue gets
// the same pill colour across all rows, which makes recurring residues
// pop visually. Uses a muted HSL palette that reads well on dark theme.
function residueColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  // 45 % sat, 32 % light = visible but not screaming on dark surface
  return `hsl(${hue}, 45%, 32%)`;
}
function residueBorder(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue}, 50%, 55%)`;
}

// Pattern strip — one tiny rect per interaction column, filled with the
// cluster's colour when the pattern bit is 1, dimmed when 0. The whole
// row reads like a small 1-D heatmap and reveals visually which clusters
// share structural similarity. Click on a single pixel filters the
// whole table to clusters whose pattern has that column active.
function PatternStrip({
  pattern, color, columns,
  activeColumn,         // optional: currently filtered column index (highlight)
  onPickColumn,         // optional: (colIndex) => void
}) {
  if (!pattern?.length) return null;
  const n = pattern.length;
  const clickable = typeof onPickColumn === "function";
  return (
    <svg width="100%" height={14} preserveAspectRatio="none"
      viewBox={`0 0 ${n} 1`}
      style={{
        display: "block",
        shapeRendering: "crispEdges",
        background: "rgba(255,255,255,0.04)",
        borderRadius: 2,
        cursor: clickable ? "crosshair" : "default",
      }}>
      {pattern.map((v, i) => {
        const isActiveCol = i === activeColumn;
        const fill = v
          ? (isActiveCol ? "#ffffff" : color)
          : (isActiveCol ? "rgba(255,255,255,0.35)" : "transparent");
        return (
          <rect key={i} x={i} y={0} width={1.02} height={1}
            fill={fill}
            onClick={clickable
              ? (e) => { e.stopPropagation(); onPickColumn(i); }
              : undefined}>
            <title>
              {columns?.[i]
                ? `${columns[i]} — ${v ? "aktiv" : "inaktiv"}${clickable ? " · Klick filtert" : ""}`
                : `Spalte ${i + 1}/${n}`}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

// Residue pill — small chip with a hash-stable background colour. Used
// in the rightmost table column to replace the comma-separated text.
// When `onToggle` is wired, the pill becomes clickable and the
// background switches to pink when the residue is in the highlight set
// — turns the table into a residue-discovery launchpad.
function ResiduePill({ name, active, onToggle }) {
  const clickable = typeof onToggle === "function";
  return (
    <span
      onClick={clickable
        ? (e) => { e.stopPropagation(); onToggle(name); }
        : undefined}
      title={clickable
        ? (active
          ? `Aus Auswahl entfernen: ${name}`
          : `Zu Auswahl hinzufügen: ${name}`)
        : name}
      style={{
        display: "inline-block",
        padding: "1px 6px", marginRight: 3, marginBottom: 2,
        fontSize: 10, lineHeight: 1.3, fontWeight: 600,
        color: active ? "#fff" : "#e2e8f0",
        background: active ? C.pink : residueColor(name),
        border: `1px solid ${active ? C.pink : residueBorder(name)}`,
        borderRadius: 10, whiteSpace: "nowrap",
        cursor: clickable ? "pointer" : "default",
        transition: "background .12s, border-color .12s",
      }}>{name}</span>
  );
}

export default function ClusterTableView({
  data,             // clusterData payload (clusters[], cluster_id_per_ifp[], n_clusters, total_frames)
  clusterColors,    // buildClusterColors result
  selectedClusters, // number[] of currently-selected cluster ids
  onSelectCluster,  // (cid) => void
  currentClusterId, // optional: cluster id of the active frame (highlighted differently than selection)
  matchingClusters, // optional: Set<number> of cluster ids matching residue discovery
  highlightResidues,// optional: string[] of currently-highlighted residues (drives pill colour)
  onToggleResidue,  // optional: (residue) => void — called when a pill is clicked
}) {
  const [sortBy, setSortBy] = useState("rank");
  const [sortDir, setSortDir] = useState("asc"); // rank asc == frames desc, which is the natural order
  const [topOnly, setTopOnly] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  // Pattern-pixel filter: when set, only clusters with pattern[col]===1 stay.
  const [patternColFilter, setPatternColFilter] = useState(null);

  // Reference cluster for the Δ column. When exactly one cluster is
  // selected, the Δ column shows the Hamming distance between each
  // cluster's pattern and the selected cluster's pattern — turns the
  // table into a "which clusters look most/least like this one?" view.
  // Otherwise we fall back to the backend-provided diff_to_prev_cluster.
  const diffRefCid = (selectedClusters?.length === 1)
    ? selectedClusters[0] : null;
  const diffRefPattern = useMemo(() => {
    if (diffRefCid == null || !data?.clusters?.length) return null;
    const ref = data.clusters.find(c => c.cluster_id === diffRefCid);
    return ref?.pattern || null;
  }, [diffRefCid, data]);

  const rows = useMemo(() => {
    if (!data?.clusters?.length) return [];
    const total = data.total_frames || 1;
    const topK = clusterColors?.topCount ?? 10;
    let r = data.clusters.map((c, i) => {
      let diff = c.diff_to_prev_cluster;
      if (diffRefPattern && c.pattern) {
        // Hamming distance to selected cluster's pattern.
        let d = 0;
        const n = Math.min(diffRefPattern.length, c.pattern.length);
        for (let k = 0; k < n; k++) {
          if (diffRefPattern[k] !== c.pattern[k]) d++;
        }
        diff = d;
      }
      return {
        rank: i,                          // 0-based; we display +1
        isTop: i < topK,
        cluster_id: c.cluster_id,
        pattern: c.pattern,
        frames: c.frame_count,
        percent: (c.frame_count / total) * 100,
        ifps: c.ifp_count,
        active: c.n_active,
        diff,
        residues: c.active_residues,
        representative: c.representative_ifp,
      };
    });
    // Filter — AND across whitespace-separated tokens; case-insensitive
    // substring match against each cluster's active_residues list.
    const tokens = filterQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length) {
      r = r.filter(x => {
        const resLower = x.residues.map(s => s.toLowerCase());
        return tokens.every(t => resLower.some(rl => rl.includes(t)));
      });
    }
    if (topOnly) r = r.filter(x => x.isTop);
    // Pattern-column filter (Phase B2b/B3) — only clusters that have
    // the picked interaction column active.
    if (patternColFilter != null) {
      r = r.filter(x => x.pattern?.[patternColFilter] === 1);
    }
    const key = sortBy;
    const dir = sortDir === "asc" ? 1 : -1;
    r.sort((a, b) => {
      if (key === "residues") {
        const av = a.residues?.length ? a.residues[0] : "";
        const bv = b.residues?.length ? b.residues[0] : "";
        return av < bv ? -dir : av > bv ? dir : 0;
      }
      return (a[key] - b[key]) * dir;
    });
    return r;
  }, [data, sortBy, sortDir, topOnly, filterQuery, patternColFilter, clusterColors, diffRefPattern]);

  // Max % across currently-visible rows — used to scale the inline bar
  // in the % column so the largest visible value always fills the cell.
  const maxPercent = useMemo(() => {
    if (!rows.length) return 1;
    return Math.max(...rows.map(r => r.percent), 1e-6);
  }, [rows]);

  if (!data?.clusters?.length || !clusterColors) {
    return (
      <div style={{
        padding: 24, fontSize: 12, color: C.textDim,
      }}>
        Keine Cluster-Daten geladen. (Aggregation ausführen.)
      </div>
    );
  }

  const total = data.total_frames || 1;
  const topK = clusterColors.topCount;
  const topShare = data.clusters.slice(0, topK)
    .reduce((acc, c) => acc + c.frame_count, 0);

  // Global residue cloud (Phase B4) — sum frame_count over every
  // cluster the residue appears in. Lets the user see which residues
  // *dominate* the trajectory and use the cloud as a one-click filter.
  const residueCloud = useMemo(() => {
    if (!data?.clusters?.length) return [];
    const tally = new Map();
    for (const c of data.clusters) {
      for (const r of c.active_residues || []) {
        tally.set(r, (tally.get(r) || 0) + c.frame_count);
      }
    }
    return Array.from(tally.entries())
      .map(([name, frames]) => ({ name, frames }))
      .sort((a, b) => b.frames - a.frames);
  }, [data]);
  const cloudMax = residueCloud[0]?.frames || 1;
  const [cloudOpen, setCloudOpen] = useState(true);

  // Multi-cluster diff (Phase B3) — shown only when ≥2 clusters are
  // selected. Computes intersection / per-cluster exclusive residues
  // across the selection.
  const compareDiff = useMemo(() => {
    if (!selectedClusters || selectedClusters.length < 2) return null;
    const sel = selectedClusters
      .map(cid => data.clusters.find(c => c.cluster_id === cid))
      .filter(Boolean);
    if (sel.length < 2) return null;
    const sets = sel.map(c => new Set(c.active_residues || []));
    const all = new Set();
    sets.forEach(s => s.forEach(r => all.add(r)));
    const common = [...all].filter(r => sets.every(s => s.has(r))).sort();
    const exclusive = sel.map((c, i) => {
      const others = sets.filter((_, j) => j !== i);
      return {
        cluster_id: c.cluster_id,
        residues: (c.active_residues || []).filter(
          r => !others.some(s => s.has(r))
        ).sort(),
      };
    });
    return { sel, common, exclusive };
  }, [selectedClusters, data]);

  const handleSort = (col) => {
    if (col.sortable === false) return;
    if (sortBy === col.id) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col.id);
      // numeric columns default to desc (most-interesting-first); text asc
      setSortDir(col.id === "residues" ? "asc" : "desc");
      if (col.id === "rank") setSortDir("asc");
    }
  };

  const sortArrow = (col) =>
    col.id === sortBy ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const selSet = new Set(selectedClusters || []);

  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      background: C.surface, color: C.text,
      overflow: "hidden",
    }}>
      {/* ── Header / summary ── */}
      <div style={{
        padding: "10px 16px", borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Top Binding Modes
          </span>
          <span style={{ fontSize: 10, color: C.textDim }}>
            {data.n_clusters} strukturelle Cluster über {data.n_ifps}
            {" "}zeitbasierte IFPs · {total} Frames gesamt
            {(filterQuery.trim() || patternColFilter != null) && (
              <span style={{ color: C.pink, marginLeft: 8 }}>
                · {rows.length} Treffer
              </span>
            )}
          </span>
          {patternColFilter != null && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              marginTop: 4, padding: "2px 4px 2px 8px",
              fontSize: 10, fontWeight: 600,
              background: C.pinkDim, color: C.pink,
              border: `1px solid ${C.pink}`, borderRadius: 10,
              alignSelf: "flex-start",
            }} title="Pattern-Spalten-Filter">
              Pattern-Spalte:{" "}
              {data.interaction_columns?.[patternColFilter]
                || `Pos ${patternColFilter + 1}`}
              <span onClick={() => setPatternColFilter(null)}
                style={{
                  cursor: "pointer", padding: "0 4px", fontSize: 12,
                  lineHeight: 1, opacity: 0.8,
                }} title="Pattern-Filter löschen">×</span>
            </span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 12 }} />
        {/* Filter input (Phase B2a, F) — AND-Match auf Residuen-Labels */}
        <div style={{
          position: "relative", display: "flex", alignItems: "center",
        }}>
          <input type="text"
            value={filterQuery}
            onChange={e => setFilterQuery(e.target.value)}
            placeholder="Filter: z.B. HIS84 ASP52"
            style={{
              width: 200, padding: "5px 24px 5px 10px",
              fontSize: 11, color: C.text,
              background: C.bg,
              border: `1px solid ${filterQuery ? C.pink : C.border}`,
              borderRadius: 4, outline: "none",
              fontFamily: "inherit",
            }} />
          {filterQuery && (
            <span onClick={() => setFilterQuery("")}
              title="Filter löschen"
              style={{
                position: "absolute", right: 6, top: "50%",
                transform: "translateY(-50%)",
                color: C.pink, cursor: "pointer", fontSize: 12,
                lineHeight: 1, padding: 2, userSelect: "none",
              }}>×</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: C.textDim }}>
          Top {topK} decken{" "}
          <span style={{ color: C.accent, fontWeight: 600 }}>
            {((topShare / total) * 100).toFixed(1) }%
          </span>
          {" "}der Trajektorie ab
        </div>
        <label style={{
          fontSize: 10, color: topOnly ? C.pink : C.textDim,
          display: "flex", alignItems: "center", gap: 4,
          cursor: "pointer", userSelect: "none",
        }}>
          <input type="checkbox"
            checked={topOnly}
            onChange={e => setTopOnly(e.target.checked)} />
          nur Top {topK}
        </label>
      </div>

      {/* ── Residue cloud (Phase B4) ── */}
      {residueCloud.length > 0 && (
        <div style={{
          borderBottom: `1px solid ${C.border}`,
          background: C.surface,
        }}>
          <div onClick={() => setCloudOpen(o => !o)}
            style={{
              padding: "6px 16px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 10, color: C.textDim, userSelect: "none",
            }}>
            <span style={{ width: 12, textAlign: "center" }}>
              {cloudOpen ? "▾" : "▸"}
            </span>
            <span style={{ fontWeight: 600 }}>Residuen-Browser</span>
            <span>· {residueCloud.length} aktive Residuen · Klick = (de)markieren</span>
            <span style={{ flex: 1 }} />
            {highlightResidues?.length > 0 && (
              <span style={{ color: C.pink, fontWeight: 600 }}>
                {highlightResidues.length} aktiv
              </span>
            )}
          </div>
          {cloudOpen && (
            <div style={{
              padding: "0 16px 10px",
              display: "flex", flexWrap: "wrap",
              gap: 4, alignItems: "baseline",
            }}>
              {residueCloud.map(({ name, frames }) => {
                const t = frames / cloudMax;
                // Map relative weight to font size 9 … 16 px
                const fs = 9 + t * 7;
                const active = highlightResidues?.includes(name);
                return (
                  <span key={name}
                    onClick={() => onToggleResidue?.(name)}
                    title={`${frames.toLocaleString("de-DE")} Frames in `
                          + `${data.clusters.filter(c => (c.active_residues || []).includes(name)).length}`
                          + ` Clustern`}
                    style={{
                      padding: "1px 7px", borderRadius: 10,
                      fontSize: fs, lineHeight: 1.3, fontWeight: 600,
                      color: active ? "#fff" : "#e2e8f0",
                      background: active ? C.pink : residueColor(name),
                      border: `1px solid ${active ? C.pink : residueBorder(name)}`,
                      cursor: "pointer", whiteSpace: "nowrap",
                      transition: "background .12s",
                    }}>{name}</span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Cluster-Compare diff panel (Phase B3) ── */}
      {compareDiff && (
        <div style={{
          padding: "10px 16px",
          background: "rgba(244,114,182,0.06)",
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: C.text,
            display: "flex", alignItems: "center", gap: 8,
            marginBottom: 6,
          }}>
            <span>Vergleich:</span>
            {compareDiff.sel.map((c) => (
              <span key={c.cluster_id} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "1px 6px", borderRadius: 8,
                background: clusterColors.colorOf(c.cluster_id),
                color: "#fff", fontSize: 10, fontWeight: 600,
                border: "1px solid rgba(255,255,255,0.2)",
              }}>Cluster {c.cluster_id}</span>
            ))}
            <span style={{ color: C.textMuted, fontSize: 10, marginLeft: 8 }}>
              (⌘/Ctrl+Klick auf weitere Cluster zum Hinzufügen)
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 10 }}>
            <div style={{ minWidth: 200 }}>
              <div style={{
                color: C.accent, fontWeight: 600, marginBottom: 4,
              }}>
                ∩ Gemeinsam ({compareDiff.common.length})
              </div>
              <div>
                {compareDiff.common.length === 0
                  ? <span style={{ color: C.textMuted }}>—</span>
                  : compareDiff.common.map((r) => (
                    <ResiduePill key={r} name={r}
                      active={highlightResidues?.includes(r)}
                      onToggle={onToggleResidue} />
                  ))}
              </div>
            </div>
            {compareDiff.exclusive.map((entry) => (
              <div key={entry.cluster_id} style={{ minWidth: 200 }}>
                <div style={{
                  fontWeight: 600, marginBottom: 4,
                  color: clusterColors.colorOf(entry.cluster_id),
                }}>
                  Nur in {entry.cluster_id} ({entry.residues.length})
                </div>
                <div>
                  {entry.residues.length === 0
                    ? <span style={{ color: C.textMuted }}>—</span>
                    : entry.residues.map((r) => (
                      <ResiduePill key={r} name={r}
                        active={highlightResidues?.includes(r)}
                        onToggle={onToggleResidue} />
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div style={{
        flex: 1, minHeight: 0, overflow: "auto",
      }}>
        <table style={{
          width: "100%", borderCollapse: "collapse",
          fontSize: 11, tableLayout: "fixed",
        }}>
          <colgroup>
            {COLS.map((col) => (
              <col key={col.id}
                style={col.width ? { width: col.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLS.map((col) => {
                const label = (col.id === "diff" && diffRefCid != null)
                  ? `Δ zu C${diffRefCid}` : col.label;
                return (
                  <th key={col.id}
                    onClick={() => handleSort(col)}
                    title={col.id === "diff"
                      ? (diffRefCid != null
                        ? `Residuen-Unterschiede zum ausgewählten Cluster ${diffRefCid}`
                        : "Residuen-Unterschiede zum vorherigen Cluster (sortiert nach Häufigkeit)")
                      : undefined}
                    style={{
                      padding: "6px 8px", textAlign: col.align,
                      color: sortBy === col.id
                        ? C.accent
                        : (col.id === "diff" && diffRefCid != null
                          ? C.pink : C.textDim),
                      fontWeight: 600, fontSize: 10,
                      background: C.surfaceLight,
                      borderBottom: `1px solid ${C.border}`,
                      cursor: col.sortable === false ? "default" : "pointer",
                      position: "sticky", top: 0, zIndex: 1,
                      userSelect: "none",
                    }}>
                    {label}{sortArrow(col)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelected = selSet.has(r.cluster_id);
              const isCurrent = r.cluster_id === currentClusterId;
              const isMatching = matchingClusters?.has(r.cluster_id);
              const color = clusterColors.colorOf(r.cluster_id);
              return (
                <tr key={r.cluster_id}
                  onClick={(e) => onSelectCluster?.(r.cluster_id,
                    e.metaKey || e.ctrlKey || e.shiftKey)}
                  style={{
                    cursor: "pointer",
                    background: isSelected
                      ? C.pinkDim
                      : isCurrent
                        ? "rgba(108,123,212,0.08)"
                        : isMatching
                          ? "rgba(244,114,182,0.06)"
                          : "transparent",
                    borderLeft: isSelected
                      ? `3px solid ${C.pink}`
                      : isCurrent
                        ? `3px solid ${C.accent}`
                        : `3px solid transparent`,
                    // Discovery-match marker on the right edge — visually
                    // distinct from the left-edge selection/current bar.
                    boxShadow: isMatching && !isSelected
                      ? `inset -3px 0 0 ${C.pink}` : "none",
                    transition: "background .12s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isCurrent) {
                      e.currentTarget.style.background = C.surfaceLight;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !isCurrent) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}>
                  <td style={{
                    padding: "6px 8px", textAlign: "right",
                    color: r.isTop ? C.text : C.textDim,
                    fontWeight: r.isTop ? 600 : 400,
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {r.rank + 1}
                  </td>
                  <td style={{
                    padding: "6px 8px", textAlign: "center",
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      display: "inline-block", width: 14, height: 14,
                      borderRadius: 3, background: color,
                      verticalAlign: "middle",
                      boxShadow: isCurrent
                        ? `0 0 0 2px ${C.accent}` : "none",
                    }} />
                  </td>
                  {/* Pattern strip — visual DNA of this binding mode. */}
                  <td style={{
                    padding: "6px 8px",
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <PatternStrip
                      pattern={r.pattern}
                      color={color}
                      columns={data.interaction_columns}
                      activeColumn={patternColFilter}
                      onPickColumn={(col) => setPatternColFilter(
                        patternColFilter === col ? null : col
                      )} />
                  </td>
                  <td style={{
                    padding: "6px 8px", textAlign: "right",
                    color: C.text,
                    fontVariantNumeric: "tabular-nums",
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {r.frames.toLocaleString("de-DE")}
                  </td>
                  {/* % column with inline bar — the bar's width is
                      proportional to the maximum visible %, so sorting
                      or filtering rescales it to use the full cell. */}
                  <td style={{
                    padding: 0,
                    position: "relative",
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <div style={{
                      position: "absolute", left: 4, top: 4, bottom: 4,
                      width: `calc(${Math.min(100, (r.percent / maxPercent) * 100)}% - 8px)`,
                      background: color, opacity: 0.22,
                      borderRadius: 3, transition: "width .15s",
                    }} />
                    <div style={{
                      position: "relative", padding: "6px 8px",
                      textAlign: "right",
                      color: C.accent, fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {r.percent.toFixed(2)}
                    </div>
                  </td>
                  <td style={{
                    padding: "6px 8px", textAlign: "right",
                    color: r.ifps > 1 ? C.text : C.textMuted,
                    fontVariantNumeric: "tabular-nums",
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {r.ifps}
                  </td>
                  <td style={{
                    padding: "6px 8px", textAlign: "right",
                    color: C.textDim,
                    fontVariantNumeric: "tabular-nums",
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {r.active}
                  </td>
                  <td style={{
                    padding: "6px 8px", textAlign: "right",
                    color: (diffRefCid != null
                      ? (r.cluster_id === diffRefCid ? C.textMuted : C.pink)
                      : (r.rank === 0 ? C.textMuted : C.textDim)),
                    fontWeight: diffRefCid != null && r.cluster_id !== diffRefCid
                      ? 600 : 400,
                    fontVariantNumeric: "tabular-nums",
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {diffRefCid != null
                      ? (r.cluster_id === diffRefCid ? "—" : r.diff)
                      : (r.rank === 0 ? "—" : r.diff)}
                  </td>
                  <td style={{
                    padding: "4px 8px", textAlign: "left",
                    borderBottom: `1px solid ${C.border}`,
                    overflow: "hidden",
                    lineHeight: 1.5,
                  }} title={r.residues?.join(", ") || ""}>
                    {r.residues?.slice(0, 8).map((res) => (
                      <ResiduePill key={res} name={res}
                        active={highlightResidues?.includes(res)}
                        onToggle={onToggleResidue} />
                    ))}
                    {r.residues?.length > 8 && (
                      <span style={{
                        fontSize: 10, color: C.textMuted, fontWeight: 600,
                        verticalAlign: "middle",
                      }}>
                        +{r.residues.length - 8}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer / legend ── */}
      <div style={{
        padding: "6px 16px", fontSize: 9, color: C.textMuted,
        borderTop: `1px solid ${C.border}`,
        display: "flex", gap: 16, flexWrap: "wrap",
      }}>
        <span>
          <span style={{ color: C.pink, fontWeight: 600 }}>■</span>
          {" "}ausgewählt
        </span>
        <span>
          <span style={{ color: C.accent, fontWeight: 600 }}>■</span>
          {" "}aktueller Frame
        </span>
        <span>
          <span style={{ color: C.pink, fontWeight: 600 }}>▕</span>
          {" "}Treffer (Residuen-Discovery)
        </span>
        <span>
          Zeile = Cluster wählen · Pille = Residuum (de)markieren
        </span>
        <span style={{ flex: 1 }} />
        <span>
          {diffRefCid != null
            ? `Δ zu C${diffRefCid} = Pattern-Unterschiede zum ausgewählten Cluster`
            : "Δ zu Top = Pattern-Unterschiede zum vorherigen Cluster (Klick auf Cluster → Δ zu diesem Cluster)"}
        </span>
      </div>
    </div>
  );
}
