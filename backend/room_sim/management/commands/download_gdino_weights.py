"""
Management command: download_gdino_weights

Pre-downloads Grounding DINO model weights + config to the local cache
so they are ready before any pipeline job runs.

Usage:
    python manage.py download_gdino_weights
    python manage.py download_gdino_weights --force   # re-download even if cached
"""

import socket
import urllib.request
from pathlib import Path

from django.core.management.base import BaseCommand


_WEIGHTS_URL = (
    "https://github.com/IDEA-Research/GroundingDINO/releases/download/"
    "v0.1.0-alpha/groundingdino_swint_ogc.pth"
)
_CONFIG_URL = (
    "https://raw.githubusercontent.com/IDEA-Research/GroundingDINO/main/"
    "groundingdino/config/GroundingDINO_SwinT_OGC.py"
)
_WEIGHTS_SIZE = 694_000_000   # ~694 MB


class _ProgressBar:
    def __init__(self, label: str, stdout):
        self.label = label
        self.stdout = stdout
        self._last_pct = -1

    def __call__(self, block_num: int, block_size: int, total_size: int) -> None:
        if total_size <= 0:
            return
        pct = min(int(block_num * block_size * 100 / total_size), 100)
        if pct != self._last_pct and pct % 5 == 0:
            self.stdout.write(f"  {self.label}: {pct}%")
            self._last_pct = pct


def _download(url: str, dest: Path, label: str, force: bool, stdout, timeout: int = 600) -> bool:
    """Download url → dest. Returns True if downloaded, False if already cached."""
    if dest.exists() and dest.stat().st_size > 10_000 and not force:
        stdout.write(f"  OK {dest.name} already cached ({dest.stat().st_size // 1_048_576} MB)")
        return False

    tmp = dest.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    stdout.write(f"  -> Downloading {label} from GitHub…")
    old_timeout = socket.getdefaulttimeout()
    try:
        socket.setdefaulttimeout(timeout)
        urllib.request.urlretrieve(url, tmp, reporthook=_ProgressBar(label, stdout))
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Download failed: {exc}") from exc
    finally:
        socket.setdefaulttimeout(old_timeout)

    tmp.replace(dest)
    stdout.write(f"  OK {dest.name} ready ({dest.stat().st_size // 1_048_576} MB)")
    return True


class Command(BaseCommand):
    help = "Pre-download Grounding DINO weights to ~/.cache/groundingdino/"

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-download even if already cached",
        )
        parser.add_argument(
            "--cache-dir",
            default=str(Path.home() / ".cache" / "groundingdino"),
            help="Override cache directory (default: ~/.cache/groundingdino)",
        )

    def handle(self, *args, **options):
        import os
        cache_dir = Path(options["cache_dir"])
        force = options["force"]

        self.stdout.write(self.style.SUCCESS(f"Grounding DINO weight downloader"))
        self.stdout.write(f"Cache directory: {cache_dir}")

        # Check groundingdino-py is installed
        try:
            import groundingdino  # noqa: F401
        except ImportError:
            self.stderr.write(self.style.ERROR(
                "groundingdino-py is not installed.\n"
                "Run: pip install groundingdino-py"
            ))
            return

        # Delete incomplete files (< 80% of expected size)
        weights_path = cache_dir / "groundingdino_swint_ogc.pth"
        if weights_path.exists() and weights_path.stat().st_size < _WEIGHTS_SIZE * 0.8:
            size_mb = weights_path.stat().st_size // 1_048_576
            self.stdout.write(
                self.style.WARNING(f"  ! Found incomplete weights file ({size_mb} MB / ~694 MB) — deleting.")
            )
            weights_path.unlink()
            force = True  # force re-download

        try:
            _download(_CONFIG_URL, cache_dir / "GroundingDINO_SwinT_OGC.py", "config", force, self.stdout, timeout=30)
            _download(_WEIGHTS_URL, weights_path, "weights (~694 MB)", force, self.stdout, timeout=900)
        except RuntimeError as exc:
            self.stderr.write(self.style.ERROR(str(exc)))
            return

        self.stdout.write(self.style.SUCCESS("\nAll Grounding DINO assets ready. You can now run jobs with DETECTOR_BACKEND=gdino."))


