/**
 * AgentManager — Spawns, updates, and manages 3D agents inside the room.
 * Ported from backend/static/js/sim_agents.js with furniture interaction.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AnimEngine, filterAnimations } from "./AnimEngine";
import {
  Agent,
  AgentGender,
  MOVE_SPEED,
  WANDER_INT,
  TARGET_H,
  FLOOR_Y,
} from "./StateSystem";
import type { RoomEnvironment } from "./RoomEnvironment";
import type { FurnitureManager, FurniturePiece } from "./FurnitureManager";
import { getActionMapping } from "./ActionMap";

const randR = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export class AgentManager {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  roomEnv: RoomEnvironment;
  furnitureMgr: FurnitureManager | null = null;
  agents: Agent[] = [];
  selected: Agent | null = null;
  private _autonomyEnabled = true;

  private _labelsRoot: HTMLDivElement | null = null;
  private _clock = new THREE.Clock();
  private _templates: Record<string, THREE.Object3D | null> = {
    male: null,
    female: null,
  };
  private _anims: Record<string, THREE.AnimationClip[] | null> = {
    male: null,
    female: null,
  };
  private _scales: Record<string, number> = { male: 1, female: 1 };
  private _loading = false;
  private _loaded = false;

  // Callbacks for React UI updates
  onAgentsChanged?: () => void;
  onSelectedChanged?: (agent: Agent | null) => void;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    roomEnv: RoomEnvironment
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.roomEnv = roomEnv;
  }

  setLabelsRoot(el: HTMLDivElement | null) {
    this._labelsRoot = el;
  }

  setFurnitureManager(mgr: FurnitureManager) {
    this.furnitureMgr = mgr;
  }

  // ── LOAD GLB MODELS ─────────────────────────────────────────────
  async loadModels(statusCb?: (msg: string) => void): Promise<void> {
    if (this._loaded || this._loading) return;
    this._loading = true;
    const loader = new GLTFLoader();

    const load = async (key: string, path: string, label: string) => {
      statusCb?.(`Loading ${label}…`);
      try {
        const gltf = await loader.loadAsync(path);
        this._templates[key] = gltf.scene;
        const filtered = filterAnimations(gltf.animations || []);
        this._anims[key] = filtered;
        gltf.scene.traverse((o: any) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this._scales[key] = this._computeScale(gltf.scene);
        statusCb?.(`${label}: ${filtered.length} animations`);
      } catch (e) {
        console.warn(`${label} model failed:`, e);
        statusCb?.(`${label} failed — using fallback`);
      }
    };

    await load("male", "/static/glb/male model.glb", "Male");
    await load("female", "/static/glb/female model.glb", "Female");
    this._loaded = true;
    this._loading = false;
    statusCb?.("Models ready!");
  }

  private _computeScale(scene: THREE.Object3D): number {
    let h = 0;
    const tmp = new THREE.Box3();
    const acc = new THREE.Box3();
    let any = false;
    scene.traverse((o: any) => {
      if (o.isSkinnedMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        if (o.geometry.boundingBox) {
          tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
          if (any) acc.union(tmp);
          else {
            acc.copy(tmp);
            any = true;
          }
        }
      }
    });
    if (any) h = acc.getSize(new THREE.Vector3()).y;
    if (!h)
      h = new THREE.Box3()
        .setFromObject(scene)
        .getSize(new THREE.Vector3()).y;
    return TARGET_H / Math.max(h, 0.001);
  }

  // ── SPAWN ───────────────────────────────────────────────────────
  async spawnAgent(gender: AgentGender = "male"): Promise<Agent | null> {
    if (!this.roomEnv._mesh) {
      console.warn("[AgentMgr] Cannot spawn — no room loaded");
      return null;
    }

    if (!this._loaded) {
      await this.loadModels();
    }

    const spawn = this._pickWander({ x: 0, z: 0 });
    const agent = new Agent(spawn.x, spawn.z, gender);
    const grp = new THREE.Group();

    const template = this._templates[gender];
    const anims = this._anims[gender];
    const scale = this._scales[gender];

    if (template) {
      const model = skeletonClone(template);
      model.scale.setScalar(scale);
      model.traverse((o: any) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      grp.add(model);

      if (anims && anims.length) {
        agent.animEngine = new AnimEngine(model, anims);
      }

      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      if (isFinite(box.min.y)) model.position.y -= box.min.y;
    } else {
      // Fallback capsule
      const fb = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.18, 1.0, 4, 8),
        new THREE.MeshStandardMaterial({
          color: agent.colorHex,
          roughness: 0.5,
          metalness: 0.15,
        })
      );
      fb.position.y = 0.68;
      fb.castShadow = true;
      grp.add(fb);
    }

    // Color ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.38, 24),
      new THREE.MeshBasicMaterial({
        color: agent.colorHex,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    grp.add(ring);

    // Gender ring
    const gc = gender === "female" ? 0xff69b4 : 0x4488ff;
    const gRing = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.27, 24),
      new THREE.MeshBasicMaterial({
        color: gc,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      })
    );
    gRing.rotation.x = -Math.PI / 2;
    gRing.position.y = 0.011;
    grp.add(gRing);

    // Selection ring
    const selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 32),
      new THREE.MeshBasicMaterial({
        color: 0xe94560,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
    );
    selRing.rotation.x = -Math.PI / 2;
    selRing.position.y = 0.012;
    selRing.visible = false;
    grp.add(selRing);
    agent._selRing = selRing;

    grp.position.set(spawn.x, 0, spawn.z);
    this.scene.add(grp);
    agent.group = grp;

    // Floating label
    if (this._labelsRoot) {
      const lbl = document.createElement("div");
      lbl.className = "rsim-lbl";
      lbl.style.borderColor = agent.color;
      lbl.innerHTML = `${agent.label}<span class="rsim-mood">${agent.state.moodEmoji}</span><span class="rsim-act">idle</span>`;
      this._labelsRoot.appendChild(lbl);
      agent.labelEl = lbl;
    }

    this.agents.push(agent);
    if (!this.selected) this.selectAgent(agent);
    this.onAgentsChanged?.();

    console.log(
      `🧠 ${agent.label} spawned with ${anims ? anims.length : 0} animations`
    );
    return agent;
  }

  selectAgent(agent: Agent) {
    this.selected = agent;
    for (const a of this.agents) {
      if (a._selRing) a._selRing.visible = a === agent;
    }
    this.onSelectedChanged?.(agent);
  }

  // ── WALL COLLISION ──────────────────────────────────────────────
  private _inside(x: number, z: number): boolean {
    return this.roomEnv.containsPoint(x, z);
  }

  private _clampToFloor(
    fx: number,
    fz: number,
    tx: number,
    tz: number
  ): { x: number; z: number } {
    if (this._inside(tx, tz)) return { x: tx, z: tz };
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 8; i++) {
      const m = (lo + hi) / 2;
      if (this._inside(fx + (tx - fx) * m, fz + (tz - fz) * m)) lo = m;
      else hi = m;
    }
    return { x: fx + (tx - fx) * lo, z: fz + (tz - fz) * lo };
  }

  private _pickWander(agent: { x: number; z: number }): {
    x: number;
    z: number;
  } {
    const fp = this.roomEnv._floorPolygon;
    if (!fp || fp.length < 3)
      return {
        x: agent.x + (Math.random() - 0.5) * 3,
        z: agent.z + (Math.random() - 0.5) * 3,
      };
    const xs = fp.map((p) => p.x);
    const zs = fp.map((p) => p.z);
    const mnX = Math.min(...xs),
      mxX = Math.max(...xs);
    const mnZ = Math.min(...zs),
      mxZ = Math.max(...zs);
    for (let i = 0; i < 30; i++) {
      const rx = randR(mnX + 0.3, mxX - 0.3);
      const rz = randR(mnZ + 0.3, mxZ - 0.3);
      if (this._inside(rx, rz)) return { x: rx, z: rz };
    }
    return { x: agent.x, z: agent.z };
  }

  // ── AUTONOMY WITH FURNITURE ─────────────────────────────────────
  /** Toggle random wander autonomy. Set false when LifeSimDriver is active. */
  setAutonomyEnabled(enabled: boolean) {
    this._autonomyEnabled = enabled;
  }

  /** Find agent by persona subject_id (stored in agent.label after LS binding). */
  agentByPersonaId(_id: string): Agent | undefined {
    return this.agents.find((a) => a.label.includes(_id));
  }

  private _autoTick(agent: Agent, now: number) {
    if (agent.busy || agent.isMoving) return;
    if (now - agent._lastAct < agent._nextIn) return;
    agent._nextIn = randR(...WANDER_INT);
    agent._lastAct = now;

    const s = agent.state;
    const p = agent.personality;
    let act = "wander";

    // Decide action based on needs
    if (s.energy < 25 && this.furnitureMgr) {
      // Try to find a bed to sleep on
      const bed = this.furnitureMgr.findNearest(agent.x, agent.z, "bed");
      if (bed) {
        agent.targetX = bed.x + (Math.random() - 0.5) * 0.3;
        agent.targetZ = bed.z + (Math.random() - 0.5) * 0.3;
        agent.furnitureTarget = { type: "bed", x: bed.x, z: bed.z };
        agent.currentAction = "walking_to_bed";
        return;
      }
      act = "rest";
    } else if (s.boredom > 70 && this.furnitureMgr) {
      // Try to watch TV
      const tv = this.furnitureMgr.findNearest(agent.x, agent.z, "tv");
      if (tv && Math.random() < 0.4) {
        agent.targetX = tv.x + (Math.random() - 0.5) * 0.5;
        agent.targetZ = tv.z + (Math.random() - 0.5) * 0.5;
        agent.furnitureTarget = { type: "tv", x: tv.x, z: tv.z };
        agent.currentAction = "walking_to_tv";
        s.modify({ boredom: -20 });
        return;
      }
    } else if (s.comfort < 40 && this.furnitureMgr) {
      // Try to sit on a chair
      const chair = this.furnitureMgr.findNearest(agent.x, agent.z, "chair");
      if (chair && Math.random() < 0.5) {
        agent.targetX = chair.x + (Math.random() - 0.5) * 0.2;
        agent.targetZ = chair.z + (Math.random() - 0.5) * 0.2;
        agent.furnitureTarget = { type: "chair", x: chair.x, z: chair.z };
        agent.currentAction = "walking_to_chair";
        s.modify({ comfort: 15 });
        return;
      }
    }

    if (
      s.boredom > 65 ||
      (p.curiosity > 50 && Math.random() < 0.4)
    ) {
      act = "wander";
    } else if (Math.random() < 0.3) {
      act = "idle";
    }

    if (act === "wander") {
      const t = this._pickWander(agent);
      agent.targetX = t.x;
      agent.targetZ = t.z;
      agent.currentAction = "walking";
      agent.isSleeping = false;
      agent.isSitting = false;
      s.modify({ boredom: -5 });
    } else if (act === "rest") {
      agent.currentAction = "resting";
      s.modify({ energy: 15, boredom: 5 });
    } else {
      agent.currentAction = "idle";
    }
  }

  // ── ANIMATION STATE RESOLVER ─────────────────────────────────────────────
  private _resolveAnimState(agent: Agent): string {
    if (agent.isMoving) return "walk";
    // LS-driven mode: use the action_id from the current LS frame
    if (agent.lsActionId) {
      const mapping = getActionMapping(agent.lsActionId);
      return mapping.animState;
    }
    // Wander-mode fallback
    if (agent.isSleeping || agent.currentAction === "resting") return "sleep";
    if (agent.isSitting) return "sit";
    return "idle";
  }

  // ── UPDATE ──────────────────────────────────────────────────────
  update() {
    const dt = this._clock.getDelta();
    const now = performance.now();
    const canvas = this.renderer.domElement;
    const vpRect = canvas.getBoundingClientRect();
    const tmpV = new THREE.Vector3();

    for (const agent of this.agents) {
      agent.state.tick(dt);

      // Movement
      const dx = agent.targetX - agent.x;
      const dz = agent.targetZ - agent.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const step = Math.min(MOVE_SPEED * dt, d);
        const nx = agent.x + (dx / d) * step;
        const nz = agent.z + (dz / d) * step;
        const c = this._clampToFloor(agent.x, agent.z, nx, nz);
        agent.x = c.x;
        agent.z = c.z;
        agent.facing = Math.atan2(dx, dz);
        agent._speed = MOVE_SPEED;
        if (Math.hypot(c.x - nx, c.z - nz) > 0.01) {
          agent.targetX = agent.x;
          agent.targetZ = agent.z;
        }
      } else {
        agent._speed = 0;

        // Arrived at furniture target?
        if (agent.furnitureTarget) {
          const ft = agent.furnitureTarget;
          if (ft.type === "bed") {
            agent.isSleeping = true;
            agent.isSitting = false;
            agent.currentAction = "sleeping";
            agent.state.modify({ energy: 25, comfort: 10 });
            // Wake up after some time
            setTimeout(() => {
              agent.isSleeping = false;
              agent.furnitureTarget = null;
              agent.currentAction = "idle";
            }, 8000 + Math.random() * 5000);
            agent.furnitureTarget = null;
          } else if (ft.type === "chair") {
            agent.isSitting = true;
            agent.isSleeping = false;
            agent.currentAction = "sitting";
            agent.state.modify({ comfort: 20 });
            setTimeout(() => {
              agent.isSitting = false;
              agent.furnitureTarget = null;
              agent.currentAction = "idle";
            }, 5000 + Math.random() * 4000);
            agent.furnitureTarget = null;
          } else {
            agent.furnitureTarget = null;
            agent.currentAction = "idle";
          }
        } else if (
          agent.currentAction === "walking" ||
          agent.currentAction === "walking_to_bed" ||
          agent.currentAction === "walking_to_chair" ||
          agent.currentAction === "walking_to_tv"
        ) {
          agent.currentAction = "idle";
        }
      }

      // 3D position — with optional proximity pull toward shared-room partner
      let displayX = agent.x;
      let displayZ = agent.z;
      if (agent.sharedRoomPartner && !agent.isMoving) {
        const partner = agent.sharedRoomPartner;
        const pdx = partner.x - agent.x;
        const pdz = partner.z - agent.z;
        const pd = Math.hypot(pdx, pdz);
        if (pd > 0.8) {
          const f = (pd - 0.8) / pd * 0.5; // pull halfway to within 0.8 units
          displayX = agent.x + pdx * f;
          displayZ = agent.z + pdz * f;
        }
      }

      if (agent.group) {
        agent.group.position.x = displayX;
        agent.group.position.z = displayZ;
        // Apply furniture snap offset (bed/chair pose)
        agent.group.position.y = agent.poseOffset?.dy ?? 0;

        // Smooth rotation
        if (agent._speed > 0) {
          let diff = agent.facing - agent._rotY;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          agent._rotY += diff * Math.min(1, dt * 10);
        }
        // Snap yaw when posed (bed/chair)
        if (agent.poseOffset?.yaw !== undefined && !agent.isMoving) {
          agent._rotY = agent.poseOffset.yaw;
        }
        agent.group.rotation.y = agent._rotY;
      }

      // Animation state — driven by LS action_id when available, otherwise by flags
      if (agent.animEngine) {
        const animState = this._resolveAnimState(agent);
        agent.animEngine.setState(animState);
        agent.animEngine.update(dt);
      }

      // Floating label
      if (agent.labelEl && agent.group) {
        tmpV.set(agent.x, TARGET_H + 0.25, agent.z);
        tmpV.project(this.camera);
        if (tmpV.z < 1) {
          const px = (tmpV.x * 0.5 + 0.5) * vpRect.width;
          const py = (-tmpV.y * 0.5 + 0.5) * vpRect.height;
          agent.labelEl.style.left = px + "px";
          agent.labelEl.style.top = py + "px";
          agent.labelEl.style.display = "";
          const act = agent.isMoving
            ? "walking"
            : agent.isSleeping
              ? "sleeping 💤"
              : agent.isSitting
                ? "sitting 🪑"
                : agent.currentAction || "idle";
          agent.labelEl.innerHTML =
            `${agent.label}<span class="rsim-mood">${agent.state.moodEmoji}</span>` +
            `<span class="rsim-act">${act}</span>`;
        } else {
          agent.labelEl.style.display = "none";
        }
      }

      if (this._autonomyEnabled) this._autoTick(agent, now);
    }
  }

  // ── UPDATE calls _autoTick conditionally ──────────────────────────────
  // (original update() already calls _autoTick at the bottom of the loop)

  dispose() {
    for (const agent of this.agents) {
      if (agent.group) {
        this.scene.remove(agent.group);
        agent.group.traverse((o: any) => {
          if (o.isMesh) {
            o.geometry?.dispose();
            if (o.material) {
              if (Array.isArray(o.material))
                o.material.forEach((m: THREE.Material) => m.dispose());
              else o.material.dispose();
            }
          }
        });
      }
      if (agent.animEngine) agent.animEngine.dispose();
      if (agent.labelEl) agent.labelEl.remove();
    }
    this.agents = [];
    this.selected = null;
  }
}
