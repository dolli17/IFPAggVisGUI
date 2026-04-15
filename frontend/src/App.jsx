import { useState, useEffect, useRef, useCallback } from "react";
import * as api from "./api";

// ─── Colors ──────────────────────────────────────────────────────
const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  surfaceLight: "#222738",
  border: "#2d3348",
  accent: "#6c7bd4",
  accentDim: "rgba(108,123,212,0.15)",
  pink: "#f472b6",
  pinkDim: "rgba(244,114,182,0.15)",
  green: "#4ade80",
  greenDim: "rgba(74,222,128,0.15)",
  text: "#e2e8f0",
  textDim: "#8892a8",
  textMuted: "#4a5568",
  red: "#f87171",
};

// ─── Reusable small components ───────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: "inline-block", width: 16, height: 16, border: `2px solid ${C.border}`, borderTopColor: C.accent, borderRadius: "50%", animation: "spin .6s linear infinite" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Btn({ children, onClick, disabled, accent, small, style: s }) {
  const bg = accent ? C.accent : "transparent";
  const clr = accent ? "#fff" : C.textDim;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: small ? "4px 10px" : "6px 14px", borderRadius: 6,
      border: `1px solid ${accent ? C.accent : C.border}`,
      background: disabled ? C.surfaceLight : bg, color: disabled ? C.textMuted : clr,
      fontSize: small ? 11 : 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.5 : 1, fontFamily: "inherit", ...s,
    }}>{children}</button>
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

function Check({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 11, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: C.accent }} />
      <span style={{ color: checked ? C.text : C.textDim }}>{label}</span>
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 3D VIEWER COMPONENT
// ═══════════════════════════════════════════════════════════════════
function Viewer3D({ pdbData, highlightResidue }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !window.$3Dmol) return;
    if (viewerRef.current) {
      viewerRef.current.clear();
    } else {
      viewerRef.current = window.$3Dmol.createViewer(containerRef.current, {
        backgroundColor: C.bg,
      });
    }
    if (pdbData) {
      viewerRef.current.addModel(pdbData, "pdb");
      viewerRef.current.setStyle({}, { cartoon: { color: "#6c7bd4" } });
      viewerRef.current.setStyle({ hetflag: true }, { stick: { colorscheme: "greenCarbon" } });
      viewerRef.current.zoomTo();
      viewerRef.current.render();
    }
  }, [pdbData]);

  useEffect(() => {
    if (!viewerRef.current || !pdbData || !highlightResidue) return;
    // Reset styles
    viewerRef.current.setStyle({}, { cartoon: { color: "#6c7bd4" } });
    viewerRef.current.setStyle({ hetflag: true }, { stick: { colorscheme: "greenCarbon" } });
    // Highlight residue
    const resName = highlightResidue.replace(/\..+$/, ""); // strip chain
    const match = resName.match(/^([A-Z]+)(\d+)$/);
    if (match) {
      const resi = parseInt(match[2]);
      viewerRef.current.addStyle({ resi }, {
        stick: { color: "#f472b6" },
      });
    }
    viewerRef.current.render();
  }, [highlightResidue, pdbData]);

  return (
    <div ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }} />
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

  // ── UI state ──
  const [tab, setTab] = useState("network");
  const [viewMode, setViewMode] = useState("ligand"); // "ligand" or "comparison"
  const [activeLigand, setActiveLigand] = useState(1);
  const [sections, setSections] = useState({ data: true, pipeline: true, filter: true });
  const [networkFrame, setNetworkFrame] = useState(0);
  const [circleResidue, setCircleResidue] = useState(null);
  const [x1Filter, setX1Filter] = useState(1.0);
  const [x2Filter, setX2Filter] = useState(0.2);
  const [viewerWidth, setViewerWidth] = useState(280);
  const isDragging = useRef(false);

  // ── Visualization data ──
  const [vizData, setVizData] = useState({});
  const [pdbData, setPdbData] = useState(null);
  const [highlightResidue, setHighlightResidue] = useState(null);

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
  const handleCSVUpload = async (e, isSecond = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = prompt("Ligandenname eingeben:", isSecond ? "Ligand_2" : "Ligand_1");
    if (!name) return;
    await withLoading("upload", () => api.uploadCSV(file, name, isSecond));
    refreshSession();
    e.target.value = "";
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
    const cacheKey = vizTab === "comparison" ? "comparison" : `${vizTab}_${lig}`;
    const loadingKey = `viz_${vizTab}`;
    return await withLoading(loadingKey, async () => {
      let data;
      switch (vizTab) {
        case "network":
          data = await api.getVizNetwork(opts.frame || 0, lig);
          break;
        case "circle":
          data = await api.getVizCircle(opts.residue || null, lig);
          break;
        case "heatmap":
          data = await api.getVizHeatmap(lig);
          break;
        case "occurrence":
          data = await api.getVizOccurrence(lig);
          break;
        case "comparison":
          data = await api.getVizComparison();
          break;
      }
      if (data) {
        setVizData(p => ({ ...p, [cacheKey]: data }));
      }
      return data;
    });
  }, []);

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
    const cacheKey = `${tab}_${activeLigand}`;
    if (!vizData[cacheKey]) {
      loadViz(tab, { frame: networkFrame, residue: circleResidue, ligand: activeLigand });
    }
  }, [tab, session, activeLigand, viewMode]);

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
    { id: "network", label: "Netzwerk" },
    { id: "circle", label: "Kreisdiagramm" },
    { id: "heatmap", label: "Distanzmatrix" },
    { id: "occurrence", label: "Vorkommen" },
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

              {/* Dev: test data */}
              <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
              <Btn small onClick={handleGenerateTestData} disabled={loading.testdata}
                style={{ width: "100%", fontSize: 10, borderStyle: "dashed" }}>
                {loading.testdata ? <><Spinner /> ...</> : "DEV: Testdaten generieren"}
              </Btn>
            </div>
          )}

          {/* ── Filter & Parameters Section ── */}
          <SectionHeader label="Filter & Parameter" open={sections.filter} onToggle={() => toggleSection("filter")} />
          {sections.filter && (
            <div style={{ padding: "10px 12px" }}>
              {/* Interaction type filters */}
              {session?.interaction_types?.length > 0 && (
                <>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Interaktionstypen</div>
                  {session.interaction_types.map(t => (
                    <Check key={t} label={t} checked={true} onChange={() => {}} />
                  ))}
                  <div style={{ height: 1, background: C.border, margin: "10px 0" }} />
                </>
              )}

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

          {/* Viz controls bar (tab-specific, only in ligand mode) */}
          {viewMode === "ligand" && hasAgg && tab === "network" && vizData[currentCacheKey] && (
            <div style={{ borderBottom: `1px solid ${C.border}`, background: C.surface }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px" }}>
                <span style={{ fontSize: 11, color: C.textDim, flexShrink: 0 }}>Frame:</span>
                <input type="range" min={0} max={(vizData[currentCacheKey].total_frames || 1) - 1}
                  value={networkFrame}
                  onChange={e => setNetworkFrame(Number(e.target.value))}
                  style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: C.accent, fontWeight: 600, minWidth: 40, flexShrink: 0 }}>{networkFrame}</span>
                <Btn small onClick={async () => {
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
              {vizData[currentCacheKey].mapped_frame && (
                <div style={{ padding: "2px 16px 4px", fontSize: 10, color: C.textMuted, display: "flex", gap: 12 }}>
                  <span>CSV-Frames: {vizData[currentCacheKey].mapped_frame.csv_start}–{vizData[currentCacheKey].mapped_frame.csv_end}</span>
                  <span>Mitte: {vizData[currentCacheKey].mapped_frame.csv_mid}</span>
                  <span>({vizData[currentCacheKey].mapped_frame.occurence}x)</span>
                </div>
              )}
              {vizData[currentCacheKey].active_residues && (
                <div style={{ padding: "0 16px 8px", fontSize: 10, color: C.textDim, lineHeight: 1.8, flexWrap: "wrap", display: "flex", gap: 2, alignItems: "center" }}>
                  <span>Aktiv:</span>
                  {[...new Set(vizData[currentCacheKey].active_residues)].map((r, i) => (
                    <span key={i} onClick={() => setHighlightResidue(r)}
                      style={{ color: highlightResidue === r ? C.pink : C.accent, cursor: "pointer", marginLeft: 4, fontWeight: 600 }}>{r}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {viewMode === "ligand" && hasAgg && tab === "circle" && vizData[currentCacheKey] && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: `1px solid ${C.border}`, background: C.surface, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: C.textDim }}>Residuum:</span>
              <div onClick={() => { setCircleResidue(null); loadViz("circle", { ligand: activeLigand }); }}
                style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", background: !circleResidue ? C.accentDim : "transparent", color: !circleResidue ? C.accent : C.textDim, border: `1px solid ${!circleResidue ? C.accent : C.border}` }}>Alle</div>
              {vizData[currentCacheKey].residues?.map(r => (
                <div key={r}
                  onClick={() => { setCircleResidue(r); setHighlightResidue(r); loadViz("circle", { residue: r, ligand: activeLigand }); }}
                  style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", background: circleResidue === r ? C.pinkDim : "transparent", color: circleResidue === r ? C.pink : C.textDim, border: `1px solid ${circleResidue === r ? C.pink : C.border}` }}>{r}</div>
              ))}
            </div>
          )}

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
              vizData.comparison?.image ? (
                <img src={`data:image/png;base64,${vizData.comparison.image}`}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }}
                  alt="comparison" />
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, color: C.textDim }}>
                    {!hasComparison ? "Vergleich zuerst ausfuehren (Pipeline-Bereich)" : "Visualisierung laden..."}
                  </div>
                </div>
              )
            ) : tab === "circle" && vizData[currentCacheKey] ? (
              // Circle: show grid of residue charts
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", alignItems: "flex-start", maxHeight: "100%", overflow: "auto" }}>
                {Object.entries(vizData[currentCacheKey].images || {}).map(([key, img]) => (
                  <div key={key}
                    onClick={() => { if (key !== "_legend") { setHighlightResidue(key); } }}
                    style={{ cursor: key !== "_legend" ? "pointer" : "default", border: `2px solid ${highlightResidue === key ? C.pink : "transparent"}`, borderRadius: 8, overflow: "hidden" }}>
                    <img src={`data:image/png;base64,${img}`}
                      style={{ maxWidth: circleResidue ? 400 : 200, height: "auto", display: "block" }}
                      alt={key} />
                  </div>
                ))}
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
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>3D Viewer</span>
            {highlightResidue && (
              <span style={{ fontSize: 10, color: C.pink, fontWeight: 600 }}>{highlightResidue}</span>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {pdbData ? (
              <Viewer3D pdbData={pdbData} highlightResidue={highlightResidue} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 20, textAlign: "center" }}>
                <div>
                  <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>Keine PDB-Datei geladen</div>
                  <div style={{ fontSize: 10, color: C.textMuted }}>PDB laden im Daten-Bereich</div>
                </div>
              </div>
            )}
          </div>
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
