/**
 * TimeOfDayController — Controls scene lighting based on simulated hour.
 * Ported from backend/static/js/sim_agents.js
 */
import * as THREE from "three";

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export class TimeOfDayController {
  private scene: THREE.Scene;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

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
    scene.add(this.sun);

    this.hemi = new THREE.HemisphereLight(0x8899ff, 0x222233, 0.3);
    scene.add(this.hemi);
  }

  setHour(h: number) {
    const sunAngle = ((h - 6) / 12) * Math.PI;
    const sunUp = Math.sin(sunAngle);
    const sunFwd = Math.cos(sunAngle);
    const day = clamp(sunUp, 0, 1);

    this.sun.intensity = 0.15 + day * 1.2;
    this.sun.position.set(sunFwd * 15, Math.max(sunUp * 18, 1), 8);

    if (h >= 5 && h <= 7) {
      this.sun.color.setHex(0xffaa55);
      this.ambient.color.setHex(0x2a1a0a);
    } else if (h >= 17 && h <= 19) {
      this.sun.color.setHex(0xff7733);
      this.ambient.color.setHex(0x2a1a0a);
    } else if (h > 19 || h < 5) {
      this.sun.color.setHex(0x334466);
      this.ambient.color.setHex(0x060610);
    } else {
      this.sun.color.setHex(0xfff5e8);
      this.ambient.color.setHex(0x222244);
    }

    this.ambient.intensity = 0.08 + day * 0.5;
    this.hemi.intensity = 0.05 + day * 0.35;
    this.hemi.color.setHex(day > 0.3 ? 0x8899ff : 0x111122);

    const sk = new THREE.Color(
      0.024 + day * 0.02,
      0.024 + day * 0.02,
      0.06 + day * 0.04
    );
    this.scene.background = sk;
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(sk);
  }

  dispose() {
    this.scene.remove(this.ambient);
    this.scene.remove(this.sun);
    this.scene.remove(this.hemi);
    this.ambient.dispose();
    this.sun.dispose();
    this.hemi.dispose();
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
