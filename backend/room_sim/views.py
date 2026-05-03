"""Django views for HorizonNet 3D room simulation API."""
import json
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpRequest, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

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

        # Resolve property FK
        from core.models import Property as PropertyModel
        property_obj = None
        if property_id:
            try:
                property_obj = PropertyModel.objects.get(id=property_id)
            except PropertyModel.DoesNotExist:
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
            "panorama_insights_url": f"/api/jobs/{job.id}/artifact/panorama_insights/",
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
                "panorama_insights_url": f"/api/jobs/{job.id}/artifact/panorama_insights/",
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


def _resolve_panorama_path_for_insights(job: ReconstructionJob):
    """
    Return the first readable panorama on disk (aligned preprocessed, then input/*).
    More defensive than aligned_image_path() alone (case variants, any image in input/).
    """
    import logging

    log = logging.getLogger(__name__)
    jd = job.job_dir()
    if not jd.is_dir():
        log.warning("[insights] job_dir missing: %s", jd)
        return None

    pre = jd / "preprocessed"
    if pre.is_dir():
        for p in sorted(pre.glob("*_aligned_rgb.png"), reverse=True):
            if p.is_file() and p.stat().st_size > 0:
                return p

    inp = jd / "input"
    if not inp.is_dir():
        return None
    for name in (
        "panorama.png",
        "panorama.jpg",
        "panorama.jpeg",
        "panorama.webp",
        "panorama.PNG",
        "panorama.JPG",
    ):
        p = inp / name
        if p.is_file() and p.stat().st_size > 0:
            return p
    for p in sorted(inp.iterdir()):
        if not p.is_file() or p.stat().st_size == 0:
            continue
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
            return p
    return None


@require_GET
def artifact_panorama_insights(request: HttpRequest, job_id: str) -> FileResponse | JsonResponse:
    """GET /api/jobs/<uuid>/artifact/panorama_insights/ — lighting / palette / bright-region JSON."""
    try:
        job = get_object_or_404(ReconstructionJob, pk=job_id)

        if job.state != "completed":
            return JsonResponse({"error": "Job not completed"}, status=409)

        insights_path = job.job_dir() / "panorama_insights.json"
        if not insights_path.is_file():
            src = _resolve_panorama_path_for_insights(job)
            if src is None:
                # Last resort: model helper (glob panorama.*)
                ap = job.aligned_image_path()
                if ap is not None and ap.is_file():
                    src = ap
            if src is None or not src.is_file():
                return JsonResponse(
                    {
                        "error": "No panorama image found under this job (expected input/panorama.* or preprocessed alignment).",
                        "job_dir": str(job.job_dir()),
                    },
                    status=404,
                )
            try:
                from .pipeline.panorama_insights import analyze_panorama_pixels

                data = analyze_panorama_pixels(src)
                insights_path.parent.mkdir(parents=True, exist_ok=True)
                with open(insights_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
            except Exception as e:
                return JsonResponse({"error": repr(e)}, status=500)

        return FileResponse(
            insights_path.open("rb"),
            content_type="application/json",
            as_attachment=False,
        )

    except ReconstructionJob.DoesNotExist:
        return JsonResponse({"error": "Job not found"}, status=404)
