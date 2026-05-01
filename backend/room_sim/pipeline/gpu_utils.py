"""
GPU device selection utilities.

Selects the dedicated NVIDIA GPU on laptops/desktops that have both an
integrated GPU (Intel/AMD) and a discrete NVIDIA GPU.  Falls back to
the first CUDA device, then to CPU.

NOTE: Task Manager on laptops (NVIDIA Optimus) shows TWO GPU rows:
  - iGPU  (Intel UHD / Iris Xe) — handles display, browser WebGL / Three.js
  - dGPU  (NVIDIA RTX/GTX)      — handles CUDA / PyTorch inference
Seeing activity on the iGPU row while doing 3D simulation is EXPECTED;
the browser's WebGL engine always renders on the iGPU on Optimus laptops.
Python/PyTorch CUDA workloads appear on the dGPU "Compute" row.
"""
import os

# Keywords that identify discrete NVIDIA GPUs
_NVIDIA_KEYWORDS = ("nvidia", "geforce", "rtx", "gtx", "quadro", "tesla", "a100", "v100")

# Keywords that identify integrated / non-discrete GPUs to skip
_SKIP_KEYWORDS = ("intel", "llvmpipe", "software")


def get_dedicated_device() -> "torch.device":  # type: ignore[name-defined]
    """
    Return a :class:`torch.device` pointing to the dedicated NVIDIA GPU.
    """
    import torch  # late import so this module can be imported without torch

    # Force PCI bus ordering so cuda:0 is the discrete card when present
    os.environ.setdefault("CUDA_DEVICE_ORDER", "PCI_BUS_ID")

    if not torch.cuda.is_available():
        print("[GPU] CUDA not available — using CPU.")
        return torch.device("cpu")

    n = torch.cuda.device_count()
    print(f"[GPU] {n} CUDA device(s) found:")
    for i in range(n):
        print(f"[GPU]   cuda:{i} → {torch.cuda.get_device_name(i)}")

    dedicated_idx: int | None = None
    for i in range(n):
        name = torch.cuda.get_device_name(i).lower()
        is_nvidia = any(kw in name for kw in _NVIDIA_KEYWORDS)
        is_integrated = any(kw in name for kw in _SKIP_KEYWORDS)
        if is_nvidia and not is_integrated:
            dedicated_idx = i
            break

    if dedicated_idx is None:
        dedicated_idx = 0
        print(f"[GPU] WARNING: Could not identify discrete NVIDIA GPU; defaulting to cuda:0 ({torch.cuda.get_device_name(0)}).")

    device = torch.device(f"cuda:{dedicated_idx}")
    torch.cuda.set_device(device)
    mem_gb = torch.cuda.get_device_properties(dedicated_idx).total_memory / 1024**3
    print(f"[GPU] ✓ Selected: {device} — {torch.cuda.get_device_name(dedicated_idx)} ({mem_gb:.1f} GB VRAM)")
    return device


# Module-level singleton — resolved once, reused throughout the process
_DEVICE: "torch.device | None" = None  # type: ignore[name-defined]


def get_device() -> "torch.device":  # type: ignore[name-defined]
    """Cached version of :func:`get_dedicated_device`."""
    global _DEVICE
    if _DEVICE is None:
        _DEVICE = get_dedicated_device()
    return _DEVICE
