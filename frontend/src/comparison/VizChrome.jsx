// ═══════════════════════════════════════════════════════════════════
// VizChrome — gemeinsame Bausteine für alle Vergleichs-Encodings.
//
// Damit die sechs Views (Six-Lane, Kreuzmatrix, Bipartit, Embedding,
// Residuen, Chord) dieselbe Sprache sprechen, liefert diese Datei:
//   • VizFrame      — Rahmen: Header (Titel + Untertitel), optionaler
//                     Toolbar-Slot, Plot-Bereich, Footer-Legende.
//   • Legend / Swatch / LigandLegend — einheitliche Legenden-Einträge.
//   • Colorbar      — kontinuierliche Skala (Kreuzmatrix).
//   • Tooltip       — einheitliche Hover-Box.
//   • useLigandFilter — Hook für interaktive Ligand-Legenden.
//
// Bewusst nur Layout/Erklärung — die eigentliche Datendarstellung (SVG)
// bleibt in den Views. Farben kommen aus theme.js.
// ═══════════════════════════════════════════════════════════════════
import { C, BLUE1, BLUE2 } from "./theme";

// Der interaktive Ligand-Filter-Hook (`useLigandFilter`) lebt in theme.js
// neben useResize — damit diese Datei ausschließlich Komponenten exportiert.

// ── Rahmen ────────────────────────────────────────────────────────
export function VizFrame({ title, subtitle, toolbar, legend, children }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex",
      flexDirection: "column", background: C.bg }}>
      {/* Header */}
      <div style={{ padding: "7px 12px 6px", borderBottom: `1px solid ${C.border}`,
        background: C.surface }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 1 }}>{subtitle}</div>
        )}
      </div>

      {/* Optionaler Toolbar-Slot */}
      {toolbar && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap",
          gap: 8, minHeight: 32, padding: "4px 12px", boxSizing: "border-box",
          fontSize: 11, borderBottom: `1px solid ${C.border}`,
          background: C.surfaceLight }}>
          {toolbar}
        </div>
      )}

      {/* Plot-Bereich (wird von den Views via useResize gemessen) */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>{children}</div>

      {/* Footer-Legende */}
      {legend && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap",
          gap: 14, padding: "5px 12px", borderTop: `1px solid ${C.border}`,
          background: C.surface, fontSize: 10.5, color: C.textDim }}>
          {legend}
        </div>
      )}
    </div>
  );
}

// ── Einzelner Legenden-Eintrag ────────────────────────────────────
// shape: dot | line | ring | dash. onClick → interaktiv (klickbar).
export function Swatch({ color, shape = "dot", label, faded = false, onClick }) {
  const interactive = typeof onClick === "function";
  let mark;
  if (shape === "dot")
    mark = <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flex: "none" }} />;
  else if (shape === "ring")
    mark = <span style={{ width: 9, height: 9, borderRadius: "50%",
      border: `2px solid ${color}`, boxSizing: "border-box", flex: "none" }} />;
  else if (shape === "line")
    mark = <span style={{ width: 14, height: 0, borderTop: `2.5px solid ${color}`, flex: "none" }} />;
  else // dash
    mark = <span style={{ width: 14, height: 0,
      borderTop: `2px dashed ${color}`, flex: "none" }} />;

  return (
    <span onClick={onClick} title={interactive ? "Klick: Ligand ein-/ausblenden" : undefined}
      style={{ display: "inline-flex", alignItems: "center", gap: 5,
        cursor: interactive ? "pointer" : "default",
        opacity: faded ? 0.4 : 1,
        textDecoration: faded ? "line-through" : "none",
        userSelect: "none" }}>
      {mark}
      <span style={{ color: faded ? C.textMuted : C.text }}>{label}</span>
    </span>
  );
}

// Stiller Hinweistext (z.B. „Größe ∝ Verweildauer").
export function Note({ children }) {
  return <span style={{ color: C.textMuted }}>{children}</span>;
}

// Zwei interaktive Ligand-Swatches (Identitäts-Farben Blau/Amber).
export function LigandLegend({ data, filter }) {
  return (
    <>
      <Swatch color={BLUE1} label={data.lig1_name}
        faded={filter?.isHidden(1)} onClick={filter ? () => filter.toggle(1) : undefined} />
      <Swatch color={BLUE2} label={data.lig2_name}
        faded={filter?.isHidden(2)} onClick={filter ? () => filter.toggle(2) : undefined} />
    </>
  );
}

// ── Kontinuierliche Farbskala (Kreuzmatrix) ───────────────────────
// colorFn(t) für t∈[0,1]; leftLabel = t0, rightLabel = t1.
export function Colorbar({ colorFn, leftLabel, rightLabel, caption }) {
  const stops = Array.from({ length: 12 }, (_, i) => i / 11);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {caption && <span style={{ color: C.textMuted }}>{caption}</span>}
      <span style={{ color: C.textMuted }}>{leftLabel}</span>
      <span style={{ display: "inline-flex", width: 90, height: 9,
        borderRadius: 2, overflow: "hidden", border: `1px solid ${C.border}` }}>
        {stops.map((t) => (
          <span key={t} style={{ flex: 1, background: colorFn(t) }} />
        ))}
      </span>
      <span style={{ color: C.textMuted }}>{rightLabel}</span>
    </span>
  );
}

// ── Einheitliche Tooltip-Box ──────────────────────────────────────
export function Tooltip({ left, top, color = C.accent, children }) {
  return (
    <div style={{ position: "absolute", left, top, padding: "6px 10px",
      borderRadius: 4, background: C.surface, border: `1px solid ${color}`,
      color: C.text, fontSize: 11, lineHeight: 1.5, pointerEvents: "none",
      zIndex: 5, minWidth: 150 }}>
      {children}
    </div>
  );
}
