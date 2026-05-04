import { useEffect, useRef, useState } from "react";
import {
  Bot, Users, Play, Loader2, ChevronDown, ChevronUp,
  CheckCircle2, MapPin, FileText, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { socialApi } from "@/services/socialApi";
import { cohabApi } from "@/services/lifeSimApi";
import type { InterestedUser } from "@/services/socialApi";
import type { CohabStatus } from "@/services/lifeSimApi";
import type { Agent } from "../room-sim/engine/StateSystem";
import type { AgentManager } from "../room-sim/engine/AgentManager";
import type { ScenarioEngine } from "../room-sim/engine/ScenarioEngine";
import type { PropertyPin } from "@/contracts/types";
import { useSimStore } from "@/shared/store/useSimStore";
import type { SimEvent } from "@/services/lifeSimApi";

interface Props {
  agentMgrRef: React.RefObject<AgentManager | null>;
  engineRef: React.RefObject<ScenarioEngine | null>;
  agents: Agent[];
  selectedAgent: Agent | null;
  onSelectAgent: (a: Agent) => void;
  selectedPin: PropertyPin | null;
  lifeSimStarting: boolean;
  lifeSimActive: boolean;
  onStartLifeSim: () => void;
  onShowLifeSimReport: () => void;
  roomReady: boolean;
  isActive: boolean;
  feedEndRef: React.RefObject<HTMLDivElement | null>;
}

type CardId = "life" | "roommate" | "cohab" | "solo";

export function SimulationLayerPanel({
  agentMgrRef, engineRef, agents, selectedAgent, onSelectAgent,
  selectedPin, lifeSimStarting, lifeSimActive, onStartLifeSim,
  onShowLifeSimReport, roomReady, isActive, feedEndRef,
}: Props) {
  const simStore = useSimStore();
  const [expanded, setExpanded] = useState<CardId | null>("life");

  // Roommate compatibility state
  const [candidates, setCandidates] = useState<InterestedUser[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [cohabRunId, setCohabRunId] = useState<string | null>(null);
  const [cohabStatus, setCohabStatus] = useState<CohabStatus | null>(null);
  const [cohabPolling, setCohabPolling] = useState(false);
  const [showCohabReport, setShowCohabReport] = useState(false);
  const cohabPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Solo scenario state
  const [soloRunning, setSoloRunning] = useState(false);

  useEffect(() => () => {
    if (cohabPollerRef.current) clearInterval(cohabPollerRef.current);
  }, []);

  function toggle(id: CardId) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  async function fetchCandidates() {
    if (!selectedPin?.id || isNaN(Number(selectedPin.id))) return;
    setLoadingCandidates(true);
    try {
      const res = await socialApi.getPropertyInterested(selectedPin.id);
      setCandidates(res.interested_users.filter((u) => !u.is_me && u.has_persona));
    } catch {
      toast.error("Could not load candidates.");
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function startCohab(partnerId: number) {
    if (!selectedPin) return;
    try {
      const res = await cohabApi.startCohab({
        lat: selectedPin.lat,
        lon: selectedPin.lng,
        property_id: selectedPin.id,
        partner_user_id: partnerId,
        num_ticks: 24,
      });
      setCohabRunId(res.run_id);
      setCohabPolling(true);
      toast.success(`Cohabitation simulation started with ${res.persona_b_name}`);

      cohabPollerRef.current = setInterval(async () => {
        try {
          const st = await cohabApi.getStatus(res.run_id);
          setCohabStatus(st);
          if (st.status === "completed" || st.status === "failed") {
            clearInterval(cohabPollerRef.current!);
            setCohabPolling(false);
            if (st.status === "completed") toast.success("Compatibility simulation done!");
            else toast.error("Simulation failed.");
          }
        } catch { /* ignore */ }
      }, 3000);
    } catch (e: any) {
      toast.error("Failed to start cohab: " + (e?.response?.data?.detail || e.message));
    }
  }

  function startSoloScenario() {
    if (!engineRef.current || agents.length === 0) {
      toast.error("Need at least 1 agent.");
      return;
    }
    setSoloRunning(true);
    if (agents.length === 1) {
      engineRef.current.startSingleAgentScenario(agents[0]);
    } else {
      engineRef.current.startTwoAgentScenario(agents[0], agents[1]);
    }
    setTimeout(() => setSoloRunning(false), 2000);
  }

  return (
    <div
      className={`absolute right-16 top-1/2 -translate-y-1/2 z-[1010] w-[320px] max-h-[82vh] transition-all duration-300 ease-out ${
        isActive ? "translate-x-0 opacity-100 pointer-events-auto" : "translate-x-[110%] opacity-0 pointer-events-none"
      }`}
    >
      <div className="holo-surface rounded-3xl flex flex-col overflow-hidden max-h-[82vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[hsl(var(--holo-cyan)/0.2)] shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-[hsl(var(--holo-cyan)/0.1)] border border-[hsl(var(--holo-cyan)/0.2)] flex items-center justify-center">
            <Bot className="h-5 w-5 text-[hsl(var(--holo-cyan))]" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-white leading-tight">Simulation Layer</h3>
            <p className="text-xs text-white/55">All agent simulations</p>
          </div>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">

          {/* ── Life Simulation ── */}
          <SimCard
            id="life"
            expanded={expanded}
            onToggle={toggle}
            icon={<Bot className="h-4 w-4" />}
            title="Life Simulation"
            subtitle="Your 24-hour daily routine"
            accentColor="hsl(var(--holo-cyan))"
          >
            <p className="text-xs text-white/55 mb-3">
              Simulate a full day in this apartment — commute, indoor activities, and neighbourhood exploration.
            </p>

            {simStore.simStatus === "completed" ? (
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs flex-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Completed
                </div>
                <Button size="sm" onClick={onShowLifeSimReport} className="rounded-xl text-xs px-3 bg-[hsl(var(--holo-cyan))] text-black hover:bg-[hsl(var(--holo-cyan)/0.8)] font-semibold">
                  <FileText className="h-3 w-3 mr-1" /> Report
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={onStartLifeSim}
                disabled={!roomReady || agents.length === 0 || lifeSimStarting || lifeSimActive}
                className="w-full rounded-xl text-xs font-semibold"
                style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(185 95% 55%))", boxShadow: "0 0 16px hsl(var(--primary)/0.3)" }}
              >
                {lifeSimStarting ? (
                  <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Starting…</>
                ) : lifeSimActive ? (
                  <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Simulating… {simStore.simProgress}%</>
                ) : (
                  <><Bot className="h-3 w-3 mr-1.5" /> Start Life Simulation</>
                )}
              </Button>
            )}

            {/* Live event feed */}
            {lifeSimActive && simStore.simEvents.length > 0 && (
              <div className="mt-3 max-h-36 overflow-y-auto space-y-1.5 rounded-xl bg-black/30 p-2">
                <p className="text-xs font-medium text-[hsl(var(--holo-cyan))] uppercase tracking-wider mb-1.5">Live Feed</p>
                {simStore.simEvents.slice(-8).map((ev: SimEvent, i: number) => (
                  <div key={i} className={`text-xs px-2 py-1.5 rounded-lg border ${
                    ev.outcome_type === "success" ? "border-emerald-700/40 bg-emerald-950/20" :
                    ev.outcome_type === "blocked" ? "border-red-700/40 bg-red-950/20" : "border-white/10 bg-white/5"
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-white/40 text-[10px]">{ev.time_label || `T${ev.tick}`}</span>
                      {ev.location_type === "outdoor" && <MapPin className="h-2.5 w-2.5 text-blue-400" />}
                      <span className="font-medium truncate">{ev.action || ev.action_name || "—"}</span>
                    </div>
                    {ev.narrative && <p className="text-white/55 mt-0.5 italic text-[10px] truncate">{ev.narrative}</p>}
                  </div>
                ))}
                <div ref={feedEndRef} />
              </div>
            )}
          </SimCard>

          {/* ── Roommate Compatibility ── */}
          <SimCard
            id="roommate"
            expanded={expanded}
            onToggle={(id) => {
              toggle(id);
              if (expanded !== "roommate") fetchCandidates();
            }}
            icon={<Users className="h-4 w-4" />}
            title="Roommate Compatibility"
            subtitle="Find compatible flatmates"
            accentColor="hsl(320 90% 75%)"
          >
            {cohabStatus?.status === "completed" ? (
              <div className="space-y-3">
                <div className="bg-black/40 rounded-xl p-3 flex items-center justify-between">
                  <span className="text-sm text-white/55">Compatibility</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-2xl font-bold ${(cohabStatus.compatibility_score ?? 0) >= 0.7 ? "text-green-400" : "text-red-400"}`}>
                      {Math.round((cohabStatus.compatibility_score ?? 0) * 100)}%
                    </span>
                    <span className="text-sm font-semibold text-white/55">{cohabStatus.grade}</span>
                  </div>
                </div>
                {cohabStatus.mediation_summary && (
                  <p className="text-xs text-white/55 italic">{cohabStatus.mediation_summary}</p>
                )}
                <Button size="sm" onClick={() => setShowCohabReport(true)} variant="outline" className="w-full rounded-xl text-xs border-white/20 hover:bg-white/10">
                  View Full Report
                </Button>
              </div>
            ) : cohabPolling ? (
              <div className="flex items-center gap-3 py-3 text-white/55 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--holo-cyan))]" />
                Simulating cohabitation… {cohabStatus?.progress ?? 0}%
              </div>
            ) : (
              <>
                <p className="text-xs text-white/55 mb-3">
                  Users who favorited this property and have a persona profile.
                </p>
                {loadingCandidates ? (
                  <div className="flex items-center gap-2 text-xs text-white/55 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading candidates…
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="text-xs text-white/55 text-center py-3">
                    No compatible candidates yet. Others need to favorite this property and set up a persona.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {candidates.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => startCohab(c.id)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs bg-black/30 border border-white/10 hover:border-[hsl(var(--holo-cyan)/0.4)] hover:bg-[hsl(var(--holo-cyan)/0.05)] transition-all"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[hsl(var(--holo-pink)/0.2)] border border-[hsl(var(--holo-pink)/0.3)] flex items-center justify-center text-[10px] font-bold text-[hsl(var(--holo-pink))]">
                            {c.display_name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-white">{c.display_name}</span>
                        </div>
                        <span className="text-[hsl(var(--holo-cyan))] text-[10px]">Simulate →</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </SimCard>

          {/* ── Solo / Duo Scenario ── */}
          <SimCard
            id="solo"
            expanded={expanded}
            onToggle={toggle}
            icon={<Play className="h-4 w-4" />}
            title="Live Scenario"
            subtitle="Scripted scene in the 3D world"
            accentColor="hsl(50 100% 60%)"
          >
            <p className="text-xs text-white/55 mb-3">
              {agents.length >= 2
                ? "Run a 2-agent cohabitation conflict scene with house rules and final report."
                : "Run a single-agent daily routine scenario."}
            </p>
            <Button
              size="sm"
              onClick={startSoloScenario}
              disabled={agents.length === 0 || soloRunning}
              className="w-full rounded-xl text-xs font-semibold"
              style={{ background: "linear-gradient(135deg, hsl(50 100% 45%), hsl(35 100% 55%))", color: "#000" }}
            >
              {soloRunning ? (
                <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Starting…</>
              ) : (
                <><Play className="h-3 w-3 mr-1.5" /> {agents.length >= 2 ? "Run Cohabitation Scene" : "Run Solo Scenario"}</>
              )}
            </Button>
          </SimCard>

          {/* ── Active Personas (always visible) ── */}
          {agents.length > 0 && (
            <div className="mt-2 rounded-2xl bg-black/20 border border-white/10 px-3 py-3 space-y-2">
              <p className="text-xs font-medium text-white/55 uppercase tracking-wider flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Active Personas
              </p>
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onSelectAgent(a)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs border transition-all ${
                    selectedAgent?.id === a.id
                      ? "bg-[hsl(var(--holo-cyan)/0.15)] border-[hsl(var(--holo-cyan))]"
                      : "bg-black/20 border-transparent hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: a.color }} />
                    <span className="font-medium text-white">{a.label}</span>
                  </div>
                  <span className="text-white/55 text-[10px] uppercase">
                    {a.isSleeping ? "💤 sleeping" : a.isSitting ? "🪑 sitting" : a.currentAction || "idle"}
                  </span>
                </button>
              ))}

              {/* Selected agent stats */}
              {selectedAgent?.state && (
                <div className="grid grid-cols-2 gap-1.5 pt-1 text-[10px]">
                  {[
                    ["⚡ Energy", selectedAgent.state.energy],
                    ["🍔 Hunger", selectedAgent.state.hunger],
                    ["🛁 Hygiene", selectedAgent.state.hygiene],
                    ["😴 Boredom", selectedAgent.state.boredom],
                  ].map(([label, val]) => (
                    <div key={String(label)} className="flex justify-between bg-black/30 rounded-lg px-2 py-1">
                      <span className="text-white/55">{label}</span>
                      <span className="font-mono text-[hsl(var(--holo-cyan))]">{Math.round(Number(val) || 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Cohab Report Dialog */}
      <Dialog open={showCohabReport} onOpenChange={setShowCohabReport}>
        <DialogContent className="sm:max-w-md border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" /> Cohabitation Report
            </DialogTitle>
          </DialogHeader>
          {cohabStatus && (
            <div className="space-y-4 py-4">
              <div className="bg-[#1e1e35] p-4 rounded-2xl flex items-center justify-between">
                <span className="text-gray-300">Compatibility Score</span>
                <div className="flex items-center gap-2">
                  <span className={`text-3xl font-bold ${(cohabStatus.compatibility_score ?? 0) >= 0.7 ? "text-green-400" : "text-red-400"}`}>
                    {Math.round((cohabStatus.compatibility_score ?? 0) * 100)}%
                  </span>
                  <span className="text-lg font-semibold text-white/55">{cohabStatus.grade}</span>
                </div>
              </div>
              {cohabStatus.compatibility_label && (
                <p className="text-sm text-center text-[hsl(var(--holo-cyan))] font-medium">{cohabStatus.compatibility_label}</p>
              )}
              {cohabStatus.mediation_summary && (
                <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-medium mb-2 text-sm">Mediation Summary</h4>
                  <p className="text-gray-300 text-sm">{cohabStatus.mediation_summary}</p>
                </div>
              )}
              {cohabStatus.mediation_rules && cohabStatus.mediation_rules.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-300">House Rules</h4>
                  {cohabStatus.mediation_rules.map((r, i) => (
                    <div key={i} className="text-sm bg-[#1e1e35] p-3 rounded-xl border border-gray-700">{r}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Reusable collapsible card ── */
function SimCard({
  id, expanded, onToggle, icon, title, subtitle, accentColor, children,
}: {
  id: CardId;
  expanded: CardId | null;
  onToggle: (id: CardId) => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accentColor: string;
  children: React.ReactNode;
}) {
  const isOpen = expanded === id;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}30`, color: accentColor }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white leading-tight">{title}</p>
          <p className="text-xs text-white/55 truncate">{subtitle}</p>
        </div>
        <div className="text-white/55 shrink-0">
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}
