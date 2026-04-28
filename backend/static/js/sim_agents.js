// sim_agents.js — Realistic Agent System for HestIA 3D Room Simulator
// Ported from engine3d.html AnimationIntelligence + SceneManager3D
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// ── CONSTANTS ───────────────────────────────────────────────────────
const AGENT_COLORS = [0xe94560,0x2ecc71,0x3498db,0xf1c40f,0x9b59b6,0xe67e22,0x1abc9c,0xe74c3c];
const MOVE_SPEED   = 2.5;
const WANDER_INT   = [3000, 6000];
const TARGET_H     = 1.7;          // desired agent height in scene units
const FLOOR_Y      = -1.6;
const clamp  = (v,lo,hi) => Math.max(lo, Math.min(hi, v));
const randR  = (lo,hi) => lo + Math.random() * (hi - lo);
const hex    = c => '#' + c.toString(16).padStart(6,'0');

// Animations to filter out before classification
const ANIM_BLACKLIST = [
  'zombie','death','die','dead','punch','kick','sword','shield','fighting',
  'hook','overhand','pistol','spell','blast','shoot','aim','reload',
  'crawl','swim','driving','levitate','flying','tpose','t-pose','rest pose',
];

// ── ANIMATION INTELLIGENCE ──────────────────────────────────────────
const ANIM_CATS = {
  walk:  { kw: ['walk loop','walk carry','walk formal','jog'], loop: true },
  run:   { kw: ['run'], loop: true },
  idle:  { kw: ['idle','listening'], loop: true },
  sit:   { kw: ['sitting','sit'], loop: true },
  sleep: { kw: ['sleep','sleeping'], loop: true },
  emote: { kw: ['dance','bow','victory','greeting','head nod','angry','confused'], loop: false },
  interact: { kw: ['consume','pickup','push','interact','farm'], loop: false },
};

class AnimEngine {
  constructor(model, clips) {
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = clips;
    this.cats = {};
    this.actions = {};
    this.current = null;
    this.currentState = 'idle';
    this._oneShot = false;
    // Classify
    for (const cat of Object.keys(ANIM_CATS)) this.cats[cat] = [];
    for (const clip of clips) {
      const n = clip.name.toLowerCase();
      let matched = false;
      for (const [cat, def] of Object.entries(ANIM_CATS)) {
        if (def.kw.some(kw => n.includes(kw))) {
          this.cats[cat].push(clip); matched = true; break;
        }
      }
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this._enter('idle');
    this.mixer.update(0.0001);
  }

  _pick(cat) {
    const c = this.cats[cat];
    return c && c.length ? c[Math.floor(Math.random()*c.length)] : null;
  }
  _pickSub(cat, sub) {
    const c = this.cats[cat];
    if (!c || !c.length) return null;
    const m = c.find(cl => cl.name.toLowerCase().includes(sub.toLowerCase()));
    return m || c[0];
  }

  _crossfade(clip, loop = true) {
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

  _enter(state) {
    if (this._oneShot) return;
    this.currentState = state;
    const map = {
      idle: () => this._pickSub('idle', 'Idle') || this._pick('idle'),
      walk: () => this._pickSub('walk', 'Walk Loop') || this._pick('walk'),
      sit:  () => this._pick('sit'),
      sleep:() => this._pick('sleep'),
    };
    const clip = (map[state] || map.idle)();
    // Fallback to any idle
    this._crossfade(clip || this._pick('idle') || (this.clips.length ? this.clips[0] : null), true);
  }

  setState(s) {
    if (s === this.currentState && !this._oneShot) return;
    this._enter(s);
  }
  update(dt) { this.mixer.update(dt); }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot()); }
}

// ── PERSONALITY & STATE ─────────────────────────────────────────────
class Personality {
  constructor() {
    this.socialness = 20 + Math.random()*60|0;
    this.laziness   = 10 + Math.random()*60|0;
    this.curiosity  = 20 + Math.random()*60|0;
  }
}
class StateSystem {
  constructor() {
    this.energy=randR(60,90); this.hunger=randR(10,40);
    this.hygiene=randR(60,90); this.comfort=randR(50,80);
    this.boredom=randR(10,40); this.mood=80;
  }
  tick(dt) {
    this.energy-=0.4*dt; this.hunger+=0.35*dt;
    this.hygiene-=0.2*dt; this.boredom+=0.5*dt;
    this._cl(); this._dm();
  }
  modify(c) { for(const[k,v] of Object.entries(c)) if(k in this) this[k]+=v; this._cl(); this._dm(); }
  _cl() { for(const k of ['energy','hunger','hygiene','comfort','boredom','mood']) this[k]=clamp(this[k],0,100); }
  _dm() { this.mood=clamp(0.25*this.energy+0.25*(100-this.hunger)+0.1*this.hygiene+0.15*this.comfort+0.25*(100-this.boredom),0,100); }
  get moodEmoji() { return this.mood>75?'😊':this.mood>50?'😐':this.mood>30?'😟':'😫'; }
  get moodLabel() { return this.mood>75?'happy':this.mood>50?'fine':this.mood>30?'sad':'miserable'; }
}

// ── AGENT ───────────────────────────────────────────────────────────
let _n = 0;
class Agent {
  constructor(x, z, gender) {
    _n++;
    this.id = _n;
    this.label = `${gender==='female'?'♀':'♂'} Agent ${_n}`;
    this.gender = gender;
    this.colorHex = AGENT_COLORS[(_n-1) % AGENT_COLORS.length];
    this.color = hex(this.colorHex);
    this.x = x; this.z = z;
    this.targetX = x; this.targetZ = z;
    this.facing = 0;
    this.state = new StateSystem();
    this.personality = new Personality();
    this.busy = false;
    this.currentAction = null;
    this._lastAct = performance.now();
    this._nextIn = randR(...WANDER_INT);
    this._speed = 0;
    // 3D
    this.group = null;
    this.animEngine = null;
    this.labelEl = null;
    this._rotY = 0;
  }
  get isMoving() { return Math.hypot(this.targetX-this.x, this.targetZ-this.z) > 0.08; }
}

// ── AGENT MANAGER ───────────────────────────────────────────────────
export class AgentManager {
  constructor(scene, camera, renderer, roomEnv) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.roomEnv = roomEnv;
    this.agents = [];
    this.selected = null;
    this._labelsRoot = document.getElementById('labels');
    this._listEl = document.getElementById('agent-list');
    this._stateEl = document.getElementById('agent-state');
    this._clock = new THREE.Clock();
    // Model templates
    this._templates = { male: null, female: null };
    this._anims     = { male: null, female: null };
    this._scales    = { male: 1, female: 1 };
    this._loading   = false;
    this._loaded    = false;
  }

  // ── LOAD GLB MODELS ─────────────────────────────────────────────
  async loadModels(statusCb) {
    if (this._loaded || this._loading) return;
    this._loading = true;
    const loader = new GLTFLoader();
    const load = async (key, path, label) => {
      if (statusCb) statusCb(`Loading ${label}…`);
      try {
        const gltf = await loader.loadAsync(path);
        this._templates[key] = gltf.scene;
        // Filter animations
        const filtered = (gltf.animations || []).filter(c => {
          const n = c.name.toLowerCase();
          return !ANIM_BLACKLIST.some(b => n.includes(b));
        });
        this._anims[key] = filtered;
        // Enable shadows
        gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        // Compute scale
        this._scales[key] = this._computeScale(gltf.scene);
        if (statusCb) statusCb(`${label}: ${filtered.length} animations`);
      } catch (e) {
        console.warn(`${label} model failed:`, e);
        if (statusCb) statusCb(`${label} failed — using fallback`);
      }
    };
    await load('male',   '/static/glb/male model.glb',   'Male');
    await load('female', '/static/glb/female model.glb', 'Female');
    this._loaded = true;
    this._loading = false;
    if (statusCb) statusCb('Models ready!');
  }

  _computeScale(scene) {
    let h = 0;
    const tmp = new THREE.Box3(), acc = new THREE.Box3();
    let any = false;
    scene.traverse(o => {
      if (o.isSkinnedMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        if (o.geometry.boundingBox) {
          tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
          if (any) acc.union(tmp); else { acc.copy(tmp); any = true; }
        }
      }
    });
    if (any) h = acc.getSize(new THREE.Vector3()).y;
    if (!h) h = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()).y;
    return TARGET_H / Math.max(h, 0.001);
  }

  // ── SPAWN ───────────────────────────────────────────────────────
  async spawnAgent(gender = 'male') {
    // Block spawn if no room is loaded
    if (!this.roomEnv._mesh) {
      console.warn('[AgentMgr] Cannot spawn — no room loaded');
      return null;
    }

    // Ensure models are loaded
    if (!this._loaded) {
      const st = document.getElementById('pano-status');
      await this.loadModels(msg => { if (st) st.textContent = msg; });
    }

    // Use rejection sampling to guarantee spawn inside the floor polygon
    const spawn = this._pickWander({ x: 0, z: 0 });
    let sx = spawn.x, sz = spawn.z;

    const agent = new Agent(sx, sz, gender);
    const grp = new THREE.Group();

    const template = this._templates[gender];
    const anims = this._anims[gender];
    const scale = this._scales[gender];

    if (template) {
      // Clone the rigged model with independent skeleton
      const model = skeletonClone(template);
      model.scale.setScalar(scale);
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      grp.add(model);

      // Animation engine
      if (anims && anims.length) {
        agent.animEngine = new AnimEngine(model, anims);
      }

      // Position feet on ground
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      if (isFinite(box.min.y)) model.position.y -= box.min.y;
    } else {
      // Fallback capsule
      const fb = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.18, 1.0, 4, 8),
        new THREE.MeshStandardMaterial({ color: agent.colorHex, roughness: 0.5, metalness: 0.15 })
      );
      fb.position.y = 0.68;
      fb.castShadow = true;
      grp.add(fb);
    }

    // Color ring under feet
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.38, 24),
      new THREE.MeshBasicMaterial({ color: agent.colorHex, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI/2;
    ring.position.y = 0.01;
    grp.add(ring);

    // Gender ring (blue=male, pink=female)
    const gc = gender === 'female' ? 0xff69b4 : 0x4488ff;
    const gRing = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.27, 24),
      new THREE.MeshBasicMaterial({ color: gc, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    gRing.rotation.x = -Math.PI/2;
    gRing.position.y = 0.011;
    grp.add(gRing);

    // Selection ring (hidden by default)
    const selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: 0xe94560, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    selRing.rotation.x = -Math.PI/2;
    selRing.position.y = 0.012;
    selRing.visible = false;
    grp.add(selRing);
    agent._selRing = selRing;

    grp.position.set(sx, FLOOR_Y, sz);
    // Lift to ground: the group sits at FLOOR_Y, children start from y=0
    grp.position.y = 0;
    this.scene.add(grp);
    agent.group = grp;

    // Floating label
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.style.borderColor = agent.color;
    lbl.innerHTML = `${agent.label}<span class="mood">${agent.state.moodEmoji}</span><span class="act">idle</span>`;
    this._labelsRoot.appendChild(lbl);
    agent.labelEl = lbl;

    this.agents.push(agent);
    this._rebuildChips();
    if (!this.selected) this.selectAgent(agent);

    console.log(`🧠 ${agent.label} spawned with ${anims ? anims.length : 0} animations`);
    return agent;
  }

  selectAgent(agent) {
    this.selected = agent;
    for (const a of this.agents) {
      if (a._selRing) a._selRing.visible = (a === agent);
    }
    document.querySelectorAll('.agent-chip').forEach(c =>
      c.classList.toggle('sel', c.dataset.aid == agent.id));
  }

  _rebuildChips() {
    this._listEl.innerHTML = '';
    for (const a of this.agents) {
      const chip = document.createElement('span');
      chip.className = 'agent-chip' + (this.selected === a ? ' sel' : '');
      chip.dataset.aid = a.id;
      chip.innerHTML = `<span class="agent-dot" style="background:${a.color}"></span>${a.label}`;
      chip.onclick = () => this.selectAgent(a);
      this._listEl.appendChild(chip);
    }
  }

  // ── WALL COLLISION ──────────────────────────────────────────────
  _inside(x, z) { return this.roomEnv.containsPoint(x, z); }
  _clampToFloor(fx, fz, tx, tz) {
    if (this._inside(tx, tz)) return { x: tx, z: tz };
    let lo = 0, hi = 1;
    for (let i = 0; i < 8; i++) {
      const m = (lo+hi)/2;
      if (this._inside(fx+(tx-fx)*m, fz+(tz-fz)*m)) lo = m; else hi = m;
    }
    return { x: fx+(tx-fx)*lo, z: fz+(tz-fz)*lo };
  }

  _pickWander(agent) {
    const fp = this.roomEnv._floorPolygon;
    if (!fp || fp.length < 3)
      return { x: agent.x + (Math.random()-0.5)*3, z: agent.z + (Math.random()-0.5)*3 };
    const xs = fp.map(p=>p.x), zs = fp.map(p=>p.z);
    const mnX = Math.min(...xs), mxX = Math.max(...xs);
    const mnZ = Math.min(...zs), mxZ = Math.max(...zs);
    for (let i = 0; i < 30; i++) {
      const rx = randR(mnX+0.3, mxX-0.3), rz = randR(mnZ+0.3, mxZ-0.3);
      if (this._inside(rx, rz)) return { x: rx, z: rz };
    }
    return { x: agent.x, z: agent.z };
  }

  // ── AUTONOMY ────────────────────────────────────────────────────
  _autoTick(agent, now) {
    if (agent.busy || agent.isMoving) return;
    if (now - agent._lastAct < agent._nextIn) return;
    agent._nextIn = randR(...WANDER_INT);
    agent._lastAct = now;
    const s = agent.state, p = agent.personality;
    let act = 'wander';
    if (s.energy < 25) act = 'rest';
    else if (s.boredom > 65 || (p.curiosity > 50 && Math.random() < 0.4)) act = 'wander';
    else if (Math.random() < 0.3) act = 'idle';

    if (act === 'wander') {
      const t = this._pickWander(agent);
      agent.targetX = t.x; agent.targetZ = t.z;
      agent.currentAction = 'walking';
      agent.state.modify({ boredom: -5 });
    } else if (act === 'rest') {
      agent.currentAction = 'resting';
      agent.state.modify({ energy: 15, boredom: 5 });
    } else {
      agent.currentAction = 'idle';
    }
  }

  // ── UPDATE ──────────────────────────────────────────────────────
  update() {
    const dt = this._clock.getDelta();
    const now = performance.now();
    const vpRect = this.renderer.domElement.getBoundingClientRect();
    const tmpV = new THREE.Vector3();

    for (const agent of this.agents) {
      agent.state.tick(dt);

      // Movement
      const dx = agent.targetX - agent.x;
      const dz = agent.targetZ - agent.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const step = Math.min(MOVE_SPEED * dt, d);
        const nx = agent.x + (dx/d)*step;
        const nz = agent.z + (dz/d)*step;
        const c = this._clampToFloor(agent.x, agent.z, nx, nz);
        agent.x = c.x; agent.z = c.z;
        agent.facing = Math.atan2(dx, dz);
        agent._speed = MOVE_SPEED;
        if (Math.hypot(c.x-nx, c.z-nz) > 0.01) {
          agent.targetX = agent.x; agent.targetZ = agent.z;
        }
      } else {
        agent._speed = 0;
        if (agent.currentAction === 'walking') agent.currentAction = 'idle';
      }

      // 3D position
      if (agent.group) {
        agent.group.position.x = agent.x;
        agent.group.position.z = agent.z;

        // Smooth rotation
        if (agent._speed > 0) {
          let diff = agent.facing - agent._rotY;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          agent._rotY += diff * Math.min(1, dt * 10);
        }
        agent.group.rotation.y = agent._rotY;
      }

      // Animation state
      if (agent.animEngine) {
        if (agent.isMoving) {
          agent.animEngine.setState('walk');
        } else if (agent.currentAction === 'resting') {
          agent.animEngine.setState('sleep');
        } else {
          agent.animEngine.setState('idle');
        }
        agent.animEngine.update(dt);
      }

      // Floating label
      if (agent.labelEl && agent.group) {
        tmpV.set(agent.x, TARGET_H + 0.25, agent.z);
        tmpV.project(this.camera);
        if (tmpV.z < 1) {
          const px = (tmpV.x * 0.5 + 0.5) * vpRect.width;
          const py = (-tmpV.y * 0.5 + 0.5) * vpRect.height;
          agent.labelEl.style.left = px + 'px';
          agent.labelEl.style.top = py + 'px';
          agent.labelEl.style.display = '';
          const act = agent.isMoving ? 'walking' : (agent.currentAction || 'idle');
          agent.labelEl.innerHTML =
            `${agent.label}<span class="mood">${agent.state.moodEmoji}</span>` +
            `<span class="act">${act}</span>`;
        } else {
          agent.labelEl.style.display = 'none';
        }
      }

      this._autoTick(agent, now);
    }

    // State panel
    if (this.selected) {
      const s = this.selected.state;
      this._stateEl.innerHTML =
        `<b>${this.selected.label}</b> ${s.moodEmoji} ${s.moodLabel}<br>` +
        `⚡ ${s.energy|0}  🍔 ${s.hunger|0}  🛁 ${s.hygiene|0}  😴 ${s.boredom|0}`;
      this._stateEl.style.color = '#aaa';
    }
  }
}

// ── TIME-OF-DAY CONTROLLER ──────────────────────────────────────────
export class TimeOfDayController {
  constructor(scene) {
    this.scene = scene;
    this.ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.position.set(10, 15, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.far = 50;
    this.sun.shadow.camera.left = -20; this.sun.shadow.camera.right = 20;
    this.sun.shadow.camera.top = 20; this.sun.shadow.camera.bottom = -20;
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0x8899ff, 0x222233, 0.3);
    scene.add(this.hemi);
  }
  setHour(h) {
    const sunAngle = ((h - 6) / 12) * Math.PI;
    const sunUp = Math.sin(sunAngle);
    const sunFwd = Math.cos(sunAngle);
    const day = clamp(sunUp, 0, 1);
    this.sun.intensity = 0.15 + day * 1.2;
    this.sun.position.set(sunFwd * 15, Math.max(sunUp * 18, 1), 8);
    if (h >= 5 && h <= 7)        { this.sun.color.setHex(0xffaa55); this.ambient.color.setHex(0x2a1a0a); }
    else if (h >= 17 && h <= 19) { this.sun.color.setHex(0xff7733); this.ambient.color.setHex(0x2a1a0a); }
    else if (h > 19 || h < 5)    { this.sun.color.setHex(0x334466); this.ambient.color.setHex(0x060610); }
    else                         { this.sun.color.setHex(0xfff5e8); this.ambient.color.setHex(0x222244); }
    this.ambient.intensity = 0.08 + day * 0.5;
    this.hemi.intensity = 0.05 + day * 0.35;
    this.hemi.color.setHex(day > 0.3 ? 0x8899ff : 0x111122);
    const sk = new THREE.Color(0.024 + day*0.02, 0.024 + day*0.02, 0.06 + day*0.04);
    this.scene.background = sk;
    if (this.scene.fog) this.scene.fog.color.copy(sk);
  }
}

export function formatTimeLabel(h) {
  const hh = Math.floor(h), mm = Math.round((h-hh)*60);
  const t = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  let p;
  if (h<5) p='Night 🌙'; else if (h<7) p='Dawn 🌅'; else if (h<11) p='Morning ☀️';
  else if (h<13) p='Noon ☀️'; else if (h<17) p='Afternoon 🌤'; else if (h<19) p='Dusk 🌅';
  else p='Night 🌙';
  return `${t} — ${p}`;
}
