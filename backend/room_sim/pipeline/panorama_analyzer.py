"""
panorama_analyzer.py — Photometric and geometric analysis of equirectangular panoramas.

Runs after HorizonNet inference in the room_sim pipeline. Pure Python: numpy,
Pillow, scikit-image only — no GPU, no neural nets.

Entry point
-----------
    result = analyze_panorama(image, layout)

Inputs
------
    image  : np.ndarray  shape (H, W, 3)  uint8 RGB
    layout : dict        raw HorizonNet JSON::

        {
          "z0": float,         # floor-to-camera height (layout units)
          "z1": float,         # ceiling-to-camera height
          "uv": [[u, v], ...]  # 2N corner pairs, normalised [0, 1]
                               #   even indices (0, 2, …) = ceiling corners
                               #   odd  indices (1, 3, …) = floor corners
        }

    Wall i spans from ceiling corner 2i to ceiling corner 2(i+1) mod 2N.
    The u axis maps linearly to yaw: yaw = u × 360°.

Output schema
-------------
    {
      "insights": {
          "light_score"       : float,       # 0–1, mean luminance upper hemisphere
          "light_character"   : str,         # "bright" | "dim" | "directional"
          "light_direction_deg": float,      # yaw of brightest region (0–360)
          "palette_temperature": str,        # "warm" | "cool" | "neutral"
          "dominant_colors"   : list[str],   # 5 hex strings, wall-band k-means
          "ceiling_color"     : str,         # hex, top-15% median
          "floor_color"       : str,         # hex, bottom-15% median
          "window_count"      : int,
          "door_count"        : int,
      },
      "spatial": {
          "wall_segments": [...],         # per-wall angular spans from layout UV
          "wall_colors" : list[str],         # one hex per wall segment
          "windows"     : [...],             # see _detect_windows for schema
          "doors"       : [...],             # see _detect_doors   for schema
      }
    }
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from PIL import Image as _PILImage
from PIL import ImageDraw as _PILDraw

if TYPE_CHECKING:
    from PIL.Image import Image as PILImage

try:
    from skimage.feature import canny
    from skimage.measure import label, regionprops
    _SKIMAGE = True
except ImportError:  # pragma: no cover
    _SKIMAGE = False

logger = logging.getLogger(__name__)

# ── ERP geometry helpers ───────────────────────────────────────────────────────

def _u_to_col(u: float, W: int) -> int:
    """Normalised u ∈ [0, 1] → pixel column index. Wraps at the seam."""
    return int(round(u * W)) % W


def _yaw_deg(u: float) -> float:
    """u ∈ [0, 1] → yaw in [0, 360). u=0 is the panorama's left/east edge."""
    return (u * 360.0) % 360.0


def _rgb_to_hex(r: float, g: float, b: float) -> str:
    return f"#{int(r):02x}{int(g):02x}{int(b):02x}"


def _median_color_hex(pixels: np.ndarray) -> str:
    """Median RGB of an (N, 3) uint8 array → hex string."""
    if pixels.size == 0:
        return "#808080"
    med = np.median(pixels.reshape(-1, 3), axis=0)
    return _rgb_to_hex(*med)


# ── Wall segment extraction ────────────────────────────────────────────────────

def _extract_wall_segments(uv: list[list[float]], W: int, H: int) -> list[dict]:
    """
    Convert HorizonNet UV corner list into per-wall angular spans.

    HorizonNet stores corners interleaved: index 2i = ceiling corner i,
    index 2i+1 = floor corner i.  Wall i therefore spans horizontally from
    the u of ceiling corner i to the u of ceiling corner (i+1) mod N.

    Returns a list of dicts::

        {"start_u": float, "end_u": float, "start_col": int, "end_col": int}

    in the same order as the layout walls (counter-clockwise when viewed from
    above, matching the HorizonNet convention).
    """
    n_walls = len(uv) // 2
    if n_walls == 0:
        return []
    segments = []
    for i in range(n_walls):
        u_start = float(uv[2 * i][0])
        u_end   = float(uv[(2 * (i + 1)) % (2 * n_walls)][0])
        segments.append({
            "start_u":   u_start,
            "end_u":     u_end,
            "start_col": _u_to_col(u_start, W),
            "end_col":   _u_to_col(u_end,   W),
        })
    return segments


def _sample_wall_band(
    image: np.ndarray,
    wall: dict,
    v_lo: float = 0.35,
    v_hi: float = 0.65,
) -> np.ndarray:
    """
    Sample pixels from the horizontal wall band (v_lo … v_hi of H) within one
    wall's angular span, handling the panorama seam wrap-around.

    Returns an (N, 3) uint8 array.
    """
    H, W, _ = image.shape
    row_lo = int(H * v_lo)
    row_hi = int(H * v_hi)
    band = image[row_lo:row_hi]          # (rows, W, 3)

    c0, c1 = wall["start_col"], wall["end_col"]
    if c0 <= c1:
        return band[:, c0:c1].reshape(-1, 3)
    # Wall crosses the u=0/1 seam: stitch left and right halves
    left  = band[:, c0:]
    right = band[:, :c1]
    return np.concatenate([left, right], axis=1).reshape(-1, 3)


def _assign_to_wall(center_u: float, wall_segments: list[dict]) -> int:
    """
    Return the index of the wall segment whose angular span contains center_u.
    Falls back to the nearest wall midpoint when no segment contains the point
    (can happen near seam edges with floating-point boundaries).
    """
    for idx, wall in enumerate(wall_segments):
        s, e = wall["start_u"], wall["end_u"]
        if s <= e:
            if s <= center_u <= e:
                return idx
        else:
            # Wrap-around wall (last wall in most rooms)
            if center_u >= s or center_u <= e:
                return idx

    # Nearest-midpoint fallback
    best_idx, best_dist = 0, float("inf")
    for idx, wall in enumerate(wall_segments):
        s, e = wall["start_u"], wall["end_u"]
        mid  = ((s + e) / 2.0) % 1.0
        dist = min(abs(center_u - mid), 1.0 - abs(center_u - mid))
        if dist < best_dist:
            best_idx, best_dist = idx, dist
    return best_idx


# ── K-means colour clustering (numpy only) ────────────────────────────────────

def _kmeans_rgb(pixels: np.ndarray, k: int = 5, max_iter: int = 25) -> np.ndarray:
    """
    Lloyd's k-means on uint8 RGB pixels.  Returns (k, 3) float32 centroids.
    Sub-samples to 6 000 points for speed; reproducible seed.
    """
    pixels = pixels.reshape(-1, 3).astype(np.float32)
    k = min(k, max(1, len(pixels)))
    if len(pixels) > 6000:
        rng_idx = np.random.default_rng(42).choice(len(pixels), 6000, replace=False)
        pixels = pixels[rng_idx]

    rng = np.random.default_rng(42)
    centers: np.ndarray = pixels[rng.choice(len(pixels), k, replace=False)].copy()

    for _ in range(max_iter):
        # (N, 1, 3) - (1, k, 3) → (N, k) squared distances
        diff   = pixels[:, None, :] - centers[None, :, :]
        labels = np.argmin((diff ** 2).sum(axis=2), axis=1)

        new_centers = np.array(
            [pixels[labels == j].mean(axis=0) if np.any(labels == j) else centers[j]
             for j in range(k)],
            dtype=np.float32,
        )
        if np.allclose(centers, new_centers, atol=0.5):
            break
        centers = new_centers

    return centers


# ── Colour temperature ────────────────────────────────────────────────────────

def _palette_temperature(hex_colors: list[str]) -> str:
    """
    Classify the palette as warm / cool / neutral from a list of hex strings.
    Hue ≤ 60° or ≥ 300° → warm; 180°–260° → cool; otherwise → neutral.
    Achromatic (grey / white) colours are skipped.
    """
    hues: list[float] = []
    for h in hex_colors:
        r_ = int(h[1:3], 16) / 255.0
        g_ = int(h[3:5], 16) / 255.0
        b_ = int(h[5:7], 16) / 255.0
        cmax, cmin = max(r_, g_, b_), min(r_, g_, b_)
        delta = cmax - cmin
        if delta < 0.05:          # near-achromatic → skip
            continue
        if cmax == r_:
            hue = 60.0 * (((g_ - b_) / delta) % 6)
        elif cmax == g_:
            hue = 60.0 * ((b_ - r_) / delta + 2)
        else:
            hue = 60.0 * ((r_ - g_) / delta + 4)
        hues.append(hue % 360.0)

    if not hues:
        return "neutral"
    mean_hue = float(np.mean(hues))
    if mean_hue <= 60.0 or mean_hue >= 300.0:
        return "warm"
    if 180.0 <= mean_hue <= 260.0:
        return "cool"
    return "neutral"


# ── Light analysis ────────────────────────────────────────────────────────────

def _analyze_light(image: np.ndarray) -> dict:
    """
    Compute light quality metrics from the **upper hemisphere** (rows 0 … H/2).

    The equirectangular projection maps the zenith to v=0 and the nadir to v=1,
    so the upper hemisphere (sky, ceiling fixtures) occupies the top half of the
    image — all lighting cues originate there.

    Returns light_score (0–1), light_character, light_direction_deg.
    """
    H, W, _ = image.shape
    upper = image[: H // 2].astype(np.float32) / 255.0   # (H/2, W, 3)

    # Value channel = max(R, G, B) — cheapest V without a full HSV conversion
    v_chan = upper.max(axis=2)   # (H/2, W)

    light_score = float(v_chan.mean())
    light_std   = float(v_chan.std())

    if light_score > 0.7:
        character = "bright"
    elif light_score < 0.4:
        character = "dim"
    elif light_std > 0.15:
        character = "directional"
    else:
        character = "bright"

    # Yaw of the brightest region — find the largest connected bright blob
    bright_mask = (v_chan > 0.80).astype(np.uint8)
    if _SKIMAGE:
        labeled = label(bright_mask)
        props   = regionprops(labeled)
        if props:
            biggest = max(props, key=lambda p: p.area)
            # centroid[1] is the column in the upper-half crop
            direction_deg = _yaw_deg(biggest.centroid[1] / W)
        else:
            # No bright pixels → use the column with highest mean V
            col_means     = v_chan.mean(axis=0)
            direction_deg = _yaw_deg(float(np.argmax(col_means)) / W)
    else:
        # scikit-image unavailable — fall back to column-mean
        col_means     = v_chan.mean(axis=0)
        direction_deg = _yaw_deg(float(np.argmax(col_means)) / W)

    return {
        "light_score":        round(light_score, 3),
        "light_character":    character,
        "light_direction_deg": round(direction_deg, 1),
    }


# ── Window detection ──────────────────────────────────────────────────────────

def _detect_windows(image: np.ndarray, wall_segments: list[dict]) -> list[dict]:
    """
    Detect windows by exploiting the overexposure signature of exterior windows
    in interior panoramas: near-white (V > 235) and near-neutral (S < 40).

    Filters applied to each connected component:
    - Area > 0.3 % of total pixels  (removes point-source light artefacts)
    - Aspect ratio 0.3 – 5.0       (removes thin horizontal bands / lens flare)
    - center_v < 0.65              (below-horizon blobs are floor reflections,
                                    not windows)

    Confidence = distance of the component's median V above the 235 threshold,
    normalised over a 20-DN headroom window; 0 → at threshold, 1 → fully blown.
    """
    if not _SKIMAGE:
        logger.warning("[panorama_analyzer] scikit-image unavailable; skipping window detection.")
        return []

    H, W, _ = image.shape
    r, g, b = (image[:, :, c].astype(np.float32) for c in range(3))

    v_chan = np.maximum(np.maximum(r, g), b)    # value  [0, 255]
    # Saturation in [0, 255]: S = 255 × (max − min) / max
    mn_chan = np.minimum(np.minimum(r, g), b)
    s_chan  = np.where(v_chan > 0, (v_chan - mn_chan) / (v_chan + 1e-6) * 255.0, 0.0)

    mask   = ((v_chan > 235) & (s_chan < 40)).astype(np.uint8)
    labeled = label(mask)
    props   = regionprops(labeled)

    total_px = H * W
    windows  = []

    for prop in props:
        if prop.area / total_px < 0.003:  # < 0.3 % → noise
            continue

        r0, c0, r1, c1 = prop.bbox
        bbox_h = r1 - r0
        bbox_w = c1 - c0
        if bbox_w < 2:
            continue
        aspect = bbox_h / bbox_w
        if not (0.3 <= aspect <= 5.0):
            continue

        cy = prop.centroid[0] / H
        cx = prop.centroid[1] / W
        if cy > 0.65:   # below the room horizon — floor reflection, not window
            continue

        region_v    = v_chan[labeled == prop.label]
        median_v    = float(np.median(region_v))
        # 20 DN above the hard threshold saturates confidence at 1.0
        confidence  = max(0.0, min(1.0, (median_v - 235.0) / 20.0))

        windows.append({
            "center_u":        round(cx, 4),
            "center_v":        round(cy, 4),
            "width_fraction":  round(bbox_w / W, 4),
            "wall_index":      _assign_to_wall(cx, wall_segments),
            "compass_yaw_deg": round(_yaw_deg(cx), 1),
            "confidence":      round(confidence, 3),
        })

    return windows


# ── Door detection ────────────────────────────────────────────────────────────

def _column_span_fraction(edge_col: np.ndarray) -> float:
    """
    Given a 1-D boolean/uint8 array of edge pixels for a single column,
    return the fraction of the array height spanned between the topmost and
    bottommost edge pixel.  Returns 0 if fewer than 3 edge pixels.
    """
    rows = np.where(edge_col)[0]
    if len(rows) < 3:
        return 0.0
    return float(rows[-1] - rows[0]) / len(edge_col)


def _detect_doors(image: np.ndarray, wall_segments: list[dict]) -> list[dict]:
    """
    Two-stage heuristic door detector.

    Stage 1 — Geometry (Canny-based):
        • Canny on the wall zone (v ∈ [0.25 H, 0.85 H]).
        • Column-wise edge projection → candidate vertical edge columns
          (threshold = mean + 1.5 σ).
        • Pair columns whose pixel separation is in [0.03 W, 0.15 W].
        • Each column must produce vertical edges spanning ≥ 40 % of the zone.
        • The pair must have a horizontal lintel: mean edge density in the row
          band [0.28 H, 0.48 H] across the pair's horizontal gap ≥ 5 %.

    Stage 2 — Appearance:
        • Inside the candidate bounding box, compute std(hue) on non-grey pixels
          (max − min > 10/255).
        • std > 25 → "open"  (room colours visible through the doorway)
          std ≤ 25 → "closed" (uniform door surface)

    Confidence:
        geom_conf = 0.5 × vert_span + 0.5 × lintel_density (both normalised)
        Candidates with confidence < 0.4 are discarded.

    Note: anything below 0.5 confidence is unreliable and should be gated in the
    frontend before rendering.
    """
    if not _SKIMAGE:
        logger.warning("[panorama_analyzer] scikit-image unavailable; skipping door detection.")
        return []

    H, W, _ = image.shape

    # Wall zone (absolute row indices)
    wz_top = int(H * 0.25)
    wz_bot = int(H * 0.85)
    wz_h   = wz_bot - wz_top

    # Lintel band — look for a horizontal edge that closes the top of the frame
    # (absolute rows: 0.28 H – 0.48 H)
    lnt_top_rel = int(H * 0.28) - wz_top   # relative to wall-zone crop
    lnt_bot_rel = int(H * 0.48) - wz_top

    # Canny on greyscale wall zone
    gray_zone = image[wz_top:wz_bot].mean(axis=2).astype(np.float32) / 255.0
    edges = canny(gray_zone, sigma=1.5).astype(np.uint8)   # shape (wz_h, W)

    # Vertical projection: total edge pixels per column across the full zone
    vert_proj = edges.sum(axis=0).astype(np.float32)       # (W,)
    v_mean, v_std = vert_proj.mean(), vert_proj.std()
    edge_threshold = v_mean + 1.5 * v_std

    # Group nearby strong-edge columns into clusters (merge within 3 px)
    strong_cols = np.where(vert_proj > edge_threshold)[0].tolist()
    clusters: list[list[int]] = []
    for col in strong_cols:
        if clusters and col - clusters[-1][-1] <= 3:
            clusters[-1].append(col)
        else:
            clusters.append([col])
    cluster_reps = [int(np.median(c)) for c in clusters]

    # Door-width bounds in pixels
    min_w = max(4, int(W * 0.03))
    max_w = int(W * 0.15)

    # Horizontal edge projection within the lintel band (one value per column)
    if lnt_top_rel >= 0 and lnt_bot_rel <= wz_h:
        horiz_proj = edges[lnt_top_rel:lnt_bot_rel].mean(axis=0)  # (W,)
    else:
        horiz_proj = np.zeros(W, dtype=np.float32)

    doors: list[dict] = []
    used: set[tuple[int, int]] = set()

    for i, c_left in enumerate(cluster_reps):
        for j, c_right in enumerate(cluster_reps):
            if j <= i:
                continue
            width = c_right - c_left
            if not (min_w <= width <= max_w):
                continue
            if (i, j) in used:
                continue

            # --- Stage 1: vertical span check ---
            span_left  = _column_span_fraction(edges[:, c_left])
            span_right = _column_span_fraction(edges[:, c_right])
            mean_span  = (span_left + span_right) / 2.0
            if mean_span < 0.40:  # must span ≥ 40 % of wall zone height
                continue

            # --- Stage 1: lintel check ---
            lintel_segment  = horiz_proj[c_left: c_right]
            lintel_density  = float(lintel_segment.mean()) if len(lintel_segment) > 0 else 0.0
            if lintel_density < 0.05:
                continue

            used.add((i, j))

            # Geometric confidence (0–1)
            # mean_span already capped at 1.0; lintel_density * 5 → saturates at 25 %
            geom_conf = min(1.0, 0.5 * min(1.0, mean_span) + 0.5 * min(1.0, lintel_density * 5.0))

            # --- Stage 2: hue variance → door type ---
            door_region = image[wz_top:wz_bot, c_left:c_right].astype(np.float32)
            r_, g_, b_  = door_region[:, :, 0], door_region[:, :, 1], door_region[:, :, 2]
            v_reg = np.maximum(np.maximum(r_, g_), b_)
            mn_reg = np.minimum(np.minimum(r_, g_), b_)
            delta  = v_reg - mn_reg

            chromatic = delta > 10.0   # filter near-grey pixels (delta in [0, 255])
            if chromatic.sum() < 30:
                door_type = "closed"   # mostly grey → assume a blank door
            else:
                r_c, g_c, b_c = r_[chromatic], g_[chromatic], b_[chromatic]
                v_c, mn_c, d_c = v_reg[chromatic], mn_reg[chromatic], delta[chromatic]
                # Vectorised hue (degrees): pick formula branch by which channel is max
                hue = np.where(
                    v_c == r_c,  ((g_c - b_c) / (d_c + 1e-6)) % 6,
                    np.where(v_c == g_c, (b_c - r_c) / (d_c + 1e-6) + 2,
                             (r_c - g_c) / (d_c + 1e-6) + 4)
                ) * 60.0 % 360.0
                door_type = "open" if float(hue.std()) > 25.0 else "closed"

            confidence = round(geom_conf, 3)
            if confidence < 0.4:
                continue

            cx  = ((c_left + c_right) / 2.0) / W
            cy  = ((wz_top  + wz_bot)  / 2.0) / H

            doors.append({
                "center_u":       round(cx, 4),
                "center_v":       round(cy, 4),
                "width_fraction": round(width / W, 4),
                "height_fraction": round(wz_h / H, 4),
                "wall_index":     _assign_to_wall(cx, wall_segments),
                "type":           door_type,
                "confidence":     confidence,
            })

    return doors


# ── Main entry point ──────────────────────────────────────────────────────────

def analyze_panorama(image: np.ndarray, layout: dict) -> dict:
    """
    Analyse an equirectangular panorama image using the HorizonNet room layout.

    See module docstring for full input/output specification.
    """
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError(f"Expected uint8 (H, W, 3) image; got shape {image.shape}")

    H, W = image.shape[:2]
    uv: list[list[float]] = layout.get("uv", [])

    logger.info(
        "[panorama_analyzer] image %dx%d, %d UV corners (%d walls)",
        W, H, len(uv), len(uv) // 2,
    )

    # ── Wall segment angular spans (derived from HorizonNet ceiling corners) ──
    # Wall i spans the u range [uv[2i][0], uv[2(i+1)%2N][0]).  The last wall
    # may wrap around the panorama seam (end_u < start_u).
    wall_segments = _extract_wall_segments(uv, W, H)

    # ── Light quality: operates on the upper hemisphere (v < 0.5 H) ──────────
    light_info = _analyze_light(image)

    # ── Wall colour palette: sample the middle band to avoid ceiling/floor ────
    wall_band = image[int(H * 0.35): int(H * 0.65)].reshape(-1, 3)
    centroids       = _kmeans_rgb(wall_band, k=5)
    dominant_colors = [_rgb_to_hex(*c) for c in centroids.astype(int)]
    palette_temp    = _palette_temperature(dominant_colors)

    # ── Ceiling colour: median of the top 15 % of the image ──────────────────
    ceiling_color = _median_color_hex(image[: int(H * 0.15)].reshape(-1, 3))

    # ── Floor colour: median of the bottom 15 % of the image ─────────────────
    floor_color = _median_color_hex(image[int(H * 0.85) :].reshape(-1, 3))

    # ── Per-wall median colours from the same middle band ────────────────────
    wall_colors = [_median_color_hex(_sample_wall_band(image, w)) for w in wall_segments]

    # ── Window detection (overexposure signal) ────────────────────────────────
    windows = _detect_windows(image, wall_segments)

    # ── Door detection (edge geometry + hue variance) ─────────────────────────
    doors = _detect_doors(image, wall_segments)

    logger.info(
        "[panorama_analyzer] done — %d windows, %d doors, light=%.2f (%s)",
        len(windows), len(doors), light_info["light_score"], light_info["light_character"],
    )

    return {
        "insights": {
            "light_score":         light_info["light_score"],
            "light_character":     light_info["light_character"],
            "light_direction_deg": light_info["light_direction_deg"],
            "palette_temperature": palette_temp,
            "dominant_colors":     dominant_colors,
            "ceiling_color":       ceiling_color,
            "floor_color":         floor_color,
            "window_count":        len(windows),
            "door_count":          len(doors),
        },
        "spatial": {
            "wall_segments": wall_segments,
            "wall_colors": wall_colors,
            "windows":     windows,
            "doors":       doors,
        },
    }


# ── Debug visualisation ───────────────────────────────────────────────────────

def draw_debug_image(
    image: np.ndarray,
    result: dict,
    layout: dict | None = None,
) -> "PILImage":
    """
    Render detection overlays on a copy of the panorama and return a PIL Image.

    Overlays:
        • Ceiling zone (top 15 %): semi-transparent blue band
        • Floor zone   (bot 15 %): semi-transparent brown band
        • Wall segment boundaries (when layout provided): vertical yellow lines
        • Windows: blue semi-transparent rectangles with confidence label
        • Doors:   green semi-transparent rectangles with type+confidence label
    """
    H, W, _ = image.shape
    base    = _PILImage.fromarray(image).convert("RGBA")
    overlay = _PILImage.new("RGBA", (W, H), (0, 0, 0, 0))
    draw    = _PILDraw.Draw(overlay)

    # Ceiling zone
    draw.rectangle([0, 0, W - 1, int(H * 0.15)], fill=(80, 140, 255, 45))
    # Floor zone
    draw.rectangle([0, int(H * 0.85), W - 1, H - 1], fill=(160, 100, 50, 45))

    # Wall segment boundaries — requires the raw layout to re-derive columns
    if layout is not None:
        segs = _extract_wall_segments(layout.get("uv", []), W, H)
        for seg in segs:
            col = seg["start_col"]
            # Draw a yellow dashed vertical line
            for y in range(0, H, 8):
                draw.line([(col, y), (col, min(H - 1, y + 4))], fill=(255, 220, 0, 180), width=1)

    spatial = result.get("spatial", {})

    # Windows
    for win in spatial.get("windows", []):
        cx_px = int(win["center_u"] * W)
        cy_px = int(win["center_v"] * H)
        w_px  = max(4, int(win["width_fraction"] * W))
        h_px  = max(4, w_px)             # estimate height from width
        x0, x1 = cx_px - w_px // 2, cx_px + w_px // 2
        y0, y1 = cy_px - h_px // 2, cy_px + h_px // 2
        draw.rectangle([x0, y0, x1, y1], fill=(50, 120, 255, 65), outline=(100, 180, 255, 210), width=2)
        draw.text((x0 + 2, y0 + 2), f"win {win['confidence']:.2f}", fill=(200, 230, 255, 230))

    # Doors
    for door in spatial.get("doors", []):
        cx_px = int(door["center_u"] * W)
        cy_px = int(door["center_v"] * H)
        w_px  = max(4, int(door["width_fraction"]  * W))
        h_px  = max(4, int(door["height_fraction"] * H))
        x0, x1 = cx_px - w_px // 2, cx_px + w_px // 2
        y0, y1 = cy_px - h_px // 2, cy_px + h_px // 2
        draw.rectangle([x0, y0, x1, y1], fill=(50, 200, 80, 65), outline=(80, 230, 100, 210), width=2)
        draw.text((x0 + 2, y0 + 2), f"door({door['type']}) {door['confidence']:.2f}", fill=(180, 255, 190, 230))

    return _PILImage.alpha_composite(base, overlay).convert("RGB")
