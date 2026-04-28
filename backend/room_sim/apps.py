from django.apps import AppConfig


class RoomSimConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "room_sim"

    def ready(self):
        """Connect startup signal to reset stale jobs after DB is ready."""
        from django.db.models.signals import post_migrate
        post_migrate.connect(_reset_stale_jobs, sender=self)


def _reset_stale_jobs(sender, **kwargs):
    """Reset any jobs stuck in 'running' state from a previous crashed server."""
    try:
        from room_sim.models import ReconstructionJob
        ReconstructionJob.objects.filter(state="running").update(
            state="failed",
            error_message="Server restarted while job was running.",
        )
    except Exception:
        pass
