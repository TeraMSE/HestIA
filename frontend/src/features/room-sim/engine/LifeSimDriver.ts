/**
 * LifeSimDriver.ts — Drives the 3D scene from a VisualSimulationReplay.
 *
 * Public surface:
 *   new LifeSimDriver(agentMgr, furnitureMgr, timeOfDay, replay, opts)
 *   start()     — begin playback; disables AgentManager autonomy
 *   pause() / resume()
 *   setSpeed(x) — 0.25× to 8×
 *   seek(frameIdx)
 *   dispose()
 *
 * Callbacks:
 *   onTickChange?(tick, timeLabel)
 *   onConflict?(FrameConflict)
 *   onComplete?()
 */
import type { AgentManager } from "./AgentManager";
import type { FurnitureManager } from "./FurnitureManager";
import type { TimeOfDayController } from "./TimeOfDay";
import type { Agent } from "./StateSystem";
import type {
  VisualSimulationReplay,
  FrameAgentState,
  FrameConflict,
  FrameEvent,
  SimulationFrame,
  ApartmentLayout,
} from "../../../services/socialSimApi";
import { getActionMapping } from "./ActionMap";

const TICK_DURATION_MS = 3000;

export interface LifeSimDriverOptions {
  /** Display label for Agent A (logged-in user's full name). */
  userALabel?: string;
  /** Display label for Agent B (friend or interested user's display name). */
  userBLabel?: string;
  /** Number of users interested in the current property (for badge). */
  interestedCount?: number;
}

export class LifeSimDriver {
  private agentMgr: AgentManager;
  private furnitureMgr: FurnitureManager | null;
  private timeOfDay: TimeOfDayController;
  private replay: VisualSimulationReplay;
  private layout: ApartmentLayout;
  private opts: LifeSimDriverOptions;

  private _playing = false;
  private _speed = 1.0;
  private _currentFrame = 0;
  private _lastFrameAt = 0;
  private _rafId: number | null = null;

  // persona_id → Agent mapping (populated by _bindAgents)
  private _agentMap: Map<string, Agent> = new Map();
  // Track previous target_room per agent for proximity detection
  private _prevRoom: Map<string, string | null> = new Map();
  private _sharedRoomFrames: Map<string, number> = new Map();

  // Callbacks
  onTickChange?: (tick: number, timeLabel: string) => void;
  onConflict?: (conflict: FrameConflict) => void;
  onComplete?: () => void;

  constructor(
    agentMgr: AgentManager,
    furnitureMgr: FurnitureManager | null,
    timeOfDay: TimeOfDayController,
    replay: VisualSimulationReplay,
    opts: LifeSimDriverOptions = {}
  ) {
    this.agentMgr = agentMgr;
    this.furnitureMgr = furnitureMgr;
    this.timeOfDay = timeOfDay;
    this.replay = replay;
    this.layout = replay.apartment;
    this.opts = opts;
  }

  /**
   * Bind 3D agents to personas. Agent A gets userALabel; Agent B gets userBLabel.
   */
  private _bindAgents() {
    this._agentMap.clear();
    for (let i = 0; i < this.replay.personas.length; i++) {
      const persona = this.replay.personas[i];
      const agent = this.agentMgr.agents[i];
      if (!agent || !persona) continue;

      this._agentMap.set(persona.subject_id, agent);

      // Determine display name: real user label (A/B) > persona name
      const gender = agent.gender === "female" ? "♀" : "♂";
      let displayName: string;
      if (i === 0 && this.opts.userALabel) {
        displayName = this.opts.userALabel;
      } else if (i === 1 && this.opts.userBLabel) {
        displayName = this.opts.userBLabel;
      } else {
        displayName = persona.name;
      }
      agent.label = `${gender} ${displayName}`;

      // Optional badge: "X interested"
      if (this.opts.interestedCount && this.opts.interestedCount > 0) {
        agent.interestBadge = `${this.opts.interestedCount} interested`;
      }
    }
  }

  start() {
    this._bindAgents();
    this.agentMgr.setAutonomyEnabled(false);
    this._playing = true;
    this._lastFrameAt = performance.now();
    this._loop();
  }

  pause() {
    this._playing = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  resume() {
    if (this._playing) return;
    this._playing = true;
    this._lastFrameAt = performance.now();
    this._loop();
  }

  setSpeed(x: number) {
    this._speed = Math.max(0.25, Math.min(8, x));
  }

  seek(frameIdx: number) {
    const total = this.replay.frames.length;
    this._currentFrame = Math.max(0, Math.min(total - 1, frameIdx));
    this._applyFrame(this.replay.frames[this._currentFrame]);
  }

  dispose() {
    this.pause();
    for (const agent of this.agentMgr.agents) {
      agent.lsActionId = undefined;
      agent.poseOffset = undefined;
      agent.sharedRoomPartner = null;
      agent.interestBadge = undefined;
    }
    this.agentMgr.setAutonomyEnabled(true);
  }

  get currentFrameIndex() { return this._currentFrame; }
  get totalFrames() { return this.replay.frames.length; }
  get isPlaying() { return this._playing; }

  // ── Private ───────────────────────────────────────────────────────────────

  private _loop() {
    if (!this._playing) return;
    this._rafId = requestAnimationFrame(() => {
      const now = performance.now();
      const elapsed = now - this._lastFrameAt;
      const tickDuration = TICK_DURATION_MS / this._speed;

      if (elapsed >= tickDuration) {
        this._lastFrameAt = now;
        const frame = this.replay.frames[this._currentFrame];
        if (frame) this._applyFrame(frame);
        this._currentFrame++;
        if (this._currentFrame >= this.replay.frames.length) {
          this._playing = false;
          this.onComplete?.();
          return;
        }
      }
      this._loop();
    });
  }

  private _applyFrame(frame: SimulationFrame) {
    const hour = (6 + frame.tick) % 24;
    this.timeOfDay.setHour(hour);
    this.onTickChange?.(frame.tick, frame.time_label);

    // Apply agent states
    for (const agentState of frame.agents) {
      const agent = this._agentMap.get(agentState.persona_id);
      if (!agent) continue;
      this._applyAgentState(agent, agentState);
    }

    // Detect shared room → proximity nudge
    this._detectSharedRoom(frame.agents);

    // Handle events (conflict flash, positive interaction)
    if (frame.events?.length) {
      this._applyEvents(frame.events);
    }

    // Fire conflict callback for UI panel
    if (frame.conflict) {
      this.onConflict?.(frame.conflict);
    }
  }

  private _applyAgentState(agent: Agent, state: FrameAgentState) {
    const mapping = getActionMapping(state.action_id);
    const worldPos = this._gridToWorld(state.x, state.y);

    if (mapping.isLeaving) {
      const doorPos = this._getDoorPosition();
      agent.targetX = doorPos.x;
      agent.targetZ = doorPos.z;
      agent.outsideRoom = true;
      setTimeout(() => {
        if (agent.group) agent.group.visible = false;
      }, 2500);
    } else {
      if (agent.outsideRoom) {
        agent.outsideRoom = false;
        if (agent.group) {
          agent.group.visible = true;
          agent.group.position.x = worldPos.x;
          agent.group.position.z = worldPos.z;
          agent.x = worldPos.x;
          agent.z = worldPos.z;
        }
      }

      const target = mapping.furnitureTarget && this.furnitureMgr
        ? this.furnitureMgr.findNearest(agent.x, agent.z, mapping.furnitureTarget as any)
        : null;

      if (target) {
        agent.targetX = target.x + (Math.random() - 0.5) * 0.2;
        agent.targetZ = target.z + (Math.random() - 0.5) * 0.2;
        agent.furnitureTarget = { type: mapping.furnitureTarget as any, x: target.x, z: target.z };
      } else {
        agent.targetX = worldPos.x;
        agent.targetZ = worldPos.z;
      }
    }

    agent.isSleeping = mapping.isSleeping ?? false;
    agent.isSitting = mapping.isSitting ?? false;
    agent.currentAction = state.action_label;
    agent.lsActionId = state.action_id;

    if (mapping.isSleeping && mapping.furnitureTarget === "bed") {
      const bed = this.furnitureMgr?.findNearest(agent.x, agent.z, "bed");
      agent.poseOffset = { dy: 0.45, yaw: bed ? Math.atan2(bed.x - agent.x, bed.z - agent.z) : 0 };
    } else if (mapping.isSitting) {
      agent.poseOffset = { dy: 0, yaw: agent.poseOffset?.yaw ?? agent._rotY };
    } else {
      agent.poseOffset = undefined;
    }

    agent.currentEmoji = state.action_emoji;
    agent.speechBubble = state.speech_bubble ?? undefined;
    agent.narration = state.narration ?? undefined;
    agent.lsMood = state.mood;

    this._updateLabel(agent, state);
  }

  private _detectSharedRoom(agents: FrameAgentState[]) {
    if (agents.length < 2) return;
    const [a, b] = agents;
    const agA = this._agentMap.get(a.persona_id);
    const agB = this._agentMap.get(b.persona_id);
    if (!agA || !agB) return;

    const key = `${a.persona_id}-${b.persona_id}`;
    if (a.room && b.room && a.room === b.room && !a.outside_room && !b.outside_room) {
      const count = (this._sharedRoomFrames.get(key) ?? 0) + 1;
      this._sharedRoomFrames.set(key, count);
      if (count >= 2) {
        agA.sharedRoomPartner = agB;
        agB.sharedRoomPartner = agA;
      }
    } else {
      this._sharedRoomFrames.set(key, 0);
      agA.sharedRoomPartner = null;
      agB.sharedRoomPartner = null;
    }
  }

  private _applyEvents(events: FrameEvent[]) {
    for (const event of events) {
      const ids = event.agents_involved ?? [];
      if (event.type === "conflict" && ids.length >= 2) {
        const agA = this._agentMap.get(ids[0]);
        const agB = this._agentMap.get(ids[1]);
        if (agA) {
          agA.animEngine?.playOneShot("emote", "idle");
          if (agA.labelEl) {
            agA.labelEl.dataset.flash = "conflict";
            setTimeout(() => { if (agA.labelEl) agA.labelEl.dataset.flash = ""; }, 3000);
          }
        }
        if (agB) {
          agB.animEngine?.playOneShot("emote", "idle");
          if (agB.labelEl) {
            agB.labelEl.dataset.flash = "conflict";
            setTimeout(() => { if (agB.labelEl) agB.labelEl.dataset.flash = ""; }, 3000);
          }
        }
      } else if (event.type === "positive_interaction" && ids.length >= 1) {
        const agA = this._agentMap.get(ids[0]);
        if (agA) {
          agA.animEngine?.playOneShot("emote", "idle");
          if (agA.labelEl) {
            agA.labelEl.dataset.flash = "positive";
            setTimeout(() => { if (agA.labelEl) agA.labelEl.dataset.flash = ""; }, 2000);
          }
        }
      }
    }
  }

  private _updateLabel(agent: Agent, state: FrameAgentState) {
    if (!agent.labelEl) return;
    const bubble = state.speech_bubble
      ? `<span class="rsim-bubble">${state.speech_bubble}</span>`
      : "";
    const badge = agent.interestBadge
      ? `<span class="rsim-badge">${agent.interestBadge}</span>`
      : "";
    agent.labelEl.innerHTML =
      `${agent.label}${badge}<span class="rsim-mood">${state.mood_emoji}</span>` +
      `<span class="rsim-act">${state.action_emoji} ${state.action_label}</span>` +
      bubble;
  }

  private _gridToWorld(gx: number, gy: number): { x: number; z: number } {
    const bounds = this.agentMgr.roomEnv.getBounds();
    if (!bounds) {
      return { x: (gx / this.layout.width - 0.5) * 6, z: (gy / this.layout.height - 0.5) * 6 };
    }
    return {
      x: bounds.minX + (gx / this.layout.width) * (bounds.maxX - bounds.minX),
      z: bounds.minZ + (gy / this.layout.height) * (bounds.maxZ - bounds.minZ),
    };
  }

  private _getDoorPosition(): { x: number; z: number } {
    const bounds = this.agentMgr.roomEnv.getBounds();
    if (!bounds) return { x: 0, z: 5 };
    return { x: (bounds.minX + bounds.maxX) / 2, z: bounds.maxZ + 0.5 };
  }
}
