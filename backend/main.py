"""
IFPAggVis GUI — FastAPI Backend
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from pipeline import (
    IFPSession, load_csv, run_aggregation, render_network, render_circle_chart,
    render_distance_matrix, render_occurrence, run_comparison,
    render_comparison, load_pdb, get_session_info, update_parameters,
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
async def api_upload_pdb(file: UploadFile = File(...)):
    try:
        content = await file.read()
        result = load_pdb(session, content, file.filename)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/pdb")
def api_get_pdb():
    if session.pdb_content is None:
        raise HTTPException(status_code=404, detail="No PDB file loaded")
    return JSONResponse(content={"pdb": session.pdb_content, "filename": session.pdb_path})


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
