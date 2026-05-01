"""
Grounding DINO open-vocabulary detector.

Wraps the groundingdino-py package, which uses language-image grounding
for superior indoor furniture detection compared to YOLOv8-World-small.

If the package is not installed or weights cannot be downloaded, the class
raises ImportError so the caller can fall back to OpenVocabDetector.

Usage:
    detector = GroundingDINODetector(classes=[...])
    detections = detector.detect(img, face_name, conf_threshold=0.3)
"""

from __future__ import annotations

import os
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

import numpy as np


# Default weight / config URLs (official Grounding DINO SwinT OGC release)
_WEIGHTS_URL = (
    "https://github.com/IDEA-Research/GroundingDINO/releases/download/"
    "v0.1.0-alpha/groundingdino_swint_ogc.pth"
)
_CONFIG_URL = (
    "https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/main/"
    "groundingdino/config/GroundingDINO_SwinT_OGC.py"
)

# Resolution order for GDINO weights:
#   1. GDINO_CACHE env var (explicit override)
#   2. <backend_root>/checkpoints/gdino/   (preferred — keeps everything in the repo structure)
#   3. ~/.cache/groundingdino              (legacy fallback)
def _resolve_cache_dir() -> Path:
    if os.environ.get("GDINO_CACHE"):
        return Path(os.environ["GDINO_CACHE"])
    # Walk up from this file to find the backend root (contains manage.py)
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "manage.py").exists():
            candidate = parent / "checkpoints" / "gdino"
            if candidate.exists():
                return candidate
    return Path.home() / ".cache" / "groundingdino"

_CACHE_DIR = _resolve_cache_dir()


# ── Download helper ───────────────────────────────────────────────────────────

class _ProgressPrinter:
    """Simple progress callback for urlretrieve."""

    def __init__(self, filename: str):
        self.filename = filename
        self._last_pct = -1

    def __call__(self, block_num: int, block_size: int, total_size: int) -> None:
        if total_size <= 0:
            return
        pct = int(block_num * block_size * 100 / total_size)
        pct = min(pct, 100)
        if pct != self._last_pct and pct % 5 == 0:
            print(f"[GroundingDINO] {self.filename}: {pct}%", flush=True)
            self._last_pct = pct


def _ensure_file(url: str, dest: Path, timeout_s: int = 300) -> Path:
    """
    Download *url* to *dest* if it doesn't exist.
    Uses a socket timeout so a stalled connection raises an error instead
    of hanging forever.  Raises RuntimeError on download failure.
    """
    if dest.exists() and dest.stat().st_size > 0:
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")

    print(f"[GroundingDINO] Downloading {dest.name} …", flush=True)
    try:
        import socket
        old_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(timeout_s)
        try:
            urllib.request.urlretrieve(url, tmp, reporthook=_ProgressPrinter(dest.name))
        finally:
            socket.setdefaulttimeout(old_timeout)

        tmp.replace(dest)
        print(f"[GroundingDINO] {dest.name} ready ({dest.stat().st_size // 1_048_576} MB).", flush=True)
        return dest
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(
            f"[GroundingDINO] Failed to download {dest.name}: {exc}\n"
            f"  → Run: python manage.py download_gdino_weights"
        ) from exc


# ── Detector class ────────────────────────────────────────────────────────────

class GroundingDINODetector:
    """
    Open-vocabulary detector backed by Grounding DINO (SwinT-OGC).

    Requires groundingdino-py installed:
        pip install groundingdino-py

    Weights are auto-downloaded to ~/.cache/groundingdino/ on first use.
    Pre-download with: python manage.py download_gdino_weights
    """

    def __init__(
        self,
        classes: List[str] | None = None,
        box_threshold: float = 0.30,
        text_threshold: float = 0.25,
        device: str | None = None,
    ) -> None:
        # Will raise ImportError if not installed — caller should catch this.
        try:
            from groundingdino.util.inference import load_model, predict  # type: ignore
            from groundingdino.util import box_ops  # type: ignore
        except ImportError as e:
            raise ImportError(
                f"groundingdino-py is required for GDINO backend: {e}"
            ) from e

        self._predict = predict
        self._box_ops = box_ops

        config_path = _ensure_file(_CONFIG_URL, _CACHE_DIR / "GroundingDINO_SwinT_OGC.py", timeout_s=30)
        weights_path = _ensure_file(_WEIGHTS_URL, _CACHE_DIR / "groundingdino_swint_ogc.pth", timeout_s=600)

        if device is None:
            try:
                from room_sim.pipeline.gpu_utils import get_device
                device = get_device()
            except Exception:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"

        print(f"[GroundingDINO] Loading model on {device}…", flush=True)
        self._model = load_model(str(config_path), str(weights_path), device=device)
        self._device = device
        self._box_threshold = box_threshold
        self._text_threshold = text_threshold
        self.classes = classes or [
            "bed", "chair", "sofa", "desk", "table", "wardrobe", "closet",
            "television", "monitor", "lamp", "window", "door", "rug",
            "mirror", "curtain", "refrigerator", "stove", "sink",
            "toilet", "shower", "ceiling light",
        ]
        # Build caption once — DINO takes a single dot-separated phrase
        self._caption = ". ".join(self.classes) + "."
        print(f"[GroundingDINO] Ready. Caption: {self._caption[:80]}…", flush=True)

    def detect(
        self, img: np.ndarray, face_name: str, conf_threshold: float = 0.3
    ) -> List[Dict[str, Any]]:
        """
        Run Grounding DINO inference on a single cubemap face (BGR numpy array).
        Returns the same dict structure as OpenVocabDetector.detect().
        """
        import torch
        from PIL import Image as PILImage
        import torchvision.transforms.functional as TF

        # Convert BGR → RGB PIL
        rgb = img[:, :, ::-1].copy()
        pil = PILImage.fromarray(rgb)
        h, w = img.shape[:2]

        # Resize to 800 px on the short side (max 1333) — matches GDINO training
        scale = 800 / min(h, w)
        new_h, new_w = int(h * scale), int(w * scale)
        if max(new_h, new_w) > 1333:
            scale = 1333 / max(new_h, new_w)
            new_h, new_w = int(h * scale), int(w * scale)
        pil_resized = pil.resize((new_w, new_h), PILImage.BILINEAR)

        image_tensor = TF.to_tensor(pil_resized)
        image_tensor = TF.normalize(
            image_tensor,
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225],
        )

        effective_thresh = max(conf_threshold, self._box_threshold)

        with torch.no_grad():
            boxes, logits, phrases = self._predict(
                model=self._model,
                image=image_tensor,
                caption=self._caption,
                box_threshold=effective_thresh,
                text_threshold=self._text_threshold,
                device=self._device,
            )

        detections: List[Dict[str, Any]] = []
        if boxes is None or len(boxes) == 0:
            return detections

        # boxes are cx, cy, w, h in [0, 1]; convert to pixel xyxy at original resolution
        boxes_xyxy = self._box_ops.box_cxcywh_to_xyxy(boxes)
        boxes_xyxy = boxes_xyxy * torch.tensor([w, h, w, h], dtype=torch.float32)
        boxes_np = boxes_xyxy.cpu().numpy()
        confs_np = logits.cpu().numpy()

        for box, conf, phrase in zip(boxes_np, confs_np, phrases):
            x_min, y_min, x_max, y_max = map(float, box)
            detections.append({
                "class_name": phrase.strip(),
                "confidence_score": float(conf),
                "cubemap_face": face_name,
                "cubemap_bbox": [x_min, y_min, x_max, y_max],
            })

        return detections


