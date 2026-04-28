# HestIA Backend - Django + HorizonNet + 3D Avatar Simulation

This is a Django backend that merges the **HorizonNet 3D room layout estimation** pipeline with the **3D avatar life simulation** system. Users upload panoramic images, the backend generates real 3D room meshes, and agents navigate within those rooms while performing personality-driven activities.

## Architecture

- **Django 5.2** — web framework and API server
- **HorizonNet** — ResNet50 + BiLSTM model for panorama → 3D room layout
- **PyTorch + torchvision** — inference runtime
- **Three.js** — browser-based 3D visualization and avatar animation
- **Threading** — background pipeline jobs (no Celery)

## Project Structure

```
backend/
├── .venv/                          # Python virtual environment
├── requirements.txt                # All Python dependencies
├── manage.py                       # Django CLI
├── db.sqlite3                      # SQLite database (created after first run)
├── hestia/                         # Django project package
│   ├── settings.py                 # Configuration
│   ├── urls.py                     # Root URL routing
│   ├── wsgi.py / asgi.py           # Server entry points
├── room_sim/                       # Main Django app
│   ├── models.py                   # ReconstructionJob DB model
│   ├── views.py                    # API endpoints
│   ├── urls.py                     # App-level routing
│   ├── apps.py                     # App config (resets stale jobs)
│   ├── pipeline/                   # HorizonNet pipeline logic
│   │   ├── runner.py               # Background job execution
│   │   ├── ply_builder.py          # PLY mesh generation
│   │   ├── floor_polygon.py        # Floor polygon derivation for pathfinding
│   │   └── horizonnet/             # Copied & renamed HorizonNet modules
│   │       ├── room_layout_model.py # Model architecture (renamed from model.py)
│   │       ├── inference.py        # Inference runner
│   │       ├── eval_general.py     # Evaluation utils + layout_2_depth()
│   │       ├── dataset.py          # Dataset utilities
│   │       └── misc/               # Post-processing, panorama alignment, utils
│   └── templates/room_sim/
│       └── sim.html                # Merged Three.js frontend
├── checkpoints/
│   └── horizonnet_resnet50_rnn.pth # Pre-trained HorizonNet checkpoint
├── media/                          # User-uploaded files & job artifacts
│   └── jobs/<uuid>/
│       ├── input/panorama.png      # Original uploaded image
│       ├── preprocessed/           # VP-aligned image (if preprocessing ran)
│       ├── inferenced/layout.json  # HorizonNet output (UV corners)
│       └── mesh/layout_mesh.ply    # 3D room mesh (PLY format)
└── static/                         # Web assets
    ├── glb/                        # 3D model files
    │   ├── male_model.glb, female_model.glb
    │   ├── chair.glb, table.glb, tv.glb, shower.glb
    │   └── textures.png
    └── vendor/three/               # Three.js r152+ (ESM modules)
        ├── three.module.js
        └── examples/jsm/
            ├── controls/OrbitControls.js
            ├── loaders/GLTFLoader.js, PLYLoader.js
            └── utils/SkeletonUtils.js
```

## Installation & Setup

### 1. **Ensure Disk Space**
PyTorch is large (~3GB). The current system ran out of disk space during requirements installation. **Free up ~5GB** before proceeding.

### 2. **Install Python Dependencies**

```bash
cd backend
source .venv/bin/activate  # or .\.venv\Scripts\activate on Windows
pip install -r requirements.txt
```

**Note:** If installation fails due to disk space, you can install PyTorch separately or skip it for now:
```bash
pip install Django Pillow numpy scipy scikit-learn shapely tqdm opencv-python requests
# Then later, when you have space:
pip install torch torchvision  # (or --index-url https://download.pytorch.org/whl/cpu for CPU)
```

### 3. **Run Migrations**

```bash
python manage.py makemigrations room_sim
python manage.py migrate
```

This creates the SQLite database and `ReconstructionJob` table.

### 4. **Collect Static Files** (optional, for production)

```bash
python manage.py collectstatic --noinput
```

### 5. **Start Development Server**

```bash
python manage.py runserver 0.0.0.0:8000
```

Open **http://localhost:8000/** in a browser.

## API Overview

### Job Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Render the merged Three.js simulation page |
| `/api/jobs/start/` | POST | Upload panorama, create job, return job_id |
| `/api/jobs/<uuid>/status/` | GET | Get job state, current step, logs tail, mesh info |
| `/api/jobs/<uuid>/events/` | GET | Get raw events.log text |

### Artifact Downloads

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jobs/<uuid>/artifact/mesh/` | GET | Download layout_mesh.ply |
| `/api/jobs/<uuid>/artifact/layout/` | GET | Download layout.json (UV corners) |
| `/api/jobs/<uuid>/artifact/panorama/` | GET | Download aligned/original panorama |
| `/api/jobs/<uuid>/floor_polygon/` | GET | Get floor polygon JSON for pathfinding |

### Example: Upload & Process

```bash
curl -X POST http://localhost:8000/api/jobs/start/ \
  -F "image=@my_panorama.jpg" \
  -F "align_panorama=true" \
  -F "mesh_stride=2" \
  -F "ignore_ceiling=true"

# Response:
# {
#   "job_id": "550e8400-e29b-41d4-a716-446655440000",
#   "status_url": "/api/jobs/550e8400.../status/",
#   "events_url": "/api/jobs/550e8400.../events/"
# }

# Poll for completion:
curl http://localhost:8000/api/jobs/550e8400-e29b-41d4-a716-446655440000/status/
```

## How It Works

### Frontend (Three.js)

1. User uploads a panoramic image (equirectangular)
2. Click "Generate Room" → POST to `/api/jobs/start/`
3. Frontend polls `/api/jobs/<id>/status/` every 1.5s
4. When pipeline completes:
   - Fetch `/api/jobs/<id>/artifact/mesh/` (PLY file)
   - Load PLY into Three.js scene with `PLYLoader`
   - Fetch `/api/jobs/<id>/floor_polygon/` (JSON polygon)
   - Initialize room environment with floor polygon for pathfinding
5. User can now add agents (male/female avatars) that navigate within the real room

### Backend Pipeline (3 Steps)

1. **Preprocess** (optional)
   - If `align_panorama=true`: detect vanishing points via pylsd-nova, rotate panorama
   - Fallback: simple 1024×512 resize if VP detection unavailable
   - Output: `preprocessed/<stem>_aligned_rgb.png`

2. **Inference**
   - Load HorizonNet (ResNet50 + BiLSTM) from checkpoint
   - Forward pass on 512×1024 panorama → layout (UV corner coordinates)
   - Output: `inferenced/<stem>.json`

3. **Meshing**
   - Read layout JSON + original panorama image
   - Use `layout_2_depth()` to compute per-pixel depth map
   - Unproject to XYZ using spherical coordinates
   - Write PLY mesh with per-vertex RGB color from panorama
   - Output: `mesh/layout_mesh.ply`

All steps run in a **background thread** (no Celery); a `threading.Semaphore(1)` serializes jobs (single GPU).

### Threading Model

- **Main thread** (Django request handler): saves upload, creates DB row, spawns background thread, returns 202
- **Background thread**: runs pipeline steps, updates DB row after each step, appends to events.log
- **Frontend**: polls `/status/` every 1.5s until `state == "completed"` or `"failed"`
- If server crashes during a job, `apps.py` resets stale `running` jobs to `failed` on next startup

## Coordinate Systems

| System | X | Y | Z | Scale | Used For |
|--------|---|---|---|-------|----------|
| HorizonNet output (PLY) | right | up | into screen | 1 unit = 1 metre | Raw mesh export |
| Three.js scene | right | up | toward viewer | configurable | Browser rendering |
| engine3d simulation | right | (unused) | down | 1 unit = 1/40 metre | Agent positions & logic |

**Key Conversion:**
- PLY mesh is loaded at native scale (metres) and multiplied by `_worldScale = 10.0` for comfortable viewport viewing
- Agent positions remain in simulation units (GRID), which should be recalibrated to `1 unit = 1 metre` to match real room scale

## Database Schema

### ReconstructionJob

```python
id              UUID (primary key)
state           'queued' | 'running' | 'completed' | 'failed'
current_step    'preprocess' | 'inference' | 'meshing' | ...
created_at      datetime
started_at      datetime (null until running)
finished_at     datetime (null until done)
align_panorama  bool
force_cuboid    bool
mesh_stride     int
ignore_ceiling  bool
checkpoint_path str (optional custom path)
mesh_vertices   int (null until completed)
mesh_faces      int (null until completed)
error_message   str (empty unless failed)
error_trace     str (full traceback if failed)
```

No authentication or user tracking; all jobs are public for now (suitable for local/trusted environments).

## Known Limitations & TODOs

### Current State
✅ Django project structure created  
✅ HorizonNet files copied & organized  
✅ Models, views, URLs, settings configured  
✅ Pipeline runner with threading  
✅ Three.js template with panorama upload UI  
✅ All API endpoints defined  

### Still Needed
❌ **PyTorch installation** — disk space issue; needs manual `pip install torch torchvision` once space is freed  
❌ **Run migrations** — blocked by PyTorch not being installed  
❌ **Full Three.js frontend** — template is a skeleton; needs implementation of:
  - `RoomEnvironment` class (PLY loading, polygon containment, pathfinding)
  - `PipelineClient` class (upload, polling, callback handling)
  - Integration with existing AnimationIntelligence avatar logic
  - Point-in-polygon tests, agent clamping to floor boundaries
  - Camera controls, agent selection/interaction UI
❌ **Test with real panorama image** — verify end-to-end pipeline  
❌ **Performance tuning** — mesh downsampling, browser limits with large PLY files  
❌ **Error handling in UI** — better UX for failed uploads, network issues  
❌ **Merge with React frontend** — this is the temporary Django template; later integrate into the main frontend

## Configuration

Edit `hestia/settings.py` to customize:

```python
CHECKPOINT_PATH = BASE_DIR / "checkpoints" / "horizonnet_resnet50_rnn.pth"
MEDIA_ROOT = BASE_DIR / "media"  # Where job artifacts are stored
STATIC_URL = "/static/"
PIPELINE_MAX_WORKERS = 1  # Max concurrent jobs (GPU-bound)
```

For production, configure:
- `DEBUG = False`
- `ALLOWED_HOSTS = ['yourdomain.com', ...]`
- `DATABASES` for PostgreSQL/MySQL instead of SQLite
- `STATIC_ROOT` and a web server to serve static files

## Debugging

### Check Job Status
```bash
python manage.py shell
from room_sim.models import ReconstructionJob
job = ReconstructionJob.objects.first()
print(job.state, job.current_step, job.error_message)
```

### View Job Artifacts
```bash
ls media/jobs/<uuid>/
cat media/jobs/<uuid>/events.log  # See all pipeline logs
```

### Browser Console
Open DevTools → Console to see Three.js warnings/errors.

## Requirements.txt

```
Django>=4.2,<5.0
Pillow>=10.0.0
torch>=2.0.0
torchvision>=0.15.0
numpy>=1.24.0
scipy>=1.10.0
shapely>=2.0.0
scikit-learn>=1.2.0
tqdm>=4.65.0
pylsd-nova>=1.2.0
opencv-python>=4.7.0
requests>=2.28.0
```

**Note:** `pylsd-nova` is optional; if missing, panorama preprocessing falls back to simple resizing.

## Next Steps

1. **Free disk space** and install remaining dependencies
2. **Run migrations** and test the API with sample panoramas
3. **Implement full Three.js frontend** in `sim.html` (RoomEnvironment + PipelineClient classes)
4. **Integrate agent logic** — merge avatar system from engine3d.html with floor polygon pathfinding
5. **Test with React frontend** — later wire up this Django backend to the main React app

## References

- Plan: `C:\Users\taher\.claude\plans\hi-starry-rossum.md`
- Original 3D simulation: `3D-Environment-Simulation-for-different-personnalities-/engine3d.html`
- Original HorizonNet webapp: `HorizonNet-master/webapp/app.py`
- Three.js docs: https://threejs.org/docs/
- Django docs: https://docs.djangoproject.com/en/5.2/
