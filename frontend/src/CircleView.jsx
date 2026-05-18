// ═══════════════════════════════════════════════════════════════════
// CircleView — D3-based circle/donut renderer for per-residue
// run-length charts.
//
// Replaces the matplotlib PNG that came from /api/viz/circle. Each
// residue is shown as a set of concentric donut rings — one ring per
// interaction type. Each ring is segmented by run-length encoding:
// active runs are coloured by interaction type, inactive runs are dim.
//
// Layout (option β agreed with user): split view — sidebar on the left
// with miniature donuts for *every* residue, big focused donut on the
// right. Selecting a mini in the sidebar focuses it on the right (and
// notifies the parent via `onSelect`). External selection through the
// `selectedLabel` prop lifts the matching mini and shows it in focus.
//
// Click target (option a agreed with user): the whole donut is clickable.
// We don't try to map clicks to individual ring segments.
// ═══════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState, useEffect } from "react";
import { arc as d3arc } from "d3-shape";

const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  surfaceLight: "#222738",
  border: "#2d3348",
  accent: "#6c7bd4",
  pink: "#f472b6",
  text: "#e2e8f0",
  textDim: "#8892a8",
  textMuted: "#4a5568",
  inactive: "#2d3348",
};

// ─── One donut renderer (used both in sidebar minis and focus pane) ───
function Donut({ residue, rings, size, label, hoveredType, onTypeHover }) {
  const cx = size / 2;
  const cy = size / 2;
  // Outer ring leaves some breathing room from the SVG edge so labels
  // don't get cropped.
  const outerR = size * 0.46;
  // Inner radius for the innermost ring; rings stack outward from here.
  const innerR0 = size * 0.20;
  const ringWidth = (rings.length > 0)
    ? (outerR - innerR0) / Math.max(1, rings.length)
    : 0;

  // Build path generators for each ring.
  // We use d3-shape's arc — it knows how to build SVG `d` strings for
  // annular sectors and respects start/end angles.
  const arcsPerRing = useMemo(() => {
    return rings.map((ring, ringIdx) => {
      const rIn = innerR0 + ringIdx * ringWidth;
      const rOut = rIn + ringWidth;
      const arcGen = d3arc()
        .innerRadius(rIn)
        .outerRadius(rOut)
        .padAngle(0)
        .cornerRadius(0);

      // Compute angles from run-length segments
      const total = ring.segments.reduce((acc, s) => acc + s.size, 0) || 1;
      // Start at top, go clockwise — matches the matplotlib version
      // (`startangle=90, counterclock=False`).
      let cumulative = 0;
      const segs = ring.segments.map((seg, segIdx) => {
        const a0 = -Math.PI / 2 + (cumulative / total) * 2 * Math.PI;
        const a1 = -Math.PI / 2 + ((cumulative + seg.size) / total) * 2 * Math.PI;
        cumulative += seg.size;
        const path = arcGen({ startAngle: a0, endAngle: a1 });
        const fill = seg.value === 1 ? ring.color : C.inactive;
        return { key: `${ringIdx}-${segIdx}`, path, fill };
      });
      return { ringIdx, type: ring.interaction_type, color: ring.color, segs,
               rIn, rOut };
    });
  }, [rings, innerR0, ringWidth]);

  return (
    <svg width={size} height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block" }}>
      <g transform={`translate(${cx}, ${cy})`}>
        {arcsPerRing.map((ring) => {
          const dimmed = hoveredType && hoveredType !== ring.type;
          return (
            <g key={ring.ringIdx}
              opacity={dimmed ? 0.25 : 1}
              onMouseEnter={() => onTypeHover?.(ring.type)}
              onMouseLeave={() => onTypeHover?.(null)}>
              {ring.segs.map((s) => (
                <path key={s.key} d={s.path} fill={s.fill}
                  stroke={C.bg} strokeWidth={0.4} />
              ))}
            </g>
          );
        })}
        {/* Center label */}
        {label && (
          <text textAnchor="middle" dy="0.32em"
            fontSize={Math.max(9, size * 0.10)}
            fill={C.text} fontWeight={600}
            style={{ pointerEvents: "none" }}>
            {label}
          </text>
        )}
      </g>
    </svg>
  );
}

// ─── Legend showing all interaction types with their colors ───
function InteractionLegend({ colors, hoveredType, onHover }) {
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: "6px 12px",
      padding: "8px 10px", borderTop: `1px solid ${C.border}`,
      fontSize: 10, color: C.textDim,
    }}>
      {Object.entries(colors).map(([type, color]) => {
        const dimmed = hoveredType && hoveredType !== type;
        return (
          <div key={type}
            onMouseEnter={() => onHover?.(type)}
            onMouseLeave={() => onHover?.(null)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              cursor: "default", opacity: dimmed ? 0.4 : 1,
            }}>
            <span style={{
              width: 10, height: 10, borderRadius: 2,
              background: color, display: "inline-block",
            }} />
            <span>{type}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function CircleView({
  data,           // { residues, rings_by_residue, interaction_colors, n_ifps }
  selectedLabels, // array — every residue in here gets the "active" border
                  //         in the sidebar; the *last* one is the focused
                  //         donut on the right. `selectedLabel` (single
                  //         string) is still accepted for back-compat.
  selectedLabel,
  onSelect,       // (label, additive) => void — emits when a residue is clicked
  compact = false, // hide the sidebar; show focus donut only (overview grid)
}) {
  const focusContainerRef = useRef(null);
  const [focusSize, setFocusSize] = useState(360);
  const [hoveredType, setHoveredType] = useState(null);

  // Keep the focused donut as big as its container allows (square)
  useEffect(() => {
    if (!focusContainerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const s = Math.max(160, Math.min(width, height) - 24);
        setFocusSize(s);
      }
    });
    ro.observe(focusContainerRef.current);
    return () => ro.disconnect();
  }, []);

  if (!data?.residues?.length) {
    return (
      <div style={{ padding: 20, color: C.textDim, fontSize: 12 }}>
        Keine Daten
      </div>
    );
  }

  // Normalize the selection prop — accept either a single label
  // (legacy) or an array (multi-select). With ≥ 2 selections, the focus
  // pane shows *all* of them as a wrap-grid of donuts; with 0 or 1 it
  // shows a single big donut (the last added one, or the first residue
  // as a default if nothing is selected).
  const labels = (selectedLabels && selectedLabels.length)
    ? selectedLabels
    : (selectedLabel ? [selectedLabel] : []);
  const labelSet = new Set(labels);
  const primary = labels.length ? labels[labels.length - 1] : null;

  const focusedResidue = (primary && data.rings_by_residue[primary])
    ? primary
    : data.residues[0];
  const focusedRings = data.rings_by_residue[focusedResidue] || [];

  // Donuts to render in the focus pane. Single-selection or no selection
  // → just one (the focused one). Multi-selection → every selected
  // residue, in selection order so the latest addition is visually last.
  const focusList = labels.length >= 2
    ? labels.filter(l => data.rings_by_residue[l])
    : [focusedResidue];

  // Per-donut size for the multi grid: we drop down as the count grows
  // so 2 fit roomy and 9 still fit. The single-donut path keeps the
  // full focus size as before.
  const perDonutSize = focusList.length <= 1
    ? focusSize
    : Math.max(120, Math.floor(focusSize
        / Math.ceil(Math.sqrt(focusList.length))));

  return (
    <div style={{
      width: "100%", height: "100%", display: "flex",
      background: C.surface, borderRadius: 8,
      border: `1px solid ${C.border}`, overflow: "hidden",
    }}>
      {/* ── Sidebar: all residues as miniature donuts ── */}
      {!compact && <div style={{
        width: 200, flexShrink: 0,
        borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", minHeight: 0,
      }}>
        <div style={{
          padding: "8px 12px", borderBottom: `1px solid ${C.border}`,
          fontSize: 10, color: C.textDim, textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          Residuen ({data.residues.length})
        </div>
        <div style={{
          flex: 1, overflowY: "auto", padding: 8,
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4,
        }}>
          {data.residues.map((res) => {
            const rings = data.rings_by_residue[res] || [];
            const isSelected = labelSet.has(res);
            const isPrimary = res === focusedResidue;
            return (
              <div key={res}
                onClick={(e) => onSelect?.(res,
                  e.metaKey || e.ctrlKey || e.shiftKey)}
                title={res}
                style={{
                  cursor: "pointer", borderRadius: 6,
                  background: isPrimary ? "rgba(244,114,182,0.18)"
                              : isSelected ? "rgba(244,114,182,0.08)"
                              : "transparent",
                  border: `1px solid ${
                    isPrimary ? C.pink
                    : isSelected ? "rgba(244,114,182,0.5)"
                    : "transparent"}`,
                  padding: 4, display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 2,
                  transition: "background .15s, border .15s",
                }}>
                <Donut residue={res} rings={rings} size={70} label={null} />
                <span style={{
                  fontSize: 9,
                  color: isSelected ? C.pink : C.textDim,
                  fontWeight: isSelected ? 600 : 400,
                  textAlign: "center", maxWidth: "100%",
                  overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>{res}</span>
              </div>
            );
          })}
        </div>
        <InteractionLegend colors={data.interaction_colors}
          hoveredType={hoveredType}
          onHover={setHoveredType} />
      </div>}

      {/* ── Focus pane: big donut for selected residue, or a wrap-grid
              of donuts for multi-select ── */}
      <div ref={focusContainerRef} style={{
        flex: 1, minWidth: 0, display: "flex",
        flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: 12,
      }}>
        {focusList.length === 1 ? (
          // ── Single residue (default / 1 selected) ──
          <>
            <div style={{
              padding: "0 0 8px 0", fontSize: 14, fontWeight: 600,
              color: C.pink, textAlign: "center",
            }}>{focusedResidue}</div>
            <div style={{
              flex: 1, width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center",
              minHeight: 0,
            }}>
              <Donut residue={focusedResidue}
                rings={focusedRings}
                size={focusSize}
                label={null}
                hoveredType={hoveredType}
                onTypeHover={setHoveredType} />
            </div>
            <div style={{
              fontSize: 10, color: C.textDim, marginTop: 8, textAlign: "center",
            }}>
              {focusedRings.length} Interaktionstyp{focusedRings.length === 1 ? "" : "en"}
              {" · "}
              {data.n_ifps} IFP{data.n_ifps === 1 ? "" : "s"}
              <br />
              Ringe (innen → außen): {focusedRings.map((r) => r.interaction_type).join(", ")}
            </div>
          </>
        ) : (
          // ── Multi-selection: wrap grid of all selected residues ──
          <>
            <div style={{
              padding: "0 0 8px 0", fontSize: 12, fontWeight: 600,
              color: C.pink, textAlign: "center",
            }}>
              {focusList.length} Residuen ausgewählt
            </div>
            <div style={{
              flex: 1, width: "100%", overflow: "auto",
              display: "flex", flexWrap: "wrap", gap: 16,
              alignItems: "center", justifyContent: "center",
              alignContent: "center",
            }}>
              {focusList.map((label) => {
                const rings = data.rings_by_residue[label] || [];
                const isPrimary = label === primary;
                return (
                  <div key={label} style={{
                    display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 4,
                    padding: 6, borderRadius: 6,
                    border: `1px solid ${isPrimary ? C.pink : "transparent"}`,
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: isPrimary ? C.pink : C.text,
                    }}>{label}</span>
                    <Donut residue={label}
                      rings={rings}
                      size={perDonutSize}
                      label={null}
                      hoveredType={hoveredType}
                      onTypeHover={setHoveredType} />
                  </div>
                );
              })}
            </div>
            <div style={{
              fontSize: 10, color: C.textDim, marginTop: 8, textAlign: "center",
            }}>
              ⌘/Ctrl+Klick auf weitere Residuen zum Hinzufügen/Entfernen
            </div>
          </>
        )}
      </div>
    </div>
  );
}
