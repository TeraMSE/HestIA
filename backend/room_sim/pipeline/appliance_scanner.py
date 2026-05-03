"""
appliance_scanner.py
────────────────────
Bridge between the 3-D reconstruction pipeline and the Appliance Energy
Scanner (TacheEnergyMaha merged into the `appliances` Django app).

After YOLO-World object detection completes the 6 cubemap face images are
saved to job_dir/cubemap_faces/. This module:

  1. Filters detections for appliance-class objects.
  2. Crops each detection from its cubemap face image (undistorted
     perspective view — better for the CNN than the ERP image).
  3. Saves each crop to job_dir/appliance_crops/.
  4. Runs every crop through ApplianceVisionAgent.analyze_single().
  5. Writes the combined results to job_dir/appliance_scans.json.
  6. Persists Appliance + ApplianceScan DB rows when the job is
     linked to a Property.

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

# YOLO class names (English) -> CNN class names (French)
YOLO_TO_CNN = {
    "refrigerator":    "refrigerateur",
    "air conditioner": "climatiseur",
    "washing machine": "machine_laver",
    "water heater":    "chauffe_eau",
    "ceiling light":   "ampoule",
    "lamp":            "ampoule",
}

MIN_CROP_PX = 48    # smaller crops give unreliable CNN predictions
CROP_PADDING = 24   # pixels added around each bbox before saving


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
        detections: Parsed detections.json content (already in memory).
        faces_dir:  Directory where the 6 cubemap face JPEGs were saved.
        log:        Logging callback that writes to events.log.

    Returns:
        appliance_scans dict written to disk, or None when nothing found.
    """
    # 1. Filter for appliance-class objects
    appliance_hits = [
        d for d in detections.get("detections", [])
        if d["class_name"].lower() in YOLO_TO_CNN
    ]

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
