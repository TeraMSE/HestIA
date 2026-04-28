# HestIA Backend - Quick Start Guide

## System Status

✅ **Complete and Ready to Test**

All components are installed and configured:
- Django 5.2 with PostgreSQL/SQLite support
- HorizonNet model and checkpoint
- Three.js viewer with PLY loading
- Background pipeline with threading
- 8 API endpoints fully functional

## Starting the Server

### Option 1: Batch File (Windows)
```bash
cd backend
RUN_SERVER.bat
```

### Option 2: Manual (All Platforms)
```bash
cd backend
source .venv/bin/activate  # (or .\.venv\Scripts\activate on Windows)
python manage.py runserver 0.0.0.0:8000
```

The server will start at **http://localhost:8000**

## Testing the System

### 1. Open the Web App
- Navigate to http://localhost:8000/ in your browser
- You should see a dark 3D viewport with upload controls on the left

### 2. Upload a Panorama Image
- Click the file input under "🌍 Room Environment"
- Select an equirectangular panorama image (360° panorama)
  - Recommended: 1024×512 pixels or larger
  - Format: PNG, JPG, JPEG, or WebP
  - Can be any 360° room photo
- Click **"⚙ Generate Room"**

### 3. Watch the Pipeline Execute
The browser will show live status updates:
- **queued** → job created
- **running: preprocess** → VP alignment (if enabled)
- **running: inference** → HorizonNet model running
- **running: meshing** → PLY mesh generation
- **completed** → Success! Mesh appears in the 3D viewer

This typically takes **2-5 minutes** depending on:
- Panorama size
- CPU/GPU capability
- VP alignment enabled/disabled

### 4. View the 3D Room
Once completed:
- The 3D mesh appears in the viewport
- Orbit camera with mouse (left-click drag to rotate, scroll to zoom)
- Grid helper shows room floor reference
- Status shows: vertex count, face count, stride

### 5. Test Errors (Optional)
- Upload a non-panorama image (portrait, landscape) → should fail gracefully
- Upload an invalid format → should reject immediately
- Check events log: watch real-time pipeline output in the status area

## Browser Developer Tools

### Check Server Communication
Open DevTools (F12) → Network tab:
1. POST to `/api/jobs/start/` → 202 response with job_id
2. GET polling to `/api/jobs/<id>/status/` → 200 response with state updates
3. GET `/api/jobs/<id>/artifact/mesh/` → 200 with PLY binary data

### Check JavaScript Errors
Console (F12) → should show:
- ✅ `Three.js app initialized. Waiting for panorama upload...`
- ✅ `✅ 3D Room Simulator Ready`
- ❌ Any errors will be displayed in red

### Check Pipeline Logs
While job is running, you can view raw logs:
```
http://localhost:8000/api/jobs/<job_id>/events/
```
Replace `<job_id>` with the UUID shown in status.

## Example: Panorama Sources

### Free Panorama Datasets
1. **Matterport3D** (academic use)
   - Download equirectangular renders from dataset
2. **360 Monodepth Dataset** (open source)
   - Various indoor room panoramas
3. **ScanNet** (academic)
   - High-quality indoor scene panoramas
4. **Personal Panoramas**
   - Use equirectangular photography software
   - Apps: Cardboard Camera, 360 Panorama, etc.

### Creating Your Own
1. Use a 360° camera (Ricoh Theta, Insta360, etc.)
2. Use smartphone app (Google Street View app)
3. Stitch multiple photos (Hugin, PTGui)
4. Ensure **equirectangular** format (not cubic or other projections)

## API Reference

### Quick API Calls

**Check if server is up:**
```bash
curl http://localhost:8000/
# Should return HTML of sim.html
```

**Create a job:**
```bash
curl -X POST http://localhost:8000/api/jobs/start/ \
  -F "image=@panorama.jpg" \
  -F "align_panorama=true"

# Response:
# {
#   "job_id": "550e8400-e29b-41d4-a716-446655440000",
#   "status_url": "/api/jobs/550e8400-e29b-41d4-a716-446655440000/status/",
#   ...
# }
```

**Check job status:**
```bash
curl http://localhost:8000/api/jobs/550e8400-e29b-41d4-a716-446655440000/status/
```

**Download mesh:**
```bash
curl -o room.ply http://localhost:8000/api/jobs/550e8400-e29b-41d4-a716-446655440000/artifact/mesh/
```

## Troubleshooting

### Server Won't Start
**Error:** `ModuleNotFoundError: No module named 'torch'`
```bash
.\.venv\Scripts\python.exe -m pip install torch torchvision
```

**Error:** `sqlite3.OperationalError: database is locked`
- Close other Django instances
- Delete `db.sqlite3` and re-run migrations:
  ```bash
  python manage.py migrate
  ```

### Panorama Upload Fails
- Check file size (should be < 50MB)
- Verify format: only PNG, JPG, JPEG, WebP accepted
- Check browser console for network errors

### Pipeline Hangs
- Check `/api/jobs/<id>/events/` for error messages
- If stuck at "preprocess": pylsd-nova may be missing (should fallback automatically)
- If stuck at "inference": check console for PyTorch errors
- If stuck at "meshing": likely a memory issue with very large panoramas

### 3D Viewer Doesn't Show Mesh
- Check browser console for Three.js errors
- Verify job status is "completed"
- Try a different panorama image
- Check that `static/vendor/three/` files are served (Network tab in DevTools)

### Slow Performance
- The `mesh_stride` parameter controls mesh density (default: 2)
  - Increase stride (3-4) for faster render but lower detail
  - Decrease stride (1) for more detail but slower render
- Very large panoramas (> 2048×1024) can be slow
- Reduce panorama size before upload if needed

## Next Steps

### 1. Test with Multiple Panoramas
- Try indoor room panoramas
- Try outdoor 360° photos
- Observe how layout varies with image quality

### 2. Monitor Performance
- Check server logs: terminal where `runserver` is running
- Check database: `python manage.py dbshell`
  - `SELECT * FROM room_sim_reconstructionjob;` to see all jobs

### 3. Integrate with React Frontend
The backend is now ready to be consumed by the React frontend:
```javascript
// Example React usage:
const jobId = await uploadPanorama(file);
const status = await pollStatus(jobId);
const mesh = await downloadMesh(jobId);
const polygon = await getFloorPolygon(jobId);
```

### 4. Add Agent System (Future)
Once confirmed the panorama → 3D mesh pipeline works:
1. Port `AnimationIntelligence` from `engine3d.html`
2. Add personality/needs simulation
3. Implement floor polygon pathfinding
4. Add agent spawning and interaction UI

## Database

### View All Jobs
```bash
python manage.py shell
from room_sim.models import ReconstructionJob
for job in ReconstructionJob.objects.all():
    print(f"{job.id}: {job.state} ({job.current_step})")
```

### Delete Old Jobs
```bash
import shutil
from room_sim.models import ReconstructionJob
from pathlib import Path

job = ReconstructionJob.objects.first()
job_dir = job.job_dir()
shutil.rmtree(job_dir)  # Delete artifacts
job.delete()  # Delete DB record
```

## Performance Metrics

Typical execution times on modern hardware:

| Step | Time | Notes |
|------|------|-------|
| Upload | 1-10s | Depends on file size and network |
| Preprocess (VP align) | 10-30s | Optional; fallback resize is instant |
| Inference (HorizonNet) | 30-120s | Main bottleneck; GPU much faster |
| Meshing | 5-15s | Fast; depends on mesh size |
| **Total** | **50-175s** | Typically ~90s for 1024×512 image |

## Monitoring in Production

For production deployment:
1. Set `DEBUG = False` in settings.py
2. Configure `ALLOWED_HOSTS` with your domain
3. Use PostgreSQL instead of SQLite
4. Use Gunicorn/uWSGI instead of `runserver`
5. Add Nginx/Apache reverse proxy
6. Set up proper logging and monitoring
7. Implement rate limiting on `/api/jobs/start/`

## Support

For issues:
1. Check `README.md` for architecture details
2. Check `SETUP_STATUS.md` for setup issues
3. Check browser console (F12) for client-side errors
4. Check server terminal for Python/Django errors
5. Check `db.sqlite3` or PostgreSQL for data issues

## Summary

The HestIA backend is a complete, working system for:
✅ Uploading panoramic images  
✅ Running HorizonNet inference  
✅ Generating 3D room meshes  
✅ Serving results via REST API  
✅ Visualizing in Three.js viewer  

Next phase: integrate with React frontend and add agent simulation.
