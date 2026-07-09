// ═══════════════════════════════════════════════════════════════════
// residueClasses — chemische Klassifizierung der Bindetaschen-Residuen.
//
// Statt jeder Residue eine eigene (bedeutungslose) Hash-Farbe zu geben,
// werden Residuen in wenige chemische Klassen eingeteilt und je Klasse
// einheitlich gefärbt. Die Farben folgen der etablierten Aminosäure-
// Eigenschaftskonvention (positiv = Blau, negativ = Rot, polar = Grün,
// hydrophob = Amber, aromatisch = Violett, speziell = Grau, Wasser =
// Cyan, Ion = Magenta). Kräftige/eigenständige Töne heben sich zusammen
// mit der Tabellen-Legende und der abgerundeten Pill-Form von den
// gedämpften, eckigen Tableau10-Cluster-Swatches ab.
//
// `fill` ist ein dunkler Ton (Pill-Hintergrund, heller Text bleibt
// lesbar), `border` der zugehörige hellere Rahmen — analog zum früheren
// residueColor/residueBorder-Look.
// ═══════════════════════════════════════════════════════════════════

// Reihenfolge = Legenden-Reihenfolge.
export const RESIDUE_CLASSES = [
  { id: "hydrophob",  label: "hydrophob",          fill: "#6e5223", border: "#d9a441",
    members: ["ALA", "VAL", "LEU", "ILE", "MET"] },
  { id: "aromatisch", label: "aromatisch",         fill: "#4a3170", border: "#a884e0",
    members: ["PHE", "TRP", "TYR"] },
  { id: "polar",      label: "polar",              fill: "#245c3c", border: "#5fc389",
    members: ["SER", "THR", "ASN", "GLN", "CYS", "CYX"] },
  { id: "positiv",    label: "positiv (basisch)",  fill: "#2f4b7c", border: "#6f9be0",
    members: ["ARG", "LYS", "HIS", "HID", "HIE", "HIP"] },
  { id: "negativ",    label: "negativ (sauer)",    fill: "#7c2f34", border: "#e06a70",
    members: ["ASP", "GLU", "ASH", "GLH"] },
  { id: "speziell",   label: "speziell (Gly/Pro)", fill: "#3f4654", border: "#8a94a6",
    members: ["GLY", "PRO"] },
  { id: "wasser",     label: "Wasser",             fill: "#1f5560", border: "#5fc7d6",
    members: ["HOH", "WAT", "SOL", "TIP"] },
  { id: "ion",        label: "Ion/Metall",         fill: "#6a2a5c", border: "#d46fbf",
    members: ["MN", "ZN", "MG", "CA", "FE", "NA", "K", "CL", "CU", "CO", "NI", "CD"] },
];

// Fallback für unbekannte Tokens (z.B. Ligandenreste).
export const RESIDUE_CLASS_OTHER = {
  id: "sonstige", label: "sonstige", fill: "#3a3f4f", border: "#6b7280",
};

// Member-Code → Klasse.
const _byMember = {};
for (const c of RESIDUE_CLASSES) {
  for (const m of c.members) _byMember[m] = c;
}

// Führende Buchstaben eines Tokens wie "HIS84" → "HIS".
function _codeOf(name) {
  const m = String(name ?? "").match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : "";
}

/** Klassen-Objekt für ein Residuum-Token (nie null). */
export function residueClass(name) {
  return _byMember[_codeOf(name)] || RESIDUE_CLASS_OTHER;
}

/** Klassen-id ("positiv", "polar", …). */
export function residueClassOf(name) {
  return residueClass(name).id;
}

/** Pill-Hintergrund (dunkel). */
export function residueClassColor(name) {
  return residueClass(name).fill;
}

/** Pill-Rahmen (hell). */
export function residueClassBorder(name) {
  return residueClass(name).border;
}
