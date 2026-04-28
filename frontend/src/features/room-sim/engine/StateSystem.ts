/**
 * Agent personality, needs, and state system.
 * Ported from backend/static/js/sim_agents.js
 */

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const randR = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export const AGENT_COLORS = [
  0xe94560, 0x2ecc71, 0x3498db, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c,
  0xe74c3c,
];
export const MOVE_SPEED = 2.5;
export const WANDER_INT: [number, number] = [3000, 6000];
export const TARGET_H = 1.7;
export const FLOOR_Y = -1.6;
export const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

export class Personality {
  socialness: number;
  laziness: number;
  curiosity: number;

  constructor() {
    this.socialness = (20 + Math.random() * 60) | 0;
    this.laziness = (10 + Math.random() * 60) | 0;
    this.curiosity = (20 + Math.random() * 60) | 0;
  }
}

export class StateSystem {
  energy: number;
  hunger: number;
  hygiene: number;
  comfort: number;
  boredom: number;
  mood: number;

  constructor() {
    this.energy = randR(60, 90);
    this.hunger = randR(10, 40);
    this.hygiene = randR(60, 90);
    this.comfort = randR(50, 80);
    this.boredom = randR(10, 40);
    this.mood = 80;
  }

  tick(dt: number) {
    this.energy -= 0.4 * dt;
    this.hunger += 0.35 * dt;
    this.hygiene -= 0.2 * dt;
    this.boredom += 0.5 * dt;
    this._cl();
    this._dm();
  }

  modify(changes: Partial<Record<string, number>>) {
    for (const [k, v] of Object.entries(changes)) {
      if (k in this && typeof v === "number") {
        (this as any)[k] += v;
      }
    }
    this._cl();
    this._dm();
  }

  private _cl() {
    for (const k of [
      "energy",
      "hunger",
      "hygiene",
      "comfort",
      "boredom",
      "mood",
    ] as const) {
      (this as any)[k] = clamp((this as any)[k], 0, 100);
    }
  }

  private _dm() {
    this.mood = clamp(
      0.25 * this.energy +
        0.25 * (100 - this.hunger) +
        0.1 * this.hygiene +
        0.15 * this.comfort +
        0.25 * (100 - this.boredom),
      0,
      100
    );
  }

  get moodEmoji(): string {
    return this.mood > 75
      ? "😊"
      : this.mood > 50
        ? "😐"
        : this.mood > 30
          ? "😟"
          : "😫";
  }

  get moodLabel(): string {
    return this.mood > 75
      ? "happy"
      : this.mood > 50
        ? "fine"
        : this.mood > 30
          ? "sad"
          : "miserable";
  }
}

let _n = 0;

export type AgentGender = "male" | "female";

export interface FurnitureTarget {
  type: "bed" | "chair" | "table" | "tv";
  x: number;
  z: number;
}

export class Agent {
  id: number;
  label: string;
  gender: AgentGender;
  colorHex: number;
  color: string;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  facing: number;
  state: StateSystem;
  personality: Personality;
  busy: boolean;
  currentAction: string | null;
  _lastAct: number;
  _nextIn: number;
  _speed: number;
  _rotY: number;

  // 3D references
  group: THREE.Group | null = null;
  animEngine: any | null = null;
  labelEl: HTMLDivElement | null = null;
  _selRing: THREE.Mesh | null = null;

  // Furniture interaction
  furnitureTarget: FurnitureTarget | null = null;
  isSleeping: boolean = false;
  isSitting: boolean = false;

  constructor(x: number, z: number, gender: AgentGender) {
    _n++;
    this.id = _n;
    this.label = `${gender === "female" ? "♀" : "♂"} Agent ${_n}`;
    this.gender = gender;
    this.colorHex = AGENT_COLORS[(_n - 1) % AGENT_COLORS.length];
    this.color = hex(this.colorHex);
    this.x = x;
    this.z = z;
    this.targetX = x;
    this.targetZ = z;
    this.facing = 0;
    this.state = new StateSystem();
    this.personality = new Personality();
    this.busy = false;
    this.currentAction = null;
    this._lastAct = performance.now();
    this._nextIn = randR(...WANDER_INT);
    this._speed = 0;
    this._rotY = 0;
  }

  get isMoving(): boolean {
    return (
      Math.hypot(this.targetX - this.x, this.targetZ - this.z) > 0.08
    );
  }
}

import * as THREE from "three";
