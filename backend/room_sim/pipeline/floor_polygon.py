"""Derive floor polygon from HorizonNet layout JSON for pathfinding."""
import json
from pathlib import Path
import numpy as np

from .horizonnet.misc.post_proc import np_coor2xy


def derive_floor_polygon(layout_json_path: Path) -> list:
    """
    Reads HorizonNet layout JSON (UV corner coordinates).
    JSON has key "uv": [[u, v], ...] where corners alternate ceiling/floor.

    Floor corners are the odd-indexed entries (1, 3, 5, ...).
    Projects UV → world XZ using np_coor2xy from post_proc.py.

    Returns list of {"x": float, "z": float} dicts in CCW winding.
    """
    with layout_json_path.open("r", encoding="utf-8") as f:
        pred = json.load(f)

    uv = np.array(pred["uv"], np.float32)
    W, H = 1024, 512
    cor_id = uv.copy()
    cor_id[:, 0] *= W
    cor_id[:, 1] *= H

    # Floor corners = odd rows (1, 3, 5, ...)
    floor_corners = cor_id[1::2]

    # Project to XY plane at camera height z = -1.6
    xy = np_coor2xy(floor_corners, z=-1.6, coorW=W, coorH=H, floorW=W, floorH=H)

    # Scale to metres: divide by 512 to normalise then apply scale
    scale = 1.0 / 512.0

    polygon = [
        {"x": float(pt[0] * scale), "z": float(pt[1] * scale)}
        for pt in xy
    ]
    return polygon
