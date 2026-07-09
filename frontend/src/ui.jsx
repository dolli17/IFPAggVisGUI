// ═══════════════════════════════════════════════════════════════════
// ui.jsx — app-weite UI-Primitive (Spinner, Button, EmptyState).
//
// Eine Quelle für die wiederkehrenden Bausteine, die zuvor in App.jsx
// und in jeder View leicht abweichend inline neu gebaut wurden. Alle
// Farben/Maße kommen aus theme.js.
// ═══════════════════════════════════════════════════════════════════
import { C, FS, SP, R } from "./comparison/theme";

// ── Lade-Spinner ──────────────────────────────────────────────────
export function Spinner({ size = 16 }) {
  return (
    <div style={{ display: "inline-block", width: size, height: size,
      border: `2px solid ${C.border}`, borderTopColor: C.accent,
      borderRadius: "50%", animation: "spin .6s linear infinite",
      verticalAlign: "middle" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────
// Genau zwei Varianten: primary (accent=true) und secondary (Standard).
// `small` für kompakte Toolbar-Buttons. Prop-API kompatibel zum früheren
// App.jsx-`Btn`, damit bestehende Aufrufe unverändert bleiben.
export function Button({ children, onClick, disabled, accent, small, title, style: s }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      padding: small ? `${SP.xs}px ${SP.sm + 2}px` : `${SP.xs + 2}px ${SP.md + 2}px`,
      borderRadius: R.md,
      border: `1px solid ${accent ? C.accent : C.border}`,
      background: disabled ? C.surfaceLight : (accent ? C.accent : "transparent"),
      color: disabled ? C.textMuted : (accent ? "#fff" : C.textDim),
      fontSize: small ? FS.small : FS.base,
      fontWeight: 600,
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.5 : 1,
      fontFamily: "inherit",
      ...s,
    }}>{children}</button>
  );
}

// ── Zahl-Regler (Slider + Zahleingabe) ────────────────────────────
// Ein wiederverwendbarer Regler für die konfigurierbaren N-Werte
// (Anzahl Farb-Cluster, Vergleichs-Knoten, Chord-Bögen, Labels, Pills).
// Formalisiert das zuvor je View inline gebaute Slider-Muster. Der
// zurückgegebene Wert ist stets eine geclampte Ganzzahl.
export function NumberControl({
  label, value, onChange, min, max, step = 1, suffix, width = 96,
}) {
  const clamp = (v) => {
    if (Number.isNaN(v)) return value;
    return Math.max(min, Math.min(max, Math.round(v)));
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: SP.xs }}>
      {label && <span style={{ color: C.textDim }}>{label}</span>}
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(clamp(parseFloat(e.target.value)))}
        style={{ width }} />
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(clamp(parseFloat(e.target.value)))}
        style={{
          width: 52, padding: `${SP.xs}px ${SP.xs + 1}px`,
          borderRadius: R.sm, border: `1px solid ${C.border}`,
          background: C.surface, color: C.text,
          fontFamily: "ui-monospace, monospace", fontSize: FS.small,
        }} />
      {suffix && <span style={{ color: C.textMuted }}>{suffix}</span>}
    </span>
  );
}

// ── Empty-/Loading-State ──────────────────────────────────────────
// Ein konsistentes, zentriertes Element für „keine Daten" und „lädt".
// Ersetzt die ~6 leicht verschiedenen Platzhalter-Divs der Views und
// schließt die Lücke in Views, die bisher gar keinen Zustand zeigten.
export function EmptyState({ children, loading = false }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
      gap: SP.sm, width: "100%", height: "100%", minHeight: 80,
      color: C.textDim, fontSize: FS.title, textAlign: "center", padding: SP.lg }}>
      {loading && <Spinner />}
      <span>{children}</span>
    </div>
  );
}
