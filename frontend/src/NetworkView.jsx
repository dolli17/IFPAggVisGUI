// ═══════════════════════════════════════════════════════════════════
// NetworkView — Cytoscape.js based network rendering.
//
// Replaces the matplotlib/networkx PNG that came from /api/viz/network.
// Receives raw graph data from /api/data/network and lets Cytoscape do
// the actual drawing. That gives us native click/hover/drag and lets the
// node positions stay in sync with the rest of the app via React state.
//
// Layout strategy: hybrid.
//   - The backend ships a default layout (computed by networkx, like the
//     original IFPAggVis pipeline) — kept on the data as `x`/`y` fields.
//   - Cytoscape renders those positions with `preset` so the picture
//     reproduces what was in the matplotlib version.
//   - The user can drag nodes; Cytoscape stores the new positions
//     internally. A "Reset Layout" button re-applies the backend default.
//   - Alternative layouts (grid, circle, breadthfirst) can be triggered
//     from a small toolbar; they don't talk to the backend.
//
// Selection sync: clicking a residue node calls `onSelect(label)`. The
// `selected` prop highlights that node from the outside (e.g. when the
// user clicks a residue elsewhere in the app).
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback } from "react";
import cytoscape from "cytoscape";

const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  border: "#2d3348",
  accent: "#6c7bd4",
  pink: "#f472b6",
  text: "#e2e8f0",
  textDim: "#8892a8",
};

// Normalize backend layout positions into a fixed canvas-sized box.
// The backend layout can come from either networkx graphviz/neato (values
// in the hundreds) or `nx.spring_layout` (values around ±0.5). A fixed
// multiplier won't fit both — instead we min-max normalize to a known
// extent so the same picture works regardless of which backend layout ran.
function normalizePositions(nodes, extent = 260) {
  const xs = nodes.map(n => n.x).filter(v => Number.isFinite(v));
  const ys = nodes.map(n => n.y).filter(v => Number.isFinite(v));
  if (xs.length === 0 || ys.length === 0) {
    return new Map();
  }
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xRange = (xMax - xMin) || 1;
  const yRange = (yMax - yMin) || 1;
  const out = new Map();
  for (const n of nodes) {
    // Center in 0, span ±extent. Y is flipped because matplotlib /
    // networkx use bottom-up while screen pixels are top-down.
    const nx = ((n.x - xMin) / xRange - 0.5) * 2 * extent;
    const ny = -((n.y - yMin) / yRange - 0.5) * 2 * extent;
    out.set(n.id, { x: nx, y: ny });
  }
  return out;
}

// Build Cytoscape elements from the API payload. Inactive residues are
// excluded for now to mirror the original matplotlib look (only the
// active residues for the current frame are drawn, edges to LIG only).
function buildElements(data) {
  if (!data) return [];
  const styles = data.interaction_styles || {};
  const positions = normalizePositions(data.nodes || []);
  const els = [];

  for (const n of data.nodes || []) {
    if (n.type === "residue" && !n.active) continue; // skip inactive
    const interactionStyle = n.interaction ? styles[n.interaction] : null;
    const pos = positions.get(n.id) || { x: 0, y: 0 };
    els.push({
      group: "nodes",
      data: {
        id: n.id,
        label: n.label,
        rawId: n.raw_id,
        kind: n.type,
        interaction: n.interaction,
        shape: n.type === "ligand" ? "ellipse"
                                   : (interactionStyle?.shape || "ellipse"),
        color: n.type === "ligand" ? C.accent
                                   : (interactionStyle?.color || C.accent),
      },
      position: pos,
    });
  }

  for (const e of data.edges || []) {
    els.push({
      group: "edges",
      data: { id: e.id, source: e.source, target: e.target },
    });
  }

  return els;
}

const cyStylesheet = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      "background-opacity": 0.55,
      "border-color": "#e2e8f0",
      "border-width": 1.5,
      "shape": "data(shape)",
      "label": "data(label)",
      "color": "#e2e8f0",
      "font-size": 9,
      "font-family": "system-ui, -apple-system, sans-serif",
      "text-valign": "center",
      "text-halign": "center",
      "text-wrap": "wrap",
      "text-max-width": 70,
      "width": 44,
      "height": 44,
    },
  },
  {
    selector: 'node[kind = "ligand"]',
    style: {
      "background-color": C.accent,
      "background-opacity": 0.85,
      "width": 56,
      "height": 56,
      "font-size": 10,
      "font-weight": "bold",
    },
  },
  {
    selector: "node:selected, node.selected-by-host",
    style: {
      "border-color": C.pink,
      "border-width": 3,
      "background-opacity": 0.9,
    },
  },
  {
    selector: "edge",
    style: {
      "width": 2,
      "line-color": C.accent,
      "opacity": 0.6,
      "curve-style": "straight",
    },
  },
];

export default function NetworkView({
  data,                // payload from /api/data/network
  selectedLabels,      // array of residue labels highlighted from outside
  onSelect,            // (label, additive) => void; called on node click
  onBackgroundClick,   // () => void; clear selection
}) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  // Cache user-dragged positions per node id, so re-renders (e.g. frame
  // change) don't snap nodes back to the backend default if the user
  // already moved them.
  const userPositionsRef = useRef(new Map());
  const [layoutName, setLayoutName] = useState("preset");

  // Initialize the Cytoscape instance once
  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: cyStylesheet,
      wheelSensitivity: 0.2,
      minZoom: 0.2,
      maxZoom: 4,
    });

    cy.on("tap", "node", (evt) => {
      const n = evt.target;
      const kind = n.data("kind");
      if (kind === "ligand") return; // LIG center is not a residue
      // Cytoscape exposes the original DOM event for modifier-key checks
      const oe = evt.originalEvent || {};
      const additive = !!(oe.metaKey || oe.ctrlKey || oe.shiftKey);
      onSelect?.(n.data("label"), additive);
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) onBackgroundClick?.();
    });
    cy.on("dragfreeon", "node", (evt) => {
      const n = evt.target;
      userPositionsRef.current.set(n.id(), { ...n.position() });
    });

    cyRef.current = cy;

    // Cytoscape doesn't auto-detect container resizes — when the parent
    // flexbox finalises its layout, or when the user resizes the window
    // / 3D-viewer split, we have to call cy.resize() ourselves or the
    // canvas stays at its initial (often 0×0) measurement.
    const ro = new ResizeObserver(() => {
      if (cyRef.current) {
        cyRef.current.resize();
        cyRef.current.fit(undefined, 30);
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync data → cytoscape elements
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !data) return;
    const elements = buildElements(data);
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
      // Re-apply user-dragged positions where they exist
      cy.nodes().forEach((n) => {
        const cached = userPositionsRef.current.get(n.id());
        if (cached) n.position(cached);
      });
    });
    // Defer fit/layout to next frame: when this effect runs the parent
    // flexbox might still be finalising its size, and Cytoscape's
    // internal canvas measurement uses the current container rect.
    requestAnimationFrame(() => {
      if (!cyRef.current) return;
      cyRef.current.resize();
      if (layoutName !== "preset") {
        cyRef.current.layout({ name: layoutName, animate: false,
                               fit: true, padding: 30 }).run();
      } else {
        cyRef.current.fit(undefined, 30);
      }
    });
  }, [data, layoutName]);

  // External multi-selection → highlight every matching node
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("selected-by-host");
    const labels = selectedLabels || [];
    if (!labels.length) return;
    const set = new Set(labels);
    const match = cy.nodes().filter((n) => set.has(n.data("label")));
    match.addClass("selected-by-host");
  }, [selectedLabels, data]);

  const resetLayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || !data) return;
    userPositionsRef.current.clear();
    setLayoutName("preset");
    // Rebuild elements to restore backend positions
    cy.batch(() => {
      cy.elements().remove();
      cy.add(buildElements(data));
    });
    cy.fit(undefined, 30);
  }, [data]);

  const layoutBtn = (name, label) => (
    <button
      key={name}
      onClick={() => setLayoutName(name)}
      style={{
        padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
        background: layoutName === name ? "rgba(108,123,212,0.15)" : "transparent",
        color: layoutName === name ? C.accent : C.textDim,
        border: `1px solid ${layoutName === name ? C.accent : C.border}`,
        fontWeight: 600, fontFamily: "inherit",
      }}>{label}</button>
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative",
                  display: "flex", flexDirection: "column",
                  background: C.surface, borderRadius: 8,
                  border: `1px solid ${C.border}` }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 4, alignItems: "center",
                    padding: "6px 8px", borderBottom: `1px solid ${C.border}`,
                    flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: C.textDim, marginRight: 4 }}>Layout:</span>
        {layoutBtn("preset", "Default")}
        {layoutBtn("cose", "Force")}
        {layoutBtn("circle", "Circle")}
        {layoutBtn("concentric", "Concentric")}
        {layoutBtn("grid", "Grid")}
        <span style={{ marginLeft: "auto", fontSize: 9, color: C.textDim }}>
          ⌘/Ctrl+Klick = mehrere
        </span>
        <button onClick={resetLayout}
          style={{
            padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
            background: "transparent", color: C.textDim,
            border: `1px solid ${C.border}`, fontWeight: 600,
            fontFamily: "inherit",
          }}>Reset</button>
      </div>
      {/* Cytoscape canvas */}
      <div ref={containerRef}
        style={{ flex: 1, minHeight: 0, background: C.bg }} />
      {/* Footer info */}
      {data && (
        <div style={{ padding: "4px 10px", borderTop: `1px solid ${C.border}`,
                      fontSize: 10, color: C.textDim,
                      display: "flex", justifyContent: "space-between" }}>
          <span>IFP #{data.ifp_id} · {data.occurrence}× </span>
          <span>{(data.active_residues || []).length} aktive Residuen</span>
        </div>
      )}
    </div>
  );
}
