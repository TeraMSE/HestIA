# HestIA Backend - Testing Checklist

## Pre-Test Verification

- [x] All dependencies installed (PyTorch, scipy, shapely, etc.)
- [x] Migrations applied (`python manage.py migrate`)
- [x] Database created (`db.sqlite3`)
- [x] Static files in place (`static/glb/`, `static/vendor/three/`)
- [x] Checkpoint downloaded (`checkpoints/horizonnet_resnet50_rnn.pth`)

## Server Startup

- [ ] Run `RUN_SERVER.bat` or `python manage.py runserver 8000`
- [ ] Wait for: `Starting development server at http://127.0.0.1:8000/`
- [ ] Verify: No errors or warnings in console

## Browser Test

- [ ] Open http://localhost:8000/ in Firefox/Chrome/Edge
- [ ] Verify: Dark viewport loads
- [ ] Verify: Grid helper visible (checkered pattern on floor)
- [ ] Verify: Left panel with "🌍 Room Environment" section visible
- [ ] Verify: No console errors (F12 → Console)

## Panorama Upload Test

### Get a Test Image
- [ ] Download or create an equirectangular panorama (360° image)
  - Size: 512×1024 to 2048×1024 pixels
  - Format: PNG, JPG, or WebP
  - Type: Indoor room or outdoor environment
  - **Download sources:**
    - Google: "360 panorama free download"
    - Unsplash: Search "panorama"
    - Personal: Use your own 360° camera photo

### Upload & Process
- [ ] Click file input under "🌍 Room Environment"
- [ ] Select your panorama image
- [ ] Verify checkboxes (VP Align: on, Hide Ceiling: on)
- [ ] Click "⚙ Generate Room"
- [ ] Verify status shows "⏳ Uploading..."

## Pipeline Execution (Real-time monitoring)

### Status Updates (watch for these messages)
- [ ] `⏳ queued: queued` — Job created
- [ ] `⏳ running: preprocess` — VP alignment running (~15-30s)
- [ ] `⏳ running: inference` — HorizonNet model running (~45-120s)
  - **Most time-consuming step** — normal for CPU inference
- [ ] `⏳ running: meshing` — Building 3D mesh (~5-15s)
- [ ] `✅ completed: completed` — Success!

### Expected Timing
| Step | Time | Notes |
|------|------|-------|
| Upload | 1-10s | Network-dependent |
| Preprocess | 10-30s | Skip if VP Align unchecked |
| Inference | 30-120s | CPU inference; use GPU for faster |
| Meshing | 5-15s | Fast |
| **Total** | **50-175s** | Typically ~90 seconds |

## 3D Mesh Verification

- [ ] After completion, 3D mesh appears in viewport
- [ ] Status shows: `✅ Room loaded!` + vertex/face count
- [ ] Mesh is visible (white/colored depending on panorama)
- [ ] Grid is still visible behind mesh

## 3D Interaction Tests

- [ ] **Rotate:** Click + drag with left mouse button → mesh rotates
- [ ] **Zoom:** Scroll wheel → zoom in/out smoothly
- [ ] **Pan:** Click + drag with right mouse button → pan view
- [ ] **Reset:** Double-click → view resets to default
- [ ] No lag or freezing during interaction

## Browser Developer Tools

### Network Tab (F12 → Network)
- [ ] `POST /api/jobs/start/` → 202 response
- [ ] `GET /api/jobs/<uuid>/status/` → 200 response (repeated)
- [ ] `GET /api/jobs/<uuid>/artifact/mesh/` → 200 response + binary data
- [ ] `GET /api/jobs/<uuid>/artifact/layout/` → 200 response + JSON data
- [ ] `GET /api/jobs/<uuid>/floor_polygon/` → 200 response + JSON polygon

### Console Tab (F12 → Console)
- [ ] No JavaScript errors (red messages)
- [ ] See success messages: `✅ 3D Room Simulator Ready`
- [ ] No warnings about missing Three.js modules

## Server Console Verification

In the terminal where server is running:
- [ ] See POST request: `POST /api/jobs/start/ 202`
- [ ] See multiple GET requests: `GET /api/jobs/<uuid>/status/ 200`
- [ ] See artifact GET: `GET /api/jobs/<uuid>/artifact/mesh/ 200`
- [ ] No 500 errors or exceptions

## API Endpoint Tests (Optional - using curl)

### Test 1: Check Server Health
```bash
curl http://localhost:8000/
# Should return HTML of sim.html
```

### Test 2: Upload Via API
```bash
curl -X POST http://localhost:8000/api/jobs/start/ \
  -F "image=@your_panorama.jpg" \
  -F "align_panorama=true"
# Returns job_id
```

### Test 3: Check Status
```bash
curl http://localhost:8000/api/jobs/<job_id>/status/
# Should show job state and progress
```

### Test 4: Download Mesh
```bash
curl -o test_mesh.ply http://localhost:8000/api/jobs/<job_id>/artifact/mesh/
# Creates test_mesh.ply file
```

## Error Handling Tests (Optional)

### Test Invalid File
- [ ] Upload a non-panorama image (portrait photo, landscape)
- [ ] Verify: Status shows "running: inference" then "completed" (result may be distorted)
- [ ] Note: HorizonNet will try to process any image, even if not a panorama

### Test Wrong File Type
- [ ] Try uploading a .txt, .pdf, or .zip file
- [ ] Verify: Error message "Only png/jpg/jpeg/webp allowed"

### Test Missing File
- [ ] Click "⚙ Generate Room" without selecting an image
- [ ] Verify: Status shows "❌ Select a file first"

### Test Large File
- [ ] Upload a panorama larger than 10MB
- [ ] Should work but take longer

## Database Verification

```bash
# In project root:
python manage.py shell
from room_sim.models import ReconstructionJob
job = ReconstructionJob.objects.first()
print(f"Job ID: {job.id}")
print(f"State: {job.state}")
print(f"Vertices: {job.mesh_vertices}")
print(f"Faces: {job.mesh_faces}")
```

- [ ] Job exists in database
- [ ] State is "completed"
- [ ] Vertices > 0
- [ ] Faces > 0

## File System Verification

```bash
# Navigate to: backend/media/jobs/<job_id>/
```

Should contain:
- [ ] `input/panorama.jpg` (original uploaded image)
- [ ] `preprocessed/*_aligned_rgb.png` (VP-aligned image)
- [ ] `inferenced/*.json` (layout with corner coordinates)
- [ ] `mesh/layout_mesh.ply` (3D mesh)
- [ ] `events.log` (pipeline execution log)

## Performance Benchmarking (Optional)

Time each step for your system:
- [ ] Preprocess time: _______ seconds
- [ ] Inference time: _______ seconds
- [ ] Meshing time: _______ seconds
- [ ] **Total time: _______ seconds**

Compare to expected ~90 seconds for standard hardware.

## Multi-Image Test (Optional)

Upload 3+ different panoramas to verify:
- [ ] System handles multiple concurrent/sequential jobs
- [ ] Each job generates unique mesh
- [ ] No data crossover between jobs
- [ ] Job IDs are unique (different UUIDs)

## Memory & Disk Usage (Optional)

- [ ] Check `media/jobs/` directory size (grows with each job)
  - Typical: 5-20MB per job (depends on panorama size)
- [ ] Monitor system memory while inference runs
  - Typical: ~2-4GB for HorizonNet inference

## Final Verification

- [ ] Server can be stopped with Ctrl+C without errors
- [ ] Server can be restarted and continues to work
- [ ] Old jobs are still accessible after restart
- [ ] Can upload and process a new panorama after restart

## Success Criteria

You have successfully tested the HestIA backend if:

✅ Server starts without errors  
✅ Web UI loads in browser  
✅ Panorama uploads and processes  
✅ 3D mesh appears in viewport  
✅ Mesh can be rotated/zoomed  
✅ All API endpoints return 200/202 responses  
✅ Database shows completed jobs  
✅ `media/jobs/` contains expected artifacts  

## Troubleshooting

If any test fails, see **QUICKSTART.md** section "Troubleshooting" for solutions.

Common issues:
- **Server won't start:** Missing PyTorch → `pip install torch torchvision`
- **Upload fails:** Check file format (must be PNG/JPG/JPEG/WebP)
- **Mesh doesn't load:** Check console (F12) for JavaScript errors
- **Inference hangs:** Check events log for error messages
- **Performance slow:** Using CPU inference (slow); consider GPU or smaller image

## Next Steps After Successful Tests

1. **Try different panoramas:** Test with various room types
2. **Check performance:** Note processing times for your hardware
3. **Integrate avatar system:** Add agent spawning and animation (future phase)
4. **Connect React frontend:** Wire up Django backend to main app
5. **Deploy to production:** Use Gunicorn + PostgreSQL + Nginx

---

## Checklist Summary

Total items: 50+  
Mark each [ ] as you complete the test.

When all items are checked, you have a **fully functional HestIA backend**! 🎉
