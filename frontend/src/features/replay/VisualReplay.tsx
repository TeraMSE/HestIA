import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Users, Eye, Play, Sparkles } from "lucide-react";
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

export function VisualReplay() {
  const { replayMode, setReplayMode, selectedPersonaA, selectedPersonaB, personas } = useApp();

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
  const [, forceUpdate] = useState(0);

  /* UI state */
  const [tab, setTab] = useState<"env" | "agents">("env");
  const fileRef = useRef<HTMLInputElement>(null);
  const [alignPano, setAlignPano] = useState(true);
  const [hideCeiling, setHideCeiling] = useState(true);

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

  /* ── Auto-Spawn Personas on Room Ready ─────────────────────────── */
  useEffect(() => {
    if (roomReady && agentMgrRef.current && agents.length === 0) {
      if (selectedPersonaA) {
        const p1 = personas.find(p => p.id === selectedPersonaA);
        const p2 = selectedPersonaB ? personas.find(p => p.id === selectedPersonaB) : null;
        
        if (p1) {
          const a1 = agentMgrRef.current.spawnAgent("male");
          if (a1) {
            a1.label = p1.name;
            a1.color = p1.avatarColor || a1.color;
          }
          if (p2) {
            const a2 = agentMgrRef.current.spawnAgent("female");
            if (a2) {
              a2.label = p2.name;
              a2.color = p2.avatarColor || a2.color;
            }
          }
          toast.success(p2 ? `Spawned ${p1.name} & ${p2.name} in the room.` : `Spawned ${p1.name} in the room.`);
          setTab("agents");
        }
      }
    }
  }, [roomReady, selectedPersonaA, selectedPersonaB, personas, agents.length]);

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

          const fMgr = new FurnitureManager(sceneRef.current!, roomEnv);
          furnitureMgrRef.current = fMgr;
          agentMgrRef.current!.setFurnitureManager(fMgr);
          if (engineRef.current) engineRef.current.fm = fMgr;
          await fMgr.placeAll();

          setPipeStatus("Room generated successfully.");
          setRoomReady(true);
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
  }, [alignPano, hideCeiling]);

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
              
              {agents.map((a) => {
                // Map x,z to percentages (roughly -5 to +5 meters maps to 0-100%)
                const px = Math.max(5, Math.min(95, 50 + (a.x * 8)));
                const py = Math.max(5, Math.min(95, 50 + (a.z * 8)));
                
                return (
                  <div key={a.id} className="absolute transition-all duration-100" style={{ left: `${px}%`, top: `${py}%`, transform: "translate(-50%, -50%)" }}>
                    <div className="relative">
                      <div className="h-10 w-10 rounded-full grid place-items-center text-sm font-bold border-[3px] border-black shadow-[0_0_15px_rgba(0,0,0,0.5)] z-10" style={{ background: a.color }}>
                        {a.label.charAt(0)}
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

                <Button onClick={handleGenerate} disabled={isGenerating} className="w-full rounded-2xl shadow-sims">
                  {isGenerating ? "Generating..." : "Generate & Spawn Agents"}
                </Button>
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

              <Card className="rounded-3xl p-4 space-y-3">
                <Label className="font-medium mb-1 block">Manual Spawn</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      const a = agentMgrRef.current?.spawnAgent("male");
                      if (a) toast.success("Spawned Male Agent");
                    }}
                    disabled={!roomReady}
                    className="rounded-2xl border-[#1e1e35] hover:border-[hsl(var(--holo-cyan))] hover:text-[hsl(var(--holo-cyan))]"
                  >
                    + Male
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      const a = agentMgrRef.current?.spawnAgent("female");
                      if (a) toast.success("Spawned Female Agent");
                    }}
                    disabled={!roomReady}
                    className="rounded-2xl border-[#1e1e35] hover:border-[hsl(var(--holo-cyan))] hover:text-[hsl(var(--holo-cyan))]"
                  >
                    + Female
                  </Button>
                </div>
              </Card>

              {agents.length > 0 && (
                <Card className="rounded-3xl p-4">
                  <Label className="font-medium mb-3 block">Active Personas</Label>
                  <div className="flex flex-col gap-2 mb-4">
                    {agents.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => handleSelectAgent(a)}
                        className={`flex items-center justify-between px-3 py-2 rounded-2xl text-xs transition-colors border ${
                          selectedAgent?.id === a.id 
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

                  {selectedAgent && (
                    <div className="rounded-2xl bg-black/40 border border-border/50 p-3 text-sm space-y-3">
                      <div className="grid grid-cols-2 gap-y-2 text-xs">
                        <div className="flex justify-between px-1"><span>⚡ Energy</span><span className="font-mono text-[hsl(var(--holo-cyan))]">{selectedAgent.state.energy | 0}</span></div>
                        <div className="flex justify-between px-1"><span>🍔 Hunger</span><span className="font-mono text-[hsl(var(--holo-cyan))]">{selectedAgent.state.hunger | 0}</span></div>
                        <div className="flex justify-between px-1"><span>🛁 Hygiene</span><span className="font-mono text-[hsl(var(--holo-cyan))]">{selectedAgent.state.hygiene | 0}</span></div>
                        <div className="flex justify-between px-1"><span>😴 Boredom</span><span className="font-mono text-[hsl(var(--holo-cyan))]">{selectedAgent.state.boredom | 0}</span></div>
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
                <span className={`text-3xl font-bold ${reportData.finalScore >= 70 ? 'text-green-400' : 'text-red-400'}`}>
                  {reportData.finalScore}%
                </span>
              </div>
              
              {reportData.conflicts.length > 0 && (
                <div className="bg-red-950/20 p-4 rounded-2xl border border-red-900/30">
                  <h4 className="text-red-400 font-semibold mb-2">Conflicts Detected</h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {reportData.conflicts.map((c,i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              
              {reportData.goodMoments.length > 0 && (
                <div className="bg-green-950/20 p-4 rounded-2xl border border-green-900/30">
                  <h4 className="text-green-400 font-semibold mb-2">Good Moments</h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {reportData.goodMoments.map((c,i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              
              {reportData.recommendations.length > 0 && (
                <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-2">Recommendations</h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {reportData.recommendations.map((c,i) => <li key={i}>{c}</li>)}
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
    </OverlayPanel>
  );
}
