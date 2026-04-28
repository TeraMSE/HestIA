/**
 * FurnitureManager — Places furniture inside the room using GLB assets + procedural bed.
 * Agents can detect nearby furniture for contextual animations.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { RoomEnvironment } from "./RoomEnvironment";

export interface FurniturePiece {
  type: "bed" | "chair" | "table" | "tv";
  mesh: THREE.Object3D;
  x: number;
  z: number;
  interactionRadius: number;
}

const FURNITURE_DEFS = [
  { type: "bed" as const, procedural: true, scale: 1.0, interactionRadius: 1.5 },
  { type: "chair" as const, path: "/static/glb/chair.glb", scale: 0.012, interactionRadius: 0.8 },
  { type: "table" as const, path: "/static/glb/table.glb", scale: 0.012, interactionRadius: 1.0 },
  { type: "tv" as const, path: "/static/glb/tv.glb", scale: 0.8, interactionRadius: 1.2 },
];

export class FurnitureManager {
  scene: THREE.Scene;
  roomEnv: RoomEnvironment;
  furniture: FurniturePiece[] = [];
  private _loader: GLTFLoader;
  private _loaded = false;

  constructor(scene: THREE.Scene, roomEnv: RoomEnvironment) {
    this.scene = scene;
    this.roomEnv = roomEnv;
    this._loader = new GLTFLoader();
  }

  async placeAll(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;

    for (const def of FURNITURE_DEFS) {
      try {
        const pos = this._pickSpot(1.0);
        if (!pos) continue;

        let mesh: THREE.Object3D;

        if (def.procedural && def.type === "bed") {
          mesh = this._createBed();
        } else if (def.path) {
          const gltf = await this._loader.loadAsync(def.path);
          mesh = gltf.scene;
          mesh.scale.setScalar(def.scale);
        } else {
          continue;
        }

        // Position on floor
        mesh.position.set(pos.x, 0, pos.z);
        mesh.rotation.y = Math.random() * Math.PI * 2;

        // Enable shadows
        mesh.traverse((o: any) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });

        this.scene.add(mesh);
        this.furniture.push({
          type: def.type,
          mesh,
          x: pos.x,
          z: pos.z,
          interactionRadius: def.interactionRadius,
        });
      } catch (e) {
        console.warn(`[FurnitureManager] Failed to load ${def.type}:`, e);
      }
    }
  }

  /** Create a procedural bed using box geometries */
  private _createBed(): THREE.Group {
    const bed = new THREE.Group();

    // Frame
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x8b6f47,
      roughness: 0.7,
      metalness: 0.1,
    });
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.3, 2.0),
      frameMat
    );
    frame.position.y = 0.15;
    frame.castShadow = true;
    frame.receiveShadow = true;
    bed.add(frame);

    // Mattress
    const mattressMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5f0,
      roughness: 0.9,
      metalness: 0.0,
    });
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.15, 1.9),
      mattressMat
    );
    mattress.position.y = 0.375;
    mattress.castShadow = true;
    bed.add(mattress);

    // Pillow
    const pillowMat = new THREE.MeshStandardMaterial({
      color: 0xe8e8e8,
      roughness: 0.85,
      metalness: 0.0,
    });
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.1, 0.3),
      pillowMat
    );
    pillow.position.set(0, 0.5, -0.7);
    pillow.castShadow = true;
    bed.add(pillow);

    // Second pillow
    const pillow2 = pillow.clone();
    pillow2.position.set(0.35, 0.5, -0.7);
    bed.add(pillow2);

    // Headboard
    const headboard = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.6, 0.08),
      frameMat
    );
    headboard.position.set(0, 0.45, -1.0);
    headboard.castShadow = true;
    bed.add(headboard);

    // Blanket
    const blanketMat = new THREE.MeshStandardMaterial({
      color: 0x7ba7c9,
      roughness: 0.95,
      metalness: 0.0,
    });
    const blanket = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.05, 1.2),
      blanketMat
    );
    blanket.position.set(0, 0.48, 0.2);
    blanket.castShadow = true;
    bed.add(blanket);

    return bed;
  }

  /** Pick a random spot inside the floor polygon with minimum distance from existing furniture */
  private _pickSpot(minDist: number): { x: number; z: number } | null {
    const bounds = this.roomEnv.getBounds();
    if (!bounds) return { x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 };

    for (let attempt = 0; attempt < 50; attempt++) {
      const x = bounds.minX + 0.5 + Math.random() * (bounds.maxX - bounds.minX - 1.0);
      const z = bounds.minZ + 0.5 + Math.random() * (bounds.maxZ - bounds.minZ - 1.0);

      if (!this.roomEnv.containsPoint(x, z)) continue;

      // Check distance from existing furniture
      let tooClose = false;
      for (const f of this.furniture) {
        if (Math.hypot(f.x - x, f.z - z) < minDist) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) return { x, z };
    }
    return null;
  }

  /** Find the closest furniture piece of a given type to a position */
  findNearest(
    x: number,
    z: number,
    type?: FurniturePiece["type"]
  ): FurniturePiece | null {
    let best: FurniturePiece | null = null;
    let bestDist = Infinity;
    for (const f of this.furniture) {
      if (type && f.type !== type) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = f;
      }
    }
    return best;
  }

  /** Check if a position is within interaction range of any furniture */
  getNearbyFurniture(x: number, z: number): FurniturePiece | null {
    for (const f of this.furniture) {
      if (Math.hypot(f.x - x, f.z - z) <= f.interactionRadius) {
        return f;
      }
    }
    return null;
  }

  dispose() {
    for (const f of this.furniture) {
      this.scene.remove(f.mesh);
      f.mesh.traverse((o: any) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) {
              o.material.forEach((m: THREE.Material) => m.dispose());
            } else {
              o.material.dispose();
            }
          }
        }
      });
    }
    this.furniture = [];
    this._loaded = false;
  }
}
