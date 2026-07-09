// ═══════════════════════════════════════════════════════════════════
// theme.js — die EINZIGE Design-Token-Quelle der App.
//
// Farben, Typo-Skala (FS), Spacing (SP) und Radius (R) leben hier und
// werden von der App-Shell (App.jsx) UND allen Views importiert. So gibt
// es genau eine Wahrheit für das dunkle wissenschaftliche Theme.
//
// Bewusst SEPARATE Token-Sets (nicht hier vermischen):
//   • Cluster-Farben  → clusterColors.js (Tableau10, qualitativ)
//   • Liganden-Identität (Vergleich) → BLUE1/BLUE2 unten (Blau/Amber)
//   • Six-Lane-Paperfarben → lokale Konstanten in ComparisonView.jsx
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";

export const C = {
  bg: "#0f1117",          // App-Hintergrund (dunkelste Ebene)
  surface: "#1a1d27",     // Panels / Karten
  surfaceLight: "#222738",// Karten-Header / Toolbars
  border: "#2d3348",      // dezente Trennlinien
  accent: "#6c7bd4",      // Primär-Aktion (Blau)
  accentDim: "rgba(108,123,212,0.15)",
  pink: "#f472b6",        // Selektion / Fokus
  pinkDim: "rgba(244,114,182,0.15)",
  green: "#4ade80",       // Status OK
  greenDim: "rgba(74,222,128,0.15)",
  red: "#f87171",         // Fehler
  text: "#e2e8f0",        // Haupttext
  textDim: "#8892a8",     // Sekundärtext
  textMuted: "#5a6580",   // Tertiärtext / Hinweise
};

// ── Typo-Skala ────────────────────────────────────────────────────
// Ersetzt die zuvor 7 willkürlich gestreuten Schriftgrößen.
export const FS = {
  tiny: 10,    // dichte Marker, Achsen-Ticks
  label: 10.5, // Eyebrow-Labels, Legenden, Subtitle
  small: 11,   // Tooltips, kleine Controls
  base: 12,    // Body / Buttons / Tabs
  title: 13,   // Panel-/View-Titel
};

// ── Spacing-Raster ────────────────────────────────────────────────
export const SP = { xs: 4, sm: 8, md: 12, lg: 16 };

// ── Radius-Skala ──────────────────────────────────────────────────
export const R = { sm: 4, md: 6, lg: 8, pill: 10 };

// Liganden-Farben. In den Vergleichs-Encodings kodiert die Farbe die
// Liganden-IDENTITÄT — daher ein klar kontrastierendes Paar (Blau/Amber)
// statt der beiden ähnlichen Blautöne des Six-Lane. Das Six-Lane selbst
// behält seine Paper-Farben (eigene Konstanten in ComparisonView.jsx).
export const BLUE1 = "#3b82f6";  // Ligand 1 (Blau)
export const BLUE2 = "#f59e0b";  // Ligand 2 (Amber) — bewusst kontrastreich
export const ligColor = (lig) => (lig === 1 ? BLUE1 : BLUE2);

export function useResize(ref, initial = { width: 900, height: 520 }) {
  const [size, setSize] = useState(initial);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setSize({ width, height });
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// Interaktiver Ligand-Filter für die Legenden: hidden = Set der
// ausgeblendeten Liganden-IDs (1|2); toggle(lig) schaltet um;
// isHidden(lig) zum Dimmen/Filtern in den Views.
export function useLigandFilter() {
  const [hidden, setHidden] = useState(() => new Set());
  const toggle = (lig) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(lig) ? next.delete(lig) : next.add(lig);
      return next;
    });
  return { hidden, toggle, isHidden: (lig) => hidden.has(lig) };
}
