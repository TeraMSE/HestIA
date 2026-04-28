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

logger = logging.getLogger(__name__)

# Module-level semaphore to serialize jobs (single GPU)
_PIPELINE_SEM = threading.Semaphore(1)


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
