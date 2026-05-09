import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Upload, Sparkles, Loader2, Bot, FileText, Activity, CheckCircle,
  AlertCircle, XCircle, TrendingUp, TrendingDown, Target, X, CheckCircle2,
  Sun, Moon,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "../room-sim/engine/RoomEnvironment";
import { AgentManager } from "../room-sim/engine/AgentManager";
import { FurnitureManager } from "../room-sim/engine/FurnitureManager";
import { TimeOfDayController, formatTimeLabel } from "../room-sim/engine/TimeOfDay";
import { PipelineClient } from "../room-sim/engine/PipelineClient";
import { ScenarioEngine, ScenarioPhase, ScenarioReport } from "../room-sim/engine/ScenarioEngine";
import type { Agent } from "../room-sim/engine/StateSystem";
import { toast } from "sonner";
import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { useSimStore } from "@/shared/store/useSimStore";
import { lifeSimApi } from "@/services/lifeSimApi";
import { LayerToolbar } from "./LayerToolbar";
import { SimulationLayerPanel } from "./SimulationLayerPanel";
import { MoldLayerPanel, MOCK_MOLD_FINDINGS } from "./MoldLayerPanel";
import { StatsLayerPanel } from "./StatsLayerPanel";
import { applianceApi } from "@/services/applianceApi";
import type { JobScanResult } from "@/services/applianceApi";
import { getJobId, saveJobId } from "@/lib/worldJobCache";
import { PersonaBuilder } from "@/features/persona/PersonaBuilder";
import { ApartmentConfigurator } from "@/features/apartment/ApartmentConfigurator";
import { Reports } from "@/features/reports/Reports";
import { MaterialAgent } from "@/features/material-agent/MaterialAgent";
import { AdminAssistant } from "@/features/admin-assistant/AdminAssistant";
import { NeighborhoodIntel } from "@/features/neighborhood/NeighborhoodIntel";
import { ApplianceEnergy } from "@/features/appliance-energy/ApplianceEnergy";
import { RoommatePanel } from "@/features/roommate/RoommatePanel";


export function WorldOverlay() {
  const { closeOverlay, activeOverlay, setWorldOpen, activeWorldLayer, pins, selectedPinId, showCeiling } = useApp();
  const { user } = useAuthStore();
  const simStore = useSimStore();
  const selectedPin = pins.find((p) => p.id === selectedPinId) ?? null;

  /* ── Three.js refs ─────────────────────────────────────────────── */
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const roomEnvRef = useRef<RoomEnvironment | null>(null);
  const agentMgrRef = useRef<AgentManager | null>(null);
  const furnitureMgrRef = useRef<FurnitureManager | null>(null);
  const todRef = useRef<TimeOfDayController | null>(null);
  const animIdRef = useRef<number | null>(null);
  const engineRef = useRef<ScenarioEngine | null>(null);

  /* ── State ─────────────────────────────────────────────────────── */
  const [pipeStatus, setPipeStatus] = useState("Waiting for panorama...");
  const [isGenerating, setIsGenerating] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const [timeVal, setTimeVal] = useState(12);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [currentPhase, setCurrentPhase] = useState<ScenarioPhase | null>(null);
  const [rulesData, setRulesData] = useState<string[] | null>(null);
  const [reportData, setReportData] = useState<ScenarioReport | null>(null);
  const [lifeSimReport, setLifeSimReport] = useState<any | null>(null);
  const [, forceUpdate] = useState(0);
  const [isCheckingExistingJob, setIsCheckingExistingJob] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  /* ── Upload form state ─────────────────────────────────────────── */
  const fileRef = useRef<HTMLInputElement>(null);
  const [alignPano, setAlignPano] = useState(true);
  const [hideCeiling, setHideCeiling] = useState(true);

  /* ── Life sim state ────────────────────────────────────────────── */
  const [lifeSimActive, setLifeSimActive] = useState(false);
  const [lifeSimStarting, setLifeSimStarting] = useState(false);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const windowMeshesRef = useRef<THREE.Mesh[]>([]);
  const ceilingMeshRef = useRef<THREE.Mesh | null>(null);
  const defaultWindowMeshesRef = useRef<THREE.Mesh[]>([]);
  const moldObjectsRef = useRef<THREE.Object3D[]>([]);
  const timeValRef = useRef(12);
  const [windowsDetected, setWindowsDetected] = useState(false);
  const [applianceScanResult, setApplianceScanResult] = useState<JobScanResult | null>(null);
  const applianceScanResultRef = useRef<JobScanResult | null>(null);

  /* ── Initialize Three.js scene ─────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8bbedd); // overridden each frame by sky animation
    scene.fog = new THREE.FogExp2(0x8bbedd, 0.018);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    camera.position.set(5, 4, 8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", stencil: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // White infinite-looking floor — sits at Y=0 to match the room bottom
    const gnd = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0xf0f2f5, roughness: 0.88, metalness: 0.02 })
    );
    gnd.rotation.x = -Math.PI / 2;
    gnd.position.y = 0;
    gnd.receiveShadow = true;
    scene.add(gnd);

    const roomEnv = new RoomEnvironment(scene);
    roomEnvRef.current = roomEnv;

    const tod = new TimeOfDayController(scene);
    tod.setHour(12);
    todRef.current = tod;

    const agentMgr = new AgentManager(scene, camera, renderer, roomEnv);
    agentMgr.setLabelsRoot(labelsRef.current);
    agentMgr.onAgentsChanged = () => setAgents([...agentMgr.agents]);
    agentMgr.onSelectedChanged = (a) => setSelectedAgent(a);
    agentMgrRef.current = agentMgr;

    const scenarioEngine = new ScenarioEngine(agentMgr, null);
    scenarioEngine.onPhaseChange = setCurrentPhase;
    scenarioEngine.onHouseRules = setRulesData;
    scenarioEngine.onFinish = setReportData;
    engineRef.current = scenarioEngine;

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    onResize();

    const skyColor = new THREE.Color();
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      controls.update();
      agentMgr.update();
      // Dynamic sky background based on time of day
      const h = timeValRef.current;
      if (h >= 6 && h < 8)        skyColor.setHex(0xe8c89a); // dawn warm
      else if (h >= 8 && h < 18)  skyColor.setHex(0x8bbedd); // day sky blue
      else if (h >= 18 && h < 20) skyColor.setHex(0xd4825a); // dusk orange
      else                         skyColor.setHex(0x080818); // night
      scene.background = skyColor;
      if (scene.fog instanceof THREE.FogExp2) scene.fog.color.copy(skyColor);
      renderer.render(scene, camera);
    };
    animate();

    const uiTimer = setInterval(() => forceUpdate((n) => n + 1), 100);

    return () => {
      clearInterval(uiTimer);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      if (animIdRef.current !== null) cancelAnimationFrame(animIdRef.current);
      if (engineRef.current) engineRef.current.stop();
      agentMgr.dispose();
      furnitureMgrRef.current?.dispose();
      roomEnv.dispose();
      tod.dispose();
      controls.dispose();
      renderer.dispose();
      windowMeshesRef.current.forEach((m) => {
        m.traverse(child => {
          if (child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial;
        if (mat.map) mat.map.dispose();
        mat.dispose();
      });
      windowMeshesRef.current = [];
      if (ceilingMeshRef.current) { ceilingMeshRef.current.geometry.dispose(); (ceilingMeshRef.current.material as THREE.Material).dispose(); ceilingMeshRef.current = null; }
      defaultWindowMeshesRef.current.forEach(m => { m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
      defaultWindowMeshesRef.current = [];
      moldObjectsRef.current.forEach(o => scene.remove(o));
      moldObjectsRef.current = [];
      if (container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  /* ── Auto-load existing 3D world when property changes ─────────── */
  useEffect(() => {
    const pinId = selectedPin?.id;
    setRoomReady(false);
    setShowUploadForm(false);
    setCurrentJobId(null);
    setWindowsDetected(false);
    windowMeshesRef.current.forEach((m) => {
      sceneRef.current?.remove(m);
      m.traverse(child => {
        if ((child as THREE.LineSegments).isLineSegments) {
          (child as THREE.LineSegments).geometry.dispose();
          ((child as THREE.LineSegments).material as THREE.Material).dispose();
        }
      });
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    });
    windowMeshesRef.current = [];
    if (ceilingMeshRef.current) { sceneRef.current?.remove(ceilingMeshRef.current); ceilingMeshRef.current.geometry.dispose(); (ceilingMeshRef.current.material as THREE.Material).dispose(); ceilingMeshRef.current = null; }
    defaultWindowMeshesRef.current.forEach(m => { sceneRef.current?.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
    defaultWindowMeshesRef.current = [];
    const isRealPin = !!pinId && /^\d+$/.test(String(pinId));

    if (!pinId || !roomEnvRef.current) {
      setIsCheckingExistingJob(false);
      setPipeStatus("Waiting for panorama...");
      return;
    }

    let cancelled = false;
    setIsCheckingExistingJob(true);

    (async () => {
      try {
        if (!isRealPin) {
          setPipeStatus("Upload a panorama to generate the 3D world.");
          setShowUploadForm(true);
          setIsCheckingExistingJob(false);
          return;
        }

        // Check localStorage cache first
        const cachedJobId = user?.id ? getJobId(user.id, pinId) : null;
        if (cachedJobId) {
          setPipeStatus("Loading saved 3D world…");
          await roomEnvRef.current!.loadFromJob(cachedJobId);
          if (cancelled) return;
          await _loadFurnitureAndFinalize(cachedJobId, cancelled);
          return;
        }

        // Fall back to API
        const resp = await fetch(`/api/jobs/property/${pinId}/`);
        if (cancelled) return;

        if (!resp.ok) {
          setPipeStatus("Upload a panorama to generate the 3D world.");
          setShowUploadForm(true);
          return;
        }

        const { job_id } = await resp.json();
        if (!job_id || cancelled) {
          setPipeStatus("Upload a panorama to generate the 3D world.");
          setShowUploadForm(true);
          return;
        }

        if (user?.id) saveJobId(user.id, pinId, job_id);
        setPipeStatus("Loading saved 3D world…");
        await roomEnvRef.current!.loadFromJob(job_id);
        if (cancelled) return;
        await _loadFurnitureAndFinalize(job_id, cancelled);
      } catch {
        if (!cancelled) {
          setPipeStatus("Upload a panorama to generate the 3D world.");
          setShowUploadForm(true);
        }
      } finally {
        if (!cancelled) setIsCheckingExistingJob(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedPin?.id, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function _addDefaultArchitecture() {
    const mesh = roomEnvRef.current?._mesh;
    if (!mesh || !sceneRef.current) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Ceiling plane — hidden by default, toggled via LayerToolbar
    const cGeo = new THREE.PlaneGeometry(size.x * 1.05, size.z * 1.05);
    const cMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f7, roughness: 0.88, side: THREE.DoubleSide });
    const cMesh = new THREE.Mesh(cGeo, cMat);
    cMesh.rotation.x = Math.PI / 2;
    cMesh.position.set(center.x, box.max.y, center.z);
    cMesh.receiveShadow = true;
    cMesh.visible = showCeiling;
    sceneRef.current.add(cMesh);
    ceilingMeshRef.current = cMesh;

    // Default windows — stencil cutout planes punch holes in walls; glass panes show sky tint
    const ww = size.x * 0.22;
    const wh = size.y * 0.38;
    const midY = center.y + size.y * 0.08;

    // Stencil material: writes ref=1 to stencil, no color/depth output
    const makeCutout = (w: number, h: number) => new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false,
      stencilWrite: true, stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
      side: THREE.DoubleSide,
    });

    [
      { x: center.x - size.x * 0.22, y: midY, z: box.max.z, ry: 0 },
      { x: center.x + size.x * 0.22, y: midY, z: box.max.z, ry: 0 },
      { x: center.x, y: midY, z: box.min.z, ry: Math.PI },
    ].forEach(({ x, y, z, ry }) => {
      const geo = new THREE.PlaneGeometry(ww, wh);

      // Stencil cutout (renders first, punches hole in wall)
      const cutout = new THREE.Mesh(geo, makeCutout(ww, wh));
      cutout.position.set(x, y, z);
      cutout.rotation.y = ry;
      cutout.renderOrder = -1;
      sceneRef.current!.add(cutout);
      defaultWindowMeshesRef.current.push(cutout);

      // Glass pane — subtle blue tint over the hole
      const glassMat = new THREE.MeshBasicMaterial({
        color: 0xaaddff, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthTest: false,
      });
      const wMesh = new THREE.Mesh(geo, glassMat);
      wMesh.position.set(x, y, z);
      wMesh.rotation.y = ry;
      wMesh.renderOrder = 999;
      sceneRef.current!.add(wMesh);
      defaultWindowMeshesRef.current.push(wMesh);

      // Frame outline
      const frameMat = new THREE.LineBasicMaterial({ color: 0xc8e8ff, depthTest: false });
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(geo), frameMat);
      frame.renderOrder = 1000;
      wMesh.add(frame);

      const light = new THREE.PointLight(0x99ddff, 0.7, 5.0);
      light.position.set(x, y, z + (ry === 0 ? -0.8 : 0.8));
      sceneRef.current!.add(light);
    });
  }

  async function _loadFurnitureAndFinalize(jobId: string, cancelled: boolean) {
    if (cancelled) return;

    // Enable stencil test on wall materials so window cutouts can show sky
    for (const wallMesh of [roomEnvRef.current!._mesh, roomEnvRef.current!._innerMesh]) {
      if (!wallMesh) continue;
      const mat = wallMesh.material as THREE.MeshStandardMaterial;
      mat.stencilWrite = false;
      mat.stencilFunc = THREE.NotEqualStencilFunc;
      mat.stencilRef = 1;
      mat.needsUpdate = true;
    }

    const fMgr = new FurnitureManager(sceneRef.current!, roomEnvRef.current!);
    furnitureMgrRef.current = fMgr;
    agentMgrRef.current!.setFurnitureManager(fMgr);
    if (engineRef.current) engineRef.current.fm = fMgr;
    await fMgr.placeAll();
    if (cancelled) return;

    setPipeStatus("3D world ready.");
    setRoomReady(true);
    setCurrentJobId(jobId);
    _addDefaultArchitecture();
    detectAndPlaceWindows(jobId);

    const mesh = roomEnvRef.current!._mesh;
    if (mesh && controlsRef.current && cameraRef.current) {
      const box = new THREE.Box3().setFromObject(mesh);
      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      const d = Math.max(s.x, s.z) * 0.9;
      controlsRef.current.target.set(c.x, 0, c.z);
      cameraRef.current.position.set(c.x, d * 0.6, c.z + d);
      controlsRef.current.update();
    }
    toast.success("3D world loaded.");
  }

  /* ── Keep scan result ref in sync ─────────────────────────────── */
  useEffect(() => { applianceScanResultRef.current = applianceScanResult; }, [applianceScanResult]);

  /* ── Auto-load appliance grades when room is ready ─────────────── */
  useEffect(() => {
    if (!currentJobId || !roomReady) return;
    applianceApi.scanFromJob(currentJobId)
      .then((result) => setApplianceScanResult(result))
      .catch(() => { /* grades unavailable, labels just won't show */ });
  }, [currentJobId, roomReady]);

  /* ── Sync ceiling visibility with store ─────────────────────────── */
  useEffect(() => {
    if (ceilingMeshRef.current) ceilingMeshRef.current.visible = showCeiling;
  }, [showCeiling]);

  /* ── Manual persona spawn (called from SimulationLayerPanel) ────── */
  const handleSpawnPersona = useCallback(() => {
    if (!agentMgrRef.current || agents.length > 0) return;
    const userName = user?.first_name || user?.email?.split("@")[0] || "You";
    const a = agentMgrRef.current.spawnAgent("male");
    if (a) { a.label = userName; a.color = "#22d3ee"; }
    toast.success(`Persona "${userName}" spawned.`);
  }, [user, agents.length]);

  /* ── Mold layer 3D objects ─────────────────────────────────────── */
  useEffect(() => {
    if (!roomReady || !sceneRef.current || !roomEnvRef.current?._mesh) return;
    const scene = sceneRef.current;

    // Remove old mold objects
    moldObjectsRef.current.forEach(o => scene.remove(o));
    moldObjectsRef.current = [];

    if (activeWorldLayer !== "mold") return;

    const mesh = roomEnvRef.current._mesh;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());

    // Map MOCK_MOLD_FINDINGS to seeded 3D positions relative to room bbox
    const positions = [
      { x: box.min.x + 0.8,       y: box.max.y - 0.3, z: box.min.z + 0.8      }, // ceiling NE corner
      { x: box.max.x - 0.8,       y: box.max.y - 0.3, z: box.min.z + 0.8      }, // ceiling NW corner
      { x: box.min.x + 0.5,       y: box.min.y + 1.1, z: center.z              }, // near-floor west wall
      { x: center.x + 0.5,        y: box.max.y - 0.15,z: center.z             }, // ceiling center
      { x: box.max.x - 1.2,       y: box.min.y + 1.8, z: box.max.z - 0.4      }, // south wall mid
    ];

    const SEVERITY_COLORS: Record<string, number> = {
      low: 0x88cc44, medium: 0xff9900, high: 0xff2222,
    };
    const SEVERITY_INTENSITY: Record<string, number> = {
      low: 1.0, medium: 2.0, high: 3.5,
    };

    MOCK_MOLD_FINDINGS.forEach((spot, i) => {
      const pos = positions[i] ?? positions[0];
      const col = SEVERITY_COLORS[spot.severity];
      const emitI = SEVERITY_INTENSITY[spot.severity];

      const geo = new THREE.SphereGeometry(0.18, 10, 10);
      const mat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: new THREE.Color(col),
        emissiveIntensity: emitI,
        transparent: true,
        opacity: 0.88,
      });
      const sphere = new THREE.Mesh(geo, mat);
      sphere.position.set(pos.x, pos.y, pos.z);
      sphere.renderOrder = 100;
      scene.add(sphere);

      const light = new THREE.PointLight(col, 1.5, 2.5);
      light.position.copy(sphere.position);
      scene.add(light);

      moldObjectsRef.current.push(sphere, light);
    });

    return () => {
      moldObjectsRef.current.forEach(o => scene.remove(o));
      moldObjectsRef.current = [];
    };
  }, [activeWorldLayer, roomReady]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Life simulation start + poll ──────────────────────────────── */
  const handleStartLifeSim = useCallback(async () => {
    if (!selectedPin) { toast.error("No property selected."); return; }
    setLifeSimStarting(true);
    try {
      const res = await lifeSimApi.startSim({
        lat: selectedPin.lat,
        lon: selectedPin.lng,
        property_id: /^\d+$/.test(String(selectedPin.id)) ? String(selectedPin.id) : undefined,
        num_ticks: 24,
      });
      simStore.startRun(res.run_id, res.simulation_month, res.month_name);
      setLifeSimActive(true);
      toast.success(`Life Simulation started — ${res.month_name}`);

      pollerRef.current = setInterval(async () => {
        try {
          const st = await lifeSimApi.getStatus(res.run_id);
          simStore.updateRun(st.status, st.progress, st.events || [], st.noise_sources_geo, st.neighbourhood_pois_geo);

          if (agentMgrRef.current && agents.length > 0) {
            const latestIndoor = [...(st.events || [])].reverse().find(e => e.location_type === "indoor");
            if (latestIndoor) agents[0].currentAction = latestIndoor.action || latestIndoor.narrative || "idle";
          }

          if (st.status === "completed" || st.status === "failed") {
            clearInterval(pollerRef.current!);
            pollerRef.current = null;
            if (st.status === "completed") {
              if (st.result) setLifeSimReport(st.result);
              toast.success("Life Simulation completed!");
            } else {
              toast.error("Life Simulation failed: " + (st.error || "unknown"));
            }
          }
        } catch { /* ignore poll errors */ }
      }, 3000);
    } catch (e: any) {
      toast.error("Failed to start simulation: " + (e?.response?.data?.detail || e.message));
    } finally {
      setLifeSimStarting(false);
    }
  }, [selectedPin, simStore, agents]);

  useEffect(() => () => { if (pollerRef.current) clearInterval(pollerRef.current); }, []);

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [simStore.simEvents.length]);

  /* ── Panorama upload + generate ─────────────────────────────────── */
  const handleGenerate = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Please select a panorama image file."); return; }

    setIsGenerating(true);
    setPipeStatus("Uploading...");
    const pipe = new PipelineClient();
    const opts: Record<string, string> = {
      align_panorama: String(alignPano),
      ignore_ceiling: String(hideCeiling),
    };
    if (selectedPin?.id && /^\d+$/.test(String(selectedPin.id))) opts.property_id = String(selectedPin.id);

    try {
      await pipe.run(
        file,
        opts,
        (state, step) => setPipeStatus(`[${state}] ${step}`),
        async (jobId) => {
          setPipeStatus("Loading generated mesh...");
          const roomEnv = roomEnvRef.current!;
          await roomEnv.loadFromJob(jobId);

          const fMgr = new FurnitureManager(sceneRef.current!, roomEnv);
          furnitureMgrRef.current = fMgr;
          agentMgrRef.current!.setFurnitureManager(fMgr);
          if (engineRef.current) engineRef.current.fm = fMgr;
          await fMgr.placeAll();
          _addDefaultArchitecture();

          if (user?.id && selectedPin?.id) saveJobId(user.id, selectedPin.id, jobId);
          setCurrentJobId(jobId);
          detectAndPlaceWindows(jobId);
          setPipeStatus("Room generated successfully.");
          setRoomReady(true);
          setShowUploadForm(false);
          setIsGenerating(false);
          toast.success("3D world generated!");

          if (roomEnv._mesh && controlsRef.current && cameraRef.current) {
            const box = new THREE.Box3().setFromObject(roomEnv._mesh);
            const c = box.getCenter(new THREE.Vector3());
            const s = box.getSize(new THREE.Vector3());
            const d = Math.max(s.x, s.z) * 0.9;
            controlsRef.current.target.set(c.x, 0, c.z);
            cameraRef.current.position.set(c.x, d * 0.6, c.z + d);
            controlsRef.current.update();
          }
        }
      );
    } catch (err: any) {
      setIsGenerating(false);
      setPipeStatus(`Error: ${err.message}`);
      toast.error(`Generation failed: ${err.message}`);
    }
  }, [alignPano, hideCeiling, selectedPin, user]);

  /* ── Window detection + Three.js placement ─────────────────────── */
  const detectAndPlaceWindows = useCallback(async (jobId: string) => {
    if (!sceneRef.current || !roomEnvRef.current) return;
    try {
      const tokenRaw = localStorage.getItem("hestia_token") ?? localStorage.getItem("access_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (tokenRaw) {
        const token = tokenRaw.startsWith('"') ? JSON.parse(tokenRaw) : tokenRaw;
        headers["Authorization"] = `Bearer ${token}`;
      }
      const resp = await fetch(`/api/windows/scan-from-job/${jobId}/`, { method: "POST", headers });
      if (!resp.ok) return;
      const data = await resp.json();
      const wins: Array<{
        face: string; cx: number; cy: number; width: number; height: number;
        confidence: number; face_image_url?: string;
      }> = data.windows ?? [];
      if (wins.length === 0) return;

      // Replace default placeholder windows with real detected ones
      defaultWindowMeshesRef.current.forEach(m => {
        m.geometry.dispose(); (m.material as THREE.Material).dispose();
        sceneRef.current?.remove(m);
      });
      defaultWindowMeshesRef.current = [];

      const mesh = roomEnvRef.current._mesh;
      const box = mesh ? new THREE.Box3().setFromObject(mesh) : null;
      const roomSize = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(6, 3, 6);
      const roomCenter = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);

      // Wall face → wall-surface position (at bounding box edge) + rotation
      const FACE_PARAMS: Record<string, { wallX: number; wallZ: number; rotY: number; horiz: "x" | "z" }> = {
        front: { wallX: 0,               wallZ:  box?.max.z ?? roomSize.z / 2,  rotY: 0,             horiz: "x" },
        back:  { wallX: 0,               wallZ:  box?.min.z ?? -roomSize.z / 2, rotY: Math.PI,       horiz: "x" },
        left:  { wallX: box?.min.x ?? -roomSize.x / 2, wallZ: 0,               rotY: Math.PI / 2,   horiz: "z" },
        right: { wallX: box?.max.x ?? roomSize.x / 2,  wallZ: 0,               rotY: -Math.PI / 2,  horiz: "z" },
      };

      // Cache textures per face so multiple windows on the same wall share one fetch
      const textureCache = new Map<string, THREE.Texture>();
      const loader = new THREE.TextureLoader();

      for (const w of wins) {
        const fp = FACE_PARAMS[w.face];
        if (!fp) continue;

        // Physical window size in Three.js world units
        const spanH = fp.horiz === "x" ? roomSize.x : roomSize.z;
        const ww = Math.max(w.width * spanH, 0.3);
        const wh = Math.max(w.height * roomSize.y, 0.3);
        const geo = new THREE.PlaneGeometry(ww, wh);

        // 3D position: at the wall surface, horizontally offset by cx within the span
        const hOffset = (w.cx - 0.5) * spanH;
        const posX = roomCenter.x + fp.wallX + (fp.horiz === "x" ? hOffset : 0);
        const posY = roomCenter.y + (w.cy - 0.5) * roomSize.y;
        const posZ = roomCenter.z + fp.wallZ + (fp.horiz === "z" ? hOffset : 0);

        // --- Load face image as texture and crop to the detection bbox ---
        let glassMat: THREE.Material;
        if (w.face_image_url) {
          try {
            let texture = textureCache.get(w.face);
            if (!texture) {
              texture = await loader.loadAsync(w.face_image_url);
              texture.wrapS = THREE.ClampToEdgeWrapping;
              texture.wrapT = THREE.ClampToEdgeWrapping;
              textureCache.set(w.face, texture.clone()); // store original for next window
            } else {
              texture = texture.clone();
            }
            // Crop UV to the detection bounding box
            // Three.js UV: origin is bottom-left, image coords: origin top-left → flip v
            texture.repeat.set(w.width, w.height);
            texture.offset.set(w.cx - w.width / 2, 1.0 - (w.cy + w.height / 2));
            texture.needsUpdate = true;

            glassMat = new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              opacity: 0.45,
              side: THREE.DoubleSide,
              depthTest: false,
            });
          } catch {
            // Texture load failed — fall back to emissive placeholder
            glassMat = new THREE.MeshStandardMaterial({
              color: 0x99ddff, transparent: true, opacity: 0.55,
              emissive: new THREE.Color(0x66bbee), emissiveIntensity: 1.2,
              side: THREE.DoubleSide, depthTest: false,
            });
          }
        } else {
          glassMat = new THREE.MeshStandardMaterial({
            color: 0x99ddff, transparent: true, opacity: 0.55,
            emissive: new THREE.Color(0x66bbee), emissiveIntensity: 1.2,
            side: THREE.DoubleSide, depthTest: false,
          });
        }

        // Stencil cutout — punches actual hole in wall so sky shows through
        const cutoutMat = new THREE.MeshBasicMaterial({
          colorWrite: false, depthWrite: false,
          stencilWrite: true, stencilRef: 1,
          stencilFunc: THREE.AlwaysStencilFunc,
          stencilZPass: THREE.ReplaceStencilOp,
          side: THREE.DoubleSide,
        });
        const cutout = new THREE.Mesh(geo.clone(), cutoutMat);
        cutout.position.set(posX, posY, posZ);
        cutout.rotation.y = fp.rotY;
        cutout.renderOrder = -1;
        sceneRef.current!.add(cutout);
        windowMeshesRef.current.push(cutout as any);

        // Glass pane — photo texture at low opacity over the hole
        const plane = new THREE.Mesh(geo, glassMat);
        plane.position.set(posX, posY, posZ);
        plane.rotation.y = fp.rotY;
        plane.renderOrder = 999;

        // Window frame — thin silver border lines
        const frameMat = new THREE.LineBasicMaterial({ color: 0xd0e8f0, depthTest: false });
        const frame = new THREE.LineSegments(new THREE.EdgesGeometry(geo), frameMat);
        frame.renderOrder = 1000;
        plane.add(frame);

        sceneRef.current!.add(plane);
        windowMeshesRef.current.push(plane);

        // Soft blue-white light spilling inward from the window
        const light = new THREE.PointLight(0xc8e8ff, 0.8, Math.max(roomSize.x, roomSize.z) * 0.6);
        light.position.set(posX, posY, posZ);
        sceneRef.current!.add(light);
      }

      // Dispose intermediate cache entries (each window owns its own cloned texture via mat.map)
      textureCache.forEach(t => t.dispose());

      setWindowsDetected(true);
      toast.success(`${wins.length} window${wins.length !== 1 ? "s" : ""} detected and placed.`);
    } catch { /* silently skip if endpoint unavailable */ }
  }, []);

  const handleTimeChange = useCallback((v: number[]) => {
    setTimeVal(v[0]);
    timeValRef.current = v[0];
    todRef.current?.setHour(v[0]);
  }, []);

  const handleSelectAgent = useCallback((a: Agent) => {
    agentMgrRef.current?.selectAgent(a);
    setSelectedAgent(a);
  }, []);

  const overlay = (
    <div className="fixed inset-0 z-[9999] bg-[#060610] overflow-hidden">

      {/* ── Three.js canvas ── */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── Agent labels ── */}
      <div ref={labelsRef} className="absolute inset-0 pointer-events-none overflow-hidden" />

      {/* ── Top header bar (always visible, safe from cutoff) ── */}
      <div className="absolute top-0 left-0 right-0 z-[1030] flex items-center gap-3 px-4 py-3 bg-black/80 backdrop-blur-md border-b border-white/10 pointer-events-none" style={{ transform: 'translateZ(0)' }}>
        <div className="flex items-center gap-2 flex-1 min-w-0 pointer-events-auto">
          {selectedPin?.title && (
            <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/15 min-w-0 flex items-center gap-1.5">
              <span className="text-sm font-semibold text-white truncate">{selectedPin.title}</span>
            </div>
          )}
          {roomReady && (
            <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-emerald-500/30 shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-300">3D Active</span>
              <button
                className="text-xs text-white/40 hover:text-white/80 ml-1 transition-colors"
                onClick={() => setShowUploadForm(true)}
              >
                · Re-scan
              </button>
            </div>
          )}
          {windowsDetected && (
            <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-sky-500/30 shrink-0">
              <span className="text-xs font-medium text-sky-300">Windows detected</span>
            </div>
          )}
        </div>
        <button
          onClick={() => { setWorldOpen(false); closeOverlay(); }}
          className="pointer-events-auto w-9 h-9 rounded-full flex items-center justify-center bg-black/60 backdrop-blur-md border border-white/20 text-white hover:bg-white/10 hover:border-white/40 transition-all shrink-0"
          aria-label="Close 3D World"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Scenario phase banner (below header) ── */}
      {currentPhase && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md px-8 py-4 rounded-3xl border border-[hsl(var(--holo-cyan)/0.5)] z-[1015] text-center shadow-[0_0_20px_rgba(0,255,255,0.2)] max-w-lg w-full pointer-events-none">
          <h3 className="text-[hsl(var(--holo-cyan))] font-bold text-sm tracking-widest uppercase mb-1.5">{currentPhase.title}</h3>
          <p className="text-white/90 text-sm">{currentPhase.description}</p>
        </div>
      )}

      {/* ── Generation / empty state overlay ── */}
      {!roomReady && (
        <div className="absolute inset-0 z-[1020] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          {isCheckingExistingJob ? (
            <div className="flex flex-col items-center gap-4 text-white">
              <Loader2 className="h-10 w-10 animate-spin text-[hsl(var(--holo-cyan))]" />
              <p className="text-sm text-muted-foreground">Checking for saved 3D world…</p>
            </div>
          ) : (
            <div className="holo-surface rounded-3xl p-8 w-full max-w-md mx-4 flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <Sparkles className="h-6 w-6 text-[hsl(var(--holo-cyan))]" />
                <h2 className="text-xl font-semibold holo-text-glow">Generate 3D World</h2>
              </div>

              <p className="text-sm text-white/60">
                Upload a 360° panorama to reconstruct the interior of this property in 3D.
              </p>

              <div>
                <Label className="mb-2 block text-sm font-medium text-white">Panorama Image</Label>
                <Input type="file" ref={fileRef} accept="image/*" className="rounded-2xl text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-2xl bg-black/30 border border-white/10 px-4 py-3">
                  <Label className="text-sm cursor-pointer text-white/80" htmlFor="align-pano">Viewport Align</Label>
                  <Switch id="align-pano" checked={alignPano} onCheckedChange={setAlignPano} />
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-black/30 border border-white/10 px-4 py-3">
                  <Label className="text-sm cursor-pointer text-white/80" htmlFor="hide-ceil">Hide Ceiling</Label>
                  <Switch id="hide-ceil" checked={hideCeiling} onCheckedChange={setHideCeiling} />
                </div>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full rounded-2xl font-semibold py-5"
                style={{ background: "linear-gradient(135deg, hsl(185 95% 45%), hsl(185 95% 65%))", boxShadow: "0 0 20px hsl(185 95% 65% / 0.4)" }}
              >
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" /> Generate 3D World</>
                )}
              </Button>

              {isGenerating && (
                <div className="text-xs font-mono text-[hsl(var(--holo-cyan))] flex items-center gap-2 bg-black/40 rounded-xl px-3 py-2">
                  <span className="w-2 h-2 rounded-full bg-[hsl(var(--holo-cyan))] animate-pulse" />
                  {pipeStatus}
                </div>
              )}

              {roomReady && (
                <button
                  className="text-xs text-muted-foreground hover:text-white transition-colors"
                  onClick={() => setShowUploadForm(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Upload new panorama (when room ready) ── */}
      {roomReady && showUploadForm && (
        <div className="absolute inset-0 z-[1020] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="holo-surface rounded-3xl p-8 w-full max-w-md mx-4 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Upload className="h-6 w-6 text-[hsl(var(--holo-cyan))]" />
                <h2 className="text-xl font-semibold holo-text-glow">Upload New Panorama</h2>
              </div>
              <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setShowUploadForm(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <Input type="file" ref={fileRef} accept="image/*" className="rounded-2xl text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-2xl bg-black/30 border border-white/10 px-4 py-3">
                <Label className="text-sm text-white/80" htmlFor="align-pano2">Viewport Align</Label>
                <Switch id="align-pano2" checked={alignPano} onCheckedChange={setAlignPano} />
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-black/30 border border-white/10 px-4 py-3">
                <Label className="text-sm text-white/80" htmlFor="hide-ceil2">Hide Ceiling</Label>
                <Switch id="hide-ceil2" checked={hideCeiling} onCheckedChange={setHideCeiling} />
              </div>
            </div>
            <Button onClick={handleGenerate} disabled={isGenerating} className="w-full rounded-2xl font-semibold py-5" style={{ background: "linear-gradient(135deg, hsl(185 95% 45%), hsl(185 95% 65%))", boxShadow: "0 0 20px hsl(185 95% 65% / 0.4)" }}>
              {isGenerating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</> : <><Upload className="h-4 w-4 mr-2" /> Generate</>}
            </Button>
          </div>
        </div>
      )}

      {/* ── Time of day slider (bottom center) with sun / moon ── */}
      {roomReady && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1015] holo-surface rounded-2xl px-5 py-3 flex items-center gap-3" style={{ minWidth: "300px" }}>
          <Sun className={`h-4 w-4 flex-shrink-0 transition-colors duration-500 ${timeVal >= 6 && timeVal <= 19 ? "text-amber-400" : "text-white/20"}`} />
          <Slider value={[timeVal]} min={0} max={24} step={0.25} onValueChange={handleTimeChange} className="flex-1" />
          <Moon className={`h-4 w-4 flex-shrink-0 transition-colors duration-500 ${timeVal < 6 || timeVal > 19 ? "text-indigo-300" : "text-white/20"}`} />
          <span className="text-xs font-mono text-[hsl(var(--holo-cyan))] whitespace-nowrap w-10 text-right">
            {formatTimeLabel(timeVal)}
          </span>
        </div>
      )}

      {/* ── Property stats layer panel ── */}
      <StatsLayerPanel isActive={activeWorldLayer === "stats"} pinId={selectedPinId} />

      {/* ── Layer toolbar ── */}
      {roomReady && <LayerToolbar />}

      {/* ── Mold layer panel ── */}
      <MoldLayerPanel isActive={activeWorldLayer === "mold"} />

      {/* ── Simulation layer panel ── */}
      <SimulationLayerPanel
        agentMgrRef={agentMgrRef}
        engineRef={engineRef}
        agents={agents}
        selectedAgent={selectedAgent}
        onSelectAgent={handleSelectAgent}
        selectedPin={selectedPin}
        lifeSimStarting={lifeSimStarting}
        lifeSimActive={lifeSimActive}
        onStartLifeSim={handleStartLifeSim}
        onShowLifeSimReport={() => setLifeSimReport(lifeSimReport || true)}
        onSpawnPersona={handleSpawnPersona}
        roomReady={roomReady}
        isActive={activeWorldLayer === "simulation"}
        feedEndRef={feedEndRef}
      />

      {/* ── Appliance grade labels (3D world, energy layer active) ── */}
      {activeWorldLayer === "energy" && applianceScanResult && furnitureMgrRef.current && cameraRef.current && containerRef.current && (() => {
        const camera = cameraRef.current!;
        const rect = containerRef.current!.getBoundingClientRect();
        const tmpV = new THREE.Vector3();
        const GRADE_HEX: Record<string, string> = {
          "A+++": "#34d399", "A++": "#34d399", "A+": "#4ade80",
          "A": "#86efac", "B": "#a3e635", "C": "#facc15",
          "D": "#fb923c", "E": "#f87171", "F": "#ef4444",
        };
        return furnitureMgrRef.current!.furniture.map((fp, idx) => {
          const match = applianceScanResult.appliances.find(
            a => a.detected_class === fp.type || fp.type.startsWith(a.detected_class) || a.detected_class.startsWith(fp.type)
          );
          if (!match) return null;
          tmpV.set(fp.x, 1.8, fp.z);
          tmpV.project(camera);
          if (tmpV.z > 1) return null; // behind camera
          const sx = (tmpV.x * 0.5 + 0.5) * rect.width;
          const sy = (-tmpV.y * 0.5 + 0.5) * rect.height;
          const col = GRADE_HEX[match.grade] ?? "#9ca3af";
          return (
            <div
              key={`appliance-grade-${idx}`}
              className="absolute pointer-events-none select-none"
              style={{ left: sx, top: sy, transform: "translate(-50%,-100%)" }}
            >
              <div
                className="text-xs font-bold px-2 py-1 rounded-xl border backdrop-blur-sm text-center shadow-lg"
                style={{ color: col, borderColor: col + "60", background: col + "18", boxShadow: `0 0 10px ${col}40`, minWidth: 32 }}
              >
                <div className="text-lg leading-none font-black">{match.grade}</div>
                <div className="text-[9px] opacity-70 capitalize mt-0.5">{fp.type}</div>
              </div>
            </div>
          );
        });
      })()}

      {/* ── Mold spot labels (3D world, mold layer active) ── */}
      {activeWorldLayer === "mold" && cameraRef.current && containerRef.current && roomReady && (() => {
        const camera = cameraRef.current!;
        const rect = containerRef.current!.getBoundingClientRect();
        const mesh = roomEnvRef.current?._mesh;
        if (!mesh) return null;
        const box = new THREE.Box3().setFromObject(mesh);
        const center = box.getCenter(new THREE.Vector3());
        const positions = [
          { x: box.min.x + 0.8, y: box.max.y - 0.3, z: box.min.z + 0.8 },
          { x: box.max.x - 0.8, y: box.max.y - 0.3, z: box.min.z + 0.8 },
          { x: box.min.x + 0.5, y: box.min.y + 1.1, z: center.z         },
          { x: center.x + 0.5, y: box.max.y - 0.15, z: center.z          },
          { x: box.max.x - 1.2, y: box.min.y + 1.8, z: box.max.z - 0.4  },
        ];
        const SEVERITY_STYLE_MAP: Record<string, { color: string; emoji: string }> = {
          low:    { color: "#a3e635", emoji: "🟢" },
          medium: { color: "#fb923c", emoji: "🟡" },
          high:   { color: "#ef4444", emoji: "🔴" },
        };
        const tmpV = new THREE.Vector3();
        return MOCK_MOLD_FINDINGS.map((spot, i) => {
          const pos = positions[i] ?? positions[0];
          tmpV.set(pos.x, pos.y + 0.3, pos.z);
          tmpV.project(camera);
          if (tmpV.z > 1) return null;
          const sx = (tmpV.x * 0.5 + 0.5) * rect.width;
          const sy = (-tmpV.y * 0.5 + 0.5) * rect.height;
          const sty = SEVERITY_STYLE_MAP[spot.severity];
          return (
            <div
              key={`mold-${i}`}
              className="absolute pointer-events-none select-none"
              style={{ left: sx, top: sy, transform: "translate(-50%,-100%)" }}
            >
              <div
                className="text-[10px] font-bold px-2 py-1 rounded-full border backdrop-blur-sm whitespace-nowrap"
                style={{ color: sty.color, borderColor: sty.color + "60", background: sty.color + "18", boxShadow: `0 0 8px ${sty.color}50` }}
              >
                {sty.emoji} {spot.severity === "high" ? "High Risk" : spot.severity === "medium" ? "Medium" : "Low"} · {spot.coverage}%
              </div>
            </div>
          );
        });
      })()}

      {/* ── House Rules Modal ── */}
      <Dialog
        open={!!rulesData}
        onOpenChange={(o) => { if (!o) { setRulesData(null); engineRef.current?.resumeAfterRules(); } }}
      >
        <DialogContent
          className="sm:max-w-md border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold">House Rules Generated</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-gray-300">To resolve the conflict and improve compatibility, the system recommends:</p>
            <ul className="space-y-2">
              {rulesData?.map((rule, i) => (
                <li key={i} className="text-sm bg-[#1e1e35] p-3 rounded-2xl border border-gray-700">{rule}</li>
              ))}
            </ul>
          </div>
          <DialogFooter className="sm:justify-center">
            <div className="text-xs text-[hsl(var(--holo-cyan))] flex items-center gap-2 animate-pulse">
              <Sparkles className="h-3 w-3" /> Agents are reading and accepting the rules...
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Scenario Report Modal ── */}
      <Dialog open={!!reportData} onOpenChange={() => setReportData(null)}>
        <DialogContent className="sm:max-w-xl border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> Simulation Report
            </DialogTitle>
          </DialogHeader>
          {reportData && (
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
              <div className="flex items-center justify-between bg-[#1e1e35] p-4 rounded-2xl border border-gray-800">
                <span className="font-medium text-gray-300">Compatibility Score</span>
                <span className={`text-3xl font-bold ${(reportData?.finalScore ?? 0) >= 70 ? "text-green-400" : "text-red-400"}`}>
                  {reportData?.finalScore ?? 0}%
                </span>
              </div>
              {reportData?.conflicts?.length > 0 && (
                <div className="bg-red-950/20 p-4 rounded-2xl border border-red-900/30">
                  <h4 className="text-red-400 font-semibold mb-2">Conflicts Detected</h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {reportData.conflicts.map((c: string, i: number) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {reportData?.goodMoments?.length > 0 && (
                <div className="bg-green-950/20 p-4 rounded-2xl border border-green-900/30">
                  <h4 className="text-green-400 font-semibold mb-2">Good Moments</h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {reportData.goodMoments.map((c: string, i: number) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {reportData?.recommendations?.length > 0 && (
                <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-2">Recommendations</h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {reportData.recommendations.map((c: string, i: number) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setReportData(null)} variant="outline" className="w-full rounded-2xl border-gray-700 hover:bg-gray-800">
              Close Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Life Simulation Final Report Modal ── */}
      <Dialog open={!!lifeSimReport} onOpenChange={(o) => !o && setLifeSimReport(null)}>
        <DialogContent className="sm:max-w-xl border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5" /> Life Simulation Report
            </DialogTitle>
          </DialogHeader>
          {lifeSimReport && lifeSimReport.satisfaction_summary && (
            <div className="space-y-6 py-4 max-h-[75vh] overflow-y-auto pr-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#1e1e35] p-5 rounded-2xl border border-gray-800 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10"><Target className="w-16 h-16" /></div>
                  <span className="text-gray-400 text-sm uppercase tracking-wider block mb-1">Final Satisfaction</span>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold ${(lifeSimReport.satisfaction_summary.final_score ?? 0) >= 0.70 ? "text-green-400" : (lifeSimReport.satisfaction_summary.final_score ?? 0) >= 0.50 ? "text-amber-400" : "text-red-400"}`}>
                      {Math.round((lifeSimReport.satisfaction_summary.final_score ?? 0) * 100)}%
                    </span>
                  </div>
                </div>
                <div className="bg-[#1e1e35] p-5 rounded-2xl border border-[hsl(var(--holo-cyan)/0.3)]">
                  <span className="text-[hsl(var(--holo-cyan))] text-sm uppercase tracking-wider block mb-1">Status</span>
                  <p className="text-xl font-bold text-white capitalize">{lifeSimReport.satisfaction_summary.satisfaction_label || "Completed"}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: CheckCircle, color: "emerald", label: "Smooth", val: lifeSimReport.satisfaction_summary.success_events || 0 },
                  { icon: AlertCircle, color: "amber", label: "Friction", val: lifeSimReport.satisfaction_summary.friction_events || 0 },
                  { icon: XCircle, color: "red", label: "Blocked", val: lifeSimReport.satisfaction_summary.blocked_events || 0 },
                ].map(({ icon: Icon, color, label, val }) => (
                  <div key={label} className={`bg-${color}-950/20 border border-${color}-900/30 p-4 rounded-2xl flex flex-col items-center`}>
                    <Icon className={`h-6 w-6 text-${color}-500 mb-2`} />
                    <span className={`text-2xl font-bold text-${color}-400`}>{val}</span>
                    <span className="text-xs text-gray-400 mt-1 uppercase">{label}</span>
                  </div>
                ))}
              </div>

              {lifeSimReport.satisfaction_summary.trajectory?.length > 0 && (
                <div className="bg-[#151522] p-4 rounded-2xl border border-gray-800">
                  <h4 className="text-gray-300 font-semibold mb-4 text-sm uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> Satisfaction Trajectory
                  </h4>
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={lifeSimReport.satisfaction_summary.trajectory.map((val: number, i: number) => ({ tick: `T${i}`, score: Math.round(val * 100) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" vertical={false} />
                        <XAxis dataKey="tick" stroke="#6b7280" fontSize={10} tickMargin={8} minTickGap={15} />
                        <YAxis stroke="#6b7280" fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <RechartsTooltip contentStyle={{ backgroundColor: "#1e1e35", borderColor: "#374151", borderRadius: "12px", fontSize: "12px" }} formatter={(v: number) => [`${v}%`, "Score"]} />
                        <ReferenceLine y={50} stroke="#4b5563" strokeDasharray="3 3" />
                        <Line type="monotone" dataKey="score" stroke="hsl(var(--holo-cyan))" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {lifeSimReport.reflection && (
                <div className="bg-gradient-to-br from-[#1e1e35] to-[#151525] p-5 rounded-2xl border border-[hsl(var(--holo-cyan)/0.3)]">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-3 flex items-center gap-2">
                    <Bot className="h-5 w-5" /> AI Reflection
                  </h4>
                  <p className="text-gray-300 text-sm leading-relaxed italic border-l-4 border-[hsl(var(--holo-cyan)/0.5)] pl-4">"{String(lifeSimReport.reflection)}"</p>
                </div>
              )}

              {lifeSimReport.pain_points?.length > 0 && (
                <div>
                  <h4 className="text-red-400 font-semibold mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
                    <TrendingDown className="h-4 w-4" /> Top Pain Points
                  </h4>
                  <div className="space-y-2">
                    {lifeSimReport.pain_points.map((p: any, i: number) => (
                      <div key={i} className="bg-red-950/20 p-3 rounded-xl border border-red-900/30 flex items-start gap-3">
                        <div className="bg-red-900/40 text-red-300 font-mono text-[10px] px-2 py-1 rounded mt-0.5 whitespace-nowrap">{p?.time_of_day || "--:--"}</div>
                        <div>
                          <p className="font-medium text-gray-200 text-sm">{p?.action || "Action"}</p>
                          <p className="text-red-400 text-xs mt-0.5">Felt {p?.emotion || "neutral"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Activity className="h-3 w-3" />
                <span>Net change: {((lifeSimReport.satisfaction_summary.net_change ?? 0) * 100) > 0 ? "+" : ""}{Math.round((lifeSimReport.satisfaction_summary.net_change ?? 0) * 100)}%</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setLifeSimReport(null)} variant="outline" className="w-full rounded-2xl border-gray-700 hover:bg-gray-800 text-white">
              Close Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Feature overlays rendered inside the 3D world ── */}
      {activeOverlay === "persona-builder"        && <PersonaBuilder />}
      {activeOverlay === "apartment-configurator" && <ApartmentConfigurator />}
      {activeOverlay === "apt-configurator"       && <ApartmentConfigurator />}
      {activeOverlay === "reports"                && <Reports />}
      {activeOverlay === "material-agent"         && <MaterialAgent />}
      {activeOverlay === "admin-assistant"        && <AdminAssistant />}
      {activeOverlay === "neighborhood-intel"     && <NeighborhoodIntel />}
      {activeOverlay === "appliance-energy"       && <ApplianceEnergy />}
      {activeOverlay === "roommate-compat"        && <RoommatePanel />}
    </div>
  );

  return createPortal(overlay, document.body);
}
