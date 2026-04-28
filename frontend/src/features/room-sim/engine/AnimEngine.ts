/**
 * AnimEngine — Classifies and crossfades GLTF animations.
 * Ported from backend/static/js/sim_agents.js
 */
import * as THREE from "three";

// Animations to ignore
const ANIM_BLACKLIST = [
  "zombie", "death", "die", "dead", "punch", "kick", "sword", "shield",
  "fighting", "hook", "overhand", "pistol", "spell", "blast", "shoot",
  "aim", "reload", "crawl", "swim", "driving", "levitate", "flying",
  "tpose", "t-pose", "rest pose",
];

interface AnimCatDef {
  kw: string[];
  loop: boolean;
}

const ANIM_CATS: Record<string, AnimCatDef> = {
  walk: { kw: ["walk loop", "walk carry", "walk formal", "jog"], loop: true },
  run: { kw: ["run"], loop: true },
  idle: { kw: ["idle", "listening"], loop: true },
  sit: { kw: ["sitting", "sit"], loop: true },
  sleep: { kw: ["sleep", "sleeping", "laying"], loop: true },
  emote: {
    kw: ["dance", "bow", "victory", "greeting", "head nod", "angry", "confused"],
    loop: false,
  },
  interact: {
    kw: ["consume", "pickup", "push", "interact", "farm"],
    loop: false,
  },
};

export function filterAnimations(
  clips: THREE.AnimationClip[]
): THREE.AnimationClip[] {
  return clips.filter((c) => {
    const n = c.name.toLowerCase();
    return !ANIM_BLACKLIST.some((b) => n.includes(b));
  });
}

export class AnimEngine {
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  cats: Record<string, THREE.AnimationClip[]>;
  actions: Record<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
  currentState: string;
  private _oneShot: boolean;

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = clips;
    this.cats = {};
    this.actions = {};
    this.current = null;
    this.currentState = "idle";
    this._oneShot = false;

    // Classify
    for (const cat of Object.keys(ANIM_CATS)) this.cats[cat] = [];
    for (const clip of clips) {
      const n = clip.name.toLowerCase();
      for (const [cat, def] of Object.entries(ANIM_CATS)) {
        if (def.kw.some((kw) => n.includes(kw))) {
          this.cats[cat].push(clip);
          break;
        }
      }
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }

    this._enter("idle");
    this.mixer.update(0.0001);
  }

  private _pick(cat: string): THREE.AnimationClip | null {
    const c = this.cats[cat];
    return c && c.length ? c[Math.floor(Math.random() * c.length)] : null;
  }

  private _pickSub(cat: string, sub: string): THREE.AnimationClip | null {
    const c = this.cats[cat];
    if (!c || !c.length) return null;
    const m = c.find((cl) => cl.name.toLowerCase().includes(sub.toLowerCase()));
    return m || c[0];
  }

  private _crossfade(clip: THREE.AnimationClip | null, loop = true) {
    if (!clip) return;
    const act = this.actions[clip.name];
    if (!act) return;
    act.reset();
    act.setLoop(
      loop ? THREE.LoopRepeat : THREE.LoopOnce,
      loop ? Infinity : 1
    );
    act.clampWhenFinished = !loop;
    if (this.current && this.current !== act) {
      this.current.fadeOut(0.3);
      act.fadeIn(0.3);
    }
    act.play();
    this.current = act;
  }

  private _enter(state: string) {
    if (this._oneShot) return;
    this.currentState = state;
    const map: Record<string, () => THREE.AnimationClip | null> = {
      idle: () => this._pickSub("idle", "Idle") || this._pick("idle"),
      walk: () => this._pickSub("walk", "Walk Loop") || this._pick("walk"),
      sit: () => this._pick("sit"),
      sleep: () => this._pick("sleep"),
    };
    const clip = (map[state] || map.idle)();
    this._crossfade(
      clip ||
        this._pick("idle") ||
        (this.clips.length ? this.clips[0] : null),
      true
    );
  }

  setState(s: string) {
    if (s === this.currentState && !this._oneShot) return;
    this._enter(s);
  }

  update(dt: number) {
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
