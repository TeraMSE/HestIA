/**
 * TimeOfDayController — Controls scene lighting based on simulated hour.
 * Uses Three.js Sky shader, ACES tonemapping, and a Kelvin-based sun curve.
 */
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Convert colour temperature (Kelvin) to linear RGB via a piecewise approximation. */
function kelvinToRGB(K: number): THREE.Color {
  const t = clamp(K, 1000, 40000) / 100;
  let r: number, g: number, b: number;

  // Red
  r = t <= 66 ? 255 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592), 0, 255);

  // Green
  if (t <= 66) {
    g = clamp(99.4708025861 * Math.log(t) - 161.1195681661, 0, 255);
  } else {
    g = clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492), 0, 255);
  }

  // Blue
  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307, 0, 255);
  }

  return new THREE.Color(r / 255, g / 255, b / 255);
}

/** Map hour → approximate sun colour temperature in Kelvin. */
function hourToKelvin(h: number): number {
  const pts: [number, number][] = [
    [0, 1800], [5, 2200], [7, 4500], [12, 6500],
    [17, 4500], [19, 2200], [24, 1800],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const [h0, k0] = pts[i];
    const [h1, k1] = pts[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0);
      return k0 + (k1 - k0) * t;
    }
  }
  return 1800;
}

export class TimeOfDayController {
  private scene: THREE.Scene;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  windowSpot: THREE.SpotLight;
  private sky: Sky;
  private _currentHour = 12;

  /** Exposed so FurnitureManager can query it for lamp switching */
  get isDark(): boolean {
    return this._currentHour < 6 || this._currentHour > 19;
  }
  get currentHour(): number { return this._currentHour; }

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Sky shader dome
    this.sky = new Sky();
    this.sky.scale.setScalar(450);
    scene.add(this.sky);
    const skyUni = this.sky.material.uniforms;
    skyUni["turbidity"].value = 4;
    skyUni["rayleigh"].value = 2;
    skyUni["mieCoefficient"].value = 0.005;
    skyUni["mieDirectionalG"].value = 0.7;

    this.ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.position.set(10, 15, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.far = 50;
    this.sun.shadow.camera.left = -20;
    this.sun.shadow.camera.right = 20;
    this.sun.shadow.camera.top = 20;
    this.sun.shadow.camera.bottom = -20;
    this.sun.shadow.bias = -0.0005;
    scene.add(this.sun);

    this.hemi = new THREE.HemisphereLight(0x8899ff, 0x222233, 0.3);
    scene.add(this.hemi);

    // Window light spill — aimed inward from the room's long edge
    this.windowSpot = new THREE.SpotLight(0xffa060, 0, 20, Math.PI / 5, 0.4);
    this.windowSpot.position.set(-8, 3, 0);
    this.windowSpot.target.position.set(0, 0, 0);
    this.windowSpot.castShadow = false;
    scene.add(this.windowSpot);
    scene.add(this.windowSpot.target);
  }

  setHour(h: number) {
    this._currentHour = h;

    const sunAngle = ((h - 6) / 12) * Math.PI;
    const sunUp = Math.sin(sunAngle);
    const sunFwd = Math.cos(sunAngle);
    const day = clamp(sunUp, 0, 1);

    // Sun position
    const sunX = sunFwd * 15;
    const sunY = Math.max(sunUp * 18, 0.5);
    const sunZ = 8;
    this.sun.position.set(sunX, sunY, sunZ);

    // Colour temperature
    const K = hourToKelvin(h);
    const sunColor = kelvinToRGB(K);
    this.sun.color.copy(sunColor);
    this.sun.intensity = 0.1 + day * 1.3;

    // Ambient — warm tint at dawn/dusk, dark at night
    this.ambient.intensity = 0.05 + day * 0.55;
    if (day < 0.05) {
      this.ambient.color.setHex(0x060610);
    } else if (h >= 5 && h <= 7) {
      this.ambient.color.setHex(0x2a1a0a);
    } else if (h >= 17 && h <= 19) {
      this.ambient.color.setHex(0x1a100a);
    } else {
      this.ambient.color.setHex(0x223344);
    }

    // Hemisphere
    this.hemi.intensity = 0.04 + day * 0.35;
    this.hemi.color.setHex(day > 0.3 ? 0x8899ff : 0x111122);
    this.hemi.groundColor.setHex(day > 0.3 ? 0x222244 : 0x050508);

    // Sky shader sun position
    const phi = THREE.MathUtils.degToRad(90 - Math.max(sunUp * 90, -10));
    const theta = THREE.MathUtils.degToRad(180);
    const sunDir = new THREE.Vector3();
    sunDir.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms["sunPosition"].value.copy(sunDir);

    // Turbidity/rayleigh vary with time for atmosphere
    const dusk = 1 - Math.abs(h - 18) / 4;
    const dawn = 1 - Math.abs(h - 6) / 3;
    const hazeFactor = clamp(Math.max(dusk, dawn), 0, 1);
    this.sky.material.uniforms["turbidity"].value = 2 + 8 * hazeFactor;
    this.sky.material.uniforms["rayleigh"].value = 1 + 1.5 * (1 - day);

    // Window spill: peaks at dawn and dusk
    const spillFactor = clamp(Math.max(dawn, dusk) * day, 0, 1);
    this.windowSpot.intensity = spillFactor * 1.8;
    this.windowSpot.color.copy(sunColor);

    // Fog
    if (this.scene.fog) {
      const fogColor = new THREE.Color(
        0.015 + day * 0.02,
        0.015 + day * 0.02,
        0.04 + day * 0.04
      );
      (this.scene.fog as THREE.Fog).color.copy(fogColor);
    }
  }

  dispose() {
    this.scene.remove(this.ambient);
    this.scene.remove(this.sun);
    this.scene.remove(this.hemi);
    this.scene.remove(this.windowSpot);
    this.scene.remove(this.sky);
    this.ambient.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.windowSpot.dispose();
  }
}

export function formatTimeLabel(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const t = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  let p: string;
  if (h < 5) p = "Night 🌙";
  else if (h < 7) p = "Dawn 🌅";
  else if (h < 11) p = "Morning ☀️";
  else if (h < 13) p = "Noon ☀️";
  else if (h < 17) p = "Afternoon 🌤";
  else if (h < 19) p = "Dusk 🌅";
  else p = "Night 🌙";
  return `${t} — ${p}`;
}
