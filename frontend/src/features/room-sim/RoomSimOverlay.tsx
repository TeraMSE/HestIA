/**
 * RoomSimOverlay â€” 3D room simulation overlay with LS life-sim integration.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Upload,
  Plus,
  Users,
  Eye,
  Play,
  Pause,
  Sparkles,
  Brain,
  AlertTriangle,
  Home,
  Maximize2,
  Minimize2,
  Sun,
  CheckCircle2,
  Circle,
  Loader2,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

/** GET /api/jobs/:id/artifact/panorama_insights/ — numpy/sklearn heuristics on the source panorama */
export interface PanoramaInsights {
  image_size?: { width: number; height: number };
  lighting_upper_hemisphere: {
    mean_v: number;
    var_v: number;
    summary: string;
  };
  palette_wall_band: {
    clusters: { rgb: number[]; hex: string; weight_pct: number }[];
    dominant_hex: string;
    tag: string;
    note?: string;
  };
  bright_regions_upper: {
    count: number;
    threshold_v: number;
    note: string;
    regions: Array<{
      u_normalized: number;
      azimuth_deg_cw_from_left: number;
      centroid_y_px: number;
      area_px: number;
    }>;
  };
  version?: number;
}

type RoomSimTab = "env" | "ambience" | "agents" | "lifesim";

/** Backend `current_step` order from `room_sim/pipeline/runner.py` */
const PIPE_ORDER = [
  "queued",
  "starting",
  "preprocess",
  "inference",
  "meshing",
  "object_detection",
  "panorama_insights",
  "completed",
] as const;

const SERVER_PIPELINE_ROWS: { key: string; label: string }[] = [
  { key: "preprocess", label: "Preprocess & align panorama" },
  { key: "inference", label: "Room layout (HorizonNet)" },
  { key: "meshing", label: "Build 3D mesh" },
  { key: "object_detection", label: "Detect objects" },
  { key: "panorama_insights", label: "Ambience pixel analysis" },
];

const CLIENT_VIEWER_ROWS: { key: "mesh" | "furniture"; label: string }[] = [
  { key: "mesh", label: "Load mesh into viewer" },
  { key: "furniture", label: "Place furniture models" },
];

function pipeRank(step: string): number {
  const i = (PIPE_ORDER as readonly string[]).indexOf(step);
  return i >= 0 ? i : PIPE_ORDER.indexOf("starting");
}

function PipelineGenerationProgress({
  mode,
  backendStep,
  jobState,
  clientPhase,
  isGenerating,
  roomReady,
}: {
  mode: "pipeline" | "property";
  backendStep: string;
  jobState: string;
  clientPhase: null | "mesh" | "furniture";
  isGenerating: boolean;
  roomReady: boolean;
}) {
  const r = backendStep ? pipeRank(backendStep) : 0;
  const preprocessIdx = PIPE_ORDER.indexOf("preprocess");

  const serverBlock =
    mode === "pipeline" ? (
      <ul className="space-y-2">
        {SERVER_PIPELINE_ROWS.map((row) => {
          const rk = pipeRank(row.key);
          const done = r > rk || backendStep === "completed";
          const active =
            backendStep === row.key ||
            (rk === preprocessIdx && (backendStep === "queued" || backendStep === "starting"));
          return (
            <li key={row.key} className="flex items-start gap-2 text-xs">
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
              ) : active ? (
                <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--holo-cyan))] shrink-0 mt-0.5" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/35 shrink-0 mt-0.5" aria-hidden />
              )}
              <span
                className={
                  done
                    ? "text-muted-foreground"
                    : active
                      ? "text-foreground font-medium"
                      : "text-muted-foreground/70"
                }
              >
                {row.label}
              </span>
            </li>
          );
        })}
      </ul>
    ) : (
      <p className="text-xs text-muted-foreground leading-relaxed">
        Loading the saved 3D room for this property (mesh and furniture were generated when the owner uploaded a panorama).
      </p>
    );

  const showClient =
    mode === "property"
      ? isGenerating
      : clientPhase !== null || (backendStep === "completed" && isGenerating);

  const meshDone =
    clientPhase === "furniture" || (clientPhase === null && !isGenerating && roomReady);
  const meshActive = clientPhase === "mesh";
  const furnitureDone = clientPhase === null && !isGenerating && roomReady;
  const furnitureActive = clientPhase === "furniture";

  return (
    <div className="rounded-2xl border border-[hsl(var(--holo-cyan)/0.35)] bg-[hsl(var(--holo-cyan)/0.06)] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--holo-cyan))] font-semibold">
          {mode === "pipeline" ? "Server pipeline" : "Saved room"}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[45%]" title={jobState}>
          {jobState}
        </span>
      </div>
      {serverBlock}
      {showClient && (
        <>
          <div className="border-t border-border/60 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            In your browser
          </div>
          <ul className="space-y-2">
            {CLIENT_VIEWER_ROWS.map((row) => {
              const done = row.key === "mesh" ? meshDone : furnitureDone;
              const active = row.key === "mesh" ? meshActive : furnitureActive;
              return (
                <li key={row.key} className="flex items-start gap-2 text-xs">
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
                  ) : active ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--holo-cyan))] shrink-0 mt-0.5" aria-hidden />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground/35 shrink-0 mt-0.5" aria-hidden />
                  )}
                  <span
                    className={
                      done ? "text-muted-foreground" : active ? "text-foreground font-medium" : "text-muted-foreground/70"
                    }
                  >
                    {row.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

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
  const [pipeBackendStep, setPipeBackendStep] = useState("");
  const [pipeJobState, setPipeJobState] = useState("");
  const [clientRoomPhase, setClientRoomPhase] = useState<null | "mesh" | "furniture">(null);
  const [genProgressMode, setGenProgressMode] = useState<"pipeline" | "property" | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const [roomJobId, setRoomJobId] = useState<string | null>(null);
  const [ambienceInsights, setAmbienceInsights] = useState<PanoramaInsights | null>(null);
  const [ambienceStatus, setAmbienceStatus] = useState<"idle" | "loading" | "error" | "ok">("idle");
  const [ambienceErrDetail, setAmbienceErrDetail] = useState<string | null>(null);
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
  const [tab, setTab] = useState<RoomSimTab>("env");
  const [immersive, setImmersive] = useState(false);
  /** Signals WebGL refs exist — `useLayoutEffect` runs before Three's `useEffect` on first mount */
  const [webglBootstrap, setWebglBootstrap] = useState(0);

  const pinTitle = selectedPin?.title ?? "No property pin selected.";
  const immersivePanels = (() => {
    switch (tab) {
      case "env":
        return {
          left: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2">Scene</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {roomReady
                  ? "The procedural room mesh and furniture load is complete. Visitors to this listing share this same spatial layout."
                  : isOwner
                    ? "Generate a panorama-driven 3D room to replace the preview grid. Options like viewport alignment and hiding the ceiling affect the pipeline output."
                    : "This property does not expose a generated world yet — only the owner can upload source imagery."}
              </p>
              <p className="text-xs text-neutral-500 mt-3 font-mono">
                {isGenerating
                  ? `${pipeJobState ? `[${pipeJobState}] ` : ""}${pipeBackendStep || pipeStatus}`
                  : roomReady
                    ? "Status: Ready"
                    : "Status: Waiting — add a panorama first"}
              </p>
            </>
          ),
          right: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2">Lighting</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Time of day drives sun angle, skylight tint, and interior mood.
                {" "}
                {liveTime ? "Live cycle is advancing in real time." : "Manual hour is locked unless live cycle is on."}
              </p>
              <p className="text-xs font-mono text-muted-foreground mt-3">{formatTimeLabel(timeVal)}</p>
            </>
          ),
          bottom: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2">Property</p>
              <p className="text-sm leading-relaxed text-muted-foreground text-center">{pinTitle}</p>
              <p className="text-xs text-center text-neutral-500 mt-2">
                Exit immersive view (minimize icon) any time for uploads, sliders, and full sidebar controls.
              </p>
            </>
          ),
        };
      case "ambience":
        return {
          left: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2">Natural light</p>
              {ambienceStatus === "loading" && (
                <p className="text-sm text-muted-foreground">Analyzing panorama pixelsâ€¦</p>
              )}
              {ambienceStatus === "error" && (
                <p className="text-sm text-muted-foreground">
                  {ambienceErrDetail || "Request failed. Check the browser network tab for /api/jobs/.../panorama_insights/."}
                </p>
              )}
              {ambienceInsights && (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">{ambienceInsights.lighting_upper_hemisphere.summary}</p>
                  <p className="text-xs font-mono text-neutral-600 mt-2">
                    mean V {ambienceInsights.lighting_upper_hemisphere.mean_v} · variance {ambienceInsights.lighting_upper_hemisphere.var_v}
                  </p>
                  <p className="text-xs text-neutral-500 mt-2">From HSV value channel, upper hemisphere (rows above mid-height).</p>
                </>
              )}
              {!roomReady && (
                <p className="text-sm text-muted-foreground">Generate or load a 3D room to analyze the source panorama.</p>
              )}
            </>
          ),
          right: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2">Wall palette</p>
              {ambienceInsights ? (
                <>
                  <p className="text-sm text-foreground font-medium capitalize">{ambienceInsights.palette_wall_band.tag} tones</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Dominant {ambienceInsights.palette_wall_band.dominant_hex} · k-means on horizon band (~42â€“58% height).
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {ambienceInsights.palette_wall_band.clusters.slice(0, 5).map((c, i) => (
                      <span
                        key={i}
                        title={`${c.weight_pct}%`}
                        className="inline-block h-6 w-6 rounded-full border border-neutral-300 shadow-sm"
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{roomReady ? "Waiting for insight payloadâ€¦" : "â€”"}</p>
              )}
            </>
          ),
          bottom: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2 text-center">Bright openings</p>
              {ambienceInsights ? (
                <>
                  <p className="text-sm text-muted-foreground text-center">
                    About <span className="font-medium text-foreground">{ambienceInsights.bright_regions_upper.count}</span> bright region
                    {ambienceInsights.bright_regions_upper.count === 1 ? "" : "s"} in the upper half (candidates for windows / exterior doors).
                  </p>
                  <p className="text-xs text-neutral-500 text-center mt-2">
                    Azimuth uses u/W Â· 360Â° along the panorama (left edge = 0Â°, seam wraps).
                  </p>
                  {ambienceInsights.bright_regions_upper.regions.slice(0, 4).length > 0 && (
                    <p className="text-xs font-mono text-center text-neutral-600 mt-2">
                      {ambienceInsights.bright_regions_upper.regions
                        .slice(0, 4)
                        .map((r) => `${r.azimuth_deg_cw_from_left.toFixed(0)}Â°`)
                        .join(" Â· ")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center">â€”</p>
              )}
            </>
          ),
        };
      case "lifesim":
        return {
          left: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2">Personas</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {myPersona
                  ? <>
                      <span className="text-foreground font-medium">{myPersona.name}</span>
                      {" drives Persona A from your saved living preferences."}
                    </>
                  : "Open Settings and save living preferences before the backend can synthesize roommate scenarios."}
              </p>
              {lsPersonaBSel && (
                <p className="text-xs text-muted-foreground mt-2">
                  Partner selection is set — the next run evaluates both occupants in shared space.
                </p>
              )}
              {lsRunning && (
                <p className="text-xs font-mono text-[hsl(var(--holo-cyan))] mt-2">Generatingâ€¦ {lsProgress}%</p>
              )}
            </>
          ),
          right: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2">Playback</p>
              {lsReplay ? (
                <>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Replay maps LLM-derived ticks onto agent paths and furnishings. Seek and speed controls mirror the sidebar.
                  </p>
                  <p className="text-xs font-mono text-muted-foreground mt-3">
                    {lsTickLabel} â€” tick {lsFrame}/{Math.max(1, lsTotal)} at {lsSpeed}Ã—
                  </p>
                  {lsCompatScore !== null && (
                    <p className="text-xs mt-2 text-[hsl(var(--holo-cyan))]">
                      Compatibility {(lsCompatScore * 100).toFixed(0)}%
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Run life simulation from the sidebar to stream structured conflicts into this viewport. Until then only free-play agents animate.
                </p>
              )}
            </>
          ),
          bottom: (
            <>
              {lsConflict ? (
                <div className="flex gap-2 text-sm text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
                  <span>{lsConflict.description}</span>
                </div>
              ) : lsRules.length > 0 ? (
                <p className="text-sm text-muted-foreground text-center">
                  <span className="text-[hsl(var(--holo-cyan))] font-medium">{lsRules.length}</span>
                  {" mediation rule(s) available — expand the sidebar to read each line."}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground text-center">
                  Highlights from mediation and conflicts appear here while a replay is active or after rules are generated.
                </p>
              )}
            </>
          ),
        };
      case "agents":
        return {
          left: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2">Population</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {agents.length === 0
                  ? "Spawn scripted agents once the mesh exists so they navigate furniture rails and satisfy needs."
                  : `${agents.length} agent(s) in the simulation. Selecting one surfaces vitals without leaving immersive view.`}
              </p>
            </>
          ),
          right: (
            <>
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--holo-cyan))]/80 mb-2">Selection</p>
              {selectedAgent ? (
                <>
                  <p className="text-sm text-foreground font-medium">{selectedAgent.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedAgent.state.moodLabel} â€¢ energy {Math.round(selectedAgent.state.energy)} â€¢ action:{" "}
                    <span className="capitalize">{selectedAgent.currentAction || "idle"}</span>
                  </p>
                </>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Tap an agent badge in the full sidebar view, or pause immersive mode to inspect every stat field.
                </p>
              )}
            </>
          ),
          bottom: (
            <p className="text-sm text-muted-foreground text-center">
              Interaction prompts stay in the standard layout; here you keep framing on behavior and pacing while the canvas stays unobstructed.
            </p>
          ),
        };
    }
  })();

  /* Recover job id when the mesh loaded but local state lost the UUID (e.g. strict remount) */
  useEffect(() => {
    if (!roomReady || roomJobId) return;
    const propId = selectedPin?.id;
    if (!propId || !/^\d+$/.test(propId)) return;
    let cancelled = false;
    fetch(`/api/jobs/property/${propId}/`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { job_id?: string } | null) => {
        if (!cancelled && data?.job_id) setRoomJobId(data.job_id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomReady, roomJobId, selectedPin?.id]);

  useEffect(() => {
    if (!roomJobId || !roomReady) {
      setAmbienceInsights(null);
      setAmbienceStatus("idle");
      setAmbienceErrDetail(null);
      return;
    }
    let cancelled = false;
    setAmbienceStatus("loading");
    setAmbienceErrDetail(null);
    fetch(`/api/jobs/${roomJobId}/artifact/panorama_insights/`)
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) {
          let detail = text.slice(0, 400);
          try {
            const j = JSON.parse(text) as { error?: string };
            if (typeof j.error === "string") detail = j.error;
          } catch {
            /* keep raw */
          }
          throw new Error(detail || `HTTP ${r.status}`);
        }
        return JSON.parse(text) as PanoramaInsights;
      })
      .then((data) => {
        if (!cancelled) {
          setAmbienceInsights(data);
          setAmbienceStatus("ok");
          setAmbienceErrDetail(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setAmbienceInsights(null);
          setAmbienceStatus("error");
          setAmbienceErrDetail(e.message || "Request failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomJobId, roomReady]);

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
        setGenProgressMode("property");
        setPipeBackendStep("");
        setPipeJobState("loading_shared_room");
        setClientRoomPhase("mesh");
        setIsGenerating(true);
        setPipeStatus("Loading shared 3D world...");
        const roomEnv = roomEnvRef.current!;
        await roomEnv.loadFromJob(jobId);
        setRoomJobId(jobId);
        setClientRoomPhase("furniture");
        setPipeStatus("Placing furniture...");
        const { FurnitureManager } = await import("./engine/FurnitureManager");
        const fMgr = new FurnitureManager(sceneRef.current!, roomEnv);
        await fMgr.placeAll(jobId);
        furnitureMgrRef.current = fMgr;
        agentMgrRef.current!.setFurnitureManager(fMgr);
        setPipeStatus("Shared 3D world loaded.");
        setClientRoomPhase(null);
        setGenProgressMode(null);
        setPipeJobState("");
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
        setClientRoomPhase(null);
        setGenProgressMode(null);
        setPipeJobState("");
        setIsGenerating(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPin?.id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [panoFileLabel, setPanoFileLabel] = useState("");
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

    setWebglBootstrap((n) => n + 1);

    // Resize + canvas host are managed in a separate effect that depends on
    // `immersive`, because toggling layout replaces `containerRef`'s DOM node
    // and the WebGL canvas must be reparented (see effect below).

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
      if (animIdRef.current !== null) cancelAnimationFrame(animIdRef.current);
      agentMgr.dispose();
      furnitureMgrRef.current?.dispose();
      roomEnv.dispose();
      tod.dispose();
      controls.dispose();
      renderer.dispose();
      const host = renderer.domElement.parentElement;
      if (host) host.removeChild(renderer.domElement);
    };
  }, []);

  /* Reparent canvas + labels synchronously — must run before paint while refs point at the mounted branch */
  useLayoutEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;

    const syncHost = () => {
      const container = containerRef.current;
      if (!container) return;

      if (renderer.domElement.parentElement !== container) {
        renderer.domElement.remove();
        container.appendChild(renderer.domElement);
      }

      const labels = labelsRef.current;
      const agentMgr = agentMgrRef.current;
      if (agentMgr && labels) {
        for (const a of agentMgr.agents) {
          if (a.labelEl) labels.appendChild(a.labelEl);
        }
        agentMgr.setLabelsRoot(labels);
      }
    };

    const fit = () => {
      const container = containerRef.current;
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 4 || h < 4) return;
      const cam = cameraRef.current;
      const r = rendererRef.current;
      if (!cam || !r) return;
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      r.setSize(w, h);
    };

    syncHost();
    fit();

    const ro = new ResizeObserver(() => fit());
    const observeTarget = containerRef.current;
    if (observeTarget) ro.observe(observeTarget);
    window.addEventListener("resize", fit);

    /* Panels remeasure after flex modal reflow when leaving fullBleed */
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      syncHost();
      fit();
      raf2 = requestAnimationFrame(() => {
        syncHost();
        fit();
      });
    });
    const tLate = window.setTimeout(() => {
      syncHost();
      fit();
    }, 120);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(tLate);
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [immersive, webglBootstrap]);

  /* â”€â”€ Pipeline: upload panorama â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const handleGenerate = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Please select a panorama image file.");
      return;
    }

    setIsGenerating(true);
    setGenProgressMode("pipeline");
    setPipeBackendStep("queued");
    setPipeJobState("queued");
    setClientRoomPhase(null);
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
          setPipeJobState(state);
          setPipeBackendStep(step);
          setPipeStatus(`[${state}] ${step}`);
        },
        async (jobId) => {
          setPipeBackendStep("completed");
          setPipeJobState("completed");
          setClientRoomPhase("mesh");
          setPipeStatus("Loading generated mesh...");
          setRoomJobId(jobId);
          const roomEnv = roomEnvRef.current!;
          await roomEnv.loadFromJob(jobId);

          setClientRoomPhase("furniture");
          setPipeStatus("Placing furniture (downloading models)...");
          const fMgr = new FurnitureManager(sceneRef.current!, roomEnv);
          await fMgr.placeAll(jobId);
          furnitureMgrRef.current = fMgr;
          agentMgrRef.current!.setFurnitureManager(fMgr);

          setClientRoomPhase(null);
          setGenProgressMode(null);
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
      setGenProgressMode(null);
      setClientRoomPhase(null);
      setPipeBackendStep("");
      setPipeJobState("");
      setPipeStatus(`Error: ${err.message}`);
      toast.error(`Generation failed: ${err.message}`);
    }
  }, [alignPano, hideCeiling, selectedPin]);

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

  const viewportCardClass = cn(
    "relative rounded-3xl overflow-hidden border-[#1e1e35] bg-[#060610]",
    /* Immersive: in-flow height must be explicit — absolute canvas does not stretch the card */
    immersive ? "relative z-0 min-h-[min(480px,50vh)] w-full flex-1 flex-col md:min-h-0" : "col-span-full min-w-0 w-full md:col-span-8 h-[550px]",
  );

  const viewportInner = (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      <div ref={labelsRef} className="absolute inset-0 pointer-events-none overflow-hidden" />
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
      {isGenerating && genProgressMode && immersive && (
        <div className="absolute inset-x-0 bottom-0 z-20 max-h-[min(40vh,320px)] overflow-y-auto p-2 sm:p-3 bg-black/70 backdrop-blur-md border-t border-[hsl(var(--holo-cyan)/0.3)]">
          <div className="max-w-xl mx-auto [&_li]:text-[11px] [&_p]:text-[11px] text-neutral-200">
            <PipelineGenerationProgress
              mode={genProgressMode}
              backendStep={pipeBackendStep}
              jobState={pipeJobState}
              clientPhase={clientRoomPhase}
              isGenerating={isGenerating}
              roomReady={roomReady}
            />
          </div>
        </div>
      )}
    </>
  );

  const panelChrome =
    "rounded-3xl border border-neutral-200/95 bg-white p-4 min-h-0 overflow-y-auto shadow-sm text-neutral-700";

  return (
    <OverlayPanel
      title="3D Room Simulation"
      subtitle="Procedural environment & AI agents"
      size="xl"
      fullBleed={immersive}
      contentClassName={immersive ? "flex h-full min-h-0 flex-col overflow-hidden px-4 py-4 gap-4" : undefined}
      headerActions={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full hover:bg-[hsl(var(--holo-cyan)/0.2)]"
          aria-label={immersive ? "Exit full layout" : "Full layout"}
          aria-pressed={immersive}
          onClick={() => setImmersive((v) => !v)}
        >
          {immersive ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
        </Button>
      }
    >
      {immersive ? (
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <div className="flex justify-center shrink-0 pt-1" role="tablist" aria-label="Insight layer">
            <div className="inline-flex flex-wrap justify-center gap-1 rounded-2xl bg-white p-1 border border-neutral-200/95 shadow-sm">
              {(
                [
                  { id: "env" as const, label: "Environment" },
                  { id: "ambience" as const, label: "Ambience", ExtraIcon: Sun },
                  { id: "lifesim" as const, label: "Life sim", BrainIcon: Brain },
                  { id: "agents" as const, label: "Agent" },
                ] as const
              ).map((item) => {
                const active = tab === item.id;
                const tabLocked = item.id !== "env" && !roomReady;
                const BrainIconComp = "BrainIcon" in item ? item.BrainIcon : undefined;
                const ExtraIconComp = "ExtraIcon" in item ? item.ExtraIcon : undefined;
                return (
                  <button
                    key={item.id}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    disabled={tabLocked}
                    title={tabLocked ? "Generate the 3D room from a panorama first." : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
                      active
                        ? "bg-[hsl(var(--holo-cyan)/0.15)] text-neutral-900 shadow-sm border border-[hsl(var(--holo-cyan)/0.4)]"
                        : "text-neutral-600 hover:text-neutral-900 border border-transparent",
                      tabLocked && "opacity-40 cursor-not-allowed hover:text-neutral-600",
                    )}
                    onClick={() => {
                      if (tabLocked) return;
                      setTab(item.id);
                      if (item.id === "lifesim" && tab !== "lifesim") {
                        if (friends.length === 0) socialApi.getFriends().then(setFriends).catch(() => {});
                        if (selectedPin) {
                          socialApi.getPropertyInterested(selectedPin.id).then((res) => {
                            setInterestedUsers(res.interested_users ?? []);
                          }).catch(() => {});
                        }
                      }
                    }}
                  >
                    {BrainIconComp ? <BrainIconComp className="h-3 w-3" /> : ExtraIconComp ? <ExtraIconComp className="h-3 w-3" /> : null}
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 min-h-0 grid gap-3 max-md:grid-cols-1 md:grid-rows-[minmax(280px,1fr)_auto] md:[grid-template-columns:minmax(12rem,1fr)_minmax(0,2.85fr)_minmax(12rem,1fr)] md:gap-x-4">
            <aside className={cn(panelChrome, "max-md:order-2 md:col-start-1 md:row-start-1 md:min-h-0 md:self-stretch")}>
              <div className="[&_.text-muted-foreground]:text-neutral-600 [&_.text-foreground]:text-neutral-900">{immersivePanels.left}</div>
            </aside>

            <div className="max-md:order-1 flex min-h-[min(360px,45vh)] min-w-0 flex-1 flex-col md:col-start-2 md:row-start-1 md:h-full md:min-h-0">
              <Card className={cn(viewportCardClass, "flex")}>{viewportInner}</Card>
            </div>

            <aside className={cn(panelChrome, "max-md:order-3 md:col-start-3 md:row-start-1 md:self-stretch")}>
              <div className="[&_.text-muted-foreground]:text-neutral-600 [&_.text-foreground]:text-neutral-900">{immersivePanels.right}</div>
            </aside>

            <div className={cn(panelChrome, "max-md:order-4 md:col-start-2 md:row-start-2 md:max-h-[30vh]", "text-center [&>*]:mx-auto [&>*]:max-w-2xl")}>
              <div className="inline-block text-center w-full [&_.text-muted-foreground]:text-neutral-600 [&_.text-foreground]:text-neutral-900">{immersivePanels.bottom}</div>
            </div>
          </div>
        </div>
      ) : (
      <div className="grid md:grid-cols-12 gap-6">
        
        {/* â”€â”€ 3D VIEWPORT â”€â”€ */}
        <Card className={viewportCardClass}>{viewportInner}</Card>

        {/* â”€â”€ CONTROLS SIDEBAR â”€â”€ */}
        <div className="md:col-span-4 flex flex-col min-h-0">
          <Tabs value={tab} onValueChange={(v) => setTab(v as RoomSimTab)} className="flex-1 flex flex-col">
            <TabsList className="rounded-2xl mb-4 grid grid-cols-2 sm:grid-cols-4 gap-1 h-auto">
              <TabsTrigger value="env" className="text-xs sm:text-sm">Environment</TabsTrigger>
              <TabsTrigger
                value="ambience"
                className="text-xs sm:text-sm"
                disabled={!roomReady}
                title={!roomReady ? "Generate the 3D room from a panorama first." : undefined}
              >
                <Sun className="h-3 w-3 mr-1 inline" />
                Ambience
              </TabsTrigger>
              <TabsTrigger
                value="agents"
                className="text-xs sm:text-sm"
                disabled={!roomReady}
                title={!roomReady ? "Generate the 3D room from a panorama first." : undefined}
              >
                Agents
              </TabsTrigger>
              <TabsTrigger
                value="lifesim"
                className="text-xs sm:text-sm"
                disabled={!roomReady}
                title={!roomReady ? "Generate the 3D room from a panorama first." : undefined}
              >
                <Brain className="h-3 w-3 mr-1 inline" />
                Life Sim
              </TabsTrigger>
            </TabsList>

            {/* ENVIRONMENT TAB */}
            <TabsContent value="env" className="flex-1 overflow-y-auto pr-1 mt-0 space-y-4">
              {/* Loading saved property room — visible to everyone */}
              {isGenerating && genProgressMode === "property" && (
                <PipelineGenerationProgress
                  mode="property"
                  backendStep=""
                  jobState={pipeJobState}
                  clientPhase={clientRoomPhase}
                  isGenerating={isGenerating}
                  roomReady={roomReady}
                />
              )}

              {/* Step 1 — panorama input drives everything else */}
              <Card className="rounded-3xl border-2 border-[hsl(var(--holo-cyan)/0.45)] bg-[hsl(var(--holo-cyan)/0.04)] p-4 space-y-4 shadow-sm">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--holo-cyan))]">
                    Step 1 — Panorama input (required first)
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    The pipeline and every downstream feature use this image. Generate the 3D room before ambience, agents, or life sim.
                  </p>
                </div>

                {roomReady ? (
                  <div className="rounded-2xl bg-emerald-900/30 border border-emerald-500/40 px-3 py-2 text-xs text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>3D world is shared — all visitors see this room.</span>
                  </div>
                ) : isOwner ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Upload className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                      <Label className="font-medium">Panorama file</Label>
                    </div>
                    <Input
                      type="file"
                      ref={fileRef}
                      accept="image/*"
                      className="rounded-2xl text-xs"
                      disabled={isGenerating}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        setPanoFileLabel(f?.name ?? "");
                      }}
                    />
                    {panoFileLabel ? (
                      <p className="text-[11px] font-mono text-muted-foreground truncate" title={panoFileLabel}>
                        Selected: {panoFileLabel}
                      </p>
                    ) : null}

                    <div className="space-y-3 pt-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                        Pipeline options (apply on Generate)
                      </p>
                      <div className="flex items-center justify-between rounded-2xl bg-muted p-3">
                        <Label className="text-sm cursor-pointer" htmlFor="align-pano">
                          Viewport align
                        </Label>
                        <Switch
                          id="align-pano"
                          checked={alignPano}
                          onCheckedChange={setAlignPano}
                          disabled={isGenerating}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-muted p-3">
                        <Label className="text-sm cursor-pointer" htmlFor="hide-ceil">
                          Hide ceiling
                        </Label>
                        <Switch
                          id="hide-ceil"
                          checked={hideCeiling}
                          onCheckedChange={setHideCeiling}
                          disabled={isGenerating}
                        />
                      </div>
                    </div>

                    <Button
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="w-full rounded-2xl shadow-sims"
                    >
                      {isGenerating && genProgressMode === "pipeline" ? "Working…" : "Generate 3D room"}
                    </Button>
                  </>
                ) : (
                  <div className="rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    Only the property owner can upload a panorama and run the pipeline for this pin.
                  </div>
                )}

                {isGenerating && genProgressMode === "pipeline" && (
                  <PipelineGenerationProgress
                    mode="pipeline"
                    backendStep={pipeBackendStep}
                    jobState={pipeJobState}
                    clientPhase={clientRoomPhase}
                    isGenerating={isGenerating}
                    roomReady={roomReady}
                  />
                )}
              </Card>

              {/* Step 2 — scene experience after mesh exists */}
              <Card
                className={cn(
                  "rounded-3xl p-4 space-y-4 relative transition-opacity",
                  !roomReady && "opacity-55",
                )}
              >
                {!roomReady && (
                  <div className="absolute inset-0 z-10 rounded-3xl flex items-start justify-center pt-8 px-4 pointer-events-none">
                    <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm max-w-[90%]">
                      <Lock className="h-4 w-4 shrink-0 text-[hsl(var(--holo-cyan))]" />
                      <span>Complete Step 1 to unlock lighting and the rest of the simulation.</span>
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Step 2 — Scene & lighting
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Adjust sun angle and interior mood after the room geometry exists.
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                    <Label className="font-medium">Time of day</Label>
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
                    disabled={liveTime || !roomReady}
                  />
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-muted p-3">
                  <Label className="text-sm cursor-pointer" htmlFor="live-time">
                    Live time cycle
                  </Label>
                  <Switch
                    id="live-time"
                    checked={liveTime}
                    onCheckedChange={setLiveTime}
                    disabled={!roomReady}
                  />
                </div>
              </Card>
            </TabsContent>

            {/* AMBIENCE TAB — pixel heuristics from backend */}
            <TabsContent value="ambience" className="flex-1 overflow-y-auto pr-1 mt-0 space-y-4">
              <Card className="rounded-3xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-[hsl(var(--holo-cyan))]" />
                  <Label className="font-medium">Natural light</Label>
                </div>
                {ambienceStatus === "loading" && <p className="text-sm text-muted-foreground">Loading panorama metricsâ€¦</p>}
                {ambienceStatus === "error" && (
                  <p className="text-sm text-amber-900 bg-amber-50 rounded-xl px-3 py-2 border border-amber-200">
                    {ambienceErrDetail || "Could not load insights. See Network tab for this request."}
                  </p>
                )}
                {!roomReady && <p className="text-sm text-muted-foreground">Generate or load a 3D room first.</p>}
                {ambienceInsights && (
                  <>
                    <p className="text-sm leading-relaxed">{ambienceInsights.lighting_upper_hemisphere.summary}</p>
                    <p className="text-xs font-mono text-muted-foreground">
                      mean V {ambienceInsights.lighting_upper_hemisphere.mean_v} · var {ambienceInsights.lighting_upper_hemisphere.var_v}
                    </p>
                  </>
                )}
              </Card>

              <Card className="rounded-3xl p-4 space-y-3">
                <Label className="font-medium">Wall color palette</Label>
                <p className="text-xs text-muted-foreground">k-means (k=5) on the horizon band (~42â€“58% image height).</p>
                {ambienceInsights && (
                  <>
                    <p className="text-sm capitalize">
                      <span className="font-medium">{ambienceInsights.palette_wall_band.tag}</span>
                      {" · dominant "}
                      <span className="font-mono">{ambienceInsights.palette_wall_band.dominant_hex}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ambienceInsights.palette_wall_band.clusters.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span
                            className="inline-block h-8 w-8 rounded-lg border border-border shadow-sm"
                            style={{ backgroundColor: c.hex }}
                          />
                          <span>{c.weight_pct}%</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Card>

              <Card className="rounded-3xl p-4 space-y-3">
                <Label className="font-medium">Bright regions (window candidates)</Label>
                <p className="text-xs text-muted-foreground">
                  High-brightness connected components in the upper half; azimuth = (u/W)Â·360Â° along the panorama.
                </p>
                {ambienceInsights && (
                  <>
                    <p className="text-sm">
                      Detected <span className="font-semibold">{ambienceInsights.bright_regions_upper.count}</span> region
                      {ambienceInsights.bright_regions_upper.count === 1 ? "" : "s"}
                      {" "}(V &gt;= {ambienceInsights.bright_regions_upper.threshold_v}).
                    </p>
                    <ul className="text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
                      {ambienceInsights.bright_regions_upper.regions.slice(0, 12).map((r, i) => (
                        <li key={i}>
                          {r.azimuth_deg_cw_from_left.toFixed(0)}Â° · area {r.area_px}px
                        </li>
                      ))}
                    </ul>
                  </>
                )}
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
      )}
    </OverlayPanel>
  );
}

