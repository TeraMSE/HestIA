/**
 * AnimEngine — Classifies and crossfades GLTF animations.
 * Supports action-specific categories (cook, clean, eat, shower, exercise)
 * in addition to generic idle/walk/sit/sleep/interact/emote.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const ANIM_BLACKLIST = [
  "zombie", "death", "die", "dead", "punch", "kick", "sword", "shield",
  "fighting", "hook", "overhand", "pistol", "spell", "blast", "shoot",
  "aim", "reload", "crawl", "swim", "driving", "flying",
  "tpose", "t-pose", "rest pose",
];

interface AnimCatDef {
  kw: string[];
  loop: boolean;
}

const ANIM_CATS: Record<string, AnimCatDef> = {
  walk:     { kw: ["walk loop", "walk carry", "walk formal", "jog"], loop: true },
  run:      { kw: ["run"], loop: true },
  idle:     { kw: ["idle", "listening"], loop: true },
  sit:      { kw: ["sitting", "sit"], loop: true },
  sleep:    { kw: ["sleep", "sleeping", "laying"], loop: true },
  emote:    { kw: ["dance", "bow", "victory", "greeting", "head nod", "angry", "confused", "talking", "levitat"], loop: false },
  interact: { kw: ["consume", "pickup", "push", "interact", "farm"], loop: false },
  // Action-specific categories (sourced from dedicated GLBs or Mixamo clips)
  shower:   { kw: ["shower"], loop: false },
  exercise: { kw: ["push", "push-up", "pushup", "exercise", "workout"], loop: false },
  cook:     { kw: ["cook", "stir", "chop", "kitchen"], loop: false },
  clean:    { kw: ["mop", "sweep", "clean", "wipe"], loop: false },
  eat:      { kw: ["eat", "eating", "drink"], loop: false },
};

export function filterAnimations(clips: THREE.AnimationClip[]): THREE.AnimationClip[] {
  return clips.filter((c) => {
    const n = c.name.toLowerCase();
    return !ANIM_BLACKLIST.some((b) => n.includes(b));
  });
}

/** Extra standalone GLBs that carry single animation clips. */
const EXTRA_GLBS: Array<{ url: string; category: string }> = [
  { url: "/static/glb/shower.glb",   category: "shower" },
  { url: "/static/glb/push-ups.glb", category: "exercise" },
];

export class AnimEngine {
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  cats: Record<string, THREE.AnimationClip[]>;
  actions: Record<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
  currentState: string;
  private _oneShot: boolean;
  private _oneShotFallback: string;

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = clips;
    this.cats = {};
    this.actions = {};
    this.current = null;
    this.currentState = "idle";
    this._oneShot = false;
    this._oneShotFallback = "idle";

    for (const cat of Object.keys(ANIM_CATS)) this.cats[cat] = [];
    this._classifyClips(clips);

    this.mixer.addEventListener("finished", () => {
      if (this._oneShot) {
        this._oneShot = false;
        this._enter(this._oneShotFallback);
      }
    });

    this._enter("idle");
    this.mixer.update(0.0001);

    // Async: load extra GLBs in background; no-op if files missing
    this._loadExtraClips();
  }

  private _classifyClips(clips: THREE.AnimationClip[]) {
    for (const clip of clips) {
      const n = clip.name.toLowerCase();
      for (const [cat, def] of Object.entries(ANIM_CATS)) {
        if (def.kw.some((kw) => n.includes(kw))) {
          if (!this.cats[cat].find((c) => c.name === clip.name)) {
            this.cats[cat].push(clip);
          }
          break;
        }
      }
      if (!this.actions[clip.name]) {
        this.actions[clip.name] = this.mixer.clipAction(clip);
      }
    }
  }

  private _loadExtraClips() {
    const loader = new GLTFLoader();
    for (const { url, category } of EXTRA_GLBS) {
      loader.load(
        url,
        (gltf) => {
          const clips = filterAnimations(gltf.animations || []);
          for (const clip of clips) {
            // Force into the target category by naming convention
            if (!this.cats[category]) this.cats[category] = [];
            if (!this.cats[category].find((c) => c.name === clip.name)) {
              this.cats[category].push(clip);
            }
            if (!this.actions[clip.name]) {
              this.actions[clip.name] = this.mixer.clipAction(clip);
            }
          }
        },
        undefined,
        () => { /* file not present — silent no-op */ }
      );
    }
  }

  private _pick(cat: string): THREE.AnimationClip | null {
    const c = this.cats[cat];
    return c && c.length ? c[Math.floor(Math.random() * c.length)] : null;
  }

  private _pickSub(cat: string, sub: string): THREE.AnimationClip | null {
    const c = this.cats[cat];
    if (!c || !c.length) return null;
    return c.find((cl) => cl.name.toLowerCase().includes(sub.toLowerCase())) ?? c[0];
  }

  private _crossfade(clip: THREE.AnimationClip | null, loop = true) {
    if (!clip) return;
    const act = this.actions[clip.name];
    if (!act) return;
    act.reset();
    act.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
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
      idle:     () => this._pickSub("idle", "Idle") || this._pick("idle"),
      walk:     () => this._pickSub("walk", "Walk Loop") || this._pick("walk"),
      sit:      () => this._pick("sit"),
      sleep:    () => this._pick("sleep"),
      interact: () => this._pick("interact"),
      emote:    () => this._pick("emote"),
      // Action-specific — fall back to interact if clip not loaded yet
      cook:     () => this._pick("cook")     || this._pick("interact"),
      clean:    () => this._pick("clean")    || this._pick("interact"),
      eat:      () => this._pick("eat")      || this._pick("interact"),
      shower:   () => this._pick("shower")   || this._pick("interact"),
      exercise: () => this._pick("exercise") || this._pick("interact"),
    };
    const clip = (map[state] || map.idle)();
    const isLoop = !["interact", "emote", "cook", "clean", "eat", "shower", "exercise"].includes(state);
    this._crossfade(
      clip || this._pick("idle") || (this.clips.length ? this.clips[0] : null),
      isLoop
    );
  }

  setState(s: string) {
    if (s === this.currentState && !this._oneShot) return;
    this._enter(s);
  }

  /**
   * Play a one-shot animation then return to fallback state.
   * Supports all action-specific states as one-shots.
   */
  playOneShot(state: string, fallback = "idle") {
    const oneShots = ["interact", "emote", "cook", "clean", "eat", "shower", "exercise"];
    if (!oneShots.includes(state)) {
      this._enter(fallback);
      return;
    }
    const clip = this._pick(state) ?? this._pick("interact") ?? this._pick("emote");
    if (!clip) {
      this._enter(fallback);
      return;
    }
    this._oneShotFallback = fallback;
    this._oneShot = true;
    this.currentState = state;
    this._crossfade(clip, false);
  }

  update(dt: number) {
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
