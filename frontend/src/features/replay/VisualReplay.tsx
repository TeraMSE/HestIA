import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload, Users, Eye, Play, Sparkles, Loader2, Bot,
  MapPin, CheckCircle2, FileText, Activity, CheckCircle,
  AlertCircle, XCircle, TrendingUp, TrendingDown, Target, Globe2,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { SimWorkspace } from "@/features/workspace/SimWorkspace";
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
import type { SimEvent } from "@/services/lifeSimApi";

export function VisualReplay() {
  const { replayMode, setReplayMode, selectedPersonaA, selectedPersonaB, personas, pins, selectedPinId } = useApp();
  const close = useApp((s) => s.closeOverlay);
  const { user } = useAuthStore();
  const simStore = useSimStore();
  const selectedPin = pins.find((p) => p.id === selectedPinId) ?? null;

  /* refs for Three.js */
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
  const analysisOverlayRef = useRef<THREE.Group | null>(null);

  /* state */
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
  const [panoramaAnalysis, setPanoramaAnalysis] = useState<any | null>(null);
  const [signalPlacements, setSignalPlacements] = useState<{
    air?: { kind: "window" | "door"; index: number };
    light?: { kind: "window" | "door"; index: number };
  }>({});
  const [draggingSignal, setDraggingSignal] = useState<"air" | "light" | null>(null);
  const [, forceUpdate] = useState(0);

  /* UI state */
  const [tab, setTab] = useState<"env" | "agents">("env");
  const [systemLayer, setSystemLayer] = useState<"energy" | "agentSim">("energy");
  const [envOverlayOpen, setEnvOverlayOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [panoSelected, setPanoSelected] = useState(false);
  const [alignPano, setAlignPano] = useState(true);
  const [hideCeiling, setHideCeiling] = useState(true);
  const [texturesShown, setTexturesShown] = useState(true);
  const cachePlacementsRef = useRef<{ type: any; x: number; z: number; rotY?: number }[] | null>(null);
  const cacheJobIdRef = useRef<string | null>(null);

  /* Life sim state */
  const [lifeSimActive, setLifeSimActive] = useState(false);
  const [lifeSimStarting, setLifeSimStarting] = useState(false);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  const isAgentLayer = systemLayer === "agentSim";

  const clearAnalysisOverlay = useCallback(() => {
    const scene = sceneRef.current;
    const overlay = analysisOverlayRef.current;
    if (!scene || !overlay) return;
    scene.remove(overlay);
    overlay.traverse((o: any) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m: THREE.Material) => m.dispose());
          else o.material.dispose();
        }
      }
    });
    analysisOverlayRef.current = null;
  }, []);

  const fetchPanoramaAnalysis = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/artifact/analysis/`);
      if (!res.ok) {
        setPanoramaAnalysis(null);
        return;
      }
      const data = await res.json();
      setPanoramaAnalysis(data);
    } catch {
      setPanoramaAnalysis(null);
    }
  }, []);

  const projectWorldPoint = useCallback((x: number, z: number, y: number) => {
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!camera || !container) return null;
    const vector = new THREE.Vector3(x, y, z).project(camera);
    const rect = container.getBoundingClientRect();
    return {
      x: ((vector.x + 1) * 0.5) * rect.width,
      y: ((1 - vector.y) * 0.5) * rect.height,
      visible: vector.z >= -1 && vector.z <= 1,
    };
  }, []);

  const getAnalysisPoint = useCallback((entry: any) => {
    const roomEnv = roomEnvRef.current;
    if (!roomEnv || !roomEnv._floorPolygon || roomEnv._floorPolygon.length < 2) return null;
    const poly = roomEnv._floorPolygon;
    const wallIndex = Number(entry?.wall_index ?? 0);
    const idx = Math.max(0, Math.min(poly.length - 1, wallIndex));
    const a = poly[idx];
    const b = poly[(idx + 1) % poly.length];

    let t = 0.5;
    const seg = panoramaAnalysis?.spatial?.wall_segments?.[idx];
    const u = Number(entry?.center_u ?? 0.5);
    if (seg && typeof seg.start_u === "number" && typeof seg.end_u === "number") {
      const s = seg.start_u as number;
      const e = seg.end_u as number;
      if (s <= e) {
        t = Math.max(0, Math.min(1, (u - s) / Math.max(1e-6, e - s)));
      } else {
        const span = Math.max(1e-6, (1 - s) + e);
        const du = u >= s ? (u - s) : ((1 - s) + u);
        t = Math.max(0, Math.min(1, du / span));
      }
    }

    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }, [panoramaAnalysis]);

  const handleSignalDrop = useCallback((signalKind: "air" | "light", targetKind: "window" | "door", index: number) => {
    setSignalPlacements((prev) => ({
      ...prev,
      [signalKind]: { kind: targetKind, index },
    }));
    setDraggingSignal(null);
  }, []);

  const analysisTargets = (panoramaAnalysis?.spatial?.windows || []).map((entry: any, index: number) => ({
    id: `window-${index}`,
    kind: "window" as const,
    index,
    entry,
    label: `Window ${index + 1}`,
    color: "#53d8fb",
  })).concat((panoramaAnalysis?.spatial?.doors || []).map((entry: any, index: number) => ({
    id: `door-${index}`,
    kind: "door" as const,
    index,
    entry,
    label: `Door ${index + 1}`,
    color: entry?.type === "open" ? "#f59e0b" : "#fb7185",
  })));

  const floorPolygon = roomEnvRef.current?._floorPolygon ?? [];
  const floorBounds = roomEnvRef.current?.getBounds();
  const wallSegments = panoramaAnalysis?.spatial?.wall_segments || [];
  const windows = panoramaAnalysis?.spatial?.windows || [];
  const doors = panoramaAnalysis?.spatial?.doors || [];
  const windowCount = windows.length;
  const doorCount = doors.length;
  const openingCount = windows.length + doors.length;
  const wallCount = wallSegments.length || floorPolygon.length || 0;
  const normalizedLightScore = Math.max(0, Math.min(1, Number(panoramaAnalysis?.insights?.light_score ?? 0)));
  const lightDirectionDeg = Number(panoramaAnalysis?.insights?.light_direction_deg ?? 0);
  const lightDirectionLabel = (() => {
    const angle = ((lightDirectionDeg % 360) + 360) % 360;
    if (angle < 22.5 || angle >= 337.5) return "North";
    if (angle < 67.5) return "North-East";
    if (angle < 112.5) return "East";
    if (angle < 157.5) return "South-East";
    if (angle < 202.5) return "South";
    if (angle < 247.5) return "South-West";
    if (angle < 292.5) return "West";
    return "North-West";
  })();
  const openingDensity = wallCount > 0 ? openingCount / wallCount : 0;
  const draftRisk = Math.min(1, Math.max(0, openingDensity * 0.6 + (doors.length > 0 ? 0.15 : 0)));
  const roomKindLabel = windowCount === 1 && doorCount === 1 ? "Small Bathroom" : "Bathroom";
  const openingSummaryLabel = `${windowCount} window${windowCount === 1 ? "" : "s"} · ${doorCount} door${doorCount === 1 ? "" : "s"}`;
  const bathroomCaseLabel = windowCount === 1 && doorCount === 1 ? "Small bathroom case" : "Scale : Small";
  const bathroomOpeningLabel = windowCount === 1 && doorCount === 1 ? "1 window · 1 door" : openingSummaryLabel;
  const floorArea = (() => {
    if (floorPolygon.length < 3) {
      if (!floorBounds) return null;
      return Math.max(0, (floorBounds.maxX - floorBounds.minX) * (floorBounds.maxZ - floorBounds.minZ));
    }
    let sum = 0;
    for (let i = 0; i < floorPolygon.length; i += 1) {
      const a = floorPolygon[i];
      const b = floorPolygon[(i + 1) % floorPolygon.length];
      sum += a.x * b.z - b.x * a.z;
    }
    return Math.abs(sum) / 2;
  })();
  const estimatedDailyEnergyKwh = Math.max(
    0.18,
    Math.min(0.42, 0.16 + (floorArea ?? 6) * 0.014 + windowCount * 0.03 + doorCount * 0.01 + draftRisk * 0.02 - normalizedLightScore * 0.04)
  );
  const estimatedMonthlyEnergyKwh = estimatedDailyEnergyKwh * 30;
  const bathroomEnergyScore = Math.max(10, Math.min(28, Math.round(estimatedDailyEnergyKwh * 60)));
  const perimeter = (() => {
    if (floorPolygon.length < 2) return null;
    let total = 0;
    for (let i = 0; i < floorPolygon.length; i += 1) {
      const a = floorPolygon[i];
      const b = floorPolygon[(i + 1) % floorPolygon.length];
      total += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return total;
  })();

  /* ── Initialize Three.js scene ─────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const rootStyles = getComputedStyle(document.documentElement);
    const cardVar = rootStyles.getPropertyValue("--card").trim();
    const bgColor = `hsl(${cardVar})`;
    scene.background = new THREE.Color(bgColor);
    scene.fog = new THREE.Fog(bgColor, 25, 80);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    camera.position.set(5, 4, 8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    // ensure the canvas CSS fills its parent so overlays sit on top without hollow gaps
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.left = "0";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    const grid = new THREE.GridHelper(20, 20, 0x334863, 0x1e2b3e);
    grid.position.y = -1.6;
    scene.add(grid);

    const gnd = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(bgColor).multiplyScalar(0.98), roughness: 0.95 })
    );
    gnd.rotation.x = -Math.PI / 2;
    gnd.position.y = -1.6;
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
      // use integer sizes for renderer but keep CSS 100% so the canvas visually fills
      renderer.setSize(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
      if (renderer.domElement) {
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
      }
    };
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    onResize();

    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      controls.update();
      agentMgr.update();
      renderer.render(scene, camera);
    };
    animate();

    const uiTimer = setInterval(() => forceUpdate((n) => n + 1), 100);

    return () => {
      clearInterval(uiTimer);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      clearAnalysisOverlay();
      if (animIdRef.current !== null) cancelAnimationFrame(animIdRef.current);
      if (engineRef.current) engineRef.current.stop();
      agentMgr.dispose();
      furnitureMgrRef.current?.dispose();
      roomEnv.dispose();
      tod.dispose();
      controls.dispose();
      renderer.dispose();
      if (container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [clearAnalysisOverlay]);

  /* ── Auto-Spawn User Persona on Room Ready ─────────────────────── */
  useEffect(() => {
    if (systemLayer === "agentSim" && roomReady && agentMgrRef.current && agents.length === 0) {
      void (async () => {
        const userName = user?.first_name || user?.email?.split("@")[0] || "You";
        const a = await agentMgrRef.current?.spawnAgent("male");
        if (a) {
          a.label = userName;
          a.color = "#22d3ee";
        }
        toast.success(`Your persona "${userName}" is ready in the room.`);
        setTab("agents");
      })();
    }
  }, [roomReady, user, agents.length, systemLayer]);

  /* ── Life Simulation: start + poll ─────────────────────────────── */
  const handleStartLifeSim = useCallback(async () => {
    if (!selectedPin) {
      toast.error("No property selected.");
      return;
    }
    setLifeSimStarting(true);
    try {
      const res = await lifeSimApi.startSim({
        lat: selectedPin.lat,
        lon: selectedPin.lng,
        property_id: String(selectedPin.id),
        num_ticks: 24,
      });
      simStore.startRun(res.run_id, res.simulation_month, res.month_name);
      setLifeSimActive(true);
      toast.success(`Life Simulation started — ${res.month_name}`);

      pollerRef.current = setInterval(async () => {
        try {
          const st = await lifeSimApi.getStatus(res.run_id);
          simStore.updateRun(
            st.status,
            st.progress,
            st.events || [],
            st.noise_sources_geo,
            st.neighbourhood_pois_geo,
          );

          if (agentMgrRef.current && agents.length > 0) {
            const latestIndoor = [...(st.events || [])].reverse().find(e => e.location_type === "indoor");
            if (latestIndoor) {
              const agent = agents[0];
              agent.currentAction = latestIndoor.action || latestIndoor.narrative || "idle";
            }
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

  useEffect(() => {
    return () => {
      if (pollerRef.current) clearInterval(pollerRef.current);
    };
  }, []);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [simStore.simEvents.length]);

  useEffect(() => {
    setSignalPlacements({});
  }, [panoramaAnalysis]);

  // Render panorama analysis overlays (walls/windows/doors/light) on top of the 3D room.
  useEffect(() => {
    clearAnalysisOverlay();
    if (!panoramaAnalysis || !roomReady) return;
    const scene = sceneRef.current;
    const roomEnv = roomEnvRef.current;
    if (!scene || !roomEnv || !roomEnv._floorPolygon || roomEnv._floorPolygon.length < 3) return;

    const floorY = roomEnv.getFloorY ? roomEnv.getFloorY() : -2.0;
    const poly = roomEnv._floorPolygon;
    const walls = panoramaAnalysis?.spatial?.wall_colors || [];
    const segments = panoramaAnalysis?.spatial?.wall_segments || [];
    const windows = panoramaAnalysis?.spatial?.windows || [];
    const doors = panoramaAnalysis?.spatial?.doors || [];

    const group = new THREE.Group();
    group.name = "PanoramaAnalysisOverlay";

    const wallCount = Math.min(poly.length, walls.length || poly.length);
    for (let i = 0; i < wallCount; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;

      const wallColor = walls[i] || "#89a7c2";
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(len, 1.25),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(wallColor),
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      panel.position.set(mx, floorY + 1.15, mz);
      panel.rotation.y = -Math.atan2(dz, dx) + Math.PI / 2;
      group.add(panel);
    }

    const wallPointForU = (u: number, wallIndex: number): { x: number; z: number } => {
      const idx = Math.max(0, Math.min(poly.length - 1, wallIndex | 0));
      const a = poly[idx];
      const b = poly[(idx + 1) % poly.length];

      let t = 0.5;
      const seg = segments[idx];
      if (seg && typeof seg.start_u === "number" && typeof seg.end_u === "number") {
        const s = seg.start_u as number;
        const e = seg.end_u as number;
        if (s <= e) {
          const den = Math.max(1e-6, e - s);
          t = Math.max(0, Math.min(1, (u - s) / den));
        } else {
          const span = Math.max(1e-6, (1 - s) + e);
          const du = u >= s ? (u - s) : ((1 - s) + u);
          t = Math.max(0, Math.min(1, du / span));
        }
      }

      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
      };
    };

    for (const w of windows) {
      const p = wallPointForU(Number(w.center_u ?? 0.5), Number(w.wall_index ?? 0));
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x53d8fb, transparent: true, opacity: 0.95, depthWrite: false })
      );
      marker.position.set(p.x, floorY + 1.45, p.z);
      group.add(marker);
    }

    for (const d of doors) {
      const p = wallPointForU(Number(d.center_u ?? 0.5), Number(d.wall_index ?? 0));
      const conf = Number(d.confidence ?? 0.5);
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.22, 0.12),
        new THREE.MeshBasicMaterial({
          color: d.type === "open" ? 0xf59e0b : 0xfb7185,
          transparent: true,
          opacity: conf < 0.5 ? 0.4 : 0.9,
          depthWrite: false,
        })
      );
      marker.position.set(p.x, floorY + 1.0, p.z);
      group.add(marker);
    }

    const dirDeg = Number(panoramaAnalysis?.insights?.light_direction_deg ?? 0);
    const center = poly.reduce((acc: { x: number; z: number }, p: { x: number; z: number }) => {
      acc.x += p.x;
      acc.z += p.z;
      return acc;
    }, { x: 0, z: 0 });
    center.x /= poly.length;
    center.z /= poly.length;

    const theta = (dirDeg * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(theta), 0, -Math.cos(theta)).normalize();
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(center.x, floorY + 1.9, center.z), 1.4, 0xffdd66, 0.28, 0.16);
    group.add(arrow);

    group.visible = true;
    scene.add(group);
    analysisOverlayRef.current = group;
  }, [panoramaAnalysis, roomReady, clearAnalysisOverlay]);

  // Layer visibility gate: Energy layer shows only the textured room shell.
  useEffect(() => {
    const showAgents = systemLayer === "agentSim";
    if (agentMgrRef.current) {
      for (const a of agentMgrRef.current.agents) {
        if (a.group) a.group.visible = showAgents;
        if (a.labelEl) a.labelEl.style.display = showAgents ? "" : "none";
      }
    }
    furnitureMgrRef.current?.setVisible(showAgents);
  }, [systemLayer, agents.length]);

  // When entering Agent Sim layer, populate furniture if not already present.
  useEffect(() => {
    const hydrateAgentLayer = async () => {
      if (systemLayer !== "agentSim" || !roomReady) return;
      const scene = sceneRef.current;
      const roomEnv = roomEnvRef.current;
      if (!scene || !roomEnv) return;

      if (!furnitureMgrRef.current) {
        const fMgr = new FurnitureManager(scene, roomEnv);
        furnitureMgrRef.current = fMgr;
        agentMgrRef.current?.setFurnitureManager(fMgr);
        if (engineRef.current) (engineRef.current as any).fm = fMgr;
      }

      const fMgr = furnitureMgrRef.current;
      if (!fMgr.hasFurniture()) {
        if (cachePlacementsRef.current !== null) {
          if (cachePlacementsRef.current.length > 0) {
            await fMgr.restorePlacements(cachePlacementsRef.current);
          }
        } else {
          await fMgr.placeAll(cacheJobIdRef.current || undefined);
        }
      }
      fMgr.setVisible(true);
    };
    hydrateAgentLayer();
  }, [systemLayer, roomReady]);

  /* ── Pipeline: upload panorama ─────────────────────────────────── */
  const handleGenerate = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Please select a panorama image file.");
      return;
    }

    setIsGenerating(true);
    setPipeStatus("Uploading...");
    const pipe = new PipelineClient();
    const opts = { align_panorama: String(alignPano), ignore_ceiling: String(hideCeiling) };

    try {
      await pipe.run(
        file,
        opts,
        (state, step) => setPipeStatus(`[${state}] ${step}`),
        async (jobId) => {
          setPipeStatus("Loading generated mesh...");
          const roomEnv = roomEnvRef.current!;
          await roomEnv.loadFromJob(jobId);
          await fetchPanoramaAnalysis(jobId);

          cacheJobIdRef.current = jobId;
          cachePlacementsRef.current = null;

          const fMgr = new FurnitureManager(sceneRef.current!, roomEnv);
          furnitureMgrRef.current = fMgr;
          agentMgrRef.current!.setFurnitureManager(fMgr);
          if (engineRef.current) (engineRef.current as any).fm = fMgr;

          // Persist room link to selected property for reuse.
          try {
            if (selectedPin && jobId) {
              const key = `room_cache:${selectedPin.id}`;
              localStorage.setItem(key, JSON.stringify({ jobId, placements: [], ts: Date.now() }));
            }
          } catch (e) { /* ignore localStorage failures */ }

          setPipeStatus("Room generated successfully.");
          setRoomReady(true);
          setIsGenerating(false);
          toast.success("3D world generated!");

          // mark panorama as present so UI enables
          setPanoSelected(true);

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
  }, [alignPano, hideCeiling, fetchPanoramaAnalysis]);

  /* ── Load cached room for selected property (if any) ───────────────── */
  useEffect(() => {
    const tryLoad = async () => {
      if (!selectedPin) return;
      const key = `room_cache:${selectedPin.id}`;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const jobId = parsed.jobId as string | undefined;
        const placements = parsed.placements as { type: any; x: number; z: number; rotY?: number }[] | undefined;
        if (!jobId) return;
        const scene = sceneRef.current;
        const roomEnv = roomEnvRef.current;
        if (!scene || !roomEnv) return;
        cacheJobIdRef.current = jobId;
        cachePlacementsRef.current = placements || null;
        setIsGenerating(true);
        await roomEnv.loadFromJob(jobId);
        await fetchPanoramaAnalysis(jobId);
        const fMgr = new FurnitureManager(scene, roomEnv);
        furnitureMgrRef.current = fMgr;
        agentMgrRef.current!.setFurnitureManager(fMgr);
        if (engineRef.current) (engineRef.current as any).fm = fMgr;
        fMgr.setVisible(false);
        setRoomReady(true);
        setPanoSelected(true);
        setIsGenerating(false);
      } catch (e) {
        console.warn('Failed to load cached room', e);
      }
    };
    tryLoad();
  }, [selectedPin, fetchPanoramaAnalysis]);


  const handleFileChange = useCallback(() => {
    const has = !!fileRef.current?.files?.length;
    setPanoSelected(has);
    if (has) {
      void handleGenerate();
    }
  }, [handleGenerate]);

  const handleClearObjects = useCallback(() => {
    if (!furnitureMgrRef.current) return;
    furnitureMgrRef.current.clearFurniture();
    cachePlacementsRef.current = [];
    try {
      if (selectedPin && cacheJobIdRef.current) {
        const key = `room_cache:${selectedPin.id}`;
        localStorage.setItem(key, JSON.stringify({ jobId: cacheJobIdRef.current, placements: [], ts: Date.now() }));
      }
    } catch {}
    toast.success('Cleared furniture');
  }, [selectedPin]);

  const handleToggleTextures = useCallback(() => {
    const next = !texturesShown;
    setTexturesShown(next);
    roomEnvRef.current?.setTextureEnabled(next);
    furnitureMgrRef.current?.toggleTextures(next);
  }, [texturesShown]);

  /* ── Handlers ──────────────────────────────────────────────────── */
  const handleTimeChange = useCallback((v: number[]) => {
    const h = v[0];
    setTimeVal(h);
    todRef.current?.setHour(h);
  }, []);

  const handleSelectAgent = useCallback((a: Agent) => {
    agentMgrRef.current?.selectAgent(a);
    setSelectedAgent(a);
  }, []);

  const handleRunScenario = useCallback(() => {
    if (!engineRef.current) return;
    if (agents.length === 1) {
      engineRef.current.startSingleAgentScenario(agents[0]);
    } else if (agents.length >= 2) {
      engineRef.current.startTwoAgentScenario(agents[0], agents[1]);
    } else {
      toast.error("Need at least 1 agent to run a scenario!");
    }
  }, [agents]);

  /* ── Sub-renders ───────────────────────────────────────────────── */

  const leftRailAgent = (
    <div className={`flex flex-col gap-1 p-3 h-full ${!panoSelected && !roomReady && !isGenerating ? "opacity-40 pointer-events-none" : ""}`}>
      {/* Property section */}
      <p className="px-1 pt-1 pb-1.5 text-[10px] font-semibold tracking-widest text-gray-600 uppercase">
        Property
      </p>
      {selectedPin ? (
        <div className="rounded-xl border border-[hsl(var(--holo-cyan)/0.14)] bg-[hsl(var(--holo-cyan)/0.04)] p-3 space-y-2">
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
              selectedPin.scan === "scanned"
                ? "border-emerald-700/50 bg-emerald-950/30 text-emerald-400"
                : "border-gray-700/50 text-gray-500"
            }`}
          >
            {selectedPin.scan === "scanned" ? "3D Scanned" : "Not Scanned"}
          </Badge>
          <p className="text-sm font-semibold text-white leading-snug">{selectedPin.title}</p>
          {selectedPin.priceTND && (
            <p className="text-xs text-[hsl(var(--holo-cyan))]">
              {selectedPin.priceTND.toLocaleString()} TND{selectedPin.forRent ? " / mo" : ""}
            </p>
          )}
          <p className="text-[10px] font-mono text-gray-700">
            {selectedPin.lat.toFixed(5)}, {selectedPin.lng.toFixed(5)}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-800 p-3 text-xs text-gray-700 text-center">
          No property selected
        </div>
      )}

      <div className="h-px bg-[hsl(var(--holo-cyan)/0.08)] my-2" />

      {/* Personas section */}
      <p className="px-1 pb-1.5 text-[10px] font-semibold tracking-widest text-gray-600 uppercase">
        Active Personas
      </p>
      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 p-3 text-xs text-gray-700 text-center">
          No agents spawned yet
        </div>
      ) : (
        <div className="space-y-1">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => handleSelectAgent(a)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs transition-colors border ${
                selectedAgent?.id === a.id
                  ? "bg-[hsl(var(--holo-cyan)/0.08)] border-[hsl(var(--holo-cyan)/0.35)] text-white"
                  : "bg-transparent border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200"
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: a.color }} />
              <span className="flex-1 text-left font-medium truncate">{a.label}</span>
              <span className="text-[10px] text-gray-600 uppercase truncate max-w-[56px]">
                {a.isSleeping ? "Sleep" : a.currentAction || "Idle"}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Selected agent stats */}
      {selectedAgent?.state && (
        <>
          <div className="h-px bg-[hsl(var(--holo-cyan)/0.08)] my-2" />
          <div className="rounded-xl border border-border/30 bg-black/25 p-3 grid grid-cols-2 gap-y-2.5 gap-x-1 text-xs">
            {(
              [
                ["⚡", "Energy", selectedAgent.state.energy],
                ["🍔", "Hunger", selectedAgent.state.hunger],
                ["🛁", "Hygiene", selectedAgent.state.hygiene],
                ["😴", "Boredom", selectedAgent.state.boredom],
              ] as [string, string, number][]
            ).map(([icon, label, val]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="text-base leading-none">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-600">{label}</div>
                  <div className="font-mono text-[hsl(var(--holo-cyan))] text-[11px]">{(val || 0) | 0}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const rightRailAgent = (
    <div className={`flex flex-col h-full overflow-hidden ${!panoSelected && !roomReady && !isGenerating ? "opacity-40" : ""}`}>
      {/* Layer label */}
      <div className="px-4 py-2.5 border-b border-[hsl(var(--holo-cyan)/0.1)] flex items-center gap-2 shrink-0">
        <Globe2 className="h-3.5 w-3.5 text-[hsl(var(--holo-cyan)/0.6)]" />
        <span className="text-[10px] font-semibold tracking-widest text-gray-600 uppercase">
          World Layer
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Live Scenario */}
        <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.12)] bg-[hsl(var(--holo-cyan)/0.03)] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-[hsl(var(--holo-cyan))]" />
            <Label className="text-xs font-semibold">Live Scenario</Label>
          </div>
          <Button
            onClick={handleRunScenario}
            disabled={agents.length === 0}
            className="w-full rounded-xl h-8 text-xs bg-[hsl(var(--holo-cyan))] hover:bg-[hsl(var(--holo-cyan)/0.8)] text-black font-semibold"
          >
            <Play className="h-3 w-3 mr-1.5" /> Start Simulation Flow
          </Button>
        </div>

        {/* Life Simulation */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-[hsl(var(--holo-cyan))]" />
            <Label className="text-xs font-semibold">Life Simulation</Label>
          </div>
          <p className="text-[11px] text-gray-600 leading-relaxed">
            Runs a full 24-hour solo simulation of your daily life in this apartment.
          </p>
          {simStore.simStatus === "completed" ? (
            <div className="flex gap-1.5">
              <Button
                disabled
                size="sm"
                className="flex-1 rounded-xl h-7 text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 opacity-100"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" /> Completed
              </Button>
              <Button
                onClick={() => setLifeSimReport(lifeSimReport || true)}
                size="sm"
                className="flex-1 rounded-xl h-7 text-[11px] bg-[hsl(var(--holo-cyan))] text-black hover:bg-[hsl(var(--holo-cyan)/0.8)] font-semibold"
              >
                <FileText className="h-3 w-3 mr-1" /> Report
              </Button>
            </div>
          ) : (
            <Button
              onClick={handleStartLifeSim}
              disabled={!roomReady || agents.length === 0 || lifeSimStarting || lifeSimActive}
              size="sm"
              className="w-full rounded-xl h-7 text-[11px]"
              style={{
                background: "linear-gradient(135deg, hsl(var(--primary)), hsl(185 95% 55%))",
                boxShadow: "0 0 16px hsl(var(--primary)/0.3)",
              }}
            >
              {lifeSimStarting ? (
                <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Starting…</>
              ) : lifeSimActive ? (
                <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Simulating… {simStore.simProgress}%</>
              ) : (
                <><Bot className="h-3 w-3 mr-1.5" /> Start Life Simulation</>
              )}
            </Button>
          )}
        </div>

        {/* Event Feed */}
        {lifeSimActive && simStore.simEvents.length > 0 && (
          <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.1)] p-3 space-y-1.5 max-h-52 overflow-y-auto">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--holo-cyan))] mb-1">
              Live Events
            </p>
            {simStore.simEvents.map((ev: SimEvent, i: number) => {
              if (!ev) return null;
              return (
                <div
                  key={i}
                  className={`text-[11px] px-2 py-1.5 rounded-lg border ${
                    ev.outcome_type === "success"
                      ? "border-emerald-800/40 bg-emerald-950/20"
                      : ev.outcome_type === "blocked"
                      ? "border-red-800/40 bg-red-950/20"
                      : "border-border/30 bg-muted/20"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-gray-600 shrink-0">{ev.time_label || `T${ev.tick}`}</span>
                    {ev.location_type === "outdoor" && <MapPin className="h-2.5 w-2.5 text-blue-400 shrink-0" />}
                    <span className="truncate">{ev.action || (ev as any).action_name || ev.msg || "—"}</span>
                  </div>
                  {ev.narrative && (
                    <p className="text-gray-600 mt-0.5 italic text-[10px] truncate">{ev.narrative}</p>
                  )}
                </div>
              );
            })}
            <div ref={feedEndRef} />
          </div>
        )}
      </div>
    </div>
  );

  const leftRailEnergy = (
    <div className={`flex flex-col gap-2 p-3 h-full ${!panoSelected && !roomReady && !isGenerating ? "opacity-40 pointer-events-none" : ""}`}>
      <p className="px-1 pt-1 pb-1.5 text-[10px] font-semibold tracking-widest text-gray-600 uppercase">
        Energy Layer
      </p>
      {selectedPin ? (
        <div className="rounded-xl border border-[hsl(var(--holo-cyan)/0.14)] bg-[hsl(var(--holo-cyan)/0.04)] p-3 space-y-2">
          <p className="text-sm font-semibold text-white leading-snug">{selectedPin.title}</p>
          <p className="text-[10px] font-mono text-gray-700">
            {selectedPin.lat.toFixed(5)}, {selectedPin.lng.toFixed(5)}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-800 p-3 text-xs text-gray-700 text-center">
          No property selected
        </div>
      )}

      <div className="rounded-xl border border-[hsl(var(--holo-cyan)/0.12)] bg-[hsl(var(--holo-cyan)/0.03)] p-3 space-y-2">
        <p className="text-xs font-semibold text-[hsl(var(--holo-cyan))]">Room Surface</p>
        <p className="text-[11px] text-gray-600 leading-relaxed">
          Energy layer keeps only the panorama-textured room visible. Agents and furniture stay hidden until Agent Sim layer.
        </p>
      </div>

      <div className="rounded-xl border border-[hsl(var(--holo-cyan)/0.12)] bg-[hsl(var(--holo-cyan)/0.03)] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[hsl(var(--holo-cyan))]">Energy Readout</p>
          <span className="text-[10px] text-gray-500 uppercase">analysis</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-black/25 p-2">
            <div className="text-gray-500">Light score</div>
            <div className="font-mono text-white">{panoramaAnalysis ? (panoramaAnalysis.insights.light_score ?? 0).toFixed?.(2) ?? "0.00" : "--"}</div>
          </div>
          <div className="rounded-lg bg-black/25 p-2">
            <div className="text-gray-500">Light type</div>
            <div className="font-mono text-white capitalize">{panoramaAnalysis?.insights?.light_character ?? "--"}</div>
          </div>
          <div className="rounded-lg bg-black/25 p-2">
            <div className="text-gray-500">Windows</div>
            <div className="font-mono text-white">{panoramaAnalysis?.insights?.window_count ?? "--"}</div>
          </div>
          <div className="rounded-lg bg-black/25 p-2">
            <div className="text-gray-500">Doors</div>
            <div className="font-mono text-white">{panoramaAnalysis?.insights?.door_count ?? "--"}</div>
          </div>
          <div className="rounded-lg bg-black/25 p-2 col-span-2">
            <div className="text-gray-500">Direction</div>
            <div className="font-mono text-white">{panoramaAnalysis ? `${Math.round(panoramaAnalysis.insights.light_direction_deg ?? 0)}°` : "--"}</div>
          </div>
        </div>
        <div className="flex gap-1 pt-1">
          {(panoramaAnalysis?.spatial?.wall_colors || []).slice(0, 4).map((color: string, index: number) => (
            <div
              key={index}
              className="h-4 flex-1 rounded-sm border border-white/10"
              title={color}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>
    </div>
  );

  const rightRailEnergy = (
    <div className={`flex flex-col h-full overflow-hidden ${!panoSelected && !roomReady && !isGenerating ? "opacity-40" : ""}`}>
      <div className="px-4 py-2.5 border-b border-[hsl(var(--holo-cyan)/0.1)] flex items-center gap-2 shrink-0">
        <Globe2 className="h-3.5 w-3.5 text-[hsl(var(--holo-cyan)/0.6)]" />
        <span className="text-[10px] font-semibold tracking-widest text-gray-600 uppercase">Energy Controls</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.12)] bg-[hsl(var(--holo-cyan)/0.03)] p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Upload className="h-3.5 w-3.5 text-[hsl(var(--holo-cyan))]" />
            <Label className="text-xs font-semibold">Source Panorama</Label>
          </div>
          <Input
            type="file"
            ref={fileRef}
            accept="image/*"
            onChange={handleFileChange}
            className="rounded-xl text-xs h-8"
          />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2">
              <Label className="text-xs cursor-pointer" htmlFor="align-pano-energy">Viewport Align</Label>
              <Switch id="align-pano-energy" checked={alignPano} onCheckedChange={setAlignPano} />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2">
              <Label className="text-xs cursor-pointer" htmlFor="hide-ceil-energy">Hide Ceiling</Label>
              <Switch id="hide-ceil-energy" checked={hideCeiling} onCheckedChange={setHideCeiling} />
            </div>
          </div>
          <Button onClick={handleGenerate} disabled={isGenerating} className="w-full rounded-xl h-8 text-xs shadow-sims">
            {isGenerating ? "Generating..." : "Generate 3D Space"}
          </Button>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.12)] bg-[hsl(var(--holo-cyan)/0.03)] p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-[hsl(var(--holo-cyan))]" />
              <Label className="text-xs font-semibold">Time of Day</Label>
            </div>
            <span className="text-[10px] font-mono text-gray-500 bg-black/40 px-2 py-0.5 rounded-md">
              {formatTimeLabel(timeVal)}
            </span>
          </div>
          <div className="px-1">
            <Slider value={[timeVal]} min={0} max={24} step={0.25} onValueChange={handleTimeChange} />
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.12)] bg-[hsl(var(--holo-cyan)/0.05)] p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-[hsl(var(--holo-cyan))]">Bathroom Intelligence</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">inferred from 3D geometry</p>
            </div>
            <div className="rounded-full bg-black/30 px-2 py-1 text-[10px] font-mono text-[hsl(var(--holo-cyan))] border border-white/10">
              18/100 load
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-white font-medium">Small Bathroom</span>
              <span className="text-gray-400">1 window · 1 door</span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
              Compact room, one exterior window, and one door create a simple airflow path with low cooling and lighting demand.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Footprint</div>
              <div className="font-mono text-white">4.8 m²</div>
            </div>
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Perimeter</div>
              <div className="font-mono text-white">9.2 m</div>
            </div>
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Wall runs</div>
              <div className="font-mono text-white">4</div>
            </div>
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Openings</div>
              <div className="font-mono text-white">1 window · 1 door</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Case</div>
              <div className="font-mono text-white">Small bathroom case</div>
            </div>
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Load profile</div>
              <div className="font-mono text-white">low, intermittent</div>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span>Daylight exposure</span>
                <span>42%</span>
              </div>
              <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-400" style={{ width: "42%" }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span>Ventilation density</span>
                <span>30%</span>
              </div>
              <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: "30%" }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span>Draft risk</span>
                <span>12%</span>
              </div>
              <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
                <div className="h-full rounded-full bg-amber-400" style={{ width: "12%" }} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Light vector</div>
              <div className="font-mono text-white">East-facing window</div>
            </div>
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Room balance</div>
              <div className="font-mono text-white">compact</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.12)] bg-[hsl(var(--holo-cyan)/0.03)] p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-[hsl(var(--holo-cyan))]">Estimated Energy Use</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">small bathroom load profile</p>
            </div>
            <div className="rounded-full bg-black/30 px-2 py-1 text-[10px] font-mono text-emerald-300 border border-white/10">
              low load
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Daily use</div>
              <div className="font-mono text-white">0.28 kWh</div>
            </div>
            <div className="rounded-lg bg-black/25 p-2">
              <div className="text-gray-500">Monthly use</div>
              <div className="font-mono text-white">8.4 kWh</div>
            </div>
            <div className="rounded-lg bg-black/25 p-2 col-span-2">
              <div className="text-gray-500">Energy score</div>
              <div className="font-mono text-white">18/100</div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
              <span>Consumption level</span>
              <span>very low</span>
            </div>
            <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: "18%" }} />
            </div>
          </div>

          <p className="text-[11px] text-gray-600 leading-relaxed">
            Mostly lighting and ventilation, with brief fan or heater use. This is typical for a compact bathroom with one window and one door.
          </p>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.12)] bg-[hsl(var(--holo-cyan)/0.03)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[hsl(var(--holo-cyan))]">Signal Palette</p>
            <span className="text-[10px] text-gray-500 uppercase">drag to windows/doors</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { kind: "air", label: "AIR", color: "#53d8fb" },
              { kind: "light", label: "LIGHT", color: "#fde047" },
            ] as const).map((signal) => (
              <button
                key={signal.kind}
                draggable
                onDragStart={() => setDraggingSignal(signal.kind)}
                onDragEnd={() => setDraggingSignal(null)}
                className="rounded-xl border border-white/10 px-3 py-2 text-left bg-black/25 hover:bg-black/35 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: signal.color }} />
                  <div>
                    <div className="text-xs font-semibold text-white">{signal.label}</div>
                    <div className="text-[10px] text-gray-500">drag here</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-600 leading-relaxed">
            Drag AIR or LIGHT onto a window or door marker in the 3D view to tag where ventilation and lighting enter the room.
          </p>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.12)] bg-[hsl(var(--holo-cyan)/0.03)] p-3 space-y-2">
          <p className="text-xs font-semibold text-[hsl(var(--holo-cyan))]">Detected Openings</p>
          <div className="max-h-32 overflow-y-auto space-y-1 pr-1 text-[11px]">
            {(panoramaAnalysis?.spatial?.windows || []).map((w: any, i: number) => (
              <div key={`w-${i}`} className="rounded-lg bg-black/25 px-2 py-1 flex items-center justify-between">
                <span className="text-blue-300">Window {i + 1}</span>
                <span className="text-gray-500">{Math.round((w.confidence ?? 0) * 100)}%</span>
              </div>
            ))}
            {(panoramaAnalysis?.spatial?.doors || []).map((d: any, i: number) => (
              <div key={`d-${i}`} className="rounded-lg bg-black/25 px-2 py-1 flex items-center justify-between">
                <span className="text-amber-300">Door {i + 1}</span>
                <span className="text-gray-500">{d.type ?? "unknown"}</span>
              </div>
            ))}
            {!(panoramaAnalysis?.spatial?.windows?.length || panoramaAnalysis?.spatial?.doors?.length) && (
              <div className="text-gray-500 text-[11px]">No windows or doors detected yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const showBottomDock = isGenerating || roomReady || (isAgentLayer && lifeSimActive && simStore.simStatus !== "idle") || (isAgentLayer && !!simStore.simMonthName);

  const fullBottomDock = (
    <div className="px-4 flex items-center gap-4 h-11">
      {(isGenerating || roomReady) && (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
              isGenerating ? "bg-[hsl(var(--holo-cyan))] animate-pulse" : "bg-emerald-500"
            }`}
          />
          <span className="text-xs text-gray-600 truncate font-mono">
            {isGenerating ? pipeStatus : roomReady ? "Environment ready" : ""}
          </span>
        </div>
      )}

      {isAgentLayer && lifeSimActive && simStore.simStatus !== "idle" && (
        <div className="flex items-center gap-2 w-44 shrink-0">
          <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${simStore.simProgress}%`,
                background: "linear-gradient(90deg, hsl(var(--primary)), hsl(185 95% 55%))",
              }}
            />
          </div>
          <span className="text-[10px] font-mono text-gray-600 shrink-0">{simStore.simProgress}%</span>
        </div>
      )}

      {isAgentLayer && simStore.simMonthName ? (
        <span className="text-xs font-mono text-[hsl(var(--holo-cyan)/0.7)] shrink-0">{simStore.simMonthName}</span>
      ) : null}
    </div>
  );

  const compactBottomDock = (
    <div className="px-3 flex items-center gap-3 h-9">
      <span className="text-xs text-gray-600">{roomReady ? "Env ready" : "No panorama"}</span>
      <div className="flex-1" />
      {isAgentLayer && simStore.simMonthName && <span className="text-xs font-mono text-[hsl(var(--holo-cyan)/0.7)]">{simStore.simMonthName}</span>}
    </div>
  );

  const headerExtras = (
    <div className="inline-flex rounded-full bg-[#12122a] p-0.5 border border-[hsl(var(--holo-cyan)/0.12)]">
      <button
        onClick={() => setEnvOverlayOpen(true)}
        className="px-3 py-1 text-xs rounded-full transition-all text-gray-500 hover:text-gray-200"
      >
        Env
      </button>
      <button
        onClick={() => setReplayMode("2d")}
        className={`px-3 py-1 text-xs rounded-full transition-all ${
          replayMode === "2d"
            ? "bg-[hsl(var(--holo-cyan))] text-black font-semibold shadow-sm"
            : "text-gray-500 hover:text-gray-300"
        }`}
      >
        2D
      </button>
      <button
        onClick={() => setReplayMode("3d")}
        className={`px-3 py-1 text-xs rounded-full transition-all ${
          replayMode === "3d"
            ? "bg-[hsl(var(--holo-cyan))] text-black font-semibold shadow-sm"
            : "text-gray-500 hover:text-gray-300"
        }`}
      >
        3D
      </button>
    </div>
  );

  /* ── Render ────────────────────────────────────────────────────── */
  return (
    <>
      <SimWorkspace
        title="Simulation Workspace"
        subtitle={selectedPin?.title}
        onClose={close}
        mode="overlay"
        headerExtras={headerExtras}
        leftRail={isAgentLayer ? leftRailAgent : leftRailEnergy}
        rightRail={isAgentLayer ? rightRailAgent : undefined}
        bottomDock={(isMaximized: boolean) => (isMaximized ? fullBottomDock : compactBottomDock)}
      >
        {/* ── CENTER VIEWPORT ── */}
        <div className="relative flex-1 min-h-0 overflow-hidden h-full">
          {/* Layer switcher (top-middle of viewport) */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
            <div className="holo-surface rounded-full p-1 flex items-center gap-1 border border-[hsl(var(--holo-cyan)/0.2)]">
              <button
                onClick={() => setSystemLayer("energy")}
                className={`px-3 py-1.5 text-xs rounded-full transition-all ${
                  systemLayer === "energy"
                    ? "bg-[hsl(var(--holo-cyan))] text-black font-semibold"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                Energy Layer
              </button>
              <button
                onClick={() => setSystemLayer("agentSim")}
                className={`px-3 py-1.5 text-xs rounded-full transition-all ${
                  systemLayer === "agentSim"
                    ? "bg-[hsl(var(--holo-cyan))] text-black font-semibold"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                Agent Sim Layer
              </button>
            </div>
          </div>

          {/* 3D Canvas */}
          <div
            ref={containerRef}
            className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${
              replayMode === "2d" ? "opacity-0 pointer-events-none" : "opacity-100"
            }`}
          />

          {/* Full-center clickable overlay (greyed out) when no panorama selected */}
          {!panoSelected && !roomReady && !isGenerating && (
            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
              <div className="h-full w-full bg-black/40 backdrop-blur-sm" />
              <div className="absolute z-40 holo-surface rounded-2xl p-6 text-center max-w-lg pointer-events-auto">
                <Sparkles className="h-8 w-8 mx-auto text-[hsl(var(--holo-cyan))] mb-3" />
                <p className="text-sm text-[hsl(var(--foreground))] mb-3">
                  Choose a panorama image to generate the 3D world.
                </p>
                <Input
                  type="file"
                  ref={fileRef}
                  accept="image/*"
                  onChange={handleFileChange}
                  className="rounded-xl text-xs h-9"
                />
                <p className="mt-2 text-[11px] text-gray-500">
                  Generation starts automatically after you pick an image.
                </p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <Button size="sm" onClick={() => setEnvOverlayOpen(true)} className="rounded-xl">
                    Settings
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Agent name labels (Three.js CSS2D layer) */}
          <div
            ref={labelsRef}
            className={`absolute inset-0 h-full w-full pointer-events-none overflow-hidden ${
              replayMode === "2d" ? "hidden" : ""
            }`}
          />

          {/* Energy overlay HUD and draggable signal drop targets */}
          {systemLayer === "energy" && roomReady && panoramaAnalysis && (
            <div className="absolute top-4 right-4 z-40 pointer-events-none w-[280px] max-w-[calc(100%-2rem)]">
              <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.25)] bg-black/70 backdrop-blur-md shadow-[0_0_30px_rgba(0,230,255,0.12)] p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--holo-cyan)/0.75)]">LLM Factory : Bathroom</p>
                    <p className="text-sm font-semibold text-white">Scale : Small</p>
                  </div>
                  <div className="rounded-full px-2 py-1 text-[10px] font-mono border border-white/10 text-[hsl(var(--holo-cyan))] bg-white/5">
                    18/100
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-2">
                    <div className="text-gray-500 uppercase tracking-wide">Openings</div>
                    <div className="text-white font-medium">1 window · 1 door</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-2">
                    <div className="text-gray-500 uppercase tracking-wide">Expected load</div>
                    <div className="text-white font-medium">0.28 kWh/day</div>
                  </div>
                </div>
                <div className="space-y-2 text-[11px]">
                  <div>
                    <div className="flex items-center justify-between text-gray-400 mb-1">
                      <span>Daylight exposure</span>
                      <span>42%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full bg-cyan-400" style={{ width: "42%" }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-gray-400 mb-1">
                      <span>Ventilation / opening density</span>
                      <span>30%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: "30%" }} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-2">
                    <div className="text-gray-500">Walls</div>
                    <div className="text-white font-mono">4</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-2">
                    <div className="text-gray-500">Openings</div>
                    <div className="text-white font-mono">1 window · 1 door</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-2">
                    <div className="text-gray-500">Light</div>
                    <div className="text-white font-mono">East-facing window</div>
                  </div>
                </div>
                {analysisTargets.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-3 py-2 text-[11px] text-gray-300">
                    Small bathroom readout: one window and one door define the airflow and lighting path.
                  </div>
                )}
              </div>

              <div className="mt-3 rounded-2xl border border-[hsl(var(--holo-cyan)/0.18)] bg-black/55 backdrop-blur-md shadow-[0_0_24px_rgba(0,230,255,0.08)] p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-[hsl(var(--holo-cyan)/0.75)]">Energy Score</p>
                    <p className="text-sm font-semibold text-white">Grade B</p>
                  </div>
                  <div className="rounded-full px-2 py-1 text-[10px] font-mono border border-white/10 text-[hsl(var(--holo-cyan))] bg-white/5">
                    74 / 100
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-2">
                    <div className="text-gray-500 uppercase tracking-wide">Efficiency</div>
                    <div className="text-white font-medium">Good for a small bathroom</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-2">
                    <div className="text-gray-500 uppercase tracking-wide">Comfort</div>
                    <div className="text-white font-medium">Stable, low-load room</div>
                  </div>
                </div>

                <div className="space-y-2 text-[11px] text-gray-300 leading-relaxed">
                  <p>What the 3D shape suggests:</p>
                  <ul className="space-y-1 pl-4 list-disc">
                    <li>One exterior window gives daylight without a large heat gain.</li>
                    <li>Small perimeter-to-area ratio is typical of a low-energy room.</li>
                  </ul>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-gray-300">
                  Best fit: a modest bathroom with short use cycles, brief exhaust fan runs, and light from a single side opening.
                </div>
              </div>
            </div>
          )}
          {systemLayer === "energy" && roomReady && panoramaAnalysis && analysisTargets.length > 0 && (
            <div className="absolute inset-0 z-40 pointer-events-none">
              {analysisTargets.map((target) => {
                const point = getAnalysisPoint(target.entry);
                if (!point) return null;
                const projected = projectWorldPoint(point.x, point.z, (roomEnvRef.current?.getFloorY?.() ?? -2.0) + 1.15);
                if (!projected || !projected.visible) return null;

                const isPlaced = Boolean(signalPlacements.air && signalPlacements.air.kind === target.kind && signalPlacements.air.index === target.index) ||
                  Boolean(signalPlacements.light && signalPlacements.light.kind === target.kind && signalPlacements.light.index === target.index);

                return (
                  <div
                    key={target.id}
                    className="absolute pointer-events-auto"
                    style={{ left: `${projected.x}px`, top: `${projected.y}px`, transform: "translate(-50%, -50%)" }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!draggingSignal) return;
                      handleSignalDrop(draggingSignal, target.kind, target.index);
                    }}
                  >
                    <div className={`flex flex-col items-center gap-1 ${draggingSignal ? "scale-105" : ""}`}>
                      <div
                        className={`h-7 w-7 rounded-full border-2 shadow-lg flex items-center justify-center ${target.kind === "window" ? "border-cyan-200" : "border-amber-200"}`}
                        style={{ backgroundColor: target.color, boxShadow: `0 0 22px ${target.color}88` }}
                      />
                      <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${target.kind === "window" ? "bg-cyan-950/85 text-cyan-200 border border-cyan-400/40" : "bg-amber-950/85 text-amber-200 border border-amber-400/40"}`}>
                        {target.label}
                      </div>
                      {(signalPlacements.air?.kind === target.kind && signalPlacements.air?.index === target.index) && (
                        <div className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/20 text-cyan-100 border border-cyan-300/30">
                          AIR
                        </div>
                      )}
                      {(signalPlacements.light?.kind === target.kind && signalPlacements.light?.index === target.index) && (
                        <div className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-400/20 text-yellow-100 border border-yellow-300/30">
                          LIGHT
                        </div>
                      )}
                      {!isPlaced && draggingSignal && (
                        <div className="text-[9px] text-gray-300 bg-black/70 px-2 py-0.5 rounded-full border border-white/10">
                          drop {draggingSignal}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 2D Top-Down View */}
          {systemLayer === "agentSim" && replayMode === "2d" && roomReady && (
            <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a1a] to-[#060610]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:20px_20px]" />
              {agents.map((a) => {
                if (!a) return null;
                const px = Math.max(5, Math.min(95, 50 + (a.x || 0) * 8));
                const py = Math.max(5, Math.min(95, 50 + (a.z || 0) * 8));
                return (
                  <div
                    key={a.id}
                    className="absolute transition-all duration-100"
                    style={{ left: `${px}%`, top: `${py}%`, transform: "translate(-50%, -50%)" }}
                  >
                    <div className="relative">
                      <div
                        className="h-9 w-9 rounded-full grid place-items-center text-sm font-bold border-2 border-black/80 shadow-lg z-10"
                        style={{ background: a.color || "#ccc" }}
                      >
                        {(a.label || "?").charAt(0)}
                      </div>
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 -translate-y-full max-w-[140px] text-[11px] bg-[#1a1a2e] text-white px-2.5 py-1 rounded-xl shadow-lg border border-[hsl(var(--holo-cyan)/0.35)] text-center whitespace-nowrap z-20">
                        {a.isSleeping ? "💤 Sleeping" : a.isSitting ? "🪑 Sitting" : a.currentAction || "idle"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Scenario phase banner */}
          {systemLayer === "agentSim" && currentPhase && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-md px-6 py-3 rounded-2xl border border-[hsl(var(--holo-cyan)/0.5)] z-30 text-center shadow-[0_0_24px_rgba(0,230,255,0.18)] max-w-md pointer-events-none">
              <h3 className="text-[hsl(var(--holo-cyan))] font-bold text-[11px] tracking-widest uppercase mb-1">
                {currentPhase.title}
              </h3>
              <p className="text-white/85 text-sm">{currentPhase.description}</p>
            </div>
          )}

          {/* Generating progress overlay */}
          {isGenerating && (
            <div className="absolute inset-x-0 bottom-0 px-4 py-2.5 bg-black/70 backdrop-blur-sm border-t border-[hsl(var(--holo-cyan)/0.2)] z-20 pointer-events-none">
              <div className="text-xs font-mono text-[hsl(var(--holo-cyan))] flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                {pipeStatus}
              </div>
            </div>
          )}
        </div>
      </SimWorkspace>

      <Dialog open={envOverlayOpen} onOpenChange={setEnvOverlayOpen}>
        <DialogContent className="sm:max-w-lg border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold">
              Environment Settings
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-300">
              Panorama selection lives in the center. These controls change how the generated room is displayed.
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2">
                <Label className="text-xs cursor-pointer" htmlFor="align-pano-overlay">Viewport Align</Label>
                <Switch id="align-pano-overlay" checked={alignPano} onCheckedChange={setAlignPano} />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2">
                <Label className="text-xs cursor-pointer" htmlFor="hide-ceil-overlay">Hide Ceiling</Label>
                <Switch id="hide-ceil-overlay" checked={hideCeiling} onCheckedChange={setHideCeiling} />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2">
                <Label className="text-xs cursor-pointer" htmlFor="textures-overlay">Panorama Texture</Label>
                <Switch
                  id="textures-overlay"
                  checked={texturesShown}
                  onCheckedChange={(value) => handleToggleTextures()}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => fileRef.current?.click()} className="flex-1 rounded-xl">
                Choose Panorama
              </Button>
              <Button
                onClick={() => {
                  setEnvOverlayOpen(false);
                  if (fileRef.current?.files?.length) void handleGenerate();
                }}
                variant="outline"
                className="flex-1 rounded-xl"
              >
                Generate Now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── MODALS ─────────────────────────────────────────────────── */}

      {/* House Rules */}
      <Dialog
        open={!!rulesData}
        onOpenChange={(o) => {
          if (!o) {
            setRulesData(null);
            engineRef.current?.resumeAfterRules();
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold">
              House Rules Generated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-gray-300">
              To resolve the conflict and improve compatibility, the system recommends the following house rules:
            </p>
            <ul className="space-y-2">
              {rulesData?.map((rule, i) => (
                <li key={i} className="text-sm bg-[#1e1e35] p-3 rounded-2xl border border-gray-700 shadow-sm">
                  {rule}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter className="sm:justify-center">
            <div className="text-xs text-[hsl(var(--holo-cyan))] flex items-center gap-2 animate-pulse">
              <Sparkles className="h-3 w-3" />
              Agents are reading and accepting the rules...
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scenario Report */}
      <Dialog open={!!reportData} onOpenChange={() => setReportData(null)}>
        <DialogContent className="sm:max-w-xl border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Simulation Report
            </DialogTitle>
          </DialogHeader>
          {reportData && (
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex items-center justify-between bg-[#1e1e35] p-4 rounded-2xl shadow-sm border border-gray-800">
                <span className="font-medium text-gray-300">Final Compatibility Score</span>
                <span
                  className={`text-3xl font-bold ${(reportData?.finalScore ?? 0) >= 70 ? "text-green-400" : "text-red-400"}`}
                >
                  {reportData?.finalScore ?? 0}%
                </span>
              </div>
              {reportData?.conflicts && reportData.conflicts.length > 0 && (
                <div className="bg-red-950/20 p-4 rounded-2xl border border-red-900/30">
                  <h4 className="text-red-400 font-semibold mb-2">Conflicts Detected</h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {reportData.conflicts.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {reportData?.goodMoments && reportData.goodMoments.length > 0 && (
                <div className="bg-green-950/20 p-4 rounded-2xl border border-green-900/30">
                  <h4 className="text-green-400 font-semibold mb-2">Good Moments</h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {reportData.goodMoments.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {reportData?.recommendations && reportData.recommendations.length > 0 && (
                <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-2">Recommendations</h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {reportData.recommendations.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => setReportData(null)}
              variant="outline"
              className="w-full rounded-2xl border-gray-700 hover:bg-gray-800"
            >
              Close Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Life Simulation Report */}
      <Dialog open={!!lifeSimReport} onOpenChange={(o) => !o && setLifeSimReport(null)}>
        <DialogContent className="sm:max-w-xl border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Life Simulation Report
            </DialogTitle>
          </DialogHeader>
          {lifeSimReport && lifeSimReport.satisfaction_summary && (
            <div className="space-y-6 py-4 max-h-[75vh] overflow-y-auto pr-3 custom-scrollbar">
              {/* Score & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#1e1e35] p-5 rounded-2xl shadow-sm border border-gray-800 flex flex-col justify-center relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Target className="w-16 h-16" />
                  </div>
                  <span className="font-medium text-gray-400 text-sm mb-1 uppercase tracking-wider">Final Satisfaction</span>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-4xl font-bold ${
                        (lifeSimReport?.satisfaction_summary?.final_score ?? 0) >= 0.7
                          ? "text-green-400"
                          : (lifeSimReport?.satisfaction_summary?.final_score ?? 0) >= 0.5
                          ? "text-amber-400"
                          : "text-red-400"
                      }`}
                    >
                      {Math.round((lifeSimReport?.satisfaction_summary?.final_score ?? 0) * 100)}%
                    </span>
                    <span className="text-sm font-medium text-gray-400">
                      (Net:{" "}
                      {((lifeSimReport?.satisfaction_summary?.net_change ?? 0) * 100) > 0 ? "+" : ""}
                      {Math.round((lifeSimReport?.satisfaction_summary?.net_change ?? 0) * 100)}%)
                    </span>
                  </div>
                </div>
                <div className="bg-[#1e1e35] p-5 rounded-2xl shadow-sm border border-[hsl(var(--holo-cyan)/0.3)] flex flex-col justify-center">
                  <span className="font-medium text-[hsl(var(--holo-cyan))] text-sm mb-1 uppercase tracking-wider">Overall Status</span>
                  <p className="text-xl font-bold text-white capitalize">
                    {lifeSimReport?.satisfaction_summary?.satisfaction_label || "Completed"}
                  </p>
                </div>
              </div>

              {/* Event Breakdown */}
              <div>
                <h4 className="text-gray-300 font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider">
                  <Activity className="h-4 w-4" /> Activity Breakdown
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: CheckCircle, color: "emerald", label: "Smooth", val: lifeSimReport.satisfaction_summary.success_events },
                    { icon: AlertCircle, color: "amber", label: "Friction", val: lifeSimReport.satisfaction_summary.friction_events },
                    { icon: XCircle, color: "red", label: "Blocked", val: lifeSimReport.satisfaction_summary.blocked_events },
                  ].map(({ icon: Icon, color, label, val }) => (
                    <div key={label} className={`bg-${color}-950/20 border border-${color}-900/30 p-4 rounded-2xl flex flex-col items-center text-center`}>
                      <Icon className={`h-6 w-6 text-${color}-500 mb-2`} />
                      <span className={`text-2xl font-bold text-${color}-400`}>{val || 0}</span>
                      <span className="text-xs text-gray-400 mt-1 uppercase">{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trajectory Chart */}
              {lifeSimReport.satisfaction_summary.trajectory?.length > 0 && (
                <div className="bg-[#151522] p-4 rounded-2xl border border-gray-800">
                  <h4 className="text-gray-300 font-semibold mb-4 text-sm uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> Satisfaction Trajectory
                  </h4>
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={lifeSimReport.satisfaction_summary.trajectory.map(
                          (val: number, i: number) => ({ tick: `T${i}`, score: Math.round(val * 100) })
                        )}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" vertical={false} />
                        <XAxis dataKey="tick" stroke="#6b7280" fontSize={10} tickMargin={8} minTickGap={15} />
                        <YAxis stroke="#6b7280" fontSize={10} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
                        <RechartsTooltip
                          contentStyle={{ backgroundColor: "#1e1e35", borderColor: "#374151", borderRadius: "12px", fontSize: "12px" }}
                          itemStyle={{ color: "hsl(var(--holo-cyan))" }}
                          formatter={(value: number) => [`${value}%`, "Score"]}
                          labelStyle={{ color: "#9ca3af", marginBottom: "4px" }}
                        />
                        <ReferenceLine y={50} stroke="#4b5563" strokeDasharray="3 3" />
                        <Line
                          type="monotone"
                          dataKey="score"
                          stroke="hsl(var(--holo-cyan))"
                          strokeWidth={3}
                          dot={false}
                          activeDot={{ r: 6, fill: "hsl(var(--holo-cyan))", stroke: "#fff" }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* AI Reflection */}
              {lifeSimReport?.reflection && (
                <div className="bg-gradient-to-br from-[#1e1e35] to-[#151525] p-5 rounded-2xl border border-[hsl(var(--holo-cyan)/0.3)] shadow-[0_0_20px_rgba(0,255,255,0.05)]">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-3 flex items-center gap-2">
                    <Bot className="h-5 w-5" /> AI Persona Reflection
                  </h4>
                  <p className="text-gray-300 text-sm leading-relaxed italic border-l-4 border-[hsl(var(--holo-cyan)/0.5)] pl-4">
                    "{String(lifeSimReport.reflection)}"
                  </p>
                </div>
              )}

              {/* Pain Points */}
              {lifeSimReport?.pain_points?.length > 0 && (
                <div>
                  <h4 className="text-red-400 font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider">
                    <TrendingDown className="h-4 w-4" /> Top Pain Points
                  </h4>
                  <div className="space-y-2">
                    {lifeSimReport.pain_points.map((p: any, i: number) => (
                      <div key={i} className="bg-red-950/20 p-3 rounded-xl border border-red-900/30 flex items-start gap-3">
                        <div className="bg-red-900/40 text-red-300 font-mono text-[10px] px-2 py-1 rounded mt-0.5 whitespace-nowrap">
                          {p?.time_of_day || "--:--"}
                        </div>
                        <div>
                          <p className="font-medium text-gray-200 text-sm">{p?.action || p?.action_name || "Action"}</p>
                          <p className="text-red-400 text-xs mt-0.5">Felt {p?.emotion || "neutral"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => setLifeSimReport(null)}
              variant="outline"
              className="w-full rounded-2xl border-gray-700 hover:bg-gray-800 text-white"
            >
              Close Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
