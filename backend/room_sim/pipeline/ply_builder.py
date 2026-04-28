"""Build PLY mesh from HorizonNet layout JSON."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

from .horizonnet.eval_general import layout_2_depth
from .horizonnet.misc.post_proc import np_coorx2u, np_coory2v


def build_ply_from_layout(
    image_path: Path,
    layout_path: Path,
    ply_path: Path,
    stride: int = 2,
    ignore_ceiling: bool = False,
) -> dict:
    """
    Reads panorama image and HorizonNet layout JSON.
    Builds a 3D mesh by projecting pixels to XYZ via spherical coordinates.
    Writes ASCII PLY with per-vertex RGB color.

    Returns {"vertices": int, "faces": int, "stride": int}.
    """
    image = np.array(Image.open(image_path).convert("RGB"))
    h, w = image.shape[:2]

    with layout_path.open("r", encoding="utf-8") as f:
        pred = json.load(f)

    cor_id = np.array(pred["uv"], np.float32)
    cor_id[:, 0] *= w
    cor_id[:, 1] *= h

    depth, floor_mask, ceil_mask, wall_mask = layout_2_depth(cor_id, h, w, return_mask=True)

    coorx, coory = np.meshgrid(np.arange(w), np.arange(h))
    us = np_coorx2u(coorx, w)
    vs = np_coory2v(coory, h)
    zs = depth * np.sin(vs)
    cs = depth * np.cos(vs)
    xs = cs * np.sin(us)
    ys = -cs * np.cos(us)

    mask = floor_mask | wall_mask
    if not ignore_ceiling:
        mask = mask | ceil_mask

    xyzrgb = np.concatenate(
        [
            xs[..., None],
            ys[..., None],
            zs[..., None],
            image.astype(np.float32),
        ],
        axis=-1,
    )

    # Duplicate first column so mesh closes around panorama seam.
    xyzrgb = np.concatenate([xyzrgb, xyzrgb[:, :1]], axis=1)
    mask = np.concatenate([mask, mask[:, :1]], axis=1)

    # Downsample to keep browser performance stable.
    stride = max(1, int(stride))
    xyzrgb = xyzrgb[::stride, ::stride]
    mask = mask[::stride, ::stride]

    hs, ws = mask.shape
    vid = np.full((hs, ws), -1, dtype=np.int32)

    vertices = []
    for i in range(hs):
        for j in range(ws):
            if not mask[i, j]:
                continue
            vid[i, j] = len(vertices)
            vertices.append(xyzrgb[i, j])

    vertices = np.array(vertices, dtype=np.float32)

    faces = []
    for i in range(hs - 1):
        for j in range(ws - 1):
            a = vid[i, j]
            b = vid[i + 1, j]
            c = vid[i + 1, j + 1]
            d = vid[i, j + 1]

            if a >= 0 and b >= 0 and c >= 0:
                faces.append((a, b, c))
            if a >= 0 and c >= 0 and d >= 0:
                faces.append((a, c, d))

    ply_path.parent.mkdir(parents=True, exist_ok=True)

    with ply_path.open("w", encoding="utf-8") as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {len(vertices)}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        f.write("property uchar red\n")
        f.write("property uchar green\n")
        f.write("property uchar blue\n")
        f.write(f"element face {len(faces)}\n")
        f.write("property list uchar int vertex_indices\n")
        f.write("end_header\n")

        for x, y, z, r, g, b in vertices:
            f.write(f"{x:.6f} {y:.6f} {z:.6f} {int(r):d} {int(g):d} {int(b):d}\n")

        for i, j, k in faces:
            f.write(f"3 {i:d} {j:d} {k:d}\n")

    return {"vertices": int(len(vertices)), "faces": int(len(faces)), "stride": int(stride)}
