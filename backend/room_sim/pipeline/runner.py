"""HorizonNet pipeline runner - executes in background thread."""
import json
import logging
import sys
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from django.conf import settings

logger = logging.getLogger(__name__)

# Module-level semaphore to serialize jobs (single GPU)
_PIPELINE_SEM = threading.Semaphore(1)

# ── Cached ZeroShotERPPipeline ────────────────────────────────────────────────
# The YOLO model + ERP→Cubemap mappings are expensive to initialize (~15-20 s).
# We keep a single singleton across jobs so that only the first job pays the
# load cost; subsequent jobs skip straight to inference.
_CV_PIPELINE_CACHE: dict = {}   # keys: (yolo_ckpt_str, tuple(classes))
_CV_PIPELINE_LOCK = threading.Lock()


def _get_cv_pipeline(yolo_ckpt: str, classes: list, fallback_model: str | None = None):
    """Return the cached ZeroShotERPPipeline, initializing it if necessary."""
    from .cv.pipeline import ZeroShotERPPipeline
    key = (yolo_ckpt, tuple(classes))
    with _CV_PIPELINE_LOCK:
        if key not in _CV_PIPELINE_CACHE:
            logger.info("[CV] Initializing ZeroShotERPPipeline (first call, cold start)…")
            _CV_PIPELINE_CACHE[key] = ZeroShotERPPipeline(
                model_name=yolo_ckpt,
                classes=classes,
                fallback_model=fallback_model,
            )
            logger.info("[CV] ZeroShotERPPipeline ready and cached.")
        else:
            logger.info("[CV] Reusing cached ZeroShotERPPipeline (warm).")
        return _CV_PIPELINE_CACHE[key]


class PipelineRunner:
    """
    Runs the full HorizonNet pipeline in a dedicated thread.

    Steps:
        1. preprocess  — optional VP alignment
        2. inference   — HorizonNet forward pass
        3. meshing     — build PLY from layout JSON
    """

    def __init__(self, job_id: str, checkpoint_path: Path):
        self.job_id = job_id
        self.checkpoint_path = checkpoint_path

    def run(self):
        """Entry point for background thread."""
        from django.db import connection
        try:
            self._execute()
        finally:
            connection.close()

    def _execute(self):
        """Main pipeline execution."""
        from ..models import ReconstructionJob

        job = ReconstructionJob.objects.get(pk=self.job_id)
        job_dir = job.job_dir()
        events_path = job_dir / "events.log"
        events_path.parent.mkdir(parents=True, exist_ok=True)

        def log(msg: str):
            ts = datetime.now(timezone.utc).isoformat()
            with events_path.open("a", encoding="utf-8") as f:
                f.write(f"[{ts}] {msg}\n")
            logger.info(f"[job {self.job_id}] {msg}")

        def set_step(step: str):
            ReconstructionJob.objects.filter(pk=self.job_id).update(current_step=step)

        try:
            ReconstructionJob.objects.filter(pk=self.job_id).update(
                state="running",
                started_at=datetime.now(timezone.utc),
                current_step="starting",
            )
            log(f"Pipeline started. Checkpoint: {self.checkpoint_path}")

            input_path = job.input_panorama_path()
            if input_path is None:
                raise FileNotFoundError("Input panorama not found.")

            source_for_inference = input_path

            # ── Step 1: Preprocess ───────────────────────────────────────
            if job.align_panorama:
                set_step("preprocess")
                log("Running panorama VP alignment...")
                try:
                    source_for_inference = self._preprocess(job_dir, input_path, log)
                except Exception as exc:
                    log(f"WARNING: alignment failed ({exc}), using resized fallback.")
                    pre_dir = job_dir / "preprocessed"
                    pre_dir.mkdir(parents=True, exist_ok=True)
                    aligned_path = pre_dir / f"{input_path.stem}_aligned_rgb.png"
                    with Image.open(input_path) as img:
                        img.convert("RGB").resize((1024, 512), Image.BICUBIC).save(aligned_path)
                    source_for_inference = aligned_path

            # ── Step 2: Inference ────────────────────────────────────────
            set_step("inference")
            log(f"Running HorizonNet inference on: {source_for_inference.name}")
            layout_json_path = self._infer(job_dir, source_for_inference, job.force_cuboid, log)

            # ── Step 3: Mesh building ────────────────────────────────────
            set_step("meshing")
            log("Building PLY mesh from layout...")
            mesh_info = self._build_mesh(
                source_for_inference, layout_json_path,
                job_dir / "mesh" / "layout_mesh.ply",
                job.mesh_stride, job.ignore_ceiling, log
            )

            # -- Step 4: Object Detection (custom best.pt, closed-vocab) ------
            set_step("object_detection")
            log("Running object detection (best.pt custom model)...")
            try:
                # Read the effective backend (decouple picks up .env correctly)
                try:
                    from decouple import config as _dc
                    _det_backend = _dc("DETECTOR_BACKEND", default="yoloworld").strip().lower()
                except Exception:
                    import os as _os
                    _det_backend = _os.environ.get("DETECTOR_BACKEND", "yoloworld").strip().lower()

                log(f"Object detection backend: {_det_backend}")

                if _det_backend == "gdino":
                    # Grounding DINO: weights auto-download; resolve YOLO fallback.
                    _yolo_fb = settings.BASE_DIR / "checkpoints" / "yolov8x-worldv2.pt"
                    if not _yolo_fb.exists():
                        _yolo_fb = settings.BASE_DIR / "checkpoints" / "yolov8s-world.pt"
                    _yolo_fb_str = str(_yolo_fb) if _yolo_fb.exists() else "yolov8x-worldv2.pt"
                    cv_pipeline = _get_cv_pipeline("gdino", [], fallback_model=_yolo_fb_str)
                else:
                    # Default: custom closed-vocabulary best.pt
                    best_ckpt = settings.BASE_DIR / "checkpoints" / "best.pt"
                    if not best_ckpt.exists():
                        log("WARNING: best.pt checkpoint not found. Skipping detection.")
                        best_ckpt = None
                    cv_pipeline = _get_cv_pipeline(str(best_ckpt), []) if best_ckpt else None

                if cv_pipeline is not None:
                    faces_dir = job_dir / "cubemap_faces"
                    detections = cv_pipeline.run(
                        str(source_for_inference),
                        conf_threshold=0.2,
                        save_faces_dir=str(faces_dir),
                    )
                    detections_path = job_dir / "detections.json"
                    with open(detections_path, "w") as f:
                        json.dump(detections, f, indent=4)
                    log(f"Saved {len(detections['detections'])} detections to detections.json")

                    # -- Step 5: Appliance Energy Scanning --------------------
                    set_step("appliance_scanning")
                    log("Running appliance energy scan from panorama detections...")
                    try:
                        from .appliance_scanner import scan_appliances
                        if faces_dir.is_dir():
                            scan_appliances(job_dir, detections, faces_dir, log)
                        else:
                            log("WARNING: cubemap_faces dir missing — appliance scan skipped.")
                    except Exception as _ap_exc:
                        log(f"WARNING: Appliance scan failed ({_ap_exc}) — job still succeeds.")
            except Exception as e:
                log(f"WARNING: Object detection failed: {e}")
                # We do not fail the whole job if object detection fails.

            # ── Done ─────────────────────────────────────────────────────
            ReconstructionJob.objects.filter(pk=self.job_id).update(
                state="completed",
                current_step="completed",
                finished_at=datetime.now(timezone.utc),
                mesh_vertices=mesh_info["vertices"],
                mesh_faces=mesh_info["faces"],
            )
            log("Pipeline completed successfully.")

        except Exception as exc:
            tb = traceback.format_exc(limit=5)
            log(f"ERROR: {exc}")
            ReconstructionJob.objects.filter(pk=self.job_id).update(
                state="failed",
                current_step="failed",
                finished_at=datetime.now(timezone.utc),
                error_message=str(exc),
                error_trace=tb,
            )

    def _preprocess(self, job_dir: Path, input_path: Path, log) -> Path:
        """Run panorama VP alignment. Falls back to resize if pylsd-nova unavailable."""
        pre_dir = job_dir / "preprocessed"
        pre_dir.mkdir(parents=True, exist_ok=True)
        aligned_path = pre_dir / f"{input_path.stem}_aligned_rgb.png"

        try:
            from .horizonnet.misc.pano_lsd_align import panoEdgeDetection, rotatePanorama

            img_pil = Image.open(input_path)
            img_np = np.array(img_pil.convert("RGB"))

            if img_np.shape != (512, 1024, 3):
                img_np = np.array(img_pil.convert("RGB").resize((1024, 512), Image.BICUBIC))

            # panoEdgeDetection returns (olines, vp, views, edges, panoEdge, score, angle)
            # vp is a 3×3 matrix; rotatePanorama expects float image in [0, 1]
            _, vp, _, _, _, _, _ = panoEdgeDetection(img_np)
            if vp is not None:
                img_float = img_np / 255.0
                # vp[2::-1] reverses the row order of vp to match rotatePanorama convention
                img_rotated = rotatePanorama(img_float, vp[2::-1])
                Image.fromarray((img_rotated * 255).clip(0, 255).astype(np.uint8)).save(aligned_path)
            else:
                img_pil.convert("RGB").resize((1024, 512), Image.BICUBIC).save(aligned_path)

            log("Panorama aligned successfully.")
            return aligned_path

        except Exception as exc:
            log(f"VP alignment error: {exc}")
            raise


    def _infer(self, job_dir: Path, image_path: Path, force_cuboid: bool, log) -> Path:
        """Load HorizonNet and run inference. Writes JSON to inferenced/."""
        from .horizonnet.inference import run_inference_on_image

        inf_dir = job_dir / "inferenced"
        inf_dir.mkdir(parents=True, exist_ok=True)

        output_json = run_inference_on_image(
            pth=self.checkpoint_path,
            img_path=image_path,
            output_dir=inf_dir,
            force_cuboid=force_cuboid,
        )

        if not output_json.is_file():
            raise RuntimeError(f"Inference produced no JSON at {output_json}")

        log(f"Layout JSON written: {output_json.name}")
        return output_json

    def _build_mesh(self, image_path: Path, layout_path: Path,
                    ply_path: Path, stride: int,
                    ignore_ceiling: bool, log) -> dict:
        """Build PLY mesh from layout."""
        from .ply_builder import build_ply_from_layout

        ply_path.parent.mkdir(parents=True, exist_ok=True)
        info = build_ply_from_layout(
            image_path, layout_path, ply_path,
            stride=stride, ignore_ceiling=ignore_ceiling,
        )
        log(f"PLY: {info['vertices']} vertices, {info['faces']} faces, stride={info['stride']}")
        return info


def submit_pipeline_job(job_id: str, checkpoint_path: Path) -> threading.Thread:
    """Submit a pipeline job. Serializes via semaphore."""
    def run_with_sem():
        with _PIPELINE_SEM:
            runner = PipelineRunner(job_id, checkpoint_path)
            runner.run()

    t = threading.Thread(target=run_with_sem, name=f"pipeline-{job_id}", daemon=True)
    t.start()
    return t



