"""
Pixel-only panorama heuristics (no ML models): lighting from HSV, k-means palette
on the wall band, and bright-region / window candidates in the upper hemisphere.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import cv2
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans


def _load_bgr(path: Path) -> np.ndarray:
    p = path.resolve()
    img = cv2.imread(str(p))
    if img is None:
        # cv2 often fails on some WEBP/JPEG variants; PIL reads reliably.
        try:
            pil = Image.open(p).convert("RGB")
            rgb = np.asarray(pil)
            img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        except Exception as err:
            raise FileNotFoundError(f"Cannot read image: {path}") from err
    return img


def _interpret_lighting(mean_v_norm: float, var_v_norm: float) -> Dict[str, Any]:
    """mean_v_norm, var_v_norm in 0..1 (variance of V channel / 255^2)."""
    parts: List[str] = []
    if mean_v_norm > 0.55:
        parts.append("Bright upper hemisphere — likely strong ambient or daylight.")
    elif mean_v_norm > 0.38:
        parts.append("Moderate skylight brightness.")
    else:
        parts.append("Relatively dim ceiling / sky region — may be low light or artificial-heavy.")

    if mean_v_norm > 0.42 and var_v_norm > 0.018:
        parts.append("High contrast in brightness — directional sunlight or sharp lamp pools are plausible.")
    elif var_v_norm < 0.006 and mean_v_norm < 0.36:
        parts.append("Low variance — even, flat lighting (overcast or indoor artificial).")

    return {
        "mean_v": round(mean_v_norm, 4),
        "var_v": round(var_v_norm, 6),
        "summary": " ".join(parts),
    }


def _rgb_to_hex(rgb: Tuple[float, float, float]) -> str:
    r, g, b = [int(np.clip(x, 0, 255)) for x in rgb]
    return f"#{r:02x}{g:02x}{b:02x}"


def _palette_tag(rgb_center: np.ndarray) -> str:
    """Coarse warm / cool / neutral from dominant cluster center (RGB 0-255)."""
    r, g, b = float(rgb_center[0]), float(rgb_center[1]), float(rgb_center[2])
    s = r + g + b + 1e-6
    warmth = (r - b) / s
    if warmth > 0.08:
        return "warm"
    if warmth < -0.08:
        return "cool"
    return "neutral"


def analyze_panorama_pixels(image_path: Path) -> Dict[str, Any]:
    """
    Run all heuristics on an equirectangular RGB/BGR panorama.

    Convention: image rows y=0..H-1 top..bottom; y < H/2 is above the horizon (sky / upper half).
    Horizontal u = column index; azimuth proxy (u / W) * 360° with seam at u=0 ≡ u=W.
    """
    img = _load_bgr(image_path)
    h, w = img.shape[:2]
    if h < 8 or w < 8:
        raise ValueError("Panorama too small for analysis")

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    v_ch = hsv[:, :, 2].astype(np.float64)

    # ── 1) Upper hemisphere (sky cap): rows y < H/2
    um = np.zeros((h, w), dtype=bool)
    um[: int(h / 2), :] = True
    upper_vals = v_ch[um]
    mean_v = float(np.mean(upper_vals) / 255.0)
    var_v = float(np.var(upper_vals) / (255.0**2))
    lighting = _interpret_lighting(mean_v, var_v)

    # ── 2) Wall band around horizon: horizontal strip [0.42H, 0.58H]
    y0 = max(0, int(0.42 * h))
    y1 = min(h, int(0.58 * h))
    band = img[y0:y1, :, :]
    flat = band.reshape(-1, 3).astype(np.float64)
    if flat.shape[0] > 60000:
        rng = np.random.default_rng(42)
        idx = rng.choice(flat.shape[0], size=60000, replace=False)
        flat = flat[idx]
    # BGR -> RGB for interpretation
    flat_rgb = flat[:, ::-1]
    n_clusters = min(5, flat_rgb.shape[0])
    if n_clusters < 3:
        palette_summary = {
            "clusters": [],
            "dominant_hex": "#808080",
            "tag": "neutral",
            "note": "Too few pixels in wall band.",
        }
    else:
        try:
            km = KMeans(n_clusters=n_clusters, n_init=10, random_state=42, max_iter=100)
            km.fit(flat_rgb)
            centers = km.cluster_centers_
            labels = km.labels_
            counts = np.bincount(labels, minlength=n_clusters)
            order = np.argsort(-counts)
            clusters_out = []
            for i in order:
                c = centers[i]
                pct = 100.0 * counts[i] / len(labels)
                clusters_out.append(
                    {
                        "rgb": [round(float(x), 1) for x in c],
                        "hex": _rgb_to_hex(c),
                        "weight_pct": round(pct, 1),
                    }
                )
            dominant = centers[order[0]]
            palette_summary = {
                "clusters": clusters_out,
                "dominant_hex": _rgb_to_hex(dominant),
                "tag": _palette_tag(dominant),
                "note": "K-means (k=5) on wall-band pixels (equirectangular rows ~42–58% height).",
            }
        except Exception:
            palette_summary = {
                "clusters": [],
                "dominant_hex": "#808080",
                "tag": "neutral",
                "note": "K-means unavailable for this image; using fallback.",
            }

    # ── 3) Bright regions in upper half → window / opening candidates
    thr = 0.88 * 255.0
    bright = (v_ch >= thr) & um
    bright_u8 = (bright.astype(np.uint8) * 255)

    # Morphological cleanup
    k = max(3, int(min(h, w) * 0.002))
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    bright_u8 = cv2.morphologyEx(bright_u8, cv2.MORPH_OPEN, kernel)

    n_lab, lab_img, stats, centroids = cv2.connectedComponentsWithStats(bright_u8, connectivity=8)
    min_area = max(200, int(0.0008 * h * w))
    regions: List[Dict[str, Any]] = []
    for li in range(1, n_lab):
        area = int(stats[li, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        cx, cy = centroids[li]
        u_norm = float(cx / max(w - 1, 1))
        azimuth_deg = round(u_norm * 360.0, 1)
        regions.append(
            {
                "u_normalized": round(u_norm, 4),
                "azimuth_deg_cw_from_left": azimuth_deg,
                "centroid_y_px": round(float(cy), 1),
                "area_px": area,
            }
        )
    regions.sort(key=lambda r: -r["area_px"])

    windows_block = {
        "count": len(regions),
        "threshold_v": round(thr / 255.0, 3),
        "note": "Bright (high V) connected regions in the upper half; often windows or door openings. "
        "Azimuth is (u/W)·360° along the panorama seam (u=0 joins u=W).",
        "regions": regions[:24],
    }

    return {
        "image_size": {"width": w, "height": h},
        "lighting_upper_hemisphere": lighting,
        "palette_wall_band": palette_summary,
        "bright_regions_upper": windows_block,
        "version": 1,
    }


def analyze_to_json_file(image_path: Path, out_path: Path) -> Dict[str, Any]:
    data = analyze_panorama_pixels(image_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return data
