/**
 * CohabVisualReplay.tsx — 3D cohabitation viewer for two personas.
 *
 * Reuses the exact same Three.js stack as VisualReplay:
 *   RoomEnvironment, AgentManager, FurnitureManager, TimeOfDayController
 *
 * Driven by the LifeSimDriver to play back the VisualSimulationReplay.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "../room-sim/engine/RoomEnvironment";
import { AgentManager } from "../room-sim/engine/AgentManager";
import { FurnitureManager } from "../room-sim/engine/FurnitureManager";
import { TimeOfDayController } from "../room-sim/engine/TimeOfDay";
import { LifeSimDriver } from "../room-sim/engine/LifeSimDriver";
import {
  Loader2,
  Play,
  Pause,
  SkipBack,
  AlertTriangle,
  Users,
  Heart,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cohabApi } from "@/services/lifeSimApi";
import type { VisualSimulationReplay } from "@/services/socialSimApi";
import { toast } from "sonner";

interface Props {
  runId: string;
  personaAName: string;
  personaBName: string;
  onBack: () => void;
}

export function CohabVisualReplay({ runId, personaAName, personaBName, onBack }: Props) {
  /* Three.js refs */
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const agentMgrRef = useRef<AgentManager | null>(null);
  const furnitureMgrRef = useRef<FurnitureManager | null>(null);
  const todRef = useRef<TimeOfDayController | null>(null);
  const animIdRef = useRef<number | null>(null);
  const roomEnvRef = useRef<RoomEnvironment | null>(null);
  const driverRef = useRef<LifeSimDriver | null>(null);

  /* Playback state */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<VisualSimulationReplay | null>(null);
  const [roomReady, setRoomReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTick, setCurrentTick] = useState(0);
  const [timeLabel, setTimeLabel] = useState("--:--");
  const [currentConflict, setCurrentConflict] = useState<string | null>(null);

  /* ── Fetch replay data ───────────────────────────────────────────── */
  useEffect(() => {
    cohabApi
      .getReplay(runId)
      .then((data) => {
        setReplay(data);
        setLoading(false);
      })
      .catch((err) => {
        const msg = err?.response?.data?.detail ?? "Failed to load replay.";
        setError(msg);
        setLoading(false);
      });
  }, [runId]);

  /* ── Initialize Three.js scene ───────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060610);
    scene.fog = new THREE.Fog(0x060610, 25, 80);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    camera.position.set(5, 6, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
    tod.setHour(8);
    todRef.current = tod;

    const agentMgr = new AgentManager(scene, camera, renderer, roomEnv);
    agentMgr.setLabelsRoot(labelsRef.current);
    agentMgrRef.current = agentMgr;

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

    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      if (animIdRef.current !== null) cancelAnimationFrame(animIdRef.current);
      if (driverRef.current) driverRef.current.dispose();
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

  /* ── Spawn agents + build room once replay is loaded ─────────────── */
  useEffect(() => {
    if (!replay || !agentMgrRef.current || !roomEnvRef.current || !todRef.current || roomReady) return;

    const agentMgr = agentMgrRef.current;
    const roomEnv = roomEnvRef.current;

    // Build the default apartment layout
    const furnitureMgr = new FurnitureManager(sceneRef.current!, roomEnv);
    furnitureMgr.buildFromLayout(replay.apartment);
    furnitureMgrRef.current = furnitureMgr;

    // Spawn Agent A
    const agentA = agentMgr.spawnAgent("male");
    if (agentA) {
      agentA.label = personaAName;
      agentA.color = "#a78bfa"; // violet
    }

    // Spawn Agent B
    const agentB = agentMgr.spawnAgent("female");
    if (agentB) {
      agentB.label = personaBName;
      agentB.color = "#22d3ee"; // cyan
    }

    // Initialize Driver
    const driver = new LifeSimDriver(agentMgr, furnitureMgr, todRef.current, replay, {
      userALabel: personaAName,
      userBLabel: personaBName,
    });
    driver.setSpeed(1.5); // Slightly faster for cohab

    driver.onTickChange = (tick, lbl) => {
      setCurrentTick(tick);
      setTimeLabel(lbl);
    };

    driver.onConflict = (conflict) => {
      setCurrentConflict(conflict.description);
      setTimeout(() => setCurrentConflict(null), 3000);
    };

    driver.onComplete = () => {
      setPlaying(false);
      toast.success("Replay complete!");
    };

    driverRef.current = driver;

    setRoomReady(true);
    toast.success("Room ready — press Play to start the replay");
  }, [replay, personaAName, personaBName, roomReady]);

  /* ── Playback loop ───────────────────────────────────────────────── */
  const startPlayback = useCallback(() => {
    if (!driverRef.current) return;
    if (driverRef.current.currentFrameIndex >= driverRef.current.totalFrames - 1) {
      driverRef.current.seek(0);
    }
    if (!driverRef.current.isPlaying) {
      driverRef.current.start();
    } else {
      driverRef.current.resume();
    }
    setPlaying(true);
  }, []);

  const pausePlayback = useCallback(() => {
    if (!driverRef.current) return;
    driverRef.current.pause();
    setPlaying(false);
  }, []);

  const resetPlayback = useCallback(() => {
    if (!driverRef.current) return;
    driverRef.current.pause();
    driverRef.current.seek(0);
    setPlaying(false);
    setCurrentTick(0);
  }, []);

  const totalFrames = replay?.frames.length ?? 0;
  const progressPct = totalFrames > 0 ? Math.round((currentTick / (totalFrames - 1 || 1)) * 100) : 0;

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full bg-[#0a0a14] rounded-2xl overflow-hidden border border-gray-800">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="p-1.5 bg-violet-500/10 rounded-lg">
          <Users className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">3D Cohabitation Replay</p>
          <p className="text-xs text-gray-500 truncate">
            <span className="text-violet-300">{personaAName}</span>
            {" × "}
            <span className="text-cyan-300">{personaBName}</span>
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs">
          {timeLabel}
        </Badge>
      </div>

      {/* 3D Viewport */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        <div ref={labelsRef} className="absolute inset-0 pointer-events-none overflow-hidden" />

        {/* Loading overlay */}
        {(loading || !roomReady) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#060610]/80 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            <p className="text-sm text-gray-400">
              {loading ? "Loading replay data…" : "Building 3D environment…"}
            </p>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#060610]/90 gap-3 p-6 z-50">
            <AlertTriangle className="h-8 w-8 text-red-400" />
            <p className="text-sm text-red-300 text-center">{error}</p>
            <Button size="sm" variant="outline" onClick={onBack}>Go Back</Button>
          </div>
        )}

        {/* Conflict flash */}
        {currentConflict && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 max-w-sm w-full mx-4 z-20 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="bg-amber-950/90 border border-amber-500/40 rounded-xl px-4 py-2 flex items-start gap-2 shadow-2xl">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200 leading-relaxed">{currentConflict}</p>
            </div>
          </div>
        )}

        {/* Legend */}
        {roomReady && !loading && !error && (
          <div className="absolute bottom-3 left-3 flex flex-col gap-1 z-10">
            <div className="flex items-center gap-2 bg-black/60 rounded-lg px-2 py-1 backdrop-blur-sm border border-white/5">
              <div className="w-3 h-3 rounded-full bg-violet-400" />
              <span className="text-xs text-gray-300">{personaAName}</span>
            </div>
            <div className="flex items-center gap-2 bg-black/60 rounded-lg px-2 py-1 backdrop-blur-sm border border-white/5">
              <div className="w-3 h-3 rounded-full bg-cyan-400" />
              <span className="text-xs text-gray-300">{personaBName}</span>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-t border-gray-800 space-y-2 shrink-0">
        {/* Progress bar */}
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${progressPct}%`,
              background: "linear-gradient(90deg, #a78bfa, #22d3ee)",
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-gray-400 hover:text-white"
            onClick={resetPlayback}
            disabled={!roomReady || loading}
          >
            <SkipBack className="h-4 w-4" />
          </Button>

          <Button
            size="sm"
            className="flex-1 h-8 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300 text-xs gap-1.5"
            onClick={playing ? pausePlayback : startPlayback}
            disabled={!roomReady || loading}
          >
            {playing ? (
              <><Pause className="h-3 w-3" /> Pause</>
            ) : (
              <><Play className="h-3 w-3" /> {currentTick === 0 ? "Play Replay" : "Resume"}</>
            )}
          </Button>

          <span className="text-xs text-gray-500 shrink-0 min-w-[30px] text-right">
            {currentTick}/{Math.max(0, totalFrames - 1)}
          </span>
        </div>

        {/* Compatibility score strip */}
        {replay?.simulation_summary && (
          <div className="flex items-center gap-2 pt-1">
            <Heart className="h-3.5 w-3.5 text-pink-400 shrink-0" />
            <span className="text-xs text-gray-500">Compatibility:</span>
            <span className="text-xs font-semibold text-white">
              {Math.round((replay.simulation_summary.compatibility_score ?? 0) * 100)}%
            </span>
            <span className="text-xs text-gray-600">
              {replay.simulation_summary.label}
            </span>
            {replay.simulation_summary.conflicts_count > 0 && (
              <Badge className="ml-auto text-[10px] bg-amber-950/50 text-amber-400 border-amber-500/30">
                {replay.simulation_summary.conflicts_count} conflicts
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

