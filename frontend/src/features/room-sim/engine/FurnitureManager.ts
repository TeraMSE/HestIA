/**
 * FurnitureManager — Places furniture inside the room using GLB assets + procedural pieces.
 * Supports wall-aligned placement, proportional scaling, and per-frame interaction effects.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import api from "../../../services/api";
import type { RoomEnvironment } from "./RoomEnvironment";
import type { Agent } from "./StateSystem";
import type { TimeOfDayController } from "./TimeOfDay";

export type FurnitureType =
  | "bed" | "chair" | "table" | "tv" | "stove" | "desk"
  | "door" | "bathroom" | "fridge" | "sink" | "sofa"
  | "toilet" | "shower" | "wardrobe" | "lamp"
  | "cabinet" | "tv_unit";

export interface FurniturePiece {
  type: FurnitureType;
  mesh: THREE.Object3D;
  x: number;
  z: number;
  interactionRadius: number;
  /** Optional point light (lamps, TV) */
  light?: THREE.PointLight;
  /** Optional emissive mesh for toggling glow */
  glowMesh?: THREE.Mesh;
}

/** Which pieces go against walls vs free interior */
const WALL_PIECES = new Set<FurnitureType>([
  "bed", "sofa", "tv", "wardrobe", "stove", "fridge", "sink", "desk", "door",
  "cabinet", "tv_unit",
]);

/** Kitchen cluster: placed on the same wall segment */
const KITCHEN_CLUSTER: FurnitureType[] = ["stove", "fridge", "sink"];

/** Bathroom cluster: placed in a corner */
const BATHROOM_CLUSTER: FurnitureType[] = ["toilet", "shower"];

const FURNITURE_DEFS: {
  type: FurnitureType;
  interactionRadius: number;
  /** Base scale for GLB models */
  scale?: number;
  /** Path for GLB models; omit for procedural */
  path?: string;
  invisible?: boolean;
  /**
   * Half-depth perpendicular to the wall (in base units, multiplied by roomScale).
   * Must be ≥ half the furniture's wall-facing dimension so pieces don't clip the wall.
   */
  wallDepth?: number;
}[] = [
  { type: "bed",      interactionRadius: 1.5, wallDepth: 1.1  }, // half of 2.0m length + margin
  { type: "sofa",     interactionRadius: 1.2, wallDepth: 0.6  }, // half of 1.1m depth
  { type: "stove",    interactionRadius: 0.9, wallDepth: 0.35 },
  { type: "fridge",   interactionRadius: 0.9, wallDepth: 0.35 },
  { type: "sink",     interactionRadius: 0.8, wallDepth: 0.35 },
  { type: "desk",     interactionRadius: 0.9, wallDepth: 0.38 },
  { type: "door",     interactionRadius: 0.5, invisible: true, wallDepth: 0.05 },
  { type: "toilet",   interactionRadius: 0.7, wallDepth: 0.4  },
  { type: "shower",   interactionRadius: 0.9, wallDepth: 0.5  },
  { type: "wardrobe", interactionRadius: 0.8, wallDepth: 0.32 },
  { type: "lamp",     interactionRadius: 0.5, wallDepth: 0.2  },
  { type: "chair",    path: "/static/glb/chair.glb",    scale: 0.012, interactionRadius: 0.8 },
  { type: "table",    path: "/static/glb/table.glb",    scale: 0.012, interactionRadius: 1.0 },
  { type: "tv",       path: "/static/glb/tv.glb",       scale: 0.8,   interactionRadius: 1.2, wallDepth: 0.25 },
  { type: "cabinet",  path: "/static/glb/cabinet.glb",  scale: 0.012, interactionRadius: 0.8, wallDepth: 0.32 },
  { type: "tv_unit",  path: "/static/glb/tv_unit.glb",  scale: 0.012, interactionRadius: 1.2, wallDepth: 0.30 },
];

export class FurnitureManager {
  scene: THREE.Scene;
  roomEnv: RoomEnvironment;
  furniture: FurniturePiece[] = [];
  private _loader: GLTFLoader;
  private _loaded = false;
  private _particles: { mesh: THREE.Points; life: number }[] = [];

  constructor(scene: THREE.Scene, roomEnv: RoomEnvironment) {
    this.scene = scene;
    this.roomEnv = roomEnv;
    this._loader = new GLTFLoader();
  }

  async placeAll(jobId?: string): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;

    const bounds = this.roomEnv.getBounds();
    // Scale furniture proportional to the room span.
    // Room is ~15 Three.js units wide. Divide by 5 so scale≈3 for a typical room.
    const roomScale = bounds
      ? Math.min(
          Math.max(
            Math.min((bounds.maxX - bounds.minX) / 5, (bounds.maxZ - bounds.minZ) / 5),
            1.0
          ),
          3.0
        )
      : 1.5;

    const wallEdges = this._computeWallEdges();

    // Assign which wall segment each wall-piece targets
    // Kitchen cluster → edge 1 (second longest), bathroom → corner of edge 2
    const bedEdge    = wallEdges[0] ?? null;
    const kitchenEdge = wallEdges[1] ?? wallEdges[0] ?? null;
    const deskEdge   = wallEdges[2] ?? wallEdges[0] ?? null;
    const wardEdge   = wallEdges[3] ?? wallEdges[0] ?? null;

    // Preload all GLB models in parallel to avoid sequential network delays
    const glbPaths = new Set(FURNITURE_DEFS.map((d) => d.path).filter(Boolean) as string[]);
    const glbCache = new Map<string, THREE.Group>();
    if (glbPaths.size > 0) {
      try {
        const loaded = await Promise.all(
          Array.from(glbPaths).map(async (path) => {
            const gltf = await this._loader.loadAsync(path);
            return { path, scene: gltf.scene };
          })
        );
        for (const item of loaded) glbCache.set(item.path, item.scene);
      } catch (e) {
        console.warn("[FurnitureManager] Some GLB models failed to load:", e);
      }
    }

    let kitchenOffset = 0;

    for (const def of FURNITURE_DEFS) {
      try {
        let mesh: THREE.Object3D;
        let light: THREE.PointLight | undefined;
        let glowMesh: THREE.Mesh | undefined;

        if (def.invisible) {
          mesh = new THREE.Group();
        } else if (def.path) {
          const cached = glbCache.get(def.path);
          if (!cached) continue;
          mesh = cached.clone();
          mesh.scale.setScalar((def.scale ?? 1.0) * roomScale);
        } else {
          const built = this._buildProcedural(def.type, roomScale);
          mesh = built.mesh;
          light = built.light;
          glowMesh = built.glowMesh;
        }

        // Shadows
        mesh.traverse((o: any) => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });

        // ── Universal bounding-box fit ────────────────────────────────────────
        // Shrink any piece that would exceed 35% of the shorter room dimension,
        // then derive the wall inset from half the measured horizontal extent
        // plus a fixed 0.5-unit gap so pieces never clip the PLY wall shell.
        // Cap: no piece may exceed 22% of the shorter room dimension.
        // Then inset by half the measured depth + a small 0.25-unit absolute clearance.
        const shortSide = bounds
          ? Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
          : roomScale * 4;
        const MAX_FRAC = 0.22;
        let wallDepth = 0.4 * roomScale;

        if (!def.invisible) {
          mesh.updateMatrixWorld(true);
          const bbox = new THREE.Box3().setFromObject(mesh);
          const sz   = bbox.getSize(new THREE.Vector3());
          const maxH = Math.max(sz.x, sz.z);
          const limit = shortSide * MAX_FRAC;

          if (maxH > limit) {
            mesh.scale.multiplyScalar(limit / maxH);
            mesh.updateMatrixWorld(true);
            bbox.setFromObject(mesh);
            bbox.getSize(sz);
          }

          // Half of the wall-facing dimension + 0.25-unit clearance.
          wallDepth = Math.max(sz.x, sz.z) / 2 + 0.25;
        }

        let pos: { x: number; z: number } | null = null;
        let rotY = 0;

        // Determine placement based on logic (CV detections overridden below if available)
        if (def.type === "bed" && bedEdge) {
          const r = this._wallMidpoint(bedEdge, 0.3, wallDepth);
          pos = r.pos; rotY = r.rotY;
        } else if (KITCHEN_CLUSTER.includes(def.type) && kitchenEdge) {
          const r = this._wallMidpoint(kitchenEdge, 0.2 + kitchenOffset * 0.25, wallDepth);
          pos = r.pos; rotY = r.rotY;
          kitchenOffset++;
        } else if ((def.type === "toilet" || def.type === "shower") && kitchenEdge) {
          const opp = wallEdges[wallEdges.length - 1] ?? kitchenEdge;
          const r = this._wallMidpoint(opp, def.type === "toilet" ? 0.2 : 0.35, wallDepth);
          pos = r.pos; rotY = r.rotY;
        } else if (def.type === "desk" && deskEdge) {
          const r = this._wallMidpoint(deskEdge, 0.7, wallDepth);
          pos = r.pos; rotY = r.rotY;
        } else if (def.type === "wardrobe" && wardEdge) {
          const r = this._wallMidpoint(wardEdge, 0.15, wallDepth);
          pos = r.pos; rotY = r.rotY;
        } else if (def.type === "sofa" && bedEdge) {
          const r = this._wallMidpoint(bedEdge, 0.75, wallDepth);
          pos = r.pos; rotY = r.rotY;
        } else if (def.type === "tv" && bedEdge) {
          const opp = wallEdges[wallEdges.length - 2] ?? bedEdge;
          const r = this._wallMidpoint(opp, 0.5, wallDepth);
          pos = r.pos; rotY = r.rotY;
        } else if (def.type === "lamp") {
          pos = this._pickSpot(0.8) ?? { x: 1, z: 1 };
        } else if (def.type === "door" && bedEdge) {
          const { start } = bedEdge;
          pos = { x: start.x, z: start.z };
        } else {
          pos = this._pickSpot(0.9 * roomScale);
          rotY = Math.random() * Math.PI * 2;
        }

        if (!pos) continue;

        // Safety: verify position is inside room polygon; if not, fall back to interior spot
        if (!this.roomEnv.containsPoint(pos.x, pos.z)) {
          const fallback = this._pickSpot(0.5);
          if (!fallback) continue;  // room polygon too small/invalid, skip this piece
          pos = fallback;
          rotY = Math.random() * Math.PI * 2;
        }

        mesh.position.set(pos.x, 0, pos.z);
        mesh.rotation.y = rotY;

        if (light) {
          light.position.set(pos.x, 1.5, pos.z);
          this.scene.add(light);
        }

        this.scene.add(mesh);
        this.furniture.push({
          type: def.type,
          mesh,
          x: pos.x,
          z: pos.z,
          interactionRadius: def.interactionRadius * roomScale,
          light,
          glowMesh,
        });
      } catch (e) {
        console.warn(`[FurnitureManager] Failed to place ${def.type}:`, e);
      }
    }

    // Process CV Detections to refine wall-aligned piece positions
    if (jobId) {
      try {
        const res = await fetch(`/api/jobs/${jobId}/artifact/detections/`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const dets = data?.detections || [];
        const erpWidth  = data?.erp_resolution?.[0] || 4096;
        const erpHeight = data?.erp_resolution?.[1] || 2048;

        // ── YOLO class name → FurnitureType (best.pt 31-class model) ──────────
        // Duplicate / near-synonym classes from best.pt are collapsed here.
        // All other best.pt classes (book, bottle, curtains, wall textures, etc.)
        // are intentionally absent — they are silently ignored by this code.
        const YOLO_MAP: Record<string, FurnitureType> = {
          // Chairs
          "Chair":        "chair",
          "chair":        "chair",
          // Sofas
          "Sofa":         "sofa",
          "couch":        "sofa",
          // Tables
          "Table":        "table",
          "table":        "table",
          "dining table": "table",
          // Other major furniture
          "bed":          "bed",
          "wardrobe":     "wardrobe",
          // Cabinets (storage)
          "cabinet":      "cabinet",
          "cupboard":     "cabinet",
          "sideboard":    "cabinet",
          // TV / media
          "tv unit":      "tv_unit",
          "tvmonitor":    "tv",
        };

        const seenTypes = new Set<string>();

        for (const d of dets) {
          const fType = YOLO_MAP[d.class_name];
          if (!fType) continue;
          if (seenTypes.has(fType)) continue;
          seenTypes.add(fType);

          const [u_min, v_min, u_max, v_max] = d.erp_bounding_box;
          const v_center = (v_min + v_max) / 2;
          const v_ratio  = v_center / erpHeight;

          // Skip ceiling (top 25%) and floor (bottom 25%) objects — they aren't wall furniture
          if (v_ratio < 0.25 || v_ratio > 0.75) continue;

          const existing = this.furniture.find(f => f.type === fType);
          if (!existing) continue;

          const u_center = (u_min + u_max) / 2;
          const phi = (u_center / erpWidth - 0.5) * 2 * Math.PI;
          const hit = this._intersectWall(Math.cos(-phi), Math.sin(-phi));

          if (hit && this.roomEnv.containsPoint(hit.pos.x, hit.pos.z)) {
            existing.x = hit.pos.x;
            existing.z = hit.pos.z;
            existing.mesh.position.set(hit.pos.x, 0, hit.pos.z);
            existing.mesh.rotation.y = hit.rotY;
            if (existing.light) existing.light.position.set(hit.pos.x, 1.5, hit.pos.z);

            // Do NOT upscale from CV detections — only allow shrink if boost < 1.0
            const relW  = (u_max - u_min) / erpWidth;
            const boost = Math.min(1.0, 0.9 + relW * 0.2);   // clamp at 1.0 so no wall-pierce
            const defn  = FURNITURE_DEFS.find(x => x.type === fType);
            existing.mesh.scale.multiplyScalar(boost);
          }
        }
      } catch (e) {
        console.warn("[FurnitureManager] CV detections fetch failed:", e);
      }
    }
  }

  // ── Per-frame effects ───────────────────────────────────────────────────────
  update(dt: number, agents: Agent[], tod?: TimeOfDayController) {
    const dark = tod?.isDark ?? false;

    for (const f of this.furniture) {
      if (f.type === "lamp" && f.light) {
        f.light.intensity = dark ? 1.2 : 0;
        if (f.glowMesh) {
          (f.glowMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = dark ? 2.0 : 0;
        }
      }

      // TV screen glows when any agent is watching TV
      if (f.type === "tv" && f.glowMesh) {
        const watching = agents.some(
          (a) => a.lsActionId === "watch_tv" && Math.hypot(a.x - f.x, a.z - f.z) < 2.5
        );
        (f.glowMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = watching ? 1.5 : 0;
        if (f.light) f.light.intensity = watching ? 0.8 : 0;
      }

      // Stove glow when cooking
      if (f.type === "stove" && f.glowMesh) {
        const cooking = agents.some(
          (a) => a.lsActionId === "cook_at_home" && Math.hypot(a.x - f.x, a.z - f.z) < 1.2
        );
        (f.glowMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = cooking ? 3.0 : 0;
        if (cooking && Math.random() < dt * 0.5) this._spawnParticle(f.x, f.z, 0.9, 0xff6600);
      }

      // Shower particles
      if (f.type === "shower" && f.glowMesh) {
        const showering = agents.some(
          (a) => (a.lsActionId === "take_shower" || a.lsActionId === "morning_routine_quiet") &&
            Math.hypot(a.x - f.x, a.z - f.z) < 1.2
        );
        if (showering && Math.random() < dt * 2) this._spawnParticle(f.x, f.z, 2.0, 0x88ccff);
      }
    }

    // Advance particle lifetimes
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this._particles.splice(i, 1);
      } else {
        (p.mesh.geometry as THREE.BufferGeometry).attributes.position.needsUpdate = true;
        p.mesh.position.y += dt * 0.4;
        p.mesh.material.opacity = p.life;
      }
    }
  }

  private _spawnParticle(x: number, z: number, y: number, color: number) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(30);
    for (let i = 0; i < 30; i += 3) {
      pos[i]     = x + (Math.random() - 0.5) * 0.3;
      pos[i + 1] = y + Math.random() * 0.2;
      pos[i + 2] = z + (Math.random() - 0.5) * 0.3;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.06, transparent: true, opacity: 1 });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this._particles.push({ mesh: pts, life: 1.5 });
  }

  // ── Procedural mesh builders ────────────────────────────────────────────────
  private _buildProcedural(type: FurnitureType, scale: number): {
    mesh: THREE.Object3D;
    light?: THREE.PointLight;
    glowMesh?: THREE.Mesh;
  } {
    switch (type) {
      case "bed":      return { mesh: this._createBed(scale) };
      case "stove":    return this._createStove(scale);
      case "fridge":   return { mesh: this._createFridge(scale) };
      case "sink":     return { mesh: this._createSink(scale) };
      case "sofa":     return { mesh: this._createSofa(scale) };
      case "toilet":   return { mesh: this._createToilet(scale) };
      case "shower":   return this._createShower(scale);
      case "desk":     return { mesh: this._createDesk(scale) };
      case "wardrobe": return { mesh: this._createWardrobe(scale) };
      case "lamp":     return this._createLamp(scale);
      default:         return { mesh: new THREE.Group() };
    }
  }

  private _s(v: number, scale: number) { return v * scale; }

  private _createBed(scale: number): THREE.Group {
    const s = (v: number) => this._s(v, scale);
    const bed = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8b6f47, roughness: 0.7, metalness: 0.1 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(s(1.2), s(0.3), s(2.0)), frameMat);
    frame.position.y = s(0.15); frame.castShadow = true; bed.add(frame);
    const mattressMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.9 });
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(s(1.1), s(0.15), s(1.9)), mattressMat);
    mattress.position.y = s(0.375); bed.add(mattress);
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.85 });
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(s(0.4), s(0.1), s(0.3)), pillowMat);
    pillow.position.set(s(-0.2), s(0.5), s(-0.7)); bed.add(pillow);
    const pillow2 = pillow.clone(); pillow2.position.set(s(0.2), s(0.5), s(-0.7)); bed.add(pillow2);
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(s(1.3), s(0.6), s(0.08)), frameMat);
    headboard.position.set(0, s(0.45), s(-1.0)); bed.add(headboard);
    const blanketMat = new THREE.MeshStandardMaterial({ color: 0x7ba7c9, roughness: 0.95 });
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(s(1.05), s(0.05), s(1.2)), blanketMat);
    blanket.position.set(0, s(0.48), s(0.2)); bed.add(blanket);
    return bed;
  }

  private _createStove(scale: number): { mesh: THREE.Group; glowMesh: THREE.Mesh } {
    const s = (v: number) => this._s(v, scale);
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(s(0.7), s(0.85), s(0.6)), bodyMat);
    body.position.y = s(0.425); body.castShadow = true; g.add(body);
    const burnerMat = new THREE.MeshStandardMaterial({
      color: 0x333333, roughness: 0.9,
      emissive: new THREE.Color(0xff4400), emissiveIntensity: 0,
    });
    for (const [bx, bz] of [[-0.15, -0.1], [0.15, -0.1], [-0.15, 0.1], [0.15, 0.1]] as [number, number][]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(s(0.08), s(0.08), s(0.02), 12), burnerMat.clone());
      b.position.set(s(bx), s(0.86), s(bz)); g.add(b);
    }
    // Use the top burner as glowMesh
    const glowMesh = g.children[g.children.length - 1] as THREE.Mesh;
    return { mesh: g, glowMesh };
  }

  private _createFridge(scale: number): THREE.Group {
    const s = (v: number) => this._s(v, scale);
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(s(0.7), s(1.8), s(0.65)), mat);
    body.position.y = s(0.9); body.castShadow = true; g.add(body);
    // Door split line
    const lineMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.5 });
    const line = new THREE.Mesh(new THREE.BoxGeometry(s(0.71), s(0.01), s(0.66)), lineMat);
    line.position.y = s(0.7); g.add(line);
    // Handle
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(s(0.04), s(0.25), s(0.04)), handleMat);
    handle.position.set(s(0.3), s(1.2), s(0.34)); g.add(handle);
    return g;
  }

  private _createSink(scale: number): THREE.Group {
    const s = (v: number) => this._s(v, scale);
    const g = new THREE.Group();
    const counterMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.5 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(s(0.6), s(0.05), s(0.5)), counterMat);
    counter.position.y = s(0.88); counter.castShadow = true; g.add(counter);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xccbbaa, roughness: 0.6 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(s(0.58), s(0.85), s(0.48)), baseMat);
    base.position.y = s(0.425); g.add(base);
    const bowlMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.1, metalness: 0.3 });
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(s(0.15), s(0.12), s(0.08), 16, 1, true), bowlMat);
    bowl.position.y = s(0.88); g.add(bowl);
    const tapMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9 });
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(s(0.02), s(0.02), s(0.2), 8), tapMat);
    tap.position.set(0, s(1.05), s(-0.12)); g.add(tap);
    return g;
  }

  private _createSofa(scale: number): THREE.Group {
    const s = (v: number) => this._s(v, scale);
    const g = new THREE.Group();
    const fabric = new THREE.MeshStandardMaterial({ color: 0x5c7a9e, roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(s(1.8), s(0.4), s(0.8)), fabric);
    base.position.y = s(0.2); base.castShadow = true; g.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(s(1.8), s(0.45), s(0.12)), fabric);
    back.position.set(0, s(0.62), s(-0.35)); g.add(back);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(s(0.12), s(0.55), s(0.8)), fabric);
    armL.position.set(s(-0.87), s(0.27), 0); g.add(armL);
    const armR = armL.clone(); armR.position.set(s(0.87), s(0.27), 0); g.add(armR);
    // Cushions
    const cushionMat = new THREE.MeshStandardMaterial({ color: 0x4a6680, roughness: 0.95 });
    for (let i = -1; i <= 1; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(s(0.52), s(0.12), s(0.55)), cushionMat);
      c.position.set(s(i * 0.6), s(0.46), s(0.05)); g.add(c);
    }
    return g;
  }

  private _createToilet(scale: number): THREE.Group {
    const s = (v: number) => this._s(v, scale);
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15 });
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(s(0.2), s(0.18), s(0.35), 16), mat);
    bowl.position.y = s(0.175); bowl.castShadow = true; g.add(bowl);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(s(0.32), s(0.3), s(0.15)), mat);
    tank.position.set(0, s(0.5), s(-0.22)); g.add(tank);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(s(0.21), s(0.21), s(0.03), 16), mat);
    lid.position.y = s(0.37); g.add(lid);
    return g;
  }

  private _createShower(scale: number): { mesh: THREE.Group; glowMesh: THREE.Mesh } {
    const s = (v: number) => this._s(v, scale);
    const g = new THREE.Group();
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x88ccff, roughness: 0.1, metalness: 0.2,
      transparent: true, opacity: 0.3,
      emissive: new THREE.Color(0x4488cc), emissiveIntensity: 0,
    });
    const wall1 = new THREE.Mesh(new THREE.BoxGeometry(s(0.9), s(2.0), s(0.03)), glassMat);
    wall1.position.set(0, s(1.0), s(-0.44)); g.add(wall1);
    const wall2 = new THREE.Mesh(new THREE.BoxGeometry(s(0.03), s(2.0), s(0.9)), glassMat.clone());
    wall2.position.set(s(0.44), s(1.0), 0); g.add(wall2);
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(s(0.88), s(0.07), s(0.88)),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 })
    );
    tray.position.y = s(0.035); g.add(tray);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(s(0.08), s(0.08), s(0.02), 16),
      new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9 }));
    head.position.set(s(0.3), s(2.0), s(-0.3)); g.add(head);
    return { mesh: g, glowMesh: wall1 as THREE.Mesh };
  }

  private _createDesk(scale: number): THREE.Group {
    const s = (v: number) => this._s(v, scale);
    const g = new THREE.Group();
    const topMat = new THREE.MeshStandardMaterial({ color: 0x3c2a1a, roughness: 0.6 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(s(1.2), s(0.06), s(0.65)), topMat);
    top.position.y = s(0.75); top.castShadow = true; g.add(top);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7 });
    for (const [lx, lz] of [[-0.55, -0.28], [0.55, -0.28], [-0.55, 0.28], [0.55, 0.28]] as [number, number][]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(s(0.05), s(0.75), s(0.05)), legMat);
      leg.position.set(s(lx), s(0.375), s(lz)); g.add(leg);
    }
    return g;
  }

  private _createWardrobe(scale: number): THREE.Group {
    const s = (v: number) => this._s(v, scale);
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x5c3d1a, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(s(1.2), s(2.0), s(0.55)), mat);
    body.position.y = s(1.0); body.castShadow = true; g.add(body);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x7a5228, roughness: 0.5 });
    const doorL = new THREE.Mesh(new THREE.BoxGeometry(s(0.56), s(1.9), s(0.04)), doorMat);
    doorL.position.set(s(-0.3), s(1.0), s(0.295)); g.add(doorL);
    const doorR = doorL.clone(); doorR.position.set(s(0.3), s(1.0), s(0.295)); g.add(doorR);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8 });
    const hL = new THREE.Mesh(new THREE.SphereGeometry(s(0.025), 8, 8), handleMat);
    hL.position.set(s(-0.05), s(1.0), s(0.32)); g.add(hL);
    const hR = hL.clone(); hR.position.set(s(0.05), s(1.0), s(0.32)); g.add(hR);
    return g;
  }

  private _createLamp(scale: number): { mesh: THREE.Group; light: THREE.PointLight; glowMesh: THREE.Mesh } {
    const s = (v: number) => this._s(v, scale);
    const g = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(s(0.03), s(0.04), s(1.4), 8), poleMat);
    pole.position.y = s(0.7); g.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(s(0.12), s(0.15), s(0.05), 12), poleMat);
    base.position.y = s(0.025); g.add(base);
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf5deb3, roughness: 0.8 });
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(s(0.2), s(0.12), s(0.25), 12), shadeMat);
    shade.position.y = s(1.45); g.add(shade);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffffaa,
      emissive: new THREE.Color(0xffffaa), emissiveIntensity: 0,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(s(0.06), 8, 8), bulbMat);
    bulb.position.y = s(1.4); g.add(bulb);

    const light = new THREE.PointLight(0xffd080, 0, s(6));
    light.position.y = s(1.4);
    g.add(light);

    return { mesh: g, light, glowMesh: bulb as THREE.Mesh };
  }

  // ── Wall placement helpers ──────────────────────────────────────────────────

  private _computeWallEdges(): { start: THREE.Vector3; end: THREE.Vector3; len: number; nx: number; nz: number }[] {
    const poly = this.roomEnv._floorPolygon;
    if (!poly || poly.length < 3) return [];

    const edges = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      // The floor polygon is CW in Three.js XZ space (Z was negated during coord transform).
      // For CW winding, the inward normal of A→B is (dz, -dx) / len.
      edges.push({
        start: new THREE.Vector3(a.x, 0, a.z),
        end:   new THREE.Vector3(b.x, 0, b.z),
        len,
        nx:  dz / len,
        nz: -dx / len,
      });
    }
    // Sort by length descending
    return edges.sort((a, b) => b.len - a.len);
  }

  private _intersectWall(dirX: number, dirZ: number): { pos: { x: number; z: number }; rotY: number } | null {
    const edges = this._computeWallEdges();
    let bestDist = Infinity;
    let bestHit: { pos: { x: number; z: number }; rotY: number } | null = null;
    
    for (const edge of edges) {
      const x1 = 0, y1 = 0, x2 = dirX * 100, y2 = dirZ * 100;
      const x3 = edge.start.x, y3 = edge.start.z, x4 = edge.end.x, y4 = edge.end.z;
      
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (den === 0) continue;
      
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
      
      if (t > 0 && t < 1 && u > 0 && u < 1) {
        const ix = x1 + t * (x2 - x1);
        const iy = y1 + t * (y2 - y1);
        const dist = Math.hypot(ix, iy);
        if (dist < bestDist) {
          bestDist = dist;
          // Place 1.0 unit inward from the wall hit point
          const px = ix + edge.nx * 1.0;
          const pz = iy + edge.nz * 1.0;
          const rotY = Math.atan2(edge.nx, edge.nz);
          bestHit = { pos: { x: px, z: pz }, rotY };
        }
      }
    }
    return bestHit;
  }

  private _wallMidpoint(
    edge: { start: THREE.Vector3; end: THREE.Vector3; nx: number; nz: number },
    fraction: number,
    inset: number  // world-space distance from wall face to furniture centre
  ): { pos: { x: number; z: number }; rotY: number } {
    const t = fraction;
    // inset is already in world-space (wallDepth * roomScale computed by caller)
    const x = edge.start.x + (edge.end.x - edge.start.x) * t + edge.nx * inset;
    const z = edge.start.z + (edge.end.z - edge.start.z) * t + edge.nz * inset;
    const rotY = Math.atan2(edge.nx, edge.nz);
    return { pos: { x, z }, rotY };
  }

  private _pickSpot(minDist: number): { x: number; z: number } | null {
    const bounds = this.roomEnv.getBounds();
    if (!bounds) return { x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 };

    for (let attempt = 0; attempt < 60; attempt++) {
      const x = bounds.minX + 0.5 + Math.random() * (bounds.maxX - bounds.minX - 1.0);
      const z = bounds.minZ + 0.5 + Math.random() * (bounds.maxZ - bounds.minZ - 1.0);
      if (!this.roomEnv.containsPoint(x, z)) continue;
      let tooClose = false;
      for (const f of this.furniture) {
        if (Math.hypot(f.x - x, f.z - z) < minDist) { tooClose = true; break; }
      }
      if (!tooClose) return { x, z };
    }
    return null;
  }

  findNearest(x: number, z: number, type?: FurnitureType): FurniturePiece | null {
    let best: FurniturePiece | null = null;
    let bestDist = Infinity;
    for (const f of this.furniture) {
      if (type && f.type !== type) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bestDist) { bestDist = d; best = f; }
    }
    return best;
  }

  getNearbyFurniture(x: number, z: number): FurniturePiece | null {
    for (const f of this.furniture) {
      if (Math.hypot(f.x - x, f.z - z) <= f.interactionRadius) return f;
    }
    return null;
  }

  dispose() {
    for (const p of this._particles) this.scene.remove(p.mesh);
    this._particles = [];

    for (const f of this.furniture) {
      this.scene.remove(f.mesh);
      if (f.light) this.scene.remove(f.light);
      f.mesh.traverse((o: any) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach((m: THREE.Material) => m.dispose());
            else o.material.dispose();
          }
        }
      });
    }
    this.furniture = [];
    this._loaded = false;
  }
}

