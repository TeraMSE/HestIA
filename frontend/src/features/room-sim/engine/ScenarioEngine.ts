import { AgentManager } from "./AgentManager";
import { FurnitureManager } from "./FurnitureManager";
import type { Agent } from "./StateSystem";

export type ScenarioPhase = {
  id: string;
  title: string;
  description: string;
  durationMs: number;
  onEnter: (agents: Agent[], am: AgentManager, fm: FurnitureManager | null) => void;
  onExit?: (agents: Agent[], am: AgentManager, fm: FurnitureManager | null) => void;
};

export interface ScenarioReport {
  conflicts: string[];
  goodMoments: string[];
  houseRules: string[];
  finalScore: number;
  recommendations: string[];
}

export class ScenarioEngine {
  private am: AgentManager;
  private fm: FurnitureManager | null;
  private timer: any = null;
  
  public isRunning: boolean = false;
  public currentPhaseIndex: number = -1;
  public phases: ScenarioPhase[] = [];
  public report: ScenarioReport | null = null;
  
  // Callbacks for UI
  public onPhaseChange?: (phase: ScenarioPhase | null) => void;
  public onHouseRules?: (rules: string[] | null) => void;
  public onFinish?: (report: ScenarioReport) => void;

  constructor(am: AgentManager, fm: FurnitureManager | null) {
    this.am = am;
    this.fm = fm;
  }

  public stop() {
    this.isRunning = false;
    this.am.autoTickEnabled = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.currentPhaseIndex = -1;
    this.onPhaseChange?.(null);
  }

  public async startSingleAgentScenario(agent: Agent) {
    this.am.autoTickEnabled = false;
    this.isRunning = true;
    this.report = {
      conflicts: [],
      goodMoments: ["Enjoyed a quiet evening at home."],
      houseRules: ["Keep the space tidy."],
      finalScore: 100,
      recommendations: ["Consider adding more decorative items to boost mood."]
    };

    this.phases = [
      {
        id: "single_p1",
        title: "Relaxing at Home",
        description: "The agent is wandering around the room, getting comfortable.",
        durationMs: 5000,
        onEnter: (agents, am, fm) => {
          am.forceAction(agents[0], "wander");
          // Just force wander to center
          am.forceTarget(agents[0], 0, 0, "walking");
        }
      },
      {
        id: "single_p2",
        title: "Watching TV",
        description: "The agent decided to sit and watch some TV.",
        durationMs: 6000,
        onEnter: (agents, am, fm) => {
          const chair = fm?.findNearest(agents[0].x, agents[0].z, "chair");
          if (chair) {
            am.forceFurniture(agents[0], "chair", chair.x, chair.z);
          } else {
            am.forceFurniture(agents[0], "chair", agents[0].x + 2, agents[0].z + 2);
          }
        }
      },
      {
        id: "single_p3",
        title: "Going to Sleep",
        description: "It's late. The agent is heading to bed.",
        durationMs: 6000,
        onEnter: (agents, am, fm) => {
          const bed = fm?.findNearest(agents[0].x, agents[0].z, "bed");
          if (bed) {
            am.forceFurniture(agents[0], "bed", bed.x, bed.z);
          } else {
            am.forceFurniture(agents[0], "bed", agents[0].x - 2, agents[0].z - 2);
          }
        }
      }
    ];

    this.runNextPhase();
  }

  public async startTwoAgentScenario(a1: Agent, a2: Agent) {
    this.am.autoTickEnabled = false;
    this.isRunning = true;
    this.report = {
      conflicts: ["Late night noise disturbance (TV while sleeping)"],
      goodMoments: ["Successfully compromised and respected house rules"],
      houseRules: [
        "1. No loud activities after 10 PM.",
        "2. Respect shared spaces when someone is resting."
      ],
      finalScore: 85,
      recommendations: [
        "Consider placing the TV further from the bed.",
        "Communication is key—always ask before turning on loud devices."
      ]
    };

    this.phases = [
      {
        id: "two_p1",
        title: "Phase 1: The Conflict",
        description: "Agent 1 is trying to sleep, but Agent 2 is watching TV loudly.",
        durationMs: 8000,
        onEnter: (agents, am, fm) => {
          const bed = fm?.findNearest(agents[0].x, agents[0].z, "bed");
          if (bed) am.forceFurniture(agents[0], "bed", bed.x, bed.z);
          else am.forceFurniture(agents[0], "bed", agents[0].x - 2, agents[0].z - 2);

          const tv = fm?.findNearest(agents[1].x, agents[1].z, "tv");
          if (tv) am.forceFurniture(agents[1], "tv", tv.x, tv.z);
          else am.forceFurniture(agents[1], "tv", agents[1].x + 2, agents[1].z + 2);
        }
      },
      {
        id: "two_p2",
        title: "Phase 2: House Rules Generation",
        description: "A conflict was detected! Generating house rules to mitigate the issue...",
        durationMs: 5000,
        onEnter: (agents, am, fm) => {
          // Pause and trigger rules UI
          am.forceAction(agents[0], "idle");
          am.forceAction(agents[1], "idle");
          this.onHouseRules?.(this.report!.houseRules);
        },
        onExit: (agents, am, fm) => {
          this.onHouseRules?.(null);
        }
      },
      {
        id: "two_p3",
        title: "Phase 3: Resolution & Following Rules",
        description: "Agent 2 respects the rules and turns off the TV to do a quiet activity.",
        durationMs: 8000,
        onEnter: (agents, am, fm) => {
          // Agent 1 sleeps peacefully
          const bed = fm?.findNearest(agents[0].x, agents[0].z, "bed");
          if (bed) am.forceFurniture(agents[0], "bed", bed.x, bed.z);
          else am.forceFurniture(agents[0], "bed", agents[0].x - 2, agents[0].z - 2);

          // Agent 2 wanders away from TV quietly
          am.forceTarget(agents[1], agents[1].x + 3, agents[1].z - 1, "walking");
        }
      }
    ];

    this.runNextPhase();
  }

  private runNextPhase() {
    if (!this.isRunning) return;

    if (this.currentPhaseIndex >= 0 && this.currentPhaseIndex < this.phases.length) {
      const prev = this.phases[this.currentPhaseIndex];
      prev.onExit?.(this.am.agents, this.am, this.fm);
    }

    this.currentPhaseIndex++;

    if (this.currentPhaseIndex >= this.phases.length) {
      this.finish();
      return;
    }

    const phase = this.phases[this.currentPhaseIndex];
    this.onPhaseChange?.(phase);
    phase.onEnter(this.am.agents, this.am, this.fm);

    this.timer = setTimeout(() => {
      this.runNextPhase();
    }, phase.durationMs);
  }

  public resumeAfterRules() {
    // If we were waiting at the rules phase, just run next immediately
    if (this.timer) clearTimeout(this.timer);
    this.runNextPhase();
  }

  private finish() {
    this.isRunning = false;
    this.am.autoTickEnabled = true;
    this.onPhaseChange?.(null);
    if (this.report) {
      this.onFinish?.(this.report);
    }
  }
}
