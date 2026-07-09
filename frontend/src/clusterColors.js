// ═══════════════════════════════════════════════════════════════════
// clusterColors — palette + derived colours for structural clusters.
//
// Top-10 clusters (by frame_count) get one of the Tableau10 categorical
// colours. Every cluster beyond the top-10 is mapped to the closest
// top-10 cluster (Hamming distance on the binary IFP pattern) and then
// drawn in a desaturated/darker variant of that top-cluster's colour.
//
// Scale (a): the distance-to-colour ramp is normalised against the
// MAX distance observed across all non-top clusters in the current
// session. The most distant rest-cluster gets the palest variant,
// closer ones stay closer to the top colour. This keeps the contrast
// inside one trajectory maximal — colours are not comparable across
// sessions, but cluster IDs aren't either.
// ═══════════════════════════════════════════════════════════════════

// Curated categorical palette that reads well on a dark background: the
// ten Tableau10 colours plus a vivid cyan and olive to stretch to twelve.
// Twelve is the deliberate ceiling — beyond roughly a dozen, categorical
// colours are no longer reliably distinguishable, so we cap here instead
// of inventing more (the earlier golden-angle generation was dropped).
const PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab",
  "#17becf", "#bcbd22",
];
const FALLBACK = "#3a3f4f";   // used if cluster id < 0 or no clusters at all
const DEFAULT_TOP_K = 10;     // default number of categorical top clusters
const MAX_TOP_K = PALETTE.length;   // hard ceiling (palette size)

// ── tiny HSL helpers (no extra dependency) ─────────────────────────
function hexToRgb(hex) {
  const m = hex.replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}
function rgbToHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v)))
                    .toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }
  return { h, s, l };
}
function hslToRgb({ h, s, l }) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

// Move a base colour towards a desaturated, slightly darker variant.
// t=0 → original colour, t=1 → fully desaturated dark grey-ish variant.
function shiftColour(baseHex, t) {
  const hsl = rgbToHsl(hexToRgb(baseHex));
  const s = hsl.s * (1 - 0.85 * t);          // 0.85 → leave a faint hint of hue
  const l = hsl.l * (1 - 0.30 * t);          // pull a bit darker so it reads as "background"
  const rgb = hslToRgb({ h: hsl.h, s, l });
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// Hamming distance between two equal-length 0/1 arrays.
function hamming(a, b) {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  // Different-length patterns shouldn't happen (same int_cols for all
  // clusters in one session) but be defensive.
  d += Math.abs(a.length - b.length);
  return d;
}

// ── public API ────────────────────────────────────────────────────

/**
 * Build a `cluster_id → hex colour` map for one ligand's cluster set.
 *
 * @param {Array<{cluster_id:number, pattern:number[]}>} clusters
 *        Output of `/api/data/clusters` (the `clusters` array — already
 *        sorted by frame_count desc, so the first `topK` entries are
 *        the categorical ones).
 * @param {number} [topK] How many top clusters get their own categorical
 *        colour (default 10, hard-capped at the palette size of 12).
 * @returns {{
 *   colorOf: (cid:number) => string,
 *   nearestTopOf: (cid:number) => number|null,
 *   distanceToTop: (cid:number) => number|null,
 *   topCount: number,
 * }}
 */
export function buildClusterColors(clusters, topK = DEFAULT_TOP_K) {
  if (!clusters || !clusters.length) {
    return {
      colorOf: () => FALLBACK,
      nearestTopOf: () => null,
      distanceToTop: () => null,
      topCount: 0,
    };
  }

  // Cap at the palette size: beyond a dozen categorical colours are no
  // longer reliably distinguishable, so we never colour more than that.
  const topCount = Math.min(Math.max(1, topK), clusters.length, MAX_TOP_K);
  const topClusters = clusters.slice(0, topCount);
  const palette = PALETTE;

  // Pre-compute nearest top + distance for every non-top cluster.
  // For top-K clusters themselves we record nearest=self / dist=0.
  const nearestTop = new Array(clusters.length).fill(null);
  const distToTop = new Array(clusters.length).fill(0);
  let maxRestDist = 0;
  for (let i = 0; i < clusters.length; i++) {
    if (i < topCount) {
      nearestTop[i] = i;
      distToTop[i] = 0;
      continue;
    }
    let bestD = Infinity, bestTop = 0;
    for (let j = 0; j < topCount; j++) {
      const d = hamming(clusters[i].pattern, topClusters[j].pattern);
      if (d < bestD) { bestD = d; bestTop = j; }
    }
    nearestTop[i] = bestTop;
    distToTop[i] = bestD;
    if (bestD > maxRestDist) maxRestDist = bestD;
  }

  // Resolve final colour per cluster.
  const colors = new Array(clusters.length);
  for (let i = 0; i < clusters.length; i++) {
    if (i < topCount) {
      colors[i] = palette[i];
    } else {
      const base = palette[nearestTop[i]];
      const t = maxRestDist > 0 ? distToTop[i] / maxRestDist : 0;
      colors[i] = shiftColour(base, t);
    }
  }

  return {
    colorOf: (cid) => {
      if (cid == null || cid < 0 || cid >= colors.length) return FALLBACK;
      return colors[cid];
    },
    nearestTopOf: (cid) =>
      cid == null || cid < 0 || cid >= nearestTop.length ? null : nearestTop[cid],
    distanceToTop: (cid) =>
      cid == null || cid < 0 || cid >= distToTop.length ? null : distToTop[cid],
    topCount,
  };
}

export const CLUSTER_TOP_K = DEFAULT_TOP_K;
export const CLUSTER_MAX_TOP_K = MAX_TOP_K;
export const CLUSTER_FALLBACK = FALLBACK;
