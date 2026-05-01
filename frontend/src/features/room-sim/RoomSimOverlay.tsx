/**
 * RoomSimOverlay â€” 3D room simulation overlay with LS life-sim integration.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Plus, Users, Eye, Play, Pause, Sparkles, Brain, AlertTriangle, Home } from "lucide-react";
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
import { LifeSimDriver } from "./engine/LifeSimDriver";
import type { Agent } from "./engine/StateSystem";
import type { VisualSimulationReplay, FrameConflict } from "../../services/socialSimApi";
import { socialSimApi, pollUntilDone } from "../../services/socialSimApi";
import { socialApi } from "../../services/socialApi";
import { toLifeSimPersona, userToLifeSimPersona } from "../persona/toLifeSimPersona";
import { useApp } from "@/shared/store/useApp";
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
  const lsDriverRef = useRef<LifeSimDriver | null>(null);

  /* state */
  const [pipeStatus, setPipeStatus] = useState("Waiting for panorama...");
  const [isGenerating, setIsGenerating] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const [timeVal, setTimeVal] = useState(12);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [, forceUpdate] = useState(0);

  /* Life-sim state */
  const { user, personas, friends, setFriends, selectedPin } = useApp();

  // Persona A: built directly from user.settings fields â€” NO separate builder step.
  // If the user has set living preferences (noise_tolerance != null) we treat them as "set".
  const myPersona = user && user.noise_tolerance != null
    ? { name: user.first_name ? `${user.first_name} ${user.last_name}`.trim() : user.email, payload: userToLifeSimPersona(user) }
    : null;

  // Whether this user is the owner of the selected property
  const isOwner = selectedPin ? String(selectedPin.ownerId) === String(user?.id) : true;

  // Persona B: either a friend/interested user id (string "user:N") or empty for solo
  const [lsPersonaBSel, setLsPersonaBSel] = useState<string>("");
  // Interested users for the currently selected property
  const [interestedUsers, setInterestedUsers] = useState<import("../../services/socialApi").InterestedUser[]>([]);
  const [lsRunning, setLsRunning] = useState(false);
  const [lsProgress, setLsProgress] = useState(0);
  const [lsPlaying, setLsPlaying] = useState(false);
  const [lsFrame, setLsFrame] = useState(0);
  const [lsTotal, setLsTotal] = useState(0);
  const [lsSpeed, setLsSpeed] = useState(1);
  const [lsTickLabel, setLsTickLabel] = useState("06:00");
  const [lsConflict, setLsConflict] = useState<FrameConflict | null>(null);
  const [lsRules, setLsRules] = useState<string[]>([]);
  const [lsReplay, setLsReplay] = useState<VisualSimulationReplay | null>(null);
  const [lsCompatScore, setLsCompatScore] = useState<number | null>(null);

  const [liveTime, setLiveTime] = useState(false);
  const liveTimeRef = useRef(false);
  useEffect(() => { liveTimeRef.current = liveTime; }, [liveTime]);

  /* UI state â€” declared BEFORE any useEffect that reads `tab` */
  const [tab, setTab] = useState<"env" | "agents" | "lifesim">("env");

  // Load friends and interested users when life-sim tab is activated
  useEffect(() => {
    if (tab !== "lifesim") return;
    if (friends.length === 0) {
      socialApi.getFriends().then(setFriends).catch(() => {});
    }
    if (selectedPin) {
      socialApi.getPropertyInterested(selectedPin.id).then((res) => {
        setInterestedUsers(res.interested_users ?? []);
      }).catch(() => {});
    }
  }, [tab, friends.length, setFriends, selectedPin]);

  // Auto-load shared 3D world when opening a property pin that already has one
  useEffect(() => {
    if (!selectedPin || roomReady || isGenerating) return;
    const propId = selectedPin.id;
    // Only trigger for backend-backed pins (numeric-looking IDs)
    if (!/^\d+$/.test(propId)) return;
    (async () => {
      try {
        const res = await fetch(`/api/jobs/property/${propId}/`);
        if (!res.ok) return; // No shared 3D world yet
        const data = await res.json();
        const jobId: string = data.job_id;
        if (!jobId) return;
        setIsGenerating(true);
        setPipeStatus("Loading shared 3D worldâ€¦");
        const roomEnv = roomEnvRef.current!;
        await roomEnv.loadFromJob(jobId);
        setPipeStatus("Placing furnitureâ€¦");
        const { FurnitureManager } = await import("./engine/FurnitureManager");
        const fMgr = new FurnitureManager(sceneRef.current!, roomEnv);
        await fMgr.placeAll(jobId);
        furnitureMgrRef.current = fMgr;
        agentMgrRef.current!.setFurnitureManager(fMgr);
        setPipeStatus("Shared 3D world loaded.");
        setRoomReady(true);
        setIsGenerating(false);
        toast.success("3D world loaded from property!");
        // Frame camera
        if (roomEnv._mesh && controlsRef.current && cameraRef.current) {
          const { Box3, Vector3 } = await import("three");
          const box = new Box3().setFromObject(roomEnv._mesh);
          const c = box.getCenter(new Vector3());
          const s = box.getSize(new Vector3());
          const d = Math.max(s.x, s.z) * 0.9;
          controlsRef.current.target.set(c.x, 0, c.z);
          cameraRef.current.position.set(c.x, d * 0.6, c.z + d);
          controlsRef.current.update();
        }
      } catch {
        // No existing 3D world â€” let user upload
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPin?.id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [alignPano, setAlignPano] = useState(true);
  const [hideCeiling, setHideCeiling] = useState(true);

  /* â”€â”€ Initialize Three.js scene â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene â€” Sky shader provides the background; fog color updated in TimeOfDayController
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x060610, 30, 90);
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    grid.position.y = 0;
    scene.add(grid);

    const gnd = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.8,
        depthWrite: false,
      })
    );
    gnd.rotation.x = -Math.PI / 2;
    gnd.position.y = 0;
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
      if (w === 0 || h === 0) return;          // guard: skip before paint
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    // Observe container size directly using ResizeObserver
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    // Delay first resize so the modal has time to finish painting
    requestAnimationFrame(() => requestAnimationFrame(onResize));

    // Render loop
    let lastT = performance.now();
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;

      controls.update();
      agentMgr.update();

      // Furniture interaction effects (lamps, TV glow, particles)
      furnitureMgrRef.current?.update(dt, agentMgr.agents, todRef.current ?? undefined);

      // Auto-advance time of day when live-time is on and LS is not playing
      if (liveTimeRef.current && !lsDriverRef.current?.isPlaying) {
        setTimeVal((prev) => {
          const next = (prev + dt / 60) % 24; // 1 real-second = 1 in-game minute
          todRef.current?.setHour(next);
          return next;
        });
      }

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

  /* â”€â”€ Pipeline: upload panorama â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const handleGenerate = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Please select a panorama image file.");
      return;
    }

    setIsGenerating(true);
    setPipeStatus("Uploading...");
    const pipe = new PipelineClient();
    const opts: Record<string, string> = {
      align_panorama: String(alignPano),
      ignore_ceiling: String(hideCeiling),
    };
    // Link to the selected property so all users see the same 3D world
    if (selectedPin && /^\d+$/.test(selectedPin.id)) {
      opts.property_id = selectedPin.id;
    }

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
          setPipeStatus("Placing furniture (downloading models)...");
          const fMgr = new FurnitureManager(sceneRef.current!, roomEnv);
          await fMgr.placeAll(jobId);
          furnitureMgrRef.current = fMgr;
          agentMgrRef.current!.setFurnitureManager(fMgr);

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

  /* â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

  /* â”€â”€ Life-Sim handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const handleRunLifeSim = useCallback(async () => {
    if (!roomReady) { toast.error("Generate the 3D room first."); return; }
    if (!myPersona) { toast.error("Set your living preferences in Settings first."); return; }
    const agentMgr = agentMgrRef.current;
    const furnitureMgr = furnitureMgrRef.current;
    const tod = todRef.current;
    if (!agentMgr || !tod) return;

    // Spawn agents with real user names as labels
    const myLabel = myPersona.name;
    if (agentMgr.agents.length < 1) {
      const a = await agentMgr.spawnAgent("male");
      if (a) a.label = myLabel;
    } else {
      agentMgr.agents[0].label = myLabel;
    }
    const hasPartner = lsPersonaBSel !== "" && lsPersonaBSel !== undefined;
    if (hasPartner && agentMgr.agents.length < 2) {
      await agentMgr.spawnAgent("female");
    }

    setLsRunning(true);
    setLsProgress(0);
    setLsConflict(null);
    setLsRules([]);
    setLsReplay(null);
    setLsCompatScore(null);
    lsDriverRef.current?.dispose();
    lsDriverRef.current = null;

    try {
      // Persona A = built directly from user settings
      const paPayload = myPersona.payload as Record<string, unknown>;
      const userALabel = myPersona.name;

      let pbPayload: Record<string, unknown> | null = null;
      let userBId: number | null = null;
      let userBLabel: string | undefined;

      if (lsPersonaBSel.startsWith("user:")) {
        const uid = parseInt(lsPersonaBSel.replace("user:", ""), 10);
        const fetched = await socialApi.getUserPersona(uid);
        if (fetched) {
          pbPayload = fetched.payload as Record<string, unknown>;
          userBId = uid;
          // Find display name from friends or interested users
          const friend = friends.find(f => f.id === uid);
          const interested = interestedUsers.find(u => u.id === uid);
          userBLabel = friend?.display_name ?? interested?.display_name ?? fetched.name;
        }
      }

      const payload = {
        persona_a: paPayload,
        persona_b: pbPayload,
        property_id: selectedPin?.id ?? null,
        user_b_id: userBId,
      };
      const { id } = await socialSimApi.startRun(payload as any);
      toast.info("Life simulation startedâ€¦");

      await pollUntilDone(id, (progress) => { setLsProgress(progress); }, 2500);

      const replayRes = await socialSimApi.getReplay(id);
      const replay = replayRes.result;
      setLsReplay(replay);
      setLsCompatScore(replay.simulation_summary.compatibility_score);

      const medRes = await socialSimApi.getMediation(id);
      setLsRules(medRes.mediation_rules);

      const driver = new LifeSimDriver(agentMgr, furnitureMgr, tod, replay, {
        userALabel,
        userBLabel,
        interestedCount: interestedUsers.filter(u => !u.is_me).length,
      });
      driver.onTickChange = (tick, lbl) => { setLsTickLabel(lbl); setLsFrame(tick); };
      driver.onConflict = (c) => { setLsConflict(c); setTimeout(() => setLsConflict(null), 5000); };
      driver.onComplete = () => { setLsPlaying(false); toast.success("Simulation complete!"); };
      lsDriverRef.current = driver;
      setLsTotal(replay.frames.length);
      driver.start();
      setLsPlaying(true);
      setLsRunning(false);
      toast.success("Playback started!");
    } catch (err: any) {
      setLsRunning(false);
      toast.error(`Life sim failed: ${err.message}`);
    }
  }, [roomReady, myPersona, user, lsPersonaBSel, selectedPin, friends, interestedUsers]);

  const handleLsPlayPause = useCallback(() => {
    const d = lsDriverRef.current;
    if (!d) return;
    if (d.isPlaying) { d.pause(); setLsPlaying(false); }
    else { d.resume(); setLsPlaying(true); }
  }, []);

  const handleLsSeek = useCallback((v: number[]) => {
    lsDriverRef.current?.seek(v[0]);
    setLsFrame(v[0]);
  }, []);

  const handleLsSpeed = useCallback((v: number[]) => {
    const s = v[0];
    setLsSpeed(s);
    lsDriverRef.current?.setSpeed(s);
  }, []);

  return (
    <OverlayPanel title="3D Room Simulation" subtitle="Procedural environment & AI agents" size="xl">
      <div className="grid md:grid-cols-12 gap-6">
        
        {/* â”€â”€ 3D VIEWPORT â”€â”€ */}
        <Card className="md:col-span-8 rounded-3xl overflow-hidden relative h-[550px] border-[#1e1e35] bg-[#060610]">
          <div ref={containerRef} className="absolute inset-0" />
          <div ref={labelsRef} className="absolute inset-0 pointer-events-none overflow-hidden" />
          
          {/* Overlay text when empty */}
          {!roomReady && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/40 backdrop-blur-sm z-10">
              <div className="text-center">
                <Sparkles className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-50" />
                {isOwner
                  ? <span className="text-sm text-muted-foreground">Upload a panorama to generate the 3D room.</span>
                  : <span className="text-sm text-muted-foreground">The property owner hasn't generated a 3D world yet.</span>}
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

        {/* â”€â”€ CONTROLS SIDEBAR â”€â”€ */}
        <div className="md:col-span-4 flex flex-col min-h-0">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col">
            <TabsList className="rounded-2xl mb-4 grid grid-cols-3">
              <TabsTrigger value="env">Environment</TabsTrigger>
              <TabsTrigger value="agents">Agents</TabsTrigger>
              <TabsTrigger value="lifesim"><Brain className="h-3 w-3 mr-1" />Life Sim</TabsTrigger>
            </TabsList>

            {/* ENVIRONMENT TAB */}
            <TabsContent value="env" className="flex-1 overflow-y-auto pr-1 mt-0 space-y-4">
              <Card className="rounded-3xl p-4 space-y-4">
                {/* Owner-only: upload panorama to create 3D world */}
              {roomReady ? (
                <div className="rounded-2xl bg-emerald-900/30 border border-emerald-500/40 px-3 py-2 text-xs text-emerald-300 flex items-center gap-2">
                  <span>âœ¦</span>
                  <span>3D world is shared â€” all visitors see this room.</span>
                </div>
              ) : isOwner ? (
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
              ) : (
                <div className="rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Only the property owner can generate a 3D world for this pin.
                </div>
              )}
                
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

                {isOwner && !roomReady && (
                  <Button 
                    onClick={handleGenerate} 
                    disabled={isGenerating} 
                    className="w-full rounded-2xl shadow-sims"
                  >
                    {isGenerating ? "Generating..." : "Generate 3D Room"}
                  </Button>
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
                  <Slider
                    value={[timeVal]}
                    min={0}
                    max={24}
                    step={0.25}
                    onValueChange={handleTimeChange}
                    disabled={liveTime}
                  />
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-muted p-3">
                  <Label className="text-sm cursor-pointer" htmlFor="live-time">Live Time Cycle</Label>
                  <Switch id="live-time" checked={liveTime} onCheckedChange={setLiveTime} />
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
                        <div className="flex justify-between px-1"><span>âš¡ Energy</span><span className="font-mono">{selectedAgent.state.energy | 0}</span></div>
                        <div className="flex justify-between px-1"><span>ðŸ” Hunger</span><span className="font-mono">{selectedAgent.state.hunger | 0}</span></div>
                        <div className="flex justify-between px-1"><span>ðŸ› Hygiene</span><span className="font-mono">{selectedAgent.state.hygiene | 0}</span></div>
                        <div className="flex justify-between px-1"><span>ðŸ˜´ Boredom</span><span className="font-mono">{selectedAgent.state.boredom | 0}</span></div>
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

            {/* LIFE SIM TAB */}
            <TabsContent value="lifesim" className="flex-1 overflow-y-auto pr-1 mt-0 space-y-4">
              {/* Conflict banner */}
              {lsConflict && (
                <div className="rounded-2xl bg-red-900/40 border border-red-500/50 px-3 py-2 flex items-center gap-2 text-sm text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{lsConflict.description}</span>
                </div>
              )}

              <Card className="rounded-3xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                  <Label className="font-medium">Run Life Simulation</Label>
                </div>

                {/* Persona A â€” auto-built from user settings */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Persona A (you)</Label>
                  {myPersona ? (
                    <div className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm">
                      <span className="font-medium">{myPersona.name}</span>
                      <span className="text-xs text-[hsl(var(--holo-cyan))]">âœ“ From Settings</span>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-amber-900/30 border border-amber-500/40 px-3 py-2 text-xs text-amber-300">
                      Set your living preferences in <a href="/settings" className="underline font-medium">Settings</a> first to run Life Sim.
                    </div>
                  )}
                </div>

                {/* Persona B â€” friend or interested user */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Persona B â€” roommate (optional)</Label>
                  <select value={lsPersonaBSel} onChange={e => setLsPersonaBSel(e.target.value)}
                    className="w-full mt-1 rounded-xl bg-muted border border-border px-2 py-1.5 text-sm">
                    <option value="">â€” Solo (no roommate) â€”</option>
                    {friends.filter(f => f.has_persona).length > 0 && (
                      <optgroup label="â”€â”€ Friends â”€â”€">
                        {friends.filter(f => f.has_persona).map(f => (
                          <option key={`friend-${f.id}`} value={`user:${f.id}`}>
                            {f.display_name} (friend)
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {interestedUsers.filter(u => !u.is_me && u.has_persona).length > 0 && (
                      <optgroup label="â”€â”€ Interested in this property â”€â”€">
                        {interestedUsers.filter(u => !u.is_me && u.has_persona).map(u => (
                          <option key={`interested-${u.id}`} value={`user:${u.id}`}>
                            {u.display_name} (interested)
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {!selectedPin && (
                    <p className="text-xs text-muted-foreground mt-1">Select a property pin on the map to see interested users.</p>
                  )}
                </div>

                <Button
                  onClick={handleRunLifeSim}
                  disabled={lsRunning || !roomReady || !myPersona}
                  title={!myPersona ? "Set living preferences in Settings first." : undefined}
                  className="w-full rounded-2xl shadow-sims">
                  {lsRunning ? `Runningâ€¦ ${lsProgress}%` : "Run Life Sim"}
                </Button>
              </Card>

              {/* Playback transport */}
              {lsReplay && (
                <Card className="rounded-3xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                      <Label className="font-medium">Playback</Label>
                    </div>
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded-lg">{lsTickLabel}</span>
                  </div>

                  <div className="flex gap-2 items-center">
                    <Button size="sm" variant="outline" className="rounded-xl h-8 w-8 p-0"
                      onClick={handleLsPlayPause}>
                      {lsPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <div className="flex-1">
                      <Slider value={[lsFrame]} min={0} max={Math.max(0, lsTotal - 1)}
                        step={1} onValueChange={handleLsSeek} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{lsFrame}/{lsTotal}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Speed</Label>
                    <Slider value={[lsSpeed]} min={0.5} max={4} step={0.5}
                      onValueChange={handleLsSpeed} className="flex-1" />
                    <span className="text-xs font-mono">{lsSpeed}Ã—</span>
                  </div>

                  {lsCompatScore !== null && (
                    <div className="rounded-xl bg-muted p-2 text-xs flex justify-between">
                      <span className="text-muted-foreground">Compatibility</span>
                      <span className="font-mono font-medium text-[hsl(var(--holo-cyan))]">
                        {(lsCompatScore * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </Card>
              )}

              {/* House rules */}
              {lsRules.length > 0 && (
                <Card className="rounded-3xl p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Home className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                    <Label className="font-medium">House Rules</Label>
                  </div>
                  {lsRules.map((rule, i) => (
                    <div key={i} className="rounded-xl bg-muted px-3 py-2 text-xs flex gap-2">
                      <span className="text-[hsl(var(--holo-cyan))] font-bold shrink-0">{i + 1}.</span>
                      <span>{rule}</span>
                    </div>
                  ))}
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </OverlayPanel>
  );
}

