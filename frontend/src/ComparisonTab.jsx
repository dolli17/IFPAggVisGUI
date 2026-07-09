// ═══════════════════════════════════════════════════════════════════
// ComparisonTab — Container für die Vergleichs-Encodings.
//
// Umschalter zwischen sechs Encodings derselben Vergleichsdaten
// (alle mit Linked Selection):
//   • Six-Lane    — Paper-Layout (interaktiv), IFP-Ebene
//   • Kreuzmatrix — Cluster×Cluster-Distanz-Heatmap
//   • Bipartit    — Modus-Graph L1 ↔ L2
//   • Embedding   — geteiltes 2D-UMAP beider Liganden
//   • Residuen    — Belegungs-Scatter pro Interaktion
//   • Chord       — Residuen-Ko-Vorkommens-Netzwerk (Flareplot)
//
// Nicht-Six-Lane-Encodings werden lazy nachgeladen (`onLoadEncoding`)
// und von App unter eigenen Cache-Keys gehalten.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { C } from "./comparison/theme";
import SixLaneView from "./ComparisonView";
import ClusterMatrixView from "./comparison/ClusterMatrixView";
import BipartiteView from "./comparison/BipartiteView";
import EmbeddingView from "./comparison/EmbeddingView";
import ResiduesView from "./comparison/ResiduesView";
import ChordView from "./comparison/ChordView";

const VIEWS = [
  { id: "sixlane", label: "Six-Lane" },
  { id: "clusters", label: "Kreuzmatrix" },
  { id: "bipartite", label: "Bipartit" },
  { id: "embedding", label: "Embedding" },
  { id: "residues", label: "Residuen" },
  { id: "chords", label: "Chord" },
];

// Welches Backend-Payload braucht ein Encoding?
const KIND_OF = {
  clusters: "clusters", bipartite: "clusters",
  embedding: "embedding",
  residues: "residues",
  chords: "chords",
};

export default function ComparisonTab({
  data, encodings, onLoadEncoding,
  selectedClusters, activeLigand, onSelectCluster, onHoverResidue,
  cmpClusterTopK, onCmpClusterTopKChange, chordMax, onChordMaxChange,
}) {
  const [encoding, setEncoding] = useState("sixlane");
  const requested = useRef(new Set());

  useEffect(() => {
    if (encoding === "sixlane") return;
    const kind = KIND_OF[encoding];
    if (kind && !encodings?.[kind] && !requested.current.has(kind)) {
      requested.current.add(kind);
      onLoadEncoding(kind);
    }
  }, [encoding, encodings, onLoadEncoding]);

  const kind = KIND_OF[encoding];
  const payload = encoding === "sixlane" ? data : encodings?.[kind];
  const sub = { selectedClusters, activeLigand, onSelectCluster };

  let body;
  if (encoding === "sixlane") {
    body = <SixLaneView data={data} selectedClusters={selectedClusters}
      activeLigand={activeLigand} onSelectIfp={onSelectCluster} />;
  } else if (!payload) {
    body = (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", color: C.textDim, fontSize: 13 }}>
        {encoding === "embedding"
          ? "UMAP-Embedding wird berechnet… (kann einige Sekunden dauern)"
          : "Lade…"}
      </div>
    );
  } else if (encoding === "clusters") body = <ClusterMatrixView data={payload} {...sub}
    topK={cmpClusterTopK} onTopKChange={onCmpClusterTopKChange} />;
  else if (encoding === "bipartite") body = <BipartiteView data={payload} {...sub}
    topK={cmpClusterTopK} onTopKChange={onCmpClusterTopKChange} />;
  else if (encoding === "embedding") body = <EmbeddingView data={payload} {...sub} />;
  else if (encoding === "residues") body = <ResiduesView data={payload} onHoverResidue={onHoverResidue} />;
  else if (encoding === "chords") body = <ChordView data={payload} onHoverResidue={onHoverResidue}
    maxChords={chordMax} onMaxChordsChange={onChordMaxChange} />;

  const Btn = ({ e }) => {
    const on = encoding === e.id;
    return (
      <div onClick={() => setEncoding(e.id)}
        style={{
          padding: "3px 11px", cursor: "pointer", fontWeight: 600, fontSize: 11,
          borderRadius: 4, marginRight: 4, marginBottom: 4,
          background: on ? C.accent : "transparent",
          color: on ? "#fff" : C.textDim,
          border: `1px solid ${on ? C.accent : C.border}`,
        }}>
        {e.label}
      </div>
    );
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center",
        padding: "6px 12px 2px", borderBottom: `1px solid ${C.border}`,
        background: C.surface }}>
        <span style={{ color: C.textMuted, fontSize: 11, marginRight: 8, marginBottom: 4 }}>
          Darstellung:
        </span>
        {VIEWS.map((e) => <Btn key={e.id} e={e} />)}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>{body}</div>
    </div>
  );
}
