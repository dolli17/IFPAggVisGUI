"""
IFPAggVis GUI — FastAPI Backend
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import os
import tempfile

from pipeline import (
    IFPSession, load_csv, run_aggregation, render_network, render_circle_chart,
    render_distance_matrix, render_occurrence, run_comparison,
    render_comparison, load_pdb, load_trajectory, get_frame_pdb,
    get_session_info, update_parameters,
    data_network, data_occurrence, data_distance_matrix, data_circle,
    data_clusters, data_umap, data_comparison,
    data_comparison_clusters, data_comparison_embedding,
    data_comparison_residues,
    data_comparison_chords,
)

app = FastAPI(title="IFPAggVis GUI Backend", version="0.1.0")

# CORS for React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174",
                   "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Single-user session (prototype)
session = IFPSession()


# ═══════════════════════════════════════════════════════════════════
# DATA ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/session")
def api_session():
    return get_session_info(session)


@app.post("/api/upload")
async def api_upload(
    file: UploadFile = File(...),
    ligand_name: str = Form("Ligand_1"),
    is_second: bool = Form(False),
):
    try:
        content = await file.read()
        result = load_csv(session, content, file.filename, ligand_name, is_second)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/upload-pdb")
async def api_upload_pdb(file: UploadFile = File(...), ligand: int = 1):
    try:
        content = await file.read()
        result = load_pdb(session, content, file.filename, ligand=ligand)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/pdb")
def api_get_pdb(ligand: int = 1):
    pdb = session.pdb_content_2 if ligand == 2 else session.pdb_content
    path = session.pdb_path_2 if ligand == 2 else session.pdb_path
    if pdb is None:
        raise HTTPException(status_code=404, detail=f"No PDB file loaded for ligand {ligand}")
    return JSONResponse(content={"pdb": pdb, "filename": path, "ligand": ligand})


@app.post("/api/upload-trajectory")
async def api_upload_trajectory(
    gro_file: UploadFile = File(...),
    xtc_files: list[UploadFile] = File(...),
    ligand: int = 1,
):
    """Upload GRO topology + one or more XTC trajectories for frame-synced 3D viewing.

    Multiple XTC files are concatenated in upload order by MDAnalysis.
    """
    try:
        # Save uploaded files to temp dir (MDAnalysis needs file paths)
        tmp_dir = tempfile.mkdtemp(prefix="ifpaggvis_traj_")
        gro_path = os.path.join(tmp_dir, gro_file.filename)

        with open(gro_path, "wb") as f:
            f.write(await gro_file.read())

        xtc_paths = []
        for xtc_file in xtc_files:
            xtc_path = os.path.join(tmp_dir, xtc_file.filename)
            with open(xtc_path, "wb") as f:
                f.write(await xtc_file.read())
            xtc_paths.append(xtc_path)

        # Sort by filename to ensure consistent replicate order
        xtc_paths.sort()

        result = load_trajectory(session, gro_path, xtc_paths, ligand=ligand)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/trajectory-frame")
def api_trajectory_frame(frame: int = 0, ligand: int = 1):
    """Return a single trajectory frame as PDB string."""
    try:
        pdb_str = get_frame_pdb(session, frame, ligand=ligand)
        return JSONResponse(content={"pdb": pdb_str, "frame": frame, "ligand": ligand})
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ═══════════════════════════════════════════════════════════════════
# PIPELINE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/aggregate")
def api_aggregate(is_second: bool = False, x1: float = None, x2: float = None):
    try:
        result = run_aggregation(session, is_second, x1=x1, x2=x2)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/compare")
def api_compare():
    try:
        result = run_comparison(session)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ═══════════════════════════════════════════════════════════════════
# VISUALIZATION ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/viz/network")
def api_viz_network(frame: int = 0, ligand: int = 1):
    try:
        return render_network(session, frame, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/network")
def api_data_network(frame: int = 0, ligand: int = 1):
    """JSON network data for client-side rendering (Cytoscape)."""
    try:
        return data_network(session, frame, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/occurrence")
def api_data_occurrence(ligand: int = 1):
    """JSON occurrence data for client-side rendering (D3/SVG)."""
    try:
        return data_occurrence(session, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/heatmap")
def api_data_heatmap(ligand: int = 1):
    """JSON distance-matrix data for client-side rendering (Canvas + SVG)."""
    try:
        return data_distance_matrix(session, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/circle")
def api_data_circle(ligand: int = 1):
    """JSON circle-chart data (run-length per residue) for client-side rendering."""
    try:
        return data_circle(session, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/clusters")
def api_data_clusters(ligand: int = 1):
    """JSON structural-cluster data (per-IFP cluster id + per-cluster summary)."""
    try:
        return data_clusters(session, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/umap")
def api_data_umap(ligand: int = 1):
    """JSON UMAP-Einbettung der Cluster + Pfad-Folge."""
    try:
        return data_umap(session, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/viz/circle")
def api_viz_circle(residue: str = None, ligand: int = 1):
    try:
        return render_circle_chart(session, residue, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/viz/heatmap")
def api_viz_heatmap(ligand: int = 1):
    try:
        return render_distance_matrix(session, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/viz/occurrence")
def api_viz_occurrence(ligand: int = 1):
    try:
        return render_occurrence(session, ligand=ligand)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/viz/comparison")
def api_viz_comparison():
    try:
        return render_comparison(session)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/comparison")
def api_data_comparison():
    """JSON Six-Lane-Vergleich (interaktiv): Knoten + Verbindungen."""
    try:
        return data_comparison(session)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/comparison/clusters")
def api_data_comparison_clusters(top_k: int = 30):
    """Cluster×Cluster-Kreuzdistanz (Heatmap + bipartiter Graph)."""
    try:
        return data_comparison_clusters(session, top_k=top_k)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/comparison/embedding")
def api_data_comparison_embedding():
    """Geteiltes 2D-UMAP-Embedding der Modi beider Liganden."""
    try:
        return data_comparison_embedding(session)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/comparison/residues")
def api_data_comparison_residues():
    """Belegung pro Interaktion/Residuum in L1 vs. L2."""
    try:
        return data_comparison_residues(session)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/comparison/chords")
def api_data_comparison_chords(max_chords: int = 600):
    """Residuen-Ko-Vorkommens-Netzwerk (Chord-Diagramm)."""
    try:
        return data_comparison_chords(session, max_chords=max_chords)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ═══════════════════════════════════════════════════════════════════
# PARAMETER ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/parameters")
def api_parameters(params: dict):
    try:
        return update_parameters(session, params)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ═══════════════════════════════════════════════════════════════════
# DEV: Test data generator
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/dev/generate-test-data")
def api_generate_test_data():
    """Generate synthetic IFP data for development/testing."""
    import numpy as np
    import pandas as pd
    import io

    np.random.seed(42)
    n_frames = 500
    residues = ["TYR40.A", "ASP52.A", "LEU78.A", "LYS33.A", "ARG95.A",
                "GLU114.A", "HIS84.A", "PHE80.A"]
    interaction_types = ["HBDonor", "HBAcceptor", "Hydrophobic", "PiStacking",
                        "Cationic", "VdWContact"]

    columns = []
    for res in residues:
        n_types = np.random.randint(1, 4)
        chosen = np.random.choice(interaction_types, n_types, replace=False)
        for t in chosen:
            columns.append(f"{res}_{t}")

    # Generate correlated binary data (simulate temporal patterns)
    data = np.zeros((n_frames, len(columns)), dtype=int)
    for j in range(len(columns)):
        prob = np.random.uniform(0.2, 0.8)
        state = np.random.choice([0, 1], p=[1 - prob, prob])
        for i in range(n_frames):
            if np.random.random() < 0.05:  # 5% chance of state change
                state = 1 - state
            data[i, j] = state

    df = pd.DataFrame(data, columns=columns)
    csv_buf = io.BytesIO()
    df.to_csv(csv_buf, index=False)
    csv_bytes = csv_buf.getvalue()

    result = load_csv(session, csv_bytes, "test_data_synthetic.csv", "TestLigand")
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
