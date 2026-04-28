import uuid
from pathlib import Path
from django.db import models
from django.conf import settings


class ReconstructionJob(models.Model):
    """
    Tracks every HorizonNet pipeline run.
    Artifacts (PLY, JSON, images) are stored on disk under
    MEDIA_ROOT/jobs/<job_id>/; this model holds metadata and status.
    """

    class State(models.TextChoices):
        QUEUED    = "queued",    "Queued"
        RUNNING   = "running",   "Running"
        COMPLETED = "completed", "Completed"
        FAILED    = "failed",    "Failed"

    id            = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    state         = models.CharField(max_length=16, choices=State.choices, default=State.QUEUED)
    current_step  = models.CharField(max_length=64, default="queued")

    # Pipeline options (stored so /status can echo them back)
    align_panorama  = models.BooleanField(default=True)
    force_cuboid    = models.BooleanField(default=False)
    mesh_stride     = models.IntegerField(default=2)
    ignore_ceiling  = models.BooleanField(default=True)
    checkpoint_path = models.CharField(max_length=512, blank=True)

    # Timing
    created_at   = models.DateTimeField(auto_now_add=True)
    started_at   = models.DateTimeField(null=True, blank=True)
    finished_at  = models.DateTimeField(null=True, blank=True)

    # Results
    mesh_vertices = models.IntegerField(null=True, blank=True)
    mesh_faces    = models.IntegerField(null=True, blank=True)

    # Error info
    error_message = models.TextField(blank=True)
    error_trace   = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]

    def job_dir(self) -> Path:
        """Returns Path to this job's directory under MEDIA_ROOT/jobs/."""
        return Path(settings.MEDIA_ROOT) / "jobs" / str(self.id)

    def input_panorama_path(self) -> Path:
        """Glob the input/ subdir to find panorama.* regardless of extension."""
        candidates = list((self.job_dir() / "input").glob("panorama.*"))
        return candidates[0] if candidates else None

    def layout_json_path(self) -> Path:
        """Return path to layout JSON, if it exists."""
        candidates = list((self.job_dir() / "inferenced").glob("*.json"))
        return candidates[0] if candidates else None

    def ply_path(self) -> Path:
        """Return path to PLY mesh file."""
        return self.job_dir() / "mesh" / "layout_mesh.ply"

    def aligned_image_path(self) -> Path:
        """Return aligned image if preprocessing ran, else fall back to original."""
        p = self.job_dir() / "preprocessed"
        candidates = list(p.glob("*_aligned_rgb.png"))
        if candidates:
            return candidates[0]
        return self.input_panorama_path()

    def __str__(self):
        return f"Job {self.id} [{self.state}]"
