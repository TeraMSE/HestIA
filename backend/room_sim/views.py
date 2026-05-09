"""Django views for HorizonNet 3D room simulation API."""
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .models import ReconstructionJob
from .pipeline.runner import submit_pipeline_job
from .pipeline.floor_polygon import derive_floor_polygon


@require_GET
def sim_page(request: HttpRequest):
    """Render the merged Three.js simulation page."""
    return render(request, "room_sim/sim.html", {
        "static_url": settings.STATIC_URL,
    })


@csrf_exempt
@require_POST
def job_start(request: HttpRequest) -> JsonResponse:
    """
    POST multipart/form-data with image and options.
    Creates job, saves panorama, dispatches background thread.
    Returns 202 with job_id.
    """
    try:
        image_file = request.FILES.get("image")
        if not image_file:
            return JsonResponse({"error": "Missing 'image' file"}, status=400)

        suffix = Path(image_file.name).suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
            return JsonResponse({"error": "Only png/jpg/jpeg/webp allowed"}, status=400)

        align_panorama = request.POST.get("align_panorama", "true").lower() == "true"
        force_cuboid = request.POST.get("force_cuboid", "false").lower() == "true"
        mesh_stride = int(request.POST.get("mesh_stride", "2"))
        ignore_ceiling = request.POST.get("ignore_ceiling", "true").lower() == "true"
        checkpoint = request.POST.get("checkpoint", "")
        property_id = request.POST.get("property_id", "")

        # Resolve property FK (only attempt if property_id looks numeric)
        from core.models import Property as PropertyModel
        property_obj = None
        if property_id and property_id.isdigit():
            try:
                property_obj = PropertyModel.objects.get(id=int(property_id))
            except (PropertyModel.DoesNotExist, ValueError):
                pass

        job = ReconstructionJob.objects.create(
            state="queued",
            current_step="queued",
            align_panorama=align_panorama,
            force_cuboid=force_cuboid,
            mesh_stride=mesh_stride,
            ignore_ceiling=ignore_ceiling,
            checkpoint_path=checkpoint,
            property=property_obj,
        )

        job_dir = job.job_dir()
        input_dir = job_dir / "input"
        input_dir.mkdir(parents=True, exist_ok=True)
        input_path = input_dir / f"panorama{suffix}"

        with input_path.open("wb") as f:
            for chunk in image_file.chunks():
                f.write(chunk)

        ckpt_path = settings.CHECKPOINT_PATH
        if checkpoint:
            ckpt_path = Path(checkpoint)
            if not ckpt_path.is_absolute():
                ckpt_path = settings.BASE_DIR / ckpt_path
        if not ckpt_path.is_file():
            job.state = "failed"
            job.error_message = f"Checkpoint not found: {ckpt_path}"
            job.save()
            return JsonResponse({"error": job.error_message}, status=400)

        submit_pipeline_job(str(job.id), ckpt_path)

        return JsonResponse(
            {
                "job_id": str(job.id),
                "status_url": f"/api/jobs/{job.id}/status/",
                "events_url": f"/api/jobs/{job.id}/events/",
            },
            status=202,
        )

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@require_GET
def property_job_status(request: HttpRequest, property_id: int) -> JsonResponse:
    """
    GET /api/jobs/property/<property_id>/ — Returns the latest completed
    ReconstructionJob for a given property, or 404 if none exists.
    This allows any user to load the shared 3D world for a property.
    """
    job = (
        ReconstructionJob.objects
        .filter(property_id=property_id, state="completed")
        .order_by("-finished_at")
        .first()
    )
    if not job:
        return JsonResponse({"error": "No completed 3D world for this property"}, status=404)

    from core.models import Property as PropertyModel
    try:
        prop = PropertyModel.objects.get(id=property_id)
        owner_id = prop.owner_id
    except PropertyModel.DoesNotExist:
        owner_id = None

    return JsonResponse({
        "job_id": str(job.id),
        "state": job.state,
        "owner_id": owner_id,
        "artifacts": {
            "mesh_url": f"/api/jobs/{job.id}/artifact/mesh/",
            "layout_url": f"/api/jobs/{job.id}/artifact/layout/",
            "panorama_url": f"/api/jobs/{job.id}/artifact/panorama/",
            "floor_polygon_url": f"/api/jobs/{job.id}/floor_polygon/",
            "detections_url": f"/api/jobs/{job.id}/artifact/detections/",
        },
    })


@require_GET
def job_status(request: HttpRequest, job_id: str) -> JsonResponse:
    """GET /api/jobs/<uuid>/status/ - Job status and logs."""
    try:
        job = get_object_or_404(ReconstructionJob, pk=job_id)
        max_log_lines = int(request.GET.get("max_log_lines", "80"))

        events_path = job.job_dir() / "events.log"
        logs_tail = []
        if events_path.is_file():
            lines = events_path.read_text(encoding="utf-8", errors="replace").splitlines()
            logs_tail = lines[-max(1, max_log_lines):]

        response_data = {
            "job_id": str(job.id),
            "state": job.state,
            "current_step": job.current_step,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None,
            "logs_tail": logs_tail,
        }

        if job.mesh_vertices is not None:
            response_data["mesh_info"] = {
                "vertices": job.mesh_vertices,
                "faces": job.mesh_faces,
                "stride": job.mesh_stride,
            }

        if job.state == "completed":
            response_data["artifacts"] = {
                "mesh_url": f"/api/jobs/{job.id}/artifact/mesh/",
                "layout_url": f"/api/jobs/{job.id}/artifact/layout/",
                "panorama_url": f"/api/jobs/{job.id}/artifact/panorama/",
                "floor_polygon_url": f"/api/jobs/{job.id}/floor_polygon/",
                "detections_url": f"/api/jobs/{job.id}/artifact/detections/",
            }

        if job.state == "failed":
            response_data["error"] = job.error_message

        return JsonResponse(response_data)

    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found"}, status=404)


@require_GET
def job_events(request: HttpRequest, job_id: str):
    """GET /api/jobs/<uuid>/events/ - Raw events log."""
    try:
        job = get_object_or_404(ReconstructionJob, pk=job_id)
        events_path = job.job_dir() / "events.log"

        if not events_path.is_file():
            return JsonResponse({"events": ""})

        content = events_path.read_text(encoding="utf-8", errors="replace")
        return JsonResponse({"events": content})

    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found"}, status=404)


@require_GET
def artifact_mesh(request: HttpRequest, job_id: str) -> FileResponse:
    """GET /api/jobs/<uuid>/artifact/mesh/ - Download PLY."""
    try:
        job = get_object_or_404(ReconstructionJob, pk=job_id)

        if job.state != "completed":
            return JsonResponse({"error": "Job not completed"}, status=409)

        ply_path = job.ply_path()
        if not ply_path.is_file():
            return JsonResponse({"error": "Mesh not found"}, status=404)

        return FileResponse(
            ply_path.open("rb"),
            content_type="application/octet-stream",
            as_attachment=False,
        )

    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found"}, status=404)


@require_GET
def artifact_layout(request: HttpRequest, job_id: str) -> FileResponse:
    """GET /api/jobs/<uuid>/artifact/layout/ - Download JSON."""
    try:
        job = get_object_or_404(ReconstructionJob, pk=job_id)

        if job.state != "completed":
            return JsonResponse({"error": "Job not completed"}, status=409)

        layout_path = job.layout_json_path()
        if not layout_path or not layout_path.is_file():
            return JsonResponse({"error": "Layout not found"}, status=404)

        return FileResponse(
            layout_path.open("rb"),
            content_type="application/json",
            as_attachment=False,
        )

    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found"}, status=404)


@require_GET
def artifact_panorama(request: HttpRequest, job_id: str) -> FileResponse:
    """GET /api/jobs/<uuid>/artifact/panorama/ - Download panorama."""
    try:
        job = get_object_or_404(ReconstructionJob, pk=job_id)

        if job.state != "completed":
            return JsonResponse({"error": "Job not completed"}, status=409)

        pano_path = job.aligned_image_path()
        if not pano_path or not pano_path.is_file():
            return JsonResponse({"error": "Panorama not found"}, status=404)

        suffix = pano_path.suffix.lower()
        if suffix in {".jpg", ".jpeg"}:
            content_type = "image/jpeg"
        elif suffix == ".png":
            content_type = "image/png"
        else:
            content_type = "image/webp"

        return FileResponse(
            pano_path.open("rb"),
            content_type=content_type,
            as_attachment=False,
        )

    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found"}, status=404)


@require_GET
def floor_polygon(request: HttpRequest, job_id: str) -> JsonResponse:
    """GET /api/jobs/<uuid>/floor_polygon/ - Floor polygon for pathfinding."""
    try:
        job = get_object_or_404(ReconstructionJob, pk=job_id)

        if job.state != "completed":
            return JsonResponse({"error": "Job not completed"}, status=409)

        layout_path = job.layout_json_path()
        if not layout_path or not layout_path.is_file():
            return JsonResponse({"error": "Layout not found"}, status=404)

        polygon = derive_floor_polygon(layout_path)

        return JsonResponse({
            "job_id": str(job.id),
            "floor_polygon": polygon,
        })

    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@require_GET
def artifact_detections(request: HttpRequest, job_id: str) -> FileResponse:
    """GET /api/jobs/<uuid>/artifact/detections/ - Download detections JSON."""
    try:
        job = get_object_or_404(ReconstructionJob, pk=job_id)

        if job.state != "completed":
            return JsonResponse({"error": "Job not completed"}, status=409)

        detections_path = job.job_dir() / "detections.json"
        if not detections_path.is_file():
            return JsonResponse({"error": "Detections not found"}, status=404)

        return FileResponse(
            detections_path.open("rb"),
            content_type="application/json",
            as_attachment=False,
        )

    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found"}, status=404)


@csrf_exempt
@require_http_methods(["DELETE"])
def job_delete(request: HttpRequest, job_id: str) -> JsonResponse:
    """
    DELETE /api/jobs/<uuid>/delete/

    Deletes the ReconstructionJob (and its on-disk artifacts) only if the
    authenticated user owns the property the job is linked to.
    Returns 204 No Content on success.
    """
    # Authenticate via JWT
    from rest_framework_simplejwt.authentication import JWTAuthentication
    from rest_framework.exceptions import AuthenticationFailed
    try:
        auth = JWTAuthentication()
        result = auth.authenticate(request)
        if result is None:
            return JsonResponse({"error": "Authentication required."}, status=401)
        auth_user, _ = result
    except AuthenticationFailed as exc:
        return JsonResponse({"error": str(exc)}, status=401)

    try:
        job = ReconstructionJob.objects.get(pk=job_id)
    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found."}, status=404)

    # Ownership check: job must be linked to a property owned by the requester
    if job.property is None or job.property.owner != auth_user:
        return JsonResponse(
            {"error": "You do not have permission to delete this 3D world."},
            status=403,
        )

    # Delete on-disk artifacts first (best-effort)
    job_dir = job.job_dir()
    if job_dir.exists():
        try:
            shutil.rmtree(job_dir)
        except Exception as exc:
            pass  # Don't block DB deletion if disk cleanup fails

    job.delete()
    return JsonResponse({"deleted": str(job_id)}, status=200)


@require_GET
def artifact_appliance_scans(request: HttpRequest, job_id: str) -> FileResponse:
    """GET /api/jobs/<uuid>/artifact/appliance_scans/ - Download appliance scan JSON."""
    try:
        job = get_object_or_404(ReconstructionJob, pk=job_id)

        scans_path = job.job_dir() / "appliance_scans.json"
        if not scans_path.is_file():
            return JsonResponse(
                {"error": "Appliance scans not found — no appliances detected or scan not yet run."},
                status=404,
            )

        return FileResponse(
            scans_path.open("rb"),
            content_type="application/json",
            as_attachment=False,
        )

    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found"}, status=404)


CUBEMAP_FACES = {"front", "back", "left", "right", "top", "bottom"}


@require_GET
def artifact_cubemap_face(request: HttpRequest, job_id: str, face_name: str) -> FileResponse:
    """GET /api/jobs/<uuid>/artifact/face/<face_name>/ - Serve one cubemap face JPEG."""
    if face_name not in CUBEMAP_FACES:
        return JsonResponse(
            {"error": f"Invalid face. Choose from: {sorted(CUBEMAP_FACES)}"},
            status=400,
        )
    job = get_object_or_404(ReconstructionJob, pk=job_id)
    face_path = job.job_dir() / "cubemap_faces" / f"{face_name}.jpg"
    if not face_path.is_file():
        return JsonResponse(
            {"error": f"Face '{face_name}' not found — run 3D reconstruction first."},
            status=404,
        )
    return FileResponse(face_path.open("rb"), content_type="image/jpeg")


# ---------------------------------------------------------------------------
# Window detection endpoint
# ---------------------------------------------------------------------------

_FACE_NORM = {
    "front": "front", "f": "front",
    "back": "back", "b": "back", "rear": "back",
    "left": "left", "l": "left",
    "right": "right", "r": "right",
    "top": "top", "bottom": "bottom", "up": "top", "down": "bottom",
}

_WALL_FACES = ("front", "back", "left", "right")


def _build_window_entry(face_norm: str, x1: float, y1: float, x2: float, y2: float,
                        conf: float, fw: int, fh: int, job_id: str) -> dict:
    return {
        "face":           face_norm,
        "cx":             round(((x1 + x2) / 2) / fw, 4),
        "cy":             round(((y1 + y2) / 2) / fh, 4),
        "width":          round((x2 - x1) / fw, 4),
        "height":         round((y2 - y1) / fh, 4),
        "confidence":     round(float(conf), 4),
        "face_image_url": f"/api/jobs/{job_id}/artifact/face/{face_norm}/",
        "bbox_px":        [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
    }


def _face_size(face_path) -> tuple:
    """Return (width, height) of a face image; defaults to 1024×1024."""
    fw, fh = 1024, 1024
    if face_path.is_file():
        try:
            import cv2 as _cv2
            img = _cv2.imread(str(face_path))
            if img is not None:
                fh, fw = img.shape[:2]
        except Exception:
            pass
    return fw, fh


def _run_fresh_window_detection(job_dir, job_id: str) -> list:
    """
    Fallback window detector: runs YOLO-World (yolov8x-worldv2.pt) constrained
    to ["window"] on the 4 wall cubemap faces.

    The main pipeline now uses best.pt (closed-vocab), which already outputs a
    "window" class.  This fallback is only reached when detections.json has no
    window entries at all.
    """
    import cv2
    from room_sim.pipeline.cv.detector import OpenVocabDetector

    ckpt = Path(settings.BASE_DIR) / "checkpoints" / "yolov8x-worldv2.pt"
    if not ckpt.is_file():
        # fall back to smaller model
        ckpt = Path(settings.BASE_DIR) / "checkpoints" / "yolov8s-world.pt"
    if not ckpt.is_file():
        return []

    detector = OpenVocabDetector(str(ckpt), ["window"])
    faces_dir = job_dir / "cubemap_faces"
    windows = []

    for face_name in _WALL_FACES:
        face_path = faces_dir / f"{face_name}.jpg"
        if not face_path.is_file():
            continue
        img = cv2.imread(str(face_path))
        if img is None:
            continue
        fw, fh = img.shape[1], img.shape[0]
        dets = detector.detect(img, face_name, conf_threshold=0.20)
        for d in dets:
            # Filter by class_name in case the detector returns other classes
            if d.get("class_name", "").lower() != "window":
                continue
            x1, y1, x2, y2 = d["cubemap_bbox"]
            windows.append(_build_window_entry(face_name, x1, y1, x2, y2,
                                               d["confidence_score"], fw, fh, job_id))

    return windows


@csrf_exempt
@require_POST
def window_scan_from_job(request: HttpRequest, job_id: str) -> JsonResponse:
    """
    POST /api/windows/scan-from-job/<job_id>/

    Returns window detections with face-image URLs for Three.js texture mapping.
    Fast path: reads existing detections.json.
    Fallback: runs fresh YOLO detection on face images using checkpoint model.
    Response: {"windows": [{"face", "cx", "cy", "width", "height", "confidence",
                             "face_image_url", "bbox_px"}]}
    """
    try:
        job = ReconstructionJob.objects.get(pk=job_id)
    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"detail": "Job not found."}, status=404)

    if job.state != "completed":
        return JsonResponse({"detail": f"Job not completed (state: {job.state})."}, status=409)

    job_dir = job.job_dir()
    cache_path = job_dir / "window_scans.json"

    # Return cache only if it already has the enriched face_image_url field
    if cache_path.is_file():
        with open(cache_path, encoding="utf-8") as f:
            cached = json.load(f)
        entries = cached.get("windows", [])
        if not entries or "face_image_url" in entries[0]:
            return JsonResponse(cached)
        # Old cache format — rebuild below
        cache_path.unlink(missing_ok=True)

    # --- Fast path: filter existing detections.json ---
    windows = []
    detections_path = job_dir / "detections.json"
    if detections_path.is_file():
        with open(detections_path, encoding="utf-8") as f:
            detections_data = json.load(f)

        faces_dir = job_dir / "cubemap_faces"
        face_sizes: dict = {}

        for det in detections_data.get("detections", []):
            if det.get("class_name", "").lower() != "window":
                continue
            face_raw = det.get("cubemap_face", "")
            face_norm = _FACE_NORM.get(face_raw.lower(), face_raw)
            if face_norm not in _WALL_FACES:
                continue
            bbox = det.get("cubemap_bbox")
            if not bbox or len(bbox) < 4:
                continue
            if face_norm not in face_sizes:
                face_sizes[face_norm] = _face_size(faces_dir / f"{face_norm}.jpg")
            fw, fh = face_sizes[face_norm]
            x1, y1, x2, y2 = bbox
            windows.append(_build_window_entry(face_norm, x1, y1, x2, y2,
                                               det.get("confidence_score", 0.5),
                                               fw, fh, str(job_id)))

    # --- Fallback: run fresh YOLO detection on face images ---
    if not windows:
        windows = _run_fresh_window_detection(job_dir, str(job_id))

    result = {"windows": windows}
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    return JsonResponse(result)
