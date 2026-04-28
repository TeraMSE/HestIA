# Backend Setup Status

## ✅ Completed

### Django Project Structure
- [x] Created `backend/` directory with `.venv` Python virtual environment
- [x] Initialized Django 5.2 project (`hestia/`) and app (`room_sim/`)
- [x] Configured `settings.py` with INSTALLED_APPS, MEDIA_ROOT, STATIC_ROOT, etc.
- [x] Set up URL routing in `hestia/urls.py` and `room_sim/urls.py`

### Database & Models
- [x] Created `ReconstructionJob` Django model with all required fields
  - UUID primary key
  - State machine (queued, running, completed, failed)
  - Pipeline options (align_panorama, force_cuboid, mesh_stride, ignore_ceiling)
  - Timing (created_at, started_at, finished_at)
  - Results (mesh_vertices, mesh_faces)
  - Error tracking (error_message, error_trace)
  - Helper methods (job_dir, input_panorama_path, layout_json_path, ply_path, etc.)

### API Views & Routing
- [x] **8 API endpoints** fully implemented in `views.py`:
  - `GET /` — renders sim.html
  - `POST /api/jobs/start/` — upload panorama, create job, start background thread
  - `GET /api/jobs/<uuid>/status/` — job state, current step, logs, artifacts
  - `GET /api/jobs/<uuid>/events/` — raw events.log
  - `GET /api/jobs/<uuid>/artifact/mesh/` — download PLY
  - `GET /api/jobs/<uuid>/artifact/layout/` — download JSON
  - `GET /api/jobs/<uuid>/artifact/panorama/` — download image
  - `GET /api/jobs/<uuid>/floor_polygon/` — get floor polygon for pathfinding

### Pipeline Infrastructure
- [x] **PipelineRunner** class in `pipeline/runner.py`
  - Executes in background thread
  - 3-step pipeline: preprocess → inference → meshing
  - Thread-safe DB updates using `Model.objects.filter().update()`
  - Graceful error handling with full traceback logging
  - Events.log for live frontend polling

- [x] **PLY Builder** (`pipeline/ply_builder.py`)
  - Extracted from HorizonNet FastAPI app
  - Converts layout JSON + panorama → 3D mesh
  - Handles stride downsampling for browser performance

- [x] **Floor Polygon** (`pipeline/floor_polygon.py`)
  - Derives navigable floor polygon from layout corners
  - Used for agent pathfinding

### Static Assets
- [x] Copied **GLB models** from `3D-Environment-Simulation-for-different-personnalities-/source/`
  - male_model.glb, female_model.glb
  - chair.glb, table.glb, tv.glb, shower.glb
  - textures.png

- [x] Copied **Three.js vendor** from `HorizonNet-master/webapp/static/vendor/three/`
  - three.module.js (r152+)
  - controls/OrbitControls.js
  - loaders/GLTFLoader.js, PLYLoader.js
  - utils/SkeletonUtils.js

- [x] Copied **HorizonNet checkpoint**
  - Renamed `epoch_2 (2).pth` → `horizonnet_resnet50_rnn.pth`

### HorizonNet Integration
- [x] Copied & organized HorizonNet source code:
  - `model.py` → `room_layout_model.py`
  - `inference.py`, `eval_general.py`, `preprocess.py`, `dataset.py`
  - `misc/` utilities (post_proc.py, pano_lsd_align.py, utils.py, etc.)

### Frontend Template
- [x] Created `sim.html` Django template with:
  - Panorama upload UI (file input, VP align checkbox, Hide Ceiling checkbox)
  - Placeholder for Three.js scene
  - Status display for pipeline progress
  - Place objects, agents, interactions panels (skeleton)
  - ImportMap configured for local static vendor files

### Requirements & Documentation
- [x] Created `requirements.txt` with all dependencies listed
- [x] Created comprehensive `README.md` with:
  - Architecture overview
  - Installation instructions
  - API documentation
  - Database schema
  - Known limitations
  - Next steps
- [x] Created this `SETUP_STATUS.md`

---

## ❌ Blocked (Disk Space Issue)

The system ran out of disk space (ENOSPC) during PyTorch installation. **~5GB of free space is needed** to complete setup.

### What's Blocked
1. **PyTorch & torchvision** installation
   ```bash
   pip install torch torchvision>=0.15.0
   ```

2. **Django migrations** (depends on PyTorch for imports)
   ```bash
   python manage.py makemigrations room_sim
   python manage.py migrate
   ```

3. **Running the server** (will fail on first import if PyTorch missing)

### What to Do
**Once disk space is freed:**

```bash
cd backend
source .venv/bin/activate  # (or .\.venv\Scripts\activate on Windows)

# Install remaining heavy packages
pip install torch torchvision opencv-python pylsd-nova

# Run migrations (now that imports will work)
python manage.py makemigrations room_sim
python manage.py migrate

# Start server
python manage.py runserver 0.0.0.0:8000
```

---

## ⚠️ Incomplete (Requires Frontend Implementation)

The backend is **API-complete** but the **frontend Three.js app** is a skeleton. The `sim.html` template has the upload UI but lacks:

1. **RoomEnvironment class**
   - Load PLY from `/api/jobs/<id>/artifact/mesh/`
   - Load floor polygon from `/api/jobs/<id>/floor_polygon/`
   - Point-in-polygon test for agent containment
   - Clamp agents to floor boundaries

2. **PipelineClient class**
   - POST to `/api/jobs/start/`
   - Poll `/api/jobs/<id>/status/`
   - Handle completion/failure callbacks

3. **Avatar system integration**
   - Merge `AnimationIntelligence` from `engine3d.html`
   - Merge personality/needs simulation
   - Merge agent interaction system

4. **Coordinate system bridging**
   - Map Three.js world coords → simulation coords
   - Handle different scales (metres vs. grid units)

This requires porting ~2600 lines from `engine3d.html` into the Django template and adapting room navigation from procedural room building to real PLY-based pathfinding.

---

## 📋 Quick Checklist for Completion

- [ ] Free ~5GB disk space
- [ ] `pip install torch torchvision opencv-python pylsd-nova`
- [ ] `python manage.py makemigrations room_sim`
- [ ] `python manage.py migrate`
- [ ] Test: `python manage.py runserver`
- [ ] Test: Upload panorama via UI, watch pipeline execute
- [ ] Implement `RoomEnvironment` class in `sim.html`
- [ ] Implement `PipelineClient` class in `sim.html`
- [ ] Port `AnimationIntelligence` + agent system from `engine3d.html`
- [ ] Test: Add agents, watch them navigate in real room
- [ ] Optimize: Mesh stride, browser performance
- [ ] Integrate: Wire up Django backend to main React frontend

---

## File Inventory

```
backend/
├── .venv/                    (265 packages, 0.5GB)
├── requirements.txt          ✅ 
├── README.md                 ✅
├── SETUP_STATUS.md           ✅ (this file)
├── manage.py                 ✅
├── db.sqlite3                ❌ (not created yet - needs migrations)
│
├── hestia/
│   ├── __init__.py           ✅
│   ├── settings.py           ✅ (configured)
│   ├── urls.py               ✅ (configured)
│   ├── wsgi.py               ✅
│   ├── asgi.py               ✅
│
├── room_sim/
│   ├── __init__.py           ✅
│   ├── apps.py               ✅ (with ready() hook)
│   ├── models.py             ✅ (ReconstructionJob)
│   ├── views.py              ✅ (8 endpoints)
│   ├── urls.py               ✅ (8 routes)
│   ├── migrations/
│   │   └── (none yet, blocked on PyTorch)
│   │
│   ├── pipeline/
│   │   ├── __init__.py       ✅
│   │   ├── runner.py         ✅ (PipelineRunner)
│   │   ├── ply_builder.py    ✅
│   │   ├── floor_polygon.py  ✅
│   │   │
│   │   └── horizonnet/
│   │       ├── __init__.py   ✅
│   │       ├── room_layout_model.py   ✅ (copied from model.py)
│   │       ├── inference.py  ✅ (needs adapt for import)
│   │       ├── eval_general.py        ✅
│   │       ├── preprocess.py ✅
│   │       ├── dataset.py    ✅
│   │       └── misc/
│   │           ├── __init__.py        ✅
│   │           ├── post_proc.py       ✅
│   │           ├── pano_lsd_align.py  ✅
│   │           ├── panostretch.py     ✅
│   │           └── utils.py           ✅
│   │
│   └── templates/room_sim/
│       └── sim.html          ⚠️ (skeleton, needs full Three.js impl)
│
├── checkpoints/
│   └── horizonnet_resnet50_rnn.pth    ✅ (copied)
│
├── media/
│   └── jobs/                 ✅ (will be created by first job)
│
└── static/
    ├── glb/
    │   ├── male_model.glb    ✅
    │   ├── female_model.glb  ✅
    │   ├── chair.glb         ✅
    │   ├── table.glb         ✅
    │   ├── tv.glb            ✅
    │   ├── shower.glb        ✅
    │   └── textures.png      ✅
    │
    └── vendor/three/
        ├── three.module.js   ✅
        └── examples/jsm/
            ├── controls/OrbitControls.js  ✅
            ├── loaders/GLTFLoader.js      ✅
            ├── loaders/PLYLoader.js       ✅
            └── utils/SkeletonUtils.js     ✅
```

---

## Dependencies Installed

✅ Already installed in venv:
- Django 5.2.13
- Pillow 12.2.0
- asgiref, sqlparse, tzdata (Django dependencies)

❌ Blocked on disk space:
- torch, torchvision, numpy, scipy, scikit-learn, shapely, tqdm
- opencv-python, pylsd-nova, requests

---

## Model Preference Reminder

From user memory: **Use Opus for planning, Sonnet for code execution**

This backend implementation was created with code-execution speed prioritized. If architectural changes are needed later, transition to Opus for design phases.
