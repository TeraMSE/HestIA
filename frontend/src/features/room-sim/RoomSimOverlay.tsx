/**
 * RoomSimOverlay — 3D room simulation overlay.
 * Uses OverlayPanel to match the UI style of other HestIA frontend features.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Plus, Users, Eye, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "./engine/RoomEnvironment";
import { AgentManager } from "./engine/AgentManager";
import { FurnitureManager } from "./engine/FurnitureManager";
import { TimeOfDayController, formatTimeLabel } from "./engine/TimeOfDay";
import { PipelineClient } from "./engine/PipelineClient";
import type { Agent } from "./engine/StateSystem";
import { toast } from "sonner";

export function RoomSimOverlay() {
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

  /* state */
  const [pipeStatus, setPipeStatus] = useState("Waiting for panorama...");
  const [isGenerating, setIsGenerating] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const [timeVal, setTimeVal] = useState(12);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
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

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060610);
    scene.fog = new THREE.Fog(0x060610, 25, 80);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    camera.position.set(5, 4, 8);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Grid
    const grid = new THREE.GridHelper(20, 20, 0x334863, 0x1e2b3e);
    grid.position.y = -1.6;
    scene.add(grid);

    // Ground
    const gnd = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.95 })
    );
    gnd.rotation.x = -Math.PI / 2;
    gnd.position.y = -1.6;
    gnd.receiveShadow = true;
    scene.add(gnd);

    // Room environment
    const roomEnv = new RoomEnvironment(scene);
    roomEnvRef.current = roomEnv;

    // Time of day
    const tod = new TimeOfDayController(scene);
    tod.setHour(12);
    todRef.current = tod;

    // Agent manager
    const agentMgr = new AgentManager(scene, camera, renderer, roomEnv);
    agentMgr.setLabelsRoot(labelsRef.current);
    agentMgr.onAgentsChanged = () => setAgents([...agentMgr.agents]);
    agentMgr.onSelectedChanged = (a) => setSelectedAgent(a);
    agentMgrRef.current = agentMgr;

    // Resize
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    // Observe container size directly using ResizeObserver
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    onResize();

    // Render loop
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      controls.update();
      agentMgr.update();
      renderer.render(scene, camera);
    };
    animate();

    // Periodic force-update for React state display
    const uiTimer = setInterval(() => forceUpdate((n) => n + 1), 500);

    return () => {
      clearInterval(uiTimer);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      if (animIdRef.current !== null) cancelAnimationFrame(animIdRef.current);
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
    const opts = {
      align_panorama: String(alignPano),
      ignore_ceiling: String(hideCeiling),
    };

    try {
      await pipe.run(
        file,
        opts,
        (state, step, logs) => {
          setPipeStatus(`[${state}] ${step}`);
        },
        async (jobId) => {
          setPipeStatus("Loading generated mesh...");
          const roomEnv = roomEnvRef.current!;
          await roomEnv.loadFromJob(jobId);

          // Place furniture
          const fMgr = new FurnitureManager(sceneRef.current!, roomEnv);
          furnitureMgrRef.current = fMgr;
          agentMgrRef.current!.setFurnitureManager(fMgr);
          await fMgr.placeAll();

          setPipeStatus("Room generated successfully.");
          setRoomReady(true);
          setIsGenerating(false);
          toast.success("3D world generated!");

          // Camera framing
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

  const handleSpawn = useCallback((gender: "male" | "female") => {
    agentMgrRef.current?.spawnAgent(gender);
  }, []);

  const handleSelectAgent = useCallback((a: Agent) => {
    agentMgrRef.current?.selectAgent(a);
    setSelectedAgent(a);
  }, []);

  return (
    <OverlayPanel title="3D Room Simulation" subtitle="Procedural environment & AI agents" size="xl">
      <div className="grid md:grid-cols-12 gap-6">
        
        {/* ── 3D VIEWPORT ── */}
        <Card className="md:col-span-8 rounded-3xl overflow-hidden relative h-[550px] border-[#1e1e35] bg-[#060610]">
          <div ref={containerRef} className="absolute inset-0" />
          <div ref={labelsRef} className="absolute inset-0 pointer-events-none overflow-hidden" />
          
          {/* Overlay text when empty */}
          {!roomReady && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/40 backdrop-blur-sm z-10">
              <div className="text-center">
                <Sparkles className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-50" />
                <span className="text-sm text-muted-foreground">Upload a panorama to generate the 3D room.</span>
              </div>
            </div>
          )}
          
          {/* Status overlay when generating */}
          {isGenerating && (
            <div className="absolute inset-x-0 bottom-0 p-3 bg-black/60 backdrop-blur-md border-t border-[hsl(var(--holo-cyan)/0.3)] z-20">
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
              <TabsTrigger value="agents">Agents</TabsTrigger>
            </TabsList>

            {/* ENVIRONMENT TAB */}
            <TabsContent value="env" className="flex-1 overflow-y-auto pr-1 mt-0 space-y-4">
              <Card className="rounded-3xl p-4 space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Upload className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                    <Label className="font-medium">Source Panorama</Label>
                  </div>
                  <Input 
                    type="file" 
                    ref={fileRef} 
                    accept="image/*" 
                    className="rounded-2xl text-xs" 
                  />
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

                <Button 
                  onClick={handleGenerate} 
                  disabled={isGenerating} 
                  className="w-full rounded-2xl shadow-sims"
                >
                  {isGenerating ? "Generating..." : "Generate 3D Room"}
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
                  <Slider 
                    value={[timeVal]} 
                    min={0} 
                    max={24} 
                    step={0.25} 
                    onValueChange={handleTimeChange} 
                  />
                </div>
              </Card>
            </TabsContent>

            {/* AGENTS TAB */}
            <TabsContent value="agents" className="flex-1 overflow-y-auto pr-1 mt-0 space-y-4">
              <Card className="rounded-3xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                  <Label className="font-medium">Spawn AI Agent</Label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="outline" 
                    className="rounded-2xl h-10 border-[#1e1e35] hover:border-[hsl(var(--holo-cyan))]"
                    disabled={!roomReady} 
                    onClick={() => handleSpawn("male")}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Male
                  </Button>
                  <Button 
                    variant="outline" 
                    className="rounded-2xl h-10 border-[#1e1e35] hover:border-[hsl(var(--holo-cyan))]"
                    disabled={!roomReady} 
                    onClick={() => handleSpawn("female")}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Female
                  </Button>
                </div>
              </Card>

              {agents.length > 0 && (
                <Card className="rounded-3xl p-4">
                  <Label className="font-medium mb-3 block">Active Agents</Label>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {agents.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => handleSelectAgent(a)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors border ${
                          selectedAgent?.id === a.id 
                            ? "bg-[hsl(var(--holo-cyan)/0.15)] border-[hsl(var(--holo-cyan))] text-white" 
                            : "bg-transparent border-[#1e1e35] text-muted-foreground hover:border-gray-500"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
                        {a.label}
                      </button>
                    ))}
                  </div>

                  {selectedAgent && (
                    <div className="rounded-2xl bg-muted p-3 text-sm space-y-3">
                      <div className="flex items-center justify-between border-b border-border/50 pb-2">
                        <span className="font-medium">{selectedAgent.label}</span>
                        <span className="text-xs bg-black/20 px-2 py-0.5 rounded-full">
                          {selectedAgent.state.moodEmoji} {selectedAgent.state.moodLabel}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-y-2 text-xs">
                        <div className="flex justify-between px-1"><span>⚡ Energy</span><span className="font-mono">{selectedAgent.state.energy | 0}</span></div>
                        <div className="flex justify-between px-1"><span>🍔 Hunger</span><span className="font-mono">{selectedAgent.state.hunger | 0}</span></div>
                        <div className="flex justify-between px-1"><span>🛁 Hygiene</span><span className="font-mono">{selectedAgent.state.hygiene | 0}</span></div>
                        <div className="flex justify-between px-1"><span>😴 Boredom</span><span className="font-mono">{selectedAgent.state.boredom | 0}</span></div>
                      </div>
                      <div className="pt-2 flex items-center gap-2 text-xs text-[hsl(var(--holo-cyan))]">
                        <Play className="h-3 w-3" />
                        <span className="capitalize">
                          {selectedAgent.currentAction || "idle"}
                          {selectedAgent.isSleeping && " (Sleeping)"}
                          {selectedAgent.isSitting && " (Sitting)"}
                        </span>
                      </div>
                    </div>
                  )}
                </Card>
              )}

              {selectedAgent && (
                <Card className="rounded-3xl p-4 space-y-2">
                  <Label className="font-medium block mb-2">Interactions</Label>
                  <Button variant="outline" className="w-full rounded-2xl justify-start">Say Hello</Button>
                  <Button variant="outline" className="w-full rounded-2xl justify-start">Small Talk</Button>
                  <Button variant="outline" className="w-full rounded-2xl justify-start">Complain about mess</Button>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </OverlayPanel>
  );
}
