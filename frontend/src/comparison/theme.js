// Gemeinsame Farben + Hooks für die Vergleichs-Encodings.
import { useEffect, useState } from "react";

export const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  surfaceLight: "#22273a",
  border: "#2d3348",
  accent: "#6c7bd4",
  pink: "#f472b6",
  text: "#e2e8f0",
  textDim: "#8892a8",
  textMuted: "#5a6580",
};

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
