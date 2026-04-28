/**
 * RoomEnvironment — Loads PLY mesh and floor polygon, provides containment checks.
 * Ported from sim.html. Renders a CLEAN white material (no textures/vertex colors).
 */
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

export interface FloorPoint {
  x: number;
  z: number;
}

export class RoomEnvironment {
  scene: THREE.Scene;
  _mesh: THREE.Mesh | null = null;
  _innerMesh: THREE.Mesh | null = null;
  _floorPolygon: FloorPoint[] | null = null;
  private _loader: PLYLoader;
  private _worldScale = 10.0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this._loader = new PLYLoader();
  }

  async loadFromJob(jobId: string): Promise<THREE.Mesh> {
    const meshUrl = `/api/jobs/${jobId}/artifact/mesh/`;
    const polyUrl = `/api/jobs/${jobId}/floor_polygon/`;

    let rawPolygon: FloorPoint[] = [];
    try {
      const polyResp = await fetch(polyUrl);
      const polyData = await polyResp.json();
      rawPolygon = polyData.floor_polygon || [];
    } catch (_) {}

    this._clearMesh();

    return new Promise((resolve, reject) => {
      this._loader.load(
        meshUrl,
        (geometry) => {
          geometry.computeVertexNormals();

          // ── CLEAN white material (no vertex colors / textures) ──
          const mat = new THREE.MeshStandardMaterial({
            color: 0xf0f0f0,
            side: THREE.DoubleSide,
            roughness: 0.6,
            metalness: 0.05,
          });

          this._mesh = new THREE.Mesh(geometry, mat);
          this._mesh.rotation.x = -Math.PI / 2;
          this._mesh.scale.setScalar(this._worldScale);
          this._mesh.receiveShadow = true;
          this.scene.add(this._mesh);

          // ── Wall thickening: inner shell ──
          const WALL_THICK = 0.035;
          const innerGeo = geometry.clone();
          innerGeo.computeVertexNormals();
          const iPos = innerGeo.attributes.position;
          const iNrm = innerGeo.attributes.normal;
          for (let i = 0; i < iPos.count; i++) {
            iPos.setX(i, iPos.getX(i) - iNrm.getX(i) * WALL_THICK);
            iPos.setY(i, iPos.getY(i) - iNrm.getY(i) * WALL_THICK);
            iPos.setZ(i, iPos.getZ(i) - iNrm.getZ(i) * WALL_THICK);
          }
          for (let i = 0; i < iNrm.count; i++) {
            iNrm.setX(i, -iNrm.getX(i));
            iNrm.setY(i, -iNrm.getY(i));
            iNrm.setZ(i, -iNrm.getZ(i));
          }
          const idx = innerGeo.index;
          if (idx) {
            for (let i = 0; i < idx.count; i += 3) {
              const a = idx.getX(i),
                c = idx.getX(i + 2);
              idx.setX(i, c);
              idx.setX(i + 2, a);
            }
          }
          const innerMat = new THREE.MeshStandardMaterial({
            color: 0xe0e0e0,
            side: THREE.DoubleSide,
            roughness: 0.65,
            metalness: 0.05,
          });
          this._innerMesh = new THREE.Mesh(innerGeo, innerMat);
          this._innerMesh.rotation.x = -Math.PI / 2;
          this._innerMesh.scale.setScalar(this._worldScale);
          this._innerMesh.receiveShadow = true;
          this.scene.add(this._innerMesh);

          // ── Fit and center ──
          this._mesh.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(this._mesh);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          const TARGET_SPAN = 15;
          const horizSpan = Math.max(size.x, size.z);
          if (horizSpan > 0.001) {
            const fitScale =
              (TARGET_SPAN / horizSpan) * this._worldScale;
            this._mesh.scale.setScalar(fitScale);
            this._innerMesh.scale.setScalar(fitScale);
            this._mesh.updateMatrixWorld(true);
            box.setFromObject(this._mesh);
            box.getSize(size);
            box.getCenter(center);
          }

          const GRID_Y = -1.6;
          this._mesh.position.x -= center.x;
          this._mesh.position.z -= center.z;
          this._mesh.position.y = GRID_Y - box.min.y;
          this._innerMesh.position.copy(this._mesh.position);

          const finalScale = this._mesh.scale.x;
          this._floorPolygon = rawPolygon.map((pt) => ({
            x: pt.x * finalScale - center.x,
            z: pt.z * finalScale - center.z,
          }));

          resolve(this._mesh);
        },
        undefined,
        reject
      );
    });
  }

  containsPoint(x: number, z: number): boolean {
    if (!this._floorPolygon || this._floorPolygon.length < 3) return true;
    let inside = false;
    const poly = this._floorPolygon;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x,
        zi = poly[i].z;
      const xj = poly[j].x,
        zj = poly[j].z;
      if (
        zi > z !== zj > z &&
        x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
      )
        inside = !inside;
    }
    return inside;
  }

  getBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    if (!this._floorPolygon || this._floorPolygon.length < 3) return null;
    const xs = this._floorPolygon.map((p) => p.x);
    const zs = this._floorPolygon.map((p) => p.z);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    };
  }

  private _clearMesh() {
    if (this._mesh) {
      this.scene.remove(this._mesh);
      this._mesh.geometry.dispose();
      (this._mesh.material as THREE.Material).dispose();
      this._mesh = null;
    }
    if (this._innerMesh) {
      this.scene.remove(this._innerMesh);
      this._innerMesh.geometry.dispose();
      (this._innerMesh.material as THREE.Material).dispose();
      this._innerMesh = null;
    }
  }

  dispose() {
    this._clearMesh();
    this._floorPolygon = null;
  }
}
