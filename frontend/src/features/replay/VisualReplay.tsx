import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Users, Eye, Play, Sparkles, Loader2, Bot, MapPin, CheckCircle2, FileText, Activity, CheckCircle, AlertCircle, XCircle, TrendingUp, TrendingDown, Target } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
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
  const [, forceUpdate] = useState(0);
  const [isCheckingExistingJob, setIsCheckingExistingJob] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);

  /* UI state */
  const [tab, setTab] = useState<"env" | "agents">("env");
  const fileRef = useRef<HTMLInputElement>(null);
  const [alignPano, setAlignPano] = useState(true);
  const [hideCeiling, setHideCeiling] = useState(true);

  /* Life sim state */
  const [lifeSimActive, setLifeSimActive] = useState(false);
  const [lifeSimStarting, setLifeSimStarting] = useState(false);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  /* ── Initialize Three.js scene ─────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060610);
    scene.fog = new THREE.Fog(0x060610, 25, 80);
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
      new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.95 })
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
      renderer.setSize(w, h);
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

    const uiTimer = setInterval(() => forceUpdate((n) => n + 1), 100); // Faster update for 2D UI smoothness

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
      if (container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  /* ── Auto-load existing 3D world when property selection changes ── */
  useEffect(() => {
    const pinId = selectedPin?.id;

    setRoomReady(false);
    setShowUploadForm(false);
    const isRealPin = !!pinId && /^\d+$/.test(String(pinId));
    if (!pinId) {
      setIsCheckingExistingJob(false);
      setPipeStatus("Waiting for panorama...");
      return;
    }

    if (!roomEnvRef.current) return;

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
        const resp = await fetch(`/api/jobs/property/${pinId}/`);
        if (cancelled) return;

        if (!resp.ok) {
          setPipeStatus("Upload a panorama to generate the 3D world.");
          return;
        }

        const { job_id } = await resp.json();
        if (!job_id || cancelled) return;

        setPipeStatus("Loading saved 3D world…");
        await roomEnvRef.current!.loadFromJob(job_id);
        if (cancelled) return;

        const fMgr = new FurnitureManager(sceneRef.current!, roomEnvRef.current!);
        furnitureMgrRef.current = fMgr;
        agentMgrRef.current!.setFurnitureManager(fMgr);
        if (engineRef.current) engineRef.current.fm = fMgr;
        await fMgr.placeAll();
        if (cancelled) return;

        setPipeStatus("3D world ready.");
        setRoomReady(true);

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
        toast.success("Saved 3D world loaded.");
      } catch {
        if (!cancelled) setPipeStatus("Upload a panorama to generate the 3D world.");
      } finally {
        if (!cancelled) setIsCheckingExistingJob(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedPin?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Auto-Spawn User Persona on Room Ready ─────────────────────── */
  useEffect(() => {
    if (roomReady && agentMgrRef.current && agents.length === 0) {
      // Auto-spawn the authenticated user's persona
      const userName = user?.first_name || user?.email?.split("@")[0] || "You";
      const a = agentMgrRef.current.spawnAgent("male");
      if (a) {
        a.label = userName;
        a.color = "#22d3ee"; // cyan
      }
      toast.success(`Your persona "${userName}" is ready in the room.`);
      setTab("agents");
    }
  }, [roomReady, user, agents.length]);

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
        property_id: /^\d+$/.test(String(selectedPin.id)) ? String(selectedPin.id) : undefined,
        num_ticks: 24,
      });
      simStore.startRun(res.run_id, res.simulation_month, res.month_name);
      setLifeSimActive(true);
      toast.success(`Life Simulation started — ${res.month_name}`);

      // Start polling
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

          // Drive the 3D agent for indoor events
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
              if (st.result) {
                setLifeSimReport(st.result);
              }
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

  // Cleanup poller on unmount
  useEffect(() => {
    return () => {
      if (pollerRef.current) clearInterval(pollerRef.current);
    };
  }, []);

  // Auto-scroll narrative feed
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [simStore.simEvents.length]);

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
    const opts: Record<string, string> = { align_panorama: String(alignPano), ignore_ceiling: String(hideCeiling) };
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
  }, [alignPano, hideCeiling, selectedPin]);

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

  return (
    <OverlayPanel title="Unified Simulation" subtitle="Live 2D & 3D Environment" size="xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">Select an environment file and start the live simulation</div>
        </div>
        <div className="inline-flex rounded-full bg-muted p-1">
          <button onClick={() => setReplayMode("2d")} className={`px-4 py-1 text-sm rounded-full transition-all ${replayMode === "2d" ? "bg-[hsl(var(--holo-cyan))] text-black font-semibold shadow-sm" : "text-muted-foreground hover:text-white"}`}>2D Top-Down</button>
          <button onClick={() => setReplayMode("3d")} className={`px-4 py-1 text-sm rounded-full transition-all ${replayMode === "3d" ? "bg-[hsl(var(--holo-cyan))] text-black font-semibold shadow-sm" : "text-muted-foreground hover:text-white"}`}>3D World</button>
        </div>
      </div>

      <div className="grid md:grid-cols-12 gap-6">

        {/* ── LIVE VIEWPORT ── */}
        <Card className="md:col-span-8 rounded-3xl overflow-hidden relative h-[550px] border-[#1e1e35] bg-[#060610]">
          {/* 3D Canvas Container */}
          <div ref={containerRef} className={`absolute inset-0 transition-opacity duration-300 ${replayMode === "2d" ? "opacity-0 pointer-events-none" : "opacity-100"}`} />

          {/* Labels layer (only shown in 3D mode) */}
          <div ref={labelsRef} className={`absolute inset-0 pointer-events-none overflow-hidden ${replayMode === "2d" ? "hidden" : ""}`} />

          {/* 2D Canvas Container */}
          {replayMode === "2d" && roomReady && (
            <div className="absolute inset-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.3)] bg-gradient-to-b from-[#0a0a1a] to-[#060610] shadow-[inset_0_0_50px_rgba(0,0,0,0.5)]">
              {/* Floor grid pattern */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:20px_20px]" />

              {agents && Array.isArray(agents) && agents.map((a) => {
                if (!a) return null;
                // Map x,z to percentages (roughly -5 to +5 meters maps to 0-100%)
                const px = Math.max(5, Math.min(95, 50 + ((a.x || 0) * 8)));
                const py = Math.max(5, Math.min(95, 50 + ((a.z || 0) * 8)));

                return (
                  <div key={a.id} className="absolute transition-all duration-100" style={{ left: `${px}%`, top: `${py}%`, transform: "translate(-50%, -50%)" }}>
                    <div className="relative">
                      <div className="h-10 w-10 rounded-full grid place-items-center text-sm font-bold border-[3px] border-black shadow-[0_0_15px_rgba(0,0,0,0.5)] z-10" style={{ background: a.color || "#ccc" }}>
                        {(a.label || "?").charAt(0)}
                      </div>
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 -translate-y-full max-w-[160px] text-xs bg-[#1e1e35] text-white px-3 py-1.5 rounded-xl shadow-lg border border-[hsl(var(--holo-cyan)/0.5)] text-center whitespace-nowrap z-20">
                        {a.isSleeping ? "💤 Sleeping" : a.isSitting ? "🪑 Sitting" : a.currentAction || "idle"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Scenario Banner */}
          {currentPhase && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md px-8 py-4 rounded-3xl border border-[hsl(var(--holo-cyan)/0.5)] z-30 text-center shadow-[0_0_20px_rgba(0,255,255,0.2)] max-w-lg w-full pointer-events-none transition-all">
              <h3 className="text-[hsl(var(--holo-cyan))] font-bold text-sm tracking-widest uppercase mb-1.5">{currentPhase.title}</h3>
              <p className="text-white/90 text-sm">{currentPhase.description}</p>
            </div>
          )}

          {/* Overlay text when empty */}
          {!roomReady && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/40 backdrop-blur-sm z-30">
              <div className="text-center">
                <Sparkles className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-50" />
                <span className="text-sm text-muted-foreground">Upload a panorama to generate the environment.</span>
              </div>
            </div>
          )}

          {/* Status overlay when generating */}
          {isGenerating && (
            <div className="absolute inset-x-0 bottom-0 p-3 bg-black/60 backdrop-blur-md border-t border-[hsl(var(--holo-cyan)/0.3)] z-30">
              <div className="text-xs font-mono text-[hsl(var(--holo-cyan))] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[hsl(var(--holo-cyan))] animate-pulse" />
                {pipeStatus}
              </div>
            </div>
          )}
        </Card>

        {/* ── CONTROLS SIDEBAR ── */}
        <div className="md:col-span-4 flex flex-col min-h-0">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col">
            <TabsList className="rounded-2xl mb-4 grid grid-cols-2">
              <TabsTrigger value="env">Environment</TabsTrigger>
              <TabsTrigger value="agents">Simulation</TabsTrigger>
            </TabsList>

            <TabsContent value="env" className="flex-1 overflow-y-auto pr-1 mt-0 space-y-4">
              <Card className="rounded-3xl p-4 space-y-4">
                {isCheckingExistingJob ? (
                  <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--holo-cyan))]" />
                    Checking for saved 3D world…
                  </div>
                ) : roomReady && !showUploadForm ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="font-medium">3D world loaded</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This property has a saved 3D model. Switch to the Simulation tab to explore it.
                    </p>
                    <Button
                      variant="outline"
                      className="w-full rounded-2xl text-xs"
                      onClick={() => setShowUploadForm(true)}
                    >
                      <Upload className="h-3 w-3 mr-2" /> Upload New Panorama
                    </Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Upload className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                        <Label className="font-medium">Source Panorama</Label>
                      </div>
                      <Input type="file" ref={fileRef} accept="image/*" className="rounded-2xl text-xs" />
                    </div>

                    <div className="space-y-3 pt-1">
                      <div className="flex items-center justify-between rounded-2xl bg-muted p-3">
                        <Label className="text-sm cursor-pointer" htmlFor="align-pano">Viewport Align</Label>
                        <Switch id="align-pano" checked={alignPano} onCheckedChange={setAlignPano} />
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-muted p-3">
                        <Label className="text-sm cursor-pointer" htmlFor="hide-ceil">Hide Ceiling</Label>
                        <Switch id="hide-ceil" checked={hideCeiling} onCheckedChange={setHideCeiling} />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={handleGenerate} disabled={isGenerating} className="flex-1 rounded-2xl shadow-sims">
                        {isGenerating ? "Generating..." : "Generate & Spawn Agents"}
                      </Button>
                      {showUploadForm && (
                        <Button variant="outline" className="rounded-2xl px-3" onClick={() => setShowUploadForm(false)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </Card>

              <Card className="rounded-3xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                    <Label className="font-medium">Time of Day</Label>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded-md">
                    {formatTimeLabel(timeVal)}
                  </span>
                </div>
                <div className="px-2 pt-2 pb-1">
                  <Slider value={[timeVal]} min={0} max={24} step={0.25} onValueChange={handleTimeChange} />
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="agents" className="flex-1 overflow-y-auto pr-1 mt-0 space-y-4">
              <Card className="rounded-3xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                  <Label className="font-medium">Run Live Scenario</Label>
                </div>

                <Button
                  onClick={handleRunScenario}
                  className="w-full mt-1 rounded-2xl shadow-sims bg-[hsl(var(--holo-cyan))] hover:bg-[hsl(var(--holo-cyan)/0.8)] text-black font-semibold"
                  disabled={agents.length === 0}
                >
                  <Play className="h-4 w-4 mr-2" /> Start Simulation Flow
                </Button>
              </Card>

              {/* ── Life Simulation Trigger ── */}
              <Card className="rounded-3xl p-4 space-y-3 border-primary/30 bg-primary/5">
                <div className="flex items-center gap-2 mb-1">
                  <Bot className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                  <Label className="font-medium">Life Simulation</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Runs a full 24-hour solo simulation of your daily life in this apartment.
                </p>
                <div className="flex gap-2 w-full mt-1">
                  {simStore.simStatus === "completed" ? (
                    <>
                      <Button disabled className="flex-1 rounded-2xl shadow-sims bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 opacity-100">
                        <CheckCircle2 className="h-4 w-4 mr-2" /> Completed
                      </Button>
                      <Button onClick={() => setLifeSimReport(lifeSimReport || true)} className="flex-1 rounded-2xl shadow-sims bg-[hsl(var(--holo-cyan))] text-black hover:bg-[hsl(var(--holo-cyan)/0.8)] font-semibold">
                        <FileText className="h-4 w-4 mr-2" /> Final Report
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={handleStartLifeSim}
                      disabled={!roomReady || agents.length === 0 || lifeSimStarting || lifeSimActive}
                      className="w-full rounded-2xl shadow-sims"
                      style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(185 95% 55%))", boxShadow: "0 0 20px hsl(var(--primary)/0.4)" }}
                    >
                      {lifeSimStarting ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</>
                      ) : lifeSimActive ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Simulating… {simStore.simProgress}%</>
                      ) : (
                        <><Bot className="h-4 w-4 mr-2" /> Start Life Simulation</>
                      )}
                    </Button>
                  )}
                </div>
              </Card>

              {/* ── Narrative Event Feed ── */}
              {lifeSimActive && simStore.simEvents.length > 0 && (
                <Card className="rounded-3xl p-4 space-y-2 max-h-[200px] overflow-y-auto">
                  <Label className="font-medium mb-2 block text-xs uppercase tracking-wider text-[hsl(var(--holo-cyan))]">
                    Live Event Feed
                  </Label>
                  {simStore.simEvents.map((ev: SimEvent, i: number) => {
                    if (!ev) return null;
                    return (
                      <div key={i} className={`text-xs p-2 rounded-xl border ${
                        ev.outcome_type === "success" ? "border-emerald-700/40 bg-emerald-950/20" :
                        ev.outcome_type === "blocked" ? "border-red-700/40 bg-red-950/20" :
                        "border-border/40 bg-muted/30"
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-muted-foreground">{ev.time_label || `T${ev.tick}`}</span>
                          {ev.location_type === "outdoor" && <MapPin className="h-3 w-3 text-blue-400" />}
                          <span className="font-medium">{ev.action || ev.action_name || ev.msg || "—"}</span>
                        </div>
                        {ev.narrative && <p className="text-muted-foreground mt-0.5 italic">{ev.narrative}</p>}
                      </div>
                    );
                  })}
                  <div ref={feedEndRef} />
                </Card>
              )}

              {agents.length > 0 && (
                <Card className="rounded-3xl p-4">
                  <Label className="font-medium mb-3 block">Active Personas</Label>
                  <div className="flex flex-col gap-2 mb-4">
                    {agents.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => handleSelectAgent(a)}
                        className={`flex items-center justify-between px-3 py-2 rounded-2xl text-xs transition-colors border ${selectedAgent?.id === a.id
                            ? "bg-[hsl(var(--holo-cyan)/0.15)] border-[hsl(var(--holo-cyan))] text-white"
                            : "bg-[#1e1e35] border-transparent text-gray-300 hover:border-gray-500"
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shadow-sm" style={{ background: a.color }} />
                          <span className="font-medium">{a.label}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground uppercase">{a.currentAction || "idle"}</span>
                      </button>
                    ))}
                  </div>

                  {selectedAgent && selectedAgent.state && (
                    <div className="rounded-2xl bg-black/40 border border-border/50 p-3 text-sm space-y-3">
                      <div className="grid grid-cols-2 gap-y-2 text-xs">
                        <div className="flex justify-between px-1"><span>⚡ Energy</span><span className="font-mono text-[hsl(var(--holo-cyan))]">{(selectedAgent.state.energy || 0) | 0}</span></div>
                        <div className="flex justify-between px-1"><span>🍔 Hunger</span><span className="font-mono text-[hsl(var(--holo-cyan))]">{(selectedAgent.state.hunger || 0) | 0}</span></div>
                        <div className="flex justify-between px-1"><span>🛁 Hygiene</span><span className="font-mono text-[hsl(var(--holo-cyan))]">{(selectedAgent.state.hygiene || 0) | 0}</span></div>
                        <div className="flex justify-between px-1"><span>😴 Boredom</span><span className="font-mono text-[hsl(var(--holo-cyan))]">{(selectedAgent.state.boredom || 0) | 0}</span></div>
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* House Rules Modal */}
      <Dialog open={!!rulesData} onOpenChange={(o) => { if (!o) { setRulesData(null); engineRef.current?.resumeAfterRules(); } }}>
        <DialogContent className="sm:max-w-md border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold">House Rules Generated</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-gray-300">To resolve the conflict and improve compatibility, the system recommends the following house rules:</p>
            <ul className="space-y-2">
              {rulesData?.map((rule, i) => (
                <li key={i} className="text-sm bg-[#1e1e35] p-3 rounded-2xl border border-gray-700 shadow-sm">{rule}</li>
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

      {/* Report Modal */}
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
                <span className={`text-3xl font-bold ${(reportData?.finalScore ?? 0) >= 70 ? 'text-green-400' : 'text-red-400'}`}>
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
            <Button onClick={() => setReportData(null)} variant="outline" className="w-full rounded-2xl border-gray-700 hover:bg-gray-800">
              Close Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Life Simulation Final Report Modal */}
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
              
              {/* Header Score & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#1e1e35] p-5 rounded-2xl shadow-sm border border-gray-800 flex flex-col justify-center relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Target className="w-16 h-16" />
                  </div>
                  <span className="font-medium text-gray-400 text-sm mb-1 uppercase tracking-wider">Final Satisfaction</span>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold ${(lifeSimReport?.satisfaction_summary?.final_score ?? 0) >= 0.70 ? 'text-green-400' : (lifeSimReport?.satisfaction_summary?.final_score ?? 0) >= 0.50 ? 'text-amber-400' : 'text-red-400'}`}>
                      {Math.round((lifeSimReport?.satisfaction_summary?.final_score ?? 0) * 100)}%
                    </span>
                    <span className="text-sm font-medium text-gray-400">
                      (Net: {((lifeSimReport?.satisfaction_summary?.net_change ?? 0) * 100) > 0 ? '+' : ''}{Math.round((lifeSimReport?.satisfaction_summary?.net_change ?? 0) * 100)}%)
                    </span>
                  </div>
                </div>

                <div className="bg-[#1e1e35] p-5 rounded-2xl shadow-sm border border-[hsl(var(--holo-cyan)/0.3)] flex flex-col justify-center">
                  <span className="font-medium text-[hsl(var(--holo-cyan))] text-sm mb-1 uppercase tracking-wider">Overall Status</span>
                  <p className="text-xl font-bold text-white capitalize">{lifeSimReport?.satisfaction_summary?.satisfaction_label || "Completed"}</p>
                </div>
              </div>

              {/* Event Breakdown Grid */}
              <div>
                <h4 className="text-gray-300 font-semibold mb-3 flex items-center gap-2 text-sm uppercase tracking-wider">
                  <Activity className="h-4 w-4" /> Activity Breakdown
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-emerald-950/20 border border-emerald-900/30 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                    <CheckCircle className="h-6 w-6 text-emerald-500 mb-2" />
                    <span className="text-2xl font-bold text-emerald-400">{lifeSimReport.satisfaction_summary.success_events || 0}</span>
                    <span className="text-xs text-gray-400 mt-1 uppercase">Smooth</span>
                  </div>
                  <div className="bg-amber-950/20 border border-amber-900/30 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                    <AlertCircle className="h-6 w-6 text-amber-500 mb-2" />
                    <span className="text-2xl font-bold text-amber-400">{lifeSimReport.satisfaction_summary.friction_events || 0}</span>
                    <span className="text-xs text-gray-400 mt-1 uppercase">Friction</span>
                  </div>
                  <div className="bg-red-950/20 border border-red-900/30 p-4 rounded-2xl flex flex-col items-center justify-center text-center">
                    <XCircle className="h-6 w-6 text-red-500 mb-2" />
                    <span className="text-2xl font-bold text-red-400">{lifeSimReport.satisfaction_summary.blocked_events || 0}</span>
                    <span className="text-xs text-gray-400 mt-1 uppercase">Blocked</span>
                  </div>
                </div>
              </div>

              {/* Satisfaction Trajectory Chart */}
              {lifeSimReport.satisfaction_summary.trajectory && Array.isArray(lifeSimReport.satisfaction_summary.trajectory) && lifeSimReport.satisfaction_summary.trajectory.length > 0 && (
                <div className="bg-[#151522] p-4 rounded-2xl border border-gray-800">
                  <h4 className="text-gray-300 font-semibold mb-4 text-sm uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> Satisfaction Trajectory
                  </h4>
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={lifeSimReport.satisfaction_summary.trajectory.map((val: number, i: number) => ({ tick: `T${i}`, score: Math.round(val * 100) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" vertical={false} />
                        <XAxis dataKey="tick" stroke="#6b7280" fontSize={10} tickMargin={8} minTickGap={15} />
                        <YAxis stroke="#6b7280" fontSize={10} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#1e1e35', borderColor: '#374151', borderRadius: '12px', fontSize: '12px' }}
                          itemStyle={{ color: 'hsl(var(--holo-cyan))' }}
                          formatter={(value: number) => [`${value}%`, 'Score']}
                          labelStyle={{ color: '#9ca3af', marginBottom: '4px' }}
                        />
                        <ReferenceLine y={50} stroke="#4b5563" strokeDasharray="3 3" />
                        <Line type="monotone" dataKey="score" stroke="hsl(var(--holo-cyan))" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: "hsl(var(--holo-cyan))", stroke: "#fff" }} />
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
                  <p className="text-gray-300 text-sm leading-relaxed italic border-l-4 border-[hsl(var(--holo-cyan)/0.5)] pl-4">"{String(lifeSimReport.reflection)}"</p>
                </div>
              )}

              {/* Key Pain Points */}
              {lifeSimReport?.pain_points && Array.isArray(lifeSimReport.pain_points) && lifeSimReport.pain_points.length > 0 && (
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
            <Button onClick={() => setLifeSimReport(null)} variant="outline" className="w-full rounded-2xl border-gray-700 hover:bg-gray-800 text-white">
              Close Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </OverlayPanel>
  );
}
