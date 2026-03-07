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
        self.similarity_threshold = [1, 5]
        self.dissimilarity_threshold = [6]
        self.dissimilarity_bool = False
        self.dpi = 150
        self.fontsize = 12
        self.node_size = 460
        self.font_size_nodes = 6
        self.scale_axis = 20
        self.cmap_name = "viridis"

        # ── 3D viewer ──
        self.pdb_content = None
        self.pdb_path = None


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
    if x1_val > 0:
        window_size = max(1, int((len(df_processed) / 100) * x1_val))
        df_processed = df_processed.rolling(window=window_size, center=True).mean()
        # Drop NaN rows from centered window edges
        df_processed = df_processed.dropna().reset_index(drop=True)

    # Step 2: Occurrence filter (x2) — binarize: mean > x2 → 1, else → 0
    df_processed = df_processed.apply(
        lambda col: [0 if v <= x2_val else 1 for v in col])

    # Remove columns that are entirely zero after filtering
    nonzero_cols = df_processed.columns[df_processed.any()]
    df_processed = df_processed[nonzero_cols]

    # Step 3: Time-based aggregation — consecutive identical IFPs
    new_list, list_values = aggregate.calculate_differences_rows(df_processed)
    df_processed["diff_to_prev"] = list_values
    agg_df = aggregate.summarise_df(df_processed, "diff_to_prev")

    if is_second:
        session.aggregated_df_2 = agg_df
        session.ifp_count_2 = len(agg_df)
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
        "interactions_remaining": len(nonzero_cols),
    }


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

    return {
        "image": img,
        "frame_index": frame_index,
        "total_frames": total_frames,
        "occurrence": int(occurence_values[frame_index]),
        "active_residues": [label_dict.get(n, str(n))
                           for n in (node_list_all or [])],
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
            session.dissimilarity_threshold,
            session.dissimilarity_bool)
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


def load_pdb(session: IFPSession, file_bytes: bytes, filename: str) -> dict:
    """Load a PDB file for the 3D viewer."""
    session.pdb_content = file_bytes.decode("utf-8", errors="replace")
    session.pdb_path = filename
    return {"filename": filename, "atom_count": session.pdb_content.count("\nATOM")}


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
            "dissimilarity_bool": session.dissimilarity_bool,
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
                       "dissimilarity_threshold", "dissimilarity_bool"):
                session.identical_ifps = None
                session.similar_ifps = None
                session.dissimilar_ifps = None
            if key in ("node_size", "font_size_nodes", "scale_axis"):
                # Network needs re-rendering but positions stay
                pass
            if key == "cmap_name":
                pass
    return get_session_info(session)
