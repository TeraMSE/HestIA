"""
appliance_scanner.py
────────────────────
Bridge between the 3-D reconstruction pipeline and the Appliance Energy
Scanner (TacheEnergyMaha merged into the `appliances` Django app).

After the main object-detection step completes the 6 cubemap face images are
saved to job_dir/cubemap_faces/.  This module:

  1. Asks the LLaVA VLM whether the panorama is a kitchen (kitchen gate).
  2. If not a kitchen: returns None immediately — YOLO-World is not run.
  3. If kitchen: runs YOLO-World (yolov8x-worldv2.pt) on the saved face images
     filtering for appliance classes (refrigerator / air conditioner /
     washing machine / water heater).
  4. Crops each detection from its cubemap face image.
  5. Runs every crop through ApplianceVisionAgent.analyze_single().
  6. Writes combined results to job_dir/appliance_scans.json.
  7. Persists Appliance + ApplianceScan DB rows when the job is linked to a
     Property.

The visual-state LLM call (TokenFactory Vision) is skipped in this
automated context — panorama crops lack the close-up detail needed for
reliable rust/damage assessment. State defaults to "normal".
"""

import json
import logging
from pathlib import Path
from typing import Callable

import cv2

logger = logging.getLogger(__name__)

# YOLO-World class names → CNN class names (French)
# Only these 4 appliance classes are searched for by YOLO-World.
YOLO_TO_CNN = {
    "refrigerator":    "refrigerateur",
    "air conditioner": "climatiseur",
    "washing machine": "machine_laver",
    "water heater":    "chauffe_eau",
}

MIN_CROP_PX = 48    # smaller crops give unreliable CNN predictions
CROP_PADDING = 24   # pixels added around each bbox before saving

# Per-job kitchen-classification cache to avoid re-prompting the VLM
# on repeated requests within the same process lifecycle.
_KITCHEN_CACHE: dict[str, bool] = {}


def is_kitchen_panorama(image_path: Path, job_id: str) -> bool:
    """
    Ask the LLaVA VLM whether the given image is a kitchen.
    Result is cached per job_id so the VLM is only called once per job.
    Falls back to False on any error (so appliance scan is simply skipped).
    """
    if job_id in _KITCHEN_CACHE:
        return _KITCHEN_CACHE[job_id]

    try:
        from social_sim.engine.llm_client import call_tokenfactory_vision
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        response = call_tokenfactory_vision(
            image_bytes=image_bytes,
            prompt="Is this image of a kitchen? Answer only 'yes' or 'no'.",
            temperature=0.0,
            max_tokens=10,
        )
        result = response.strip().lower().startswith("yes")
    except Exception as exc:
        logger.warning(
            "[appliance_scanner] Kitchen VLM check failed (%s) — defaulting to False.", exc
        )
        result = False

    _KITCHEN_CACHE[job_id] = result
    return result


def _run_yoloworld_on_faces(
    faces_dir: Path,
    log: Callable[[str], None],
) -> list:
    """
    Run YOLO-World (yolov8x-worldv2.pt) on the 4 wall cubemap faces and
    return detections that match YOLO_TO_CNN appliance classes.
    """
    from django.conf import settings
    from room_sim.pipeline.cv.detector import OpenVocabDetector

    ckpt = Path(settings.BASE_DIR) / "checkpoints" / "yolov8x-worldv2.pt"
    if not ckpt.is_file():
        log("WARNING: yolov8x-worldv2.pt not found — appliance scan skipped.")
        return []

    appliance_vocab = list(YOLO_TO_CNN.keys())
    log(f"[appliance] Running YOLO-World for appliances: {appliance_vocab}")
    detector = OpenVocabDetector(model_name=str(ckpt), classes=appliance_vocab)

    wall_faces = ["front", "back", "left", "right"]
    hits = []
    for face_name in wall_faces:
        face_path = faces_dir / f"{face_name}.jpg"
        if not face_path.is_file():
            continue
        img = cv2.imread(str(face_path))
        if img is None:
            continue
        dets = detector.detect(img, face_name, conf_threshold=0.25)
        for d in dets:
            if d["class_name"].lower() in YOLO_TO_CNN:
                hits.append(d)
    log(f"[appliance] YOLO-World found {len(hits)} appliance detection(s).")
    return hits


def _crop_from_face(face_img, bbox, padding=CROP_PADDING):
    """Crop bbox from a cubemap face image with padding. Returns None if too small."""
    h, w = face_img.shape[:2]
    x1, y1, x2, y2 = [int(round(c)) for c in bbox]
    x1 = max(0, x1 - padding)
    y1 = max(0, y1 - padding)
    x2 = min(w, x2 + padding)
    y2 = min(h, y2 + padding)
    if (x2 - x1) < MIN_CROP_PX or (y2 - y1) < MIN_CROP_PX:
        return None
    return face_img[y1:y2, x1:x2]


def scan_appliances(
    job_dir: Path,
    detections: dict,
    faces_dir: Path,
    log: Callable[[str], None],
) -> dict | None:
    """
    Entry point called by the pipeline runner after object detection.

    Args:
        job_dir:    Base directory for this reconstruction job.
        detections: Parsed detections.json content (already in memory, from best.pt).
                    Used for context only — appliance classes are re-detected via
                    YOLO-World when the room is identified as a kitchen.
        faces_dir:  Directory where the 6 cubemap face JPEGs were saved.
        log:        Logging callback that writes to events.log.

    Returns:
        appliance_scans dict written to disk, or None when nothing found.
    """
    job_id = job_dir.name

    # ── Kitchen gate ─────────────────────────────────────────────────────────
    # best.pt does not detect refrigerator / air conditioner / washing machine /
    # water heater.  We only bother running YOLO-World when the VLM confirms
    # the panorama shows a kitchen.
    #
    # Pick the "front" face (or first available) as the VLM input to keep the
    # request lightweight.
    kitchen_probe: Path | None = None
    for _face in ("front", "back", "left", "right", "top", "bottom"):
        _p = faces_dir / f"{_face}.jpg"
        if _p.is_file():
            kitchen_probe = _p
            break

    if kitchen_probe is None:
        log("[appliance] No cubemap faces found — appliance scan skipped.")
        return None

    log("[appliance] Checking room type via VLM (kitchen gate)...")
    if not is_kitchen_panorama(kitchen_probe, job_id):
        log("[appliance] Room is not a kitchen — appliance scan skipped.")
        return None

    log("[appliance] Room classified as kitchen — running YOLO-World appliance scan.")

    # ── Detect appliances with YOLO-World ─────────────────────────────────────
    appliance_hits = _run_yoloworld_on_faces(faces_dir, log)

    if not appliance_hits:
        log("No appliance-class objects detected — skipping appliance scan.")
        return None

    log(
        f"Found {len(appliance_hits)} appliance detection(s): "
        + str([d["class_name"] for d in appliance_hits])
    )

    # 2. Load the CNN agent (cached singleton)
    try:
        from appliances.services.agent import get_agent
        agent = get_agent()
    except Exception as exc:
        log(
            f"WARNING: Could not load ApplianceVisionAgent ({exc}). "
            "Ensure APPLIANCE_CNN_PATH is set and mobilenet_best.pth is present."
        )
        return None

    crops_dir = job_dir / "appliance_crops"
    crops_dir.mkdir(parents=True, exist_ok=True)

    appliance_results = []
    seen_classes: dict = {}

    for det in appliance_hits:
        yolo_class = det["class_name"].lower()
        cnn_hint   = YOLO_TO_CNN[yolo_class]
        face_name  = det["cubemap_face"]
        bbox       = det.get("cubemap_bbox")
        yolo_conf  = det.get("confidence_score", 0.0)

        # 3. Load the face image saved during detection
        face_path = faces_dir / f"{face_name}.jpg"
        if not face_path.is_file():
            log(f"  WARNING: cubemap face '{face_name}.jpg' not found — skipping.")
            continue

        face_img = cv2.imread(str(face_path))
        if face_img is None:
            log(f"  WARNING: Could not read '{face_name}.jpg' — skipping.")
            continue

        # 4. Crop the bbox from the undistorted face image
        crop = _crop_from_face(face_img, bbox)
        if crop is None:
            log(f"  Skipping {yolo_class} on face '{face_name}': crop too small.")
            continue

        idx = seen_classes.get(cnn_hint, 0)
        seen_classes[cnn_hint] = idx + 1
        crop_filename = f"{cnn_hint}_{idx:02d}.jpg"
        crop_path = crops_dir / crop_filename
        cv2.imwrite(str(crop_path), crop)

        # 5. Run CNN + rule engine (state detection skipped in auto mode)
        try:
            result = agent.analyze_single(str(crop_path), etat="normal")
        except Exception as exc:
            log(f"  WARNING: CNN inference failed for {crop_filename}: {exc}")
            continue

        result["source_detection"] = {
            "yolo_class":      yolo_class,
            "cubemap_face":    face_name,
            "cubemap_bbox":    bbox,
            "yolo_confidence": round(yolo_conf, 4),
            "crop_file":       crop_filename,
        }
        appliance_results.append(result)
        log(
            f"  {yolo_class} -> CNN: {result['detected_class']} "
            f"({result['confidence']:.0f}%) | EPS {result['efficiency_score']}/100 ({result['grade']})"
        )

    if not appliance_results:
        log("No valid appliance crops could be processed.")
        return None

    # 6. Compute household weighted score
    from appliances.services.rule_engine import ApplianceRuleEngine
    engine = ApplianceRuleEngine()
    global_score, scores_by_device, _ = engine.calculate_score([
        {
            "category":   r["detected_class"],
            "age":        r.get("age_years") or 7,
            "confidence": r["confidence"] / 100,
            "etat":       r["etat_visuel"],
        }
        for r in appliance_results
    ])
    global_grade = engine.get_grade(global_score)

    output = {
        "global_score":    global_score,
        "global_grade":    global_grade,
        "scores_by_device": scores_by_device,
        "appliances":      appliance_results,
    }

    # 7. Write appliance_scans.json
    scans_path = job_dir / "appliance_scans.json"
    with open(scans_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    log(f"appliance_scans.json written — household EPS {global_score}/100 ({global_grade})")

    # 8. Persist to DB (best-effort; never fails the whole job)
    try:
        _persist_to_db(job_dir, output, log)
    except Exception as exc:
        log(f"WARNING: DB persistence failed ({exc}) — JSON results still available on disk.")

    return output


def _persist_to_db(job_dir: Path, output: dict, log: Callable[[str], None]) -> None:
    """Create Appliance + ApplianceScan rows linked to the ReconstructionJob."""
    from room_sim.models import ReconstructionJob
    from appliances.models import Appliance, ApplianceScan

    job_id = job_dir.name
    try:
        job = ReconstructionJob.objects.get(pk=job_id)
    except ReconstructionJob.DoesNotExist:
        log(f"WARNING: ReconstructionJob {job_id} not found — DB skipped.")
        return

    crops_dir = job_dir / "appliance_crops"
    appliance_objs = []

    for ap in output["appliances"]:
        src = ap.get("source_detection", {})
        crop_file = crops_dir / src.get("crop_file", "")

        appliance = Appliance(
            property=job.property,
            reconstruction_job=job,
            source="panorama",
            detected_class=ap["detected_class"],
            confidence=ap["confidence"] / 100,
            etat_visuel=ap["etat_visuel"],
            age_years=ap.get("age_years"),
            kwh_per_year=ap.get("kwh_per_year"),
            energy_class=ap.get("energy_class", "?"),
            brand=ap.get("brand", "?"),
            technology=ap.get("technology", "inconnu"),
            efficiency_score=ap["efficiency_score"],
            grade=ap["grade"],
            score_details=ap.get("score_details", {}),
            recommendation_text=ap.get("recommendation", ""),
            cubemap_face=src.get("cubemap_face", ""),
            cubemap_bbox=src.get("cubemap_bbox"),
        )
        if crop_file.is_file():
            from django.core.files import File
            with open(crop_file, "rb") as img_f:
                appliance.photo.save(crop_file.name, File(img_f), save=False)
        appliance.save()
        appliance_objs.append(appliance)

    scan = ApplianceScan.objects.create(
        property=job.property,
        reconstruction_job=job,
        global_score=output["global_score"],
        grade=output["global_grade"],
        scores_by_device=output["scores_by_device"],
    )
    scan.appliances.set(appliance_objs)
    log(
        f"DB: ApplianceScan #{scan.pk} created with {len(appliance_objs)} appliance(s) "
        f"(score={scan.global_score}, grade={scan.grade})."
    )
