"""
IFPAggVis Pipeline Orchestrator
Manages all session state and wraps IFPAggVis module calls for the GUI backend.
"""

import io
import os
import base64
import tempfile
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.markers as pltmarkers
import networkx as nx
import dynetx as dn
from tqdm import tqdm

from ifpaggvis import helpers, aggregate, calculate, visualise


class IFPSession:
    """Holds all state for one analysis session."""

    def __init__(self):
        # ── Primary simulation ──
        self.raw_df = None          # as loaded from CSV (MultiIndex columns)
        self.flat_df = None         # after get_res_names_in_col_index
        self.aggregated_df = None   # L1-reduced (representative IFPs + occurence)
        self.interactions = None    # list of column names (RESNAME_TYPE)
        self.run_lengths = None     # dict from calculate_lengths_interaction
        self.colours = None         # dict from colour_based_on_interaction
        self.distances = None       # N×N numpy distance matrix
        self.identical_within = None  # from calculate_where_diff_zero
        self.node_positions = None  # dict from get_unique_residue_position
        self.dyngraph = None        # dynetx.DynGraph
        self.label_dict = None      # node → residue name
        self.int_type_dict = None   # node → interaction type
        self.active_nodes = None    # dict per IFP → active nodes
        self.edge_lists = None      # list of edge tuples per IFP
        self.ligand_name_1 = "Ligand_1"
        self.frame_count = 0
        self.ifp_count = 0
        self.frame_map = None          # list of dicts: csv_start, csv_end, csv_mid per aggregated IFP
        self.x1_offset = 0             # frames dropped at start by x1 rolling window
        # Structural (interaction-based) aggregation — see notebook 02.
        # `structure_clusters[i]` = cluster id of the i-th time-aggregated IFP.
        # `structure_cluster_summary` = one entry per distinct IFP pattern,
        # sorted by frame_count desc.
        self.structure_clusters = None
        self.structure_cluster_summary = None

        # ── Second simulation ──
        self.flat_df_2 = None
        self.aggregated_df_2 = None
        self.interactions_2 = None
        self.run_lengths_2 = None
        self.colours_2 = None
        self.distances_2 = None
        self.identical_within_2 = None
        self.node_positions_2 = None
        self.dyngraph_2 = None
        self.label_dict_2 = None
        self.int_type_dict_2 = None
        self.active_nodes_2 = None
        self.edge_lists_2 = None
        self.ligand_name_2 = "Ligand_2"
        self.frame_count_2 = 0
        self.ifp_count_2 = 0
        self.frame_map_2 = None
        self.x1_offset_2 = 0
        self.structure_clusters_2 = None
        self.structure_cluster_summary_2 = None

        # ── Comparison state ──
        self.merged_df = None
        self.cross_distances = None
        self.identical_ifps = None
        self.similar_ifps = None
        self.dissimilar_ifps = None

        # ── Aggregation parameters (x1/x2 filters) ──
        self.x1_filter = 1.0     # sliding window size as % of trajectory length
        self.x2_filter = 0.2     # occurrence threshold (0.0–1.0)

        # ── Parameters ──
        self.memory = 1024
        self.identical_threshold = [0]
        self.similarity_threshold = [1, 6]
        self.dissimilarity_threshold = [6]
        self.dpi = 150
        self.fontsize = 12
        self.node_size = 460
        self.font_size_nodes = 6
        self.scale_axis = 20
        self.cmap_name = "viridis"

        # ── 3D viewer / Trajectory — Ligand 1 ──
        self.pdb_content = None
        self.pdb_path = None
        self.trajectory_universe = None   # MDAnalysis Universe
        self.trajectory_n_frames = 0
        self.trajectory_gro_path = None
        self.trajectory_xtc_paths = []    # list of XTC file paths

        # ── 3D viewer / Trajectory — Ligand 2 ──
        self.pdb_content_2 = None
        self.pdb_path_2 = None
        self.trajectory_universe_2 = None
        self.trajectory_n_frames_2 = 0
        self.trajectory_gro_path_2 = None
        self.trajectory_xtc_paths_2 = []


# ═══════════════════════════════════════════════════════════════════
# PIPELINE FUNCTIONS
# ═══════════════════════════════════════════════════════════════════

def load_csv(session: IFPSession, file_bytes: bytes, filename: str,
             ligand_name: str, is_second: bool = False) -> dict:
    """Load a CSV file, flatten MultiIndex columns, store in session."""
    buf = io.BytesIO(file_bytes)
    flat_df = None

    # Peek at first line to detect format
    first_lines = buf.read(2000).decode("utf-8", errors="replace").split("\n")
    buf.seek(0)

    first_cell = first_lines[0].split(",")[0].strip().lower() if first_lines else ""

    if first_cell in ("ligand", ""):
        # ProLIF 3-level MultiIndex: ligand/protein/interaction header rows
        # Check if 3rd row starts with "interaction" → 3 header rows + possible "Frame" row
        third_line = first_lines[2].split(",")[0].strip().lower() if len(first_lines) > 2 else ""
        if third_line == "interaction":
            # 3-level MultiIndex (ligand, protein, interaction)
            df = pd.read_csv(buf, header=[0, 1, 2])

            # Drop the unnamed index column (contains "Frame", "0", "1"...)
            first_col = df.columns[0]
            if "unnamed" in str(first_col[0]).lower() or (
                str(first_col[0]).strip().lower() == "ligand"
                and str(first_col[1]).strip().lower() == "protein"
            ):
                df = df.iloc[:, 1:]

            # Drop the "Frame" row (first data row after headers)
            if len(df) > 0:
                first_val = str(df.iloc[0, 0]).strip().lower()
                if first_val in ("frame", "nan", ""):
                    df = df.iloc[1:]

            # Flatten: use protein + interaction levels (drop ligand level)
            new_columns = []
            for col in df.columns:
                protein = str(col[1]).strip()
                interaction = str(col[2]).strip()
                new_columns.append(f"{protein}_{interaction}")
            df.columns = new_columns
            flat_df = df.reset_index(drop=True)
        else:
            # Try 2-level MultiIndex
            try:
                df = pd.read_csv(buf, header=[0, 1])
                if isinstance(df.columns, pd.MultiIndex):
                    flat_df = helpers.get_res_names_in_col_index(df)
                else:
                    buf.seek(0)
                    flat_df = pd.read_csv(buf)
            except Exception:
                buf.seek(0)
                flat_df = pd.read_csv(buf)
    else:
        # Flat format: single header row with RESNAME_TYPE columns
        flat_df = pd.read_csv(buf)

    # Drop any non-interaction columns (index cols, unnamed cols)
    interaction_cols = [c for c in flat_df.columns
                        if "_" in c and not c.startswith("Unnamed")]
    if interaction_cols:
        flat_df = flat_df[interaction_cols]

    # Convert to binary int: handle bool (True/False), numeric, and string values
    for col in flat_df.columns:
        if flat_df[col].dtype == object:
            # String "True"/"False" → bool → int
            flat_df[col] = flat_df[col].map(
                lambda x: 1 if str(x).strip().lower() == "true" else 0)
        elif flat_df[col].dtype == bool:
            flat_df[col] = flat_df[col].astype(int)
        else:
            flat_df[col] = pd.to_numeric(flat_df[col], errors="coerce").fillna(0)
            flat_df[col] = (flat_df[col] != 0).astype(int)

    if is_second:
        session.flat_df_2 = flat_df
        session.ligand_name_2 = ligand_name
        session.frame_count_2 = len(flat_df)
        session.interactions_2 = flat_df.columns.tolist()
        return {
            "filename": filename,
            "ligand_name": ligand_name,
            "frame_count": len(flat_df),
            "interaction_count": len(flat_df.columns),
            "interactions": flat_df.columns.tolist(),
        }

    session.raw_df = None
    session.flat_df = flat_df
    session.ligand_name_1 = ligand_name
    session.frame_count = len(flat_df)
    session.interactions = flat_df.columns.tolist()

    # Reset downstream state
    session.aggregated_df = None
    session.distances = None
    session.node_positions = None
    session.dyngraph = None
    session.run_lengths = None
    session.merged_df = None

    return {
        "filename": filename,
        "ligand_name": ligand_name,
        "frame_count": len(flat_df),
        "interaction_count": len(flat_df.columns),
        "interactions": flat_df.columns.tolist(),
    }


def run_aggregation(session: IFPSession, is_second: bool = False,
                    x1: float = None, x2: float = None) -> dict:
    """Run the full aggregation pipeline: x1 sliding window → x2 occurrence filter → time-based aggregation."""
    df = session.flat_df_2 if is_second else session.flat_df
    if df is None:
        raise ValueError("No data loaded. Upload a CSV first.")

    # Use provided values or session defaults
    x1_val = x1 if x1 is not None else session.x1_filter
    x2_val = x2 if x2 is not None else session.x2_filter

    # Store chosen values back to session
    session.x1_filter = x1_val
    session.x2_filter = x2_val

    df_processed = df.copy()

    # Step 1: Sliding window (x1 filter) — centered rolling mean
    x1_offset = 0
    if x1_val > 0:
        window_size = max(1, int((len(df_processed) / 100) * x1_val))
        df_processed = df_processed.rolling(window=window_size, center=True).mean()
        # Number of NaN rows dropped at the start (centered window)
        x1_offset = (window_size - 1) // 2
        # Drop NaN rows from centered window edges
        df_processed = df_processed.dropna().reset_index(drop=True)

    # Step 2: Occurrence filter (x2) — binarize: mean > x2 → 1, else → 0
    df_processed = df_processed.apply(
        lambda col: [0 if v <= x2_val else 1 for v in col])

    # Remove columns that are entirely zero after filtering
    nonzero_cols = df_processed.columns[df_processed.any()]
    df_processed = df_processed[nonzero_cols]

    # Step 3: Time-based aggregation — consecutive identical IFPs
    # Snapshot int_cols *before* diff_to_prev is appended; we reuse the
    # post-x2 binary df for the structural cluster groupby below.
    cluster_int_cols = list(df_processed.columns)
    df_x2_binary = df_processed.copy()

    new_list, list_values = aggregate.calculate_differences_rows(df_processed)
    df_processed["diff_to_prev"] = list_values
    agg_df = aggregate.summarise_df(df_processed, "diff_to_prev")

    # Step 3b: Structural aggregation (notebook 02) for cluster discovery.
    # Cheap O(N·D) groupby; result is independent of time-aggregation, so we
    # store it alongside the time-aggregated state.
    cluster_per_ifp, cluster_summary = _compute_structure_clusters(
        agg_df, df_x2_binary, cluster_int_cols)

    # Step 4: Build frame map — maps each aggregated IFP back to CSV frame range
    # agg_df.index contains the post-x1 frame indices from summarise_df
    agg_indices = agg_df.index.tolist()
    occ_values = agg_df["occurence"].values
    frame_map = []
    for i, (post_x1_idx, occ) in enumerate(zip(agg_indices, occ_values)):
        csv_start = int(post_x1_idx + x1_offset)
        csv_end = int(post_x1_idx + x1_offset + occ - 1)
        csv_mid = int(csv_start + occ // 2)
        frame_map.append({
            "csv_start": csv_start,
            "csv_end": csv_end,
            "csv_mid": csv_mid,
            "occurence": int(occ),
        })

    if is_second:
        session.aggregated_df_2 = agg_df
        session.ifp_count_2 = len(agg_df)
        session.frame_map_2 = frame_map
        session.x1_offset_2 = x1_offset
        session.structure_clusters_2 = cluster_per_ifp
        session.structure_cluster_summary_2 = cluster_summary
        # Reset downstream for second sim
        session.distances_2 = None
        session.node_positions_2 = None
        session.dyngraph_2 = None
        session.run_lengths_2 = None
        session.label_dict_2 = None
        session.int_type_dict_2 = None
        session.active_nodes_2 = None
        session.edge_lists_2 = None
        session.identical_within_2 = None
    else:
        session.aggregated_df = agg_df
        session.ifp_count = len(agg_df)
        session.frame_map = frame_map
        session.x1_offset = x1_offset
        session.structure_clusters = cluster_per_ifp
        session.structure_cluster_summary = cluster_summary
        # Reset downstream
        session.distances = None
        session.node_positions = None
        session.dyngraph = None
        session.run_lengths = None

    return {
        "original_frames": len(df),
        "frames_after_x1": len(df_processed) - 1,  # before aggregation (minus diff_to_prev col artifact)
        "unique_ifps": len(agg_df),
        "reduction_ratio": round(1 - len(agg_df) / len(df), 4),
        "x1_filter": x1_val,
        "x2_filter": x2_val,
        "x1_offset": x1_offset,
        "interactions_remaining": len(nonzero_cols),
        "structure_clusters": len(cluster_summary),
    }


def _compute_structure_clusters(agg_df, df_x2_binary, int_cols):
    """Structural (interaction-based) aggregation à la notebook 02.

    Mirrors the notebook's
        df_x2_result.groupby(all_cols, as_index=False).size()
                    .sort_values("size", ascending=False)
    plus aggregate.calculate_differences_rows for the diff_to_prev column.

    UI-only extension on top of the notebook output: for each cluster we
    also report which time-aggregated IFP positions belong to it and a
    representative IFP (= the one with the longest run length within the
    cluster). The frontend needs this to drive linked views without having
    to recompute the mapping itself.

    Returns
    -------
    cluster_per_ifp : list[int]
        Cluster id (0…n_clusters-1) for each row of ``agg_df``. Cluster 0
        is the most frequent pattern (by total frame count).
    summary : list[dict]
        One entry per cluster, sorted by frame_count desc.
    """
    n_agg = len(agg_df)
    if n_agg == 0 or not int_cols:
        return [], []

    # ── Notebook step: structural groupby on the post-x2 binary df ──
    df_int_agg = (df_x2_binary[int_cols]
                  .groupby(int_cols, as_index=False)
                  .size()
                  .sort_values("size", ascending=False)
                  .reset_index(drop=True))

    # ── Notebook step: diff_to_prev between consecutive cluster patterns
    # via the existing library function. Slices off the trailing "size"
    # column the same way the notebook does (`iloc[::1, :-1]`).
    _, diff_to_prev = aggregate.calculate_differences_rows(
        df_int_agg.iloc[:, :-1])

    # ── UI extension: assign cluster ids to time-aggregated IFPs ──
    pattern_to_cid = {}
    for cid in range(len(df_int_agg)):
        pat = tuple(int(df_int_agg.iloc[cid][c]) for c in int_cols)
        pattern_to_cid[pat] = cid

    cluster_per_ifp = []
    ifp_indices_per_cluster = [[] for _ in range(len(df_int_agg))]
    occ_per_cluster_pos = [[] for _ in range(len(df_int_agg))]
    occ_values = agg_df["occurence"].values
    agg_int = agg_df[int_cols].values  # ndarray for speed
    for pos in range(n_agg):
        pat = tuple(int(v) for v in agg_int[pos])
        cid = pattern_to_cid.get(pat)
        if cid is None:
            cluster_per_ifp.append(-1)
            continue
        cluster_per_ifp.append(cid)
        ifp_indices_per_cluster[cid].append(pos)
        occ_per_cluster_pos[cid].append(int(occ_values[pos]))

    # ── Build the per-cluster summary records ──
    total_frames = float(agg_df["occurence"].sum())
    summary = []
    for cid in range(len(df_int_agg)):
        row = df_int_agg.iloc[cid]
        pattern = [int(row[c]) for c in int_cols]
        active_cols = [int_cols[k] for k, v in enumerate(pattern) if v == 1]
        active_residues = sorted({c.split("_")[0] for c in active_cols})
        positions = ifp_indices_per_cluster[cid]
        occs = occ_per_cluster_pos[cid]
        rep_idx = int(positions[int(np.argmax(occs))]) if positions else None

        # calculate_differences_rows returns np.array([]) for index 0
        # (first cluster has no predecessor). Coerce to 0 for JSON.
        diff_val = diff_to_prev[cid] if cid < len(diff_to_prev) else 0
        if isinstance(diff_val, np.ndarray):
            diff_val = 0

        summary.append({
            "cluster_id": cid,
            "pattern": pattern,
            "active_residues": active_residues,
            "n_active": int(sum(pattern)),
            "frame_count": int(row["size"]),
            "frame_fraction": (int(row["size"]) / total_frames
                               if total_frames else 0.0),
            "ifp_count": len(positions),
            "ifp_indices": positions,
            "representative_ifp": rep_idx,
            "diff_to_prev_cluster": int(diff_val),
        })
    return cluster_per_ifp, summary


def _ensure_network_state(session: IFPSession, ligand: int = 1):
    """Build network state (positions, DynGraph, labels, edges) if not cached."""
    if ligand == 2:
        agg = session.aggregated_df_2
        if agg is None:
            raise ValueError("Run aggregation for second simulation first.")
    else:
        agg = session.aggregated_df
        if agg is None:
            raise ValueError("Run aggregation first.")

    # Interaction columns (exclude metadata)
    int_cols = [c for c in agg.columns if c not in ("diff_to_prev", "occurence")]

    # Select state fields based on ligand
    pos_attr = "node_positions_2" if ligand == 2 else "node_positions"
    label_attr = "label_dict_2" if ligand == 2 else "label_dict"
    int_type_attr = "int_type_dict_2" if ligand == 2 else "int_type_dict"
    active_attr = "active_nodes_2" if ligand == 2 else "active_nodes"
    edges_attr = "edge_lists_2" if ligand == 2 else "edge_lists"
    dyn_attr = "dyngraph_2" if ligand == 2 else "dyngraph"

    # Node positions (GraphViz neato layout → then remap to integer keys)
    if getattr(session, pos_attr) is None:
        try:
            res_positions = visualise.get_unique_residue_position(
                int_cols, save=False)
        except Exception:
            G = nx.Graph()
            G.add_node("LIG")
            res_unique = list(set(c.split("_")[0] for c in int_cols))
            G.add_nodes_from(res_unique)
            for r in res_unique:
                G.add_edge("LIG", r)
            res_positions = nx.spring_layout(G, seed=42)

        int_positions = {}
        if "LIG" in res_positions:
            int_positions["LIG"] = res_positions["LIG"]
        else:
            for k, v in res_positions.items():
                if "LIG" in str(k).upper():
                    int_positions["LIG"] = v
                    break
            else:
                int_positions["LIG"] = (0.0, 0.0)

        for i, col in enumerate(int_cols):
            res_name = col.split("_")[0]
            if res_name in res_positions:
                int_positions[i] = res_positions[res_name]
            else:
                int_positions[i] = (0.0, 0.0)

        setattr(session, pos_attr, int_positions)

    # Labels and interaction types
    if getattr(session, label_attr) is None:
        number_nodes = list(range(len(int_cols)))
        labels, int_types = helpers.get_interaction_names(
            int_cols, number_nodes, "LIG")
        setattr(session, label_attr, labels)
        setattr(session, int_type_attr, int_types)

    # Active nodes and edge lists per IFP
    if getattr(session, active_attr) is None:
        interacting_nodes = list(range(len(int_cols)))
        active, edges = helpers.define_existing_edge_in_IFP(
            agg[int_cols], "LIG", interacting_nodes,
            max_val=len(int_cols), min_val=0)
        setattr(session, active_attr, active)
        setattr(session, edges_attr, edges)

    # DynGraph
    if getattr(session, dyn_attr) is None:
        edge_lists = getattr(session, edges_attr)
        g = dn.DynGraph()
        for i in range(len(agg)):
            for edge in edge_lists[i]:
                g.add_interaction(edge[0], edge[1], t=i)
        setattr(session, dyn_attr, g)


def _fig_to_base64(fig, fmt="png") -> str:
    """Convert matplotlib figure to base64 string."""
    buf = io.BytesIO()
    fig.savefig(buf, format=fmt, dpi=150, bbox_inches="tight",
                facecolor="#0f1117", edgecolor="none")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


# ═══════════════════════════════════════════════════════════════════
# VISUALIZATION FUNCTIONS
# ═══════════════════════════════════════════════════════════════════

def render_network(session: IFPSession, frame_index: int = 0, ligand: int = 1) -> dict:
    """Render a single network frame as PNG (base64)."""
    _ensure_network_state(session, ligand)
    agg = session.aggregated_df_2 if ligand == 2 else session.aggregated_df
    int_cols = [c for c in agg.columns if c not in ("diff_to_prev", "occurence")]
    pos_nodes = getattr(session, "node_positions_2" if ligand == 2 else "node_positions")
    label_dict = getattr(session, "label_dict_2" if ligand == 2 else "label_dict")
    int_type_dict = getattr(session, "int_type_dict_2" if ligand == 2 else "int_type_dict")
    active_nodes = getattr(session, "active_nodes_2" if ligand == 2 else "active_nodes")
    dyngraph = getattr(session, "dyngraph_2" if ligand == 2 else "dyngraph")
    total_frames = len(agg)

    if frame_index < 0 or frame_index >= total_frames:
        frame_index = 0

    # ── Build the network figure for this single frame ──
    occurence_values = agg["occurence"].values
    network_numbers = agg.index.tolist()
    frames = np.arange(0, total_frames, 1)

    fig, axs = plt.subplots(2, 1, figsize=[6, 7],
                            gridspec_kw={"width_ratios": [1], "height_ratios": [1, 5]})
    fig.patch.set_facecolor("#0f1117")
    for ax in axs:
        ax.set_facecolor("#1a1d27")

    # Occurrence line plot
    axs[0].plot(frames, occurence_values, color="#6c7bd4", linewidth=1.5)
    axs[0].set_ylabel("Occurence", fontsize=10, color="#e2e8f0")
    y_lim = int((np.amax(occurence_values) / 100) * 10)
    y = y_lim + np.amax(occurence_values)
    axs[0].set_ylim(0, y)
    axs[0].set_xlim(0, len(frames))
    axs[0].vlines(ymin=0, ymax=y, x=frame_index, linewidth=1.5,
                  linestyle=":", color="#f472b6", zorder=5)
    title = f"IFP #{network_numbers[frame_index]} — occurs {occurence_values[frame_index]} times"
    axs[0].set_title(title, fontsize=10, loc="left", color="#e2e8f0")
    axs[0].tick_params(colors="#8892a8")
    axs[0].spines[:].set_color("#2d3348")

    # Network plot
    s = dyngraph.time_slice(t_from=frame_index, t_to=frame_index)
    lig_node = ["LIG"]
    node_list_all = active_nodes.get(frame_index, {}).get("LIG", [])

    # Interaction glyph definitions
    interactions_glyphs = _get_interaction_glyphs(session.node_size)

    options = {"edgecolors": "#8892a8", "node_size": session.node_size + 60}

    # Draw LIG center node
    nx.draw_networkx_nodes(s, pos=pos_nodes, ax=axs[1], nodelist=lig_node,
                           node_color="#6c7bd4", alpha=0.8, **options)

    # Draw residue nodes with interaction glyphs
    if node_list_all:
        # White base nodes
        base_nodes = nx.draw_networkx_nodes(
            s, pos=pos_nodes, ax=axs[1], nodelist=node_list_all,
            node_color="#1a1d27", node_size=session.node_size)
        if base_nodes:
            base_nodes.set_edgecolor("#e2e8f0")

        for node in node_list_all:
            int_type = int_type_dict.get(node, "Hydrophobic")
            if int_type in interactions_glyphs:
                glyph = interactions_glyphs[int_type]
                nx.draw_networkx_nodes(
                    s, pos=pos_nodes, ax=axs[1], nodelist=[node], **glyph)

        # Edges
        nx.draw_networkx_edges(s, pos=pos_nodes, ax=axs[1],
                               width=1.5, alpha=0.6, edge_color="#6c7bd4")

    # Labels
    all_labels = lig_node + (node_list_all if node_list_all else [])
    dict_labels = {x: label_dict.get(x, str(x)) for x in all_labels}
    nx.draw_networkx_labels(s, pos_nodes, dict_labels,
                            font_size=session.font_size_nodes,
                            font_color="#e2e8f0", ax=axs[1])

    axs[1].tick_params(colors="#8892a8")
    axs[1].spines[:].set_color("#2d3348")

    plt.tight_layout()
    img = _fig_to_base64(fig)

    # Frame mapping for 3D viewer sync
    frame_map = getattr(session, "frame_map_2" if ligand == 2 else "frame_map")
    mapped_frame = None
    if frame_map and 0 <= frame_index < len(frame_map):
        mapped_frame = frame_map[frame_index]

    return {
        "image": img,
        "frame_index": frame_index,
        "total_frames": total_frames,
        "occurrence": int(occurence_values[frame_index]),
        "active_residues": [label_dict.get(n, str(n))
                           for n in (node_list_all or [])],
        "mapped_frame": mapped_frame,
    }


# ── Frontend-rendering data colors / glyph mapping ──
# These mirror _get_interaction_glyphs() but are translated into shape/color
# tokens that Cytoscape understands directly (no matplotlib involved).
# `tab:blue`/`tab:red` from matplotlib become hex equivalents.
INTERACTION_STYLES_FRONTEND = {
    "Anionic":       {"shape": "triangle",         "color": "#1f77b4"},
    "Cationic":      {"shape": "triangle",         "color": "#d62728"},  # ^ inverted in matplotlib
    "CationPi":      {"shape": "star",             "color": "#d62728"},
    "PiCation":      {"shape": "star",             "color": "#1f77b4"},
    "PiStacking":    {"shape": "pentagon",         "color": "#1f77b4"},
    "EdgeToFace":    {"shape": "diamond",          "color": "#d62728"},
    "FaceToFace":    {"shape": "diamond",          "color": "#1f77b4"},
    "Hydrophobic":   {"shape": "ellipse",          "color": "#1f77b4"},
    "HBAcceptor":    {"shape": "round-rectangle",  "color": "#1f77b4"},
    "HBDonor":       {"shape": "round-rectangle",  "color": "#d62728"},
    "MetalAcceptor": {"shape": "round-rectangle",  "color": "#d62728"},
    "MetalDonor":    {"shape": "round-rectangle",  "color": "#1f77b4"},
    "XBAcceptor":    {"shape": "rectangle",        "color": "#d62728"},
    "XBDonor":       {"shape": "rectangle",        "color": "#1f77b4"},
    "VdWContact":    {"shape": "ellipse",          "color": "#d62728"},
}


def data_network(session: IFPSession, frame_index: int = 0,
                 ligand: int = 1) -> dict:
    """Return raw network data for client-side rendering (Cytoscape).

    Companion to ``render_network``. Returns the full residue graph with
    the layout positions computed in ``_ensure_network_state``, plus
    per-frame information about which residues are active and which edges
    are present. The frontend draws this directly.
    """
    _ensure_network_state(session, ligand)
    agg = session.aggregated_df_2 if ligand == 2 else session.aggregated_df
    int_cols = [c for c in agg.columns if c not in ("diff_to_prev", "occurence")]
    pos_nodes = getattr(session, "node_positions_2" if ligand == 2 else "node_positions")
    label_dict = getattr(session, "label_dict_2" if ligand == 2 else "label_dict")
    int_type_dict = getattr(session, "int_type_dict_2" if ligand == 2 else "int_type_dict")
    active_nodes = getattr(session, "active_nodes_2" if ligand == 2 else "active_nodes")
    edge_lists = getattr(session, "edge_lists_2" if ligand == 2 else "edge_lists")
    total_frames = len(agg)

    if frame_index < 0 or frame_index >= total_frames:
        frame_index = 0

    occurence_values = agg["occurence"].values
    network_numbers = agg.index.tolist()

    # Active interaction-node ids for this frame (e.g. [3, 7, 12])
    active_ids_this_frame = set(
        active_nodes.get(frame_index, {}).get("LIG", []) or [])

    # ── Nodes ── stable id -> "n<int>" or "lig"; we keep the original id
    # in `raw_id` so the edge list can match it without ambiguity.
    nodes_out = []

    # Center ligand node
    lig_x, lig_y = pos_nodes.get("LIG", (0.0, 0.0))
    nodes_out.append({
        "id": "lig",
        "raw_id": "LIG",
        "label": "LIG",
        "type": "ligand",
        "interaction": None,
        "x": float(lig_x),
        "y": float(lig_y),
        "active": True,  # ligand is always present
    })

    # Residue / interaction nodes
    for i, col in enumerate(int_cols):
        x, y = pos_nodes.get(i, (0.0, 0.0))
        int_type = int_type_dict.get(i, "Hydrophobic")
        nodes_out.append({
            "id": f"n{i}",
            "raw_id": i,
            "label": label_dict.get(i, str(i)),
            "type": "residue",
            "interaction": int_type,
            "x": float(x),
            "y": float(y),
            "active": i in active_ids_this_frame,
        })

    # ── Edges for current frame ──
    def _eid(node_id):
        return "lig" if node_id == "LIG" else f"n{node_id}"

    edges_out = []
    edges_for_frame = edge_lists[frame_index] if (
        edge_lists is not None and frame_index < len(edge_lists)) else []
    for i, edge in enumerate(edges_for_frame):
        # edges are usually (LIG, residue_id) tuples
        if len(edge) < 2:
            continue
        src, tgt = edge[0], edge[1]
        edges_out.append({
            "id": f"e{i}",
            "source": _eid(src),
            "target": _eid(tgt),
        })

    # Frame mapping for 3D viewer sync
    frame_map = getattr(session, "frame_map_2" if ligand == 2 else "frame_map")
    mapped_frame = None
    if frame_map and 0 <= frame_index < len(frame_map):
        mapped_frame = frame_map[frame_index]

    return {
        "frame_index": frame_index,
        "total_frames": total_frames,
        "ifp_id": int(network_numbers[frame_index]),
        "occurrence": int(occurence_values[frame_index]),
        "occurrence_curve": [int(v) for v in occurence_values],
        "nodes": nodes_out,
        "edges": edges_out,
        "active_residues": [label_dict.get(n, str(n))
                            for n in active_ids_this_frame],
        "mapped_frame": mapped_frame,
        "interaction_styles": INTERACTION_STYLES_FRONTEND,
    }


def _get_interaction_glyphs(node_size_basic):
    """Return interaction glyph definitions for network rendering."""
    ns = node_size_basic
    return {
        "Anionic": {"node_shape": "v", "node_size": ns + 85, "node_color": "tab:blue", "alpha": 0.5},
        "Cationic": {"node_shape": "^", "node_size": ns + 85, "node_color": "tab:red", "alpha": 0.5},
        "CationPi": {"node_shape": "*", "node_size": ns + 85, "node_color": "tab:red", "alpha": 0.5},
        "PiCation": {"node_shape": "*", "node_size": ns + 85, "node_color": "tab:blue", "alpha": 0.5},
        "PiStacking": {"node_shape": "p", "node_size": ns + 85, "node_color": "tab:blue", "alpha": 0.5},
        "EdgeToFace": {"node_shape": "D", "node_size": ns + 85, "node_color": "tab:red", "alpha": 0.5},
        "FaceToFace": {"node_shape": "D", "node_size": ns + 85, "node_color": "tab:blue", "alpha": 0.5},
        "Hydrophobic": {"node_shape": "o", "node_size": ns + 80, "node_color": "tab:blue", "alpha": 0.5},
        "HBAcceptor": {"node_shape": "s", "node_size": ns + 180, "node_color": "tab:blue", "alpha": 0.5},
        "HBDonor": {"node_shape": "s", "node_size": ns + 180, "node_color": "tab:red", "alpha": 0.5},
        "MetalAcceptor": {"node_shape": "+", "node_size": ns + 200, "node_color": "tab:red", "alpha": 0.5},
        "MetalDonor": {"node_shape": "+", "node_size": ns + 200, "node_color": "tab:blue", "alpha": 0.5},
        "XBAcceptor": {"node_shape": "x", "node_size": ns + 200, "node_color": "tab:red", "alpha": 0.5},
        "XBDonor": {"node_shape": "x", "node_size": ns + 200, "node_color": "tab:blue", "alpha": 0.5},
        "VdWContact": {"node_shape": "o", "node_size": ns + 60, "node_color": "tab:red", "alpha": 0.5},
    }


def render_circle_chart(session: IFPSession, residue: str = None, ligand: int = 1) -> dict:
    """Render circle chart(s) for one or all residues."""
    agg = session.aggregated_df_2 if ligand == 2 else session.aggregated_df
    if agg is None:
        raise ValueError("Run aggregation first.")

    int_cols = [c for c in agg.columns if c not in ("diff_to_prev", "occurence")]

    # Compute run lengths if not cached
    rl_attr = "run_lengths_2" if ligand == 2 else "run_lengths"
    col_attr = "colours_2" if ligand == 2 else "colours"
    if getattr(session, rl_attr) is None:
        rl, cols = aggregate.calculate_lengths_interaction(agg[int_cols])
        setattr(session, rl_attr, rl)
        setattr(session, col_attr, cols)

    dfs = getattr(session, rl_attr)
    colours = getattr(session, col_attr)

    # Determine residues
    all_residues = sorted(set(c.split("_")[0] for c in int_cols))
    if residue and residue in all_residues:
        residues_to_plot = [residue]
    else:
        residues_to_plot = all_residues

    images = {}
    for res in residues_to_plot:
        # Find interactions for this residue
        res_interactions = [k for k in dfs.keys() if k.startswith(res + "_")]
        if not res_interactions:
            continue

        fig, ax = plt.subplots(figsize=(5, 5))
        fig.patch.set_facecolor("#0f1117")
        ax.set_facecolor("#0f1117")
        size = 0.12

        for idx, interaction_key in enumerate(res_interactions):
            df_ring = dfs[interaction_key]
            vals = df_ring["size"].values
            val_interaction = df_ring["value"].values
            int_type = interaction_key.split("_")[-1]

            colours_plot = [colours.get(int_type, "#6c7bd4") if i == 1
                          else "#2d3348" for i in val_interaction]
            radius = 1 + (size * idx)
            ax.pie(vals.flatten(), radius=radius, startangle=90,
                   colors=colours_plot,
                   wedgeprops=dict(width=size, edgecolor="#0f1117", linewidth=0.5),
                   counterclock=False)

        ax.set(aspect="equal")
        ax.set_title(res, fontsize=14, color="#e2e8f0", pad=15)
        plt.tight_layout()
        images[res] = _fig_to_base64(fig)

    # Legend
    fig_legend, ax_legend = plt.subplots(figsize=(3, 3))
    fig_legend.patch.set_facecolor("#0f1117")
    ax_legend.axis("off")
    import matplotlib.patches as mpatches
    patches = [mpatches.Patch(color=v, label=k) for k, v in colours.items()]
    ax_legend.legend(handles=patches, loc="center", fontsize=9,
                     frameon=False, labelcolor="#e2e8f0")
    plt.tight_layout()
    images["_legend"] = _fig_to_base64(fig_legend)

    return {
        "images": images,
        "residues": all_residues,
    }


def render_distance_matrix(session: IFPSession, ligand: int = 1) -> dict:
    """Render the distance matrix compound figure."""
    agg = session.aggregated_df_2 if ligand == 2 else session.aggregated_df
    if agg is None:
        raise ValueError("Run aggregation first.")

    int_cols = [c for c in agg.columns if c not in ("diff_to_prev", "occurence")]

    dist_attr = "distances_2" if ligand == 2 else "distances"
    ident_attr = "identical_within_2" if ligand == 2 else "identical_within"

    # Compute distances if not cached
    if getattr(session, dist_attr) is None:
        ifp_values = agg[int_cols].values.tolist()
        setattr(session, dist_attr, calculate.calculate_distances(
            ifp_values, session.memory))

    # Compute identical IFPs within this simulation
    if getattr(session, ident_attr) is None:
        setattr(session, ident_attr, calculate.calculate_where_diff_zero(
            getattr(session, dist_attr), agg.index.tolist()))

    cmap = plt.get_cmap(session.cmap_name)
    distances = getattr(session, dist_attr)
    identical_within = getattr(session, ident_attr)

    fig = visualise.plot_distance_distribution_sim_hist_line(
        distances,
        agg["occurence"],
        identical_within,
        cmap=cmap,
        fontsize=session.fontsize,
    )

    # Re-style for dark theme
    fig.patch.set_facecolor("#0f1117")
    for ax in fig.get_axes():
        ax.set_facecolor("#1a1d27")
        ax.tick_params(colors="#8892a8")
        ax.xaxis.label.set_color("#e2e8f0")
        ax.yaxis.label.set_color("#e2e8f0")
        ax.title.set_color("#e2e8f0")
        for spine in ax.spines.values():
            spine.set_color("#2d3348")

    img = _fig_to_base64(fig)

    return {
        "image": img,
        "ifp_count": len(agg),
        "max_distance": float(np.amax(distances)),
    }


def render_occurrence(session: IFPSession, ligand: int = 1) -> dict:
    """Render the occurrence line plot."""
    agg = session.aggregated_df_2 if ligand == 2 else session.aggregated_df
    if agg is None:
        raise ValueError("Run aggregation first.")

    occ = agg["occurence"].values
    frames = np.arange(len(occ))

    fig, ax = plt.subplots(figsize=(10, 4))
    fig.patch.set_facecolor("#0f1117")
    ax.set_facecolor("#1a1d27")

    ax.fill_between(frames, occ, alpha=0.15, color="#6c7bd4")
    ax.plot(frames, occ, color="#6c7bd4", linewidth=1.5, label="Occurrence")

    # Cumulative
    cumulative = np.cumsum(occ) / np.sum(occ) * np.max(occ)
    ax.plot(frames, cumulative, color="#f472b6", linewidth=1.5,
            linestyle="--", label="Cumulative (scaled)")

    ax.set_xlabel("IFP Index", color="#e2e8f0", fontsize=session.fontsize)
    ax.set_ylabel("Occurrence", color="#e2e8f0", fontsize=session.fontsize)
    ax.legend(fontsize=10, facecolor="#1a1d27", edgecolor="#2d3348",
              labelcolor="#e2e8f0")
    ax.tick_params(colors="#8892a8")
    for spine in ax.spines.values():
        spine.set_color("#2d3348")

    plt.tight_layout()
    img = _fig_to_base64(fig)

    return {
        "image": img,
        "total_frames": int(np.sum(occ)),
        "unique_ifps": len(occ),
        "max_occurrence": int(np.max(occ)),
    }


def data_circle(session: IFPSession, ligand: int = 1) -> dict:
    """Return raw circle-chart data for client-side rendering.

    Companion to ``render_circle_chart``. Reuses the existing
    run-length cache (``session.run_lengths`` / ``session.colours``)
    that ``render_circle_chart`` populates on first call. We ship the
    data for *all* residues at once — the frontend handles the
    "show one focused" UI in the sidebar layout, so a per-residue
    endpoint would just add round-trips for no benefit.
    """
    agg = session.aggregated_df_2 if ligand == 2 else session.aggregated_df
    if agg is None:
        raise ValueError("Run aggregation first.")

    int_cols = [c for c in agg.columns if c not in ("diff_to_prev", "occurence")]

    rl_attr = "run_lengths_2" if ligand == 2 else "run_lengths"
    col_attr = "colours_2" if ligand == 2 else "colours"

    if getattr(session, rl_attr) is None:
        rl, cols = aggregate.calculate_lengths_interaction(agg[int_cols])
        setattr(session, rl_attr, rl)
        setattr(session, col_attr, cols)

    dfs = getattr(session, rl_attr)        # dict: "RES_INT" -> DataFrame(value,size)
    colours = getattr(session, col_attr)   # dict: int_type -> color

    # Determine residues (sorted, like the matplotlib version)
    all_residues = sorted(set(c.split("_")[0] for c in int_cols))

    # Build the per-residue ring structure
    rings_by_residue = {}
    for res in all_residues:
        # All interaction keys belonging to this residue
        res_keys = [k for k in dfs.keys() if k.startswith(res + "_")]
        if not res_keys:
            continue
        rings = []
        for key in res_keys:
            df_ring = dfs[key]
            int_type = key.split("_", 1)[1]
            color = colours.get(int_type, "#6c7bd4")
            # Convert matplotlib color (str hex / tuple / named) to a hex
            # string the browser can use directly.
            color_hex = _color_to_hex(color)
            segments = [
                {"value": int(v), "size": int(s)}
                for v, s in zip(df_ring["value"].values,
                                df_ring["size"].values)
            ]
            rings.append({
                "interaction_type": int_type,
                "color": color_hex,
                "segments": segments,
            })
        rings_by_residue[res] = rings

    return {
        "residues": all_residues,
        "rings_by_residue": rings_by_residue,
        "interaction_colors": {
            k: _color_to_hex(v) for k, v in colours.items()
        },
        "n_ifps": len(agg),
    }


def _color_to_hex(c) -> str:
    """Best-effort conversion of a matplotlib color to a `#rrggbb` string."""
    if isinstance(c, str):
        if c.startswith("#"):
            return c
        # Named matplotlib colors → hex via to_hex
        try:
            from matplotlib.colors import to_hex
            return to_hex(c)
        except Exception:
            return "#6c7bd4"
    # tuple / list of floats in [0,1]
    if isinstance(c, (tuple, list)) and len(c) >= 3:
        r, g, b = c[:3]
        return "#{:02x}{:02x}{:02x}".format(
            int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))
    return "#6c7bd4"


def data_distance_matrix(session: IFPSession, ligand: int = 1) -> dict:
    """Return raw distance-matrix data for client-side rendering.

    Companion to ``render_distance_matrix``. We reuse the already-cached
    pairwise distances on the session (computed by
    ``calculate.calculate_distances`` via the matplotlib path on first
    request) so this endpoint is cheap even for large N.

    Output shape: a flat NxN array of Manhattan distances (= count of
    differing IFP positions), plus IFP ids and occurrence counts so the
    frontend can label rows/columns and surface useful tooltips.
    """
    agg = session.aggregated_df_2 if ligand == 2 else session.aggregated_df
    if agg is None:
        raise ValueError("Run aggregation first.")

    int_cols = [c for c in agg.columns if c not in ("diff_to_prev", "occurence")]

    dist_attr = "distances_2" if ligand == 2 else "distances"

    # Compute distances on first call (parity with render_distance_matrix
    # so the heatmap and the data endpoint share the same cache).
    if getattr(session, dist_attr) is None:
        ifp_values = agg[int_cols].values.tolist()
        setattr(session, dist_attr, calculate.calculate_distances(
            ifp_values, session.memory))

    distances = getattr(session, dist_attr)
    occ = agg["occurence"].values
    ifp_ids = agg.index.tolist()

    # Convert to a JSON-serialisable nested list. NxN with N up to a few
    # thousand stays well within JSON limits; for huge N we'd switch to
    # a binary endpoint, but matplotlib's render path has the same cap.
    dist_list = [[float(v) for v in row] for row in distances]

    return {
        "distances": dist_list,
        "ifp_ids": [int(v) for v in ifp_ids],
        "occurrence": [int(v) for v in occ],
        "n": len(ifp_ids),
        "max_distance": float(np.max(distances)) if len(distances) else 0.0,
        "min_distance": float(np.min(distances)) if len(distances) else 0.0,
    }


def data_occurrence(session: IFPSession, ligand: int = 1) -> dict:
    """Return raw occurrence data for client-side rendering.

    Companion to ``render_occurrence``. Per IFP we report how often it
    appeared (`occurrence`), the original IFP id (`ifp_ids`, may not be
    contiguous after aggregation), and a few summary numbers for the UI.
    The frontend draws the line/area chart and computes the cumulative
    curve itself so it can control visual scaling.
    """
    agg = session.aggregated_df_2 if ligand == 2 else session.aggregated_df
    if agg is None:
        raise ValueError("Run aggregation first.")

    occ = agg["occurence"].values
    ifp_ids = agg.index.tolist()
    total_observations = int(np.sum(occ))

    return {
        "occurrence": [int(v) for v in occ],
        "ifp_ids": [int(v) for v in ifp_ids],
        "unique_ifps": len(occ),
        "total_observations": total_observations,
        "max_occurrence": int(np.max(occ)) if len(occ) else 0,
    }


def data_clusters(session: IFPSession, ligand: int = 1) -> dict:
    """Return structural cluster data for client-side linked views.

    Computed in ``run_aggregation`` via the notebook-style groupby on the
    post-x2 binary df (mirrors notebook 02). The frontend uses
    ``cluster_id_per_ifp`` to colour the occurrence plot / frame slider
    by cluster and ``clusters`` to populate the top-binding-modes panel.
    """
    agg = session.aggregated_df_2 if ligand == 2 else session.aggregated_df
    if agg is None:
        raise ValueError("Run aggregation first.")
    cpi = (session.structure_clusters_2 if ligand == 2
           else session.structure_clusters)
    summary = (session.structure_cluster_summary_2 if ligand == 2
               else session.structure_cluster_summary)
    return {
        "cluster_id_per_ifp": cpi or [],
        "n_clusters": len(summary or []),
        "clusters": summary or [],
        "n_ifps": len(agg),
        "total_frames": int(agg["occurence"].sum()) if len(agg) else 0,
    }


def run_comparison(session: IFPSession) -> dict:
    """Merge two simulations, compute distances, classify pairs."""
    import time

    if session.aggregated_df is None or session.aggregated_df_2 is None:
        raise ValueError("Both simulations must be loaded and aggregated.")

    # Merge
    t0 = time.perf_counter()
    session.merged_df = aggregate.summarise_two_interaction_dfs(
        session.aggregated_df, session.aggregated_df_2,
        session.ligand_name_1, session.ligand_name_2)
    t1 = time.perf_counter()
    print(f"[TIMING] run_comparison — merge: {t1 - t0:.3f}s")

    # Distance matrix on merged data
    int_cols = [c for c in session.merged_df.columns
                if c not in ("diff_to_prev", "occurence", "Lig")]
    ifp_values = session.merged_df[int_cols].values.tolist()
    t2 = time.perf_counter()
    session.cross_distances = calculate.calculate_distances(
        ifp_values, session.memory)
    t3 = time.perf_counter()
    print(f"[TIMING] run_comparison — distances ({len(ifp_values)} IFPs): {t3 - t2:.3f}s")

    # Classify pairs
    a = session.merged_df["Lig"].values
    lig_names = [session.ligand_name_1, session.ligand_name_2]

    t4 = time.perf_counter()
    session.identical_ifps, session.similar_ifps, session.dissimilar_ifps = \
        calculate.calculate_where_diff_and_sim(
            a, session.cross_distances, lig_names,
            session.identical_threshold,
            session.similarity_threshold,
            session.dissimilarity_threshold)
    t5 = time.perf_counter()
    print(f"[TIMING] run_comparison — classify: {t5 - t4:.3f}s")
    print(f"[TIMING] run_comparison — TOTAL: {t5 - t0:.3f}s")

    return {
        "merged_ifps": len(session.merged_df),
        "merged_interactions": len(int_cols),
        "lig1_name": session.ligand_name_1,
        "lig2_name": session.ligand_name_2,
    }


def render_comparison(session: IFPSession) -> dict:
    """Render the six-lane comparison plot."""
    import time

    if session.identical_ifps is None or session.similar_ifps is None:
        raise ValueError("Run comparison first.")

    a = session.merged_df["Lig"].values
    lig_names = [session.ligand_name_1, session.ligand_name_2]

    t0 = time.perf_counter()
    fig = visualise.plot_similarity_between_ligands(
        a, session.identical_ifps, session.similar_ifps,
        lig_names, fontsize=session.fontsize)
    t1 = time.perf_counter()
    print(f"[TIMING] render_comparison — plot_similarity: {t1 - t0:.3f}s")

    fig.patch.set_facecolor("#0f1117")
    for ax in fig.get_axes():
        ax.set_facecolor("#1a1d27")
        ax.tick_params(colors="#8892a8")
        ax.xaxis.label.set_color("#e2e8f0")
        ax.yaxis.label.set_color("#e2e8f0")
        for spine in ax.spines.values():
            spine.set_color("#2d3348")

    t2 = time.perf_counter()
    img = _fig_to_base64(fig)
    t3 = time.perf_counter()
    print(f"[TIMING] render_comparison — fig_to_base64: {t3 - t2:.3f}s")
    print(f"[TIMING] render_comparison — TOTAL: {t3 - t0:.3f}s")

    return {"image": img}


def load_pdb(session: IFPSession, file_bytes: bytes, filename: str,
             ligand: int = 1) -> dict:
    """Load a PDB file for the 3D viewer."""
    content = file_bytes.decode("utf-8", errors="replace")
    if ligand == 2:
        session.pdb_content_2 = content
        session.pdb_path_2 = filename
    else:
        session.pdb_content = content
        session.pdb_path = filename
    return {"filename": filename, "ligand": ligand,
            "atom_count": content.count("\nATOM")}


def load_trajectory(session: IFPSession, gro_path: str, xtc_paths: list,
                    ligand: int = 1) -> dict:
    """Load a GRO topology + multiple XTC trajectories via MDAnalysis.

    MDAnalysis concatenates multiple XTC files in order, so frame indices
    span across all replicates sequentially.
    """
    import MDAnalysis as mda

    u = mda.Universe(gro_path, xtc_paths)
    pdb_first = _frame_to_pdb(u, 0)

    if ligand == 2:
        session.trajectory_universe_2 = u
        session.trajectory_n_frames_2 = len(u.trajectory)
        session.trajectory_gro_path_2 = gro_path
        session.trajectory_xtc_paths_2 = xtc_paths
        session.pdb_content_2 = pdb_first
        session.pdb_path_2 = os.path.basename(gro_path)
    else:
        session.trajectory_universe = u
        session.trajectory_n_frames = len(u.trajectory)
        session.trajectory_gro_path = gro_path
        session.trajectory_xtc_paths = xtc_paths
        session.pdb_content = pdb_first
        session.pdb_path = os.path.basename(gro_path)

    return {
        "n_frames": len(u.trajectory),
        "n_atoms": len(u.atoms),
        "ligand": ligand,
        "gro": os.path.basename(gro_path),
        "xtc_files": [os.path.basename(p) for p in xtc_paths],
        "xtc_count": len(xtc_paths),
    }


def get_frame_pdb(session: IFPSession, frame: int, ligand: int = 1) -> str:
    """Extract a single frame from the loaded trajectory as PDB string."""
    universe = session.trajectory_universe_2 if ligand == 2 else session.trajectory_universe
    n_frames = session.trajectory_n_frames_2 if ligand == 2 else session.trajectory_n_frames
    if universe is None:
        raise ValueError(f"No trajectory loaded for ligand {ligand}")
    if frame < 0 or frame >= n_frames:
        raise ValueError(f"Frame {frame} out of range [0, {n_frames - 1}]")
    return _frame_to_pdb(universe, frame)


STANDARD_RESIDUES = {
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
    # Common caps / terminal patches
    "ACE", "NME", "NMA", "NH2",
    # Protonation variants
    "HID", "HIE", "HIP", "HSD", "HSE", "HSP", "CYX", "ASH", "GLH",
}


def _frame_to_pdb(universe, frame: int) -> str:
    """Convert a single MDAnalysis frame to PDB string.

    Sets record_types to HETATM for non-standard residues (ligands, water,
    ions) so that py3Dmol can distinguish them via hetflag.
    """
    import numpy as np
    universe.trajectory[frame]

    # Set HETATM for non-standard residues (GRO has no ATOM/HETATM distinction)
    if not hasattr(universe.atoms, "record_types"):
        universe.add_TopologyAttr("record_types", ["ATOM"] * len(universe.atoms))
    rec = np.array(["HETATM"] * len(universe.atoms), dtype=object)
    for atom in universe.atoms:
        if atom.resname in STANDARD_RESIDUES:
            rec[atom.index] = "ATOM"
    universe.atoms.record_types = rec

    with tempfile.NamedTemporaryFile(suffix=".pdb", delete=False, mode="w") as tmp:
        tmp_path = tmp.name
    try:
        from MDAnalysis.coordinates.PDB import PDBWriter
        with PDBWriter(tmp_path, n_atoms=len(universe.atoms)) as w:
            w.write(universe.atoms)
        with open(tmp_path, "r") as f:
            return f.read()
    finally:
        os.unlink(tmp_path)


def get_residues(session: IFPSession) -> list:
    """Return list of unique residues from loaded data."""
    if session.interactions is None:
        return []
    return sorted(set(c.split("_")[0] for c in session.interactions))


def get_interaction_types(session: IFPSession) -> list:
    """Return list of unique interaction types from loaded data."""
    if session.interactions is None:
        return []
    return sorted(set(c.split("_")[-1] for c in session.interactions))


def get_session_info(session: IFPSession) -> dict:
    """Return current session state summary."""
    return {
        "has_data": session.flat_df is not None,
        "has_aggregation": session.aggregated_df is not None,
        "has_second_data": session.flat_df_2 is not None,
        "has_second_aggregation": session.aggregated_df_2 is not None,
        "has_comparison": session.identical_ifps is not None,
        "has_pdb": session.pdb_content is not None,
        "has_pdb_2": session.pdb_content_2 is not None,
        "has_trajectory": session.trajectory_universe is not None,
        "has_trajectory_2": session.trajectory_universe_2 is not None,
        "trajectory_n_frames": session.trajectory_n_frames,
        "trajectory_n_frames_2": session.trajectory_n_frames_2,
        "ligand_name_1": session.ligand_name_1,
        "ligand_name_2": session.ligand_name_2,
        "frame_count": session.frame_count,
        "ifp_count": session.ifp_count,
        "frame_count_2": session.frame_count_2,
        "ifp_count_2": session.ifp_count_2,
        "interaction_count": len(session.interactions) if session.interactions else 0,
        "residues": get_residues(session),
        "interaction_types": get_interaction_types(session),
        "parameters": {
            "x1_filter": session.x1_filter,
            "x2_filter": session.x2_filter,
            "memory": session.memory,
            "identical_threshold": session.identical_threshold,
            "similarity_threshold": session.similarity_threshold,
            "dissimilarity_threshold": session.dissimilarity_threshold,
            "dpi": session.dpi,
            "fontsize": session.fontsize,
            "node_size": session.node_size,
            "font_size_nodes": session.font_size_nodes,
            "scale_axis": session.scale_axis,
            "cmap": session.cmap_name,
        },
    }


def update_parameters(session: IFPSession, params: dict) -> dict:
    """Update session parameters. Returns updated params."""
    for key, val in params.items():
        if hasattr(session, key):
            setattr(session, key, val)
            # Invalidate cached results that depend on changed params
            if key in ("memory",):
                session.distances = None
                session.cross_distances = None
            if key in ("identical_threshold", "similarity_threshold",
                       "dissimilarity_threshold"):
                session.identical_ifps = None
                session.similar_ifps = None
                session.dissimilar_ifps = None
            if key in ("node_size", "font_size_nodes", "scale_axis"):
                # Network needs re-rendering but positions stay
                pass
            if key == "cmap_name":
                pass
    return get_session_info(session)
