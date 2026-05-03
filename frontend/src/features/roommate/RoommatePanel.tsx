import { useEffect, useRef, useState } from "react";
import { useApp } from "@/shared/store/useApp";
import { socialApi, type InterestedUser } from "@/services/socialApi";
import { cohabApi, type CohabStatus } from "@/services/lifeSimApi";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users, UserCheck, UserX, Loader2, Heart,
  Play, CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import { CohabReport } from "./CohabReport";

type Phase = "select" | "running" | "report";

type PartnerCandidate = InterestedUser;

export function RoommatePanel() {
  const { selectedPinId, pins } = useApp();

  const selectedPin = pins.find((p) => p.id === selectedPinId) ?? null;

  const [phase, setPhase] = useState<Phase>("select");
  const [candidates, setCandidates] = useState<PartnerCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPartner, setSelectedPartner] = useState<PartnerCandidate | null>(null);
  const [starting, setStarting] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [simStatus, setSimStatus] = useState<CohabStatus | null>(null);
  const [personaAName, setPersonaAName] = useState("You");
  const [personaBName, setPersonaBName] = useState("Partner");

  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch interested users
  useEffect(() => {
    if (!selectedPinId) return;
    setLoading(true);
    socialApi
      .getPropertyInterested(selectedPinId)
      .then(({ interested_users }) => {
        const eligible = interested_users.filter(
          (u) => u.has_persona && !u.is_me
        ) as PartnerCandidate[];
        setCandidates(eligible);
      })
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, [selectedPinId]);

  // Cleanup poller on unmount
  useEffect(() => {
    return () => {
      if (pollerRef.current) clearInterval(pollerRef.current);
    };
  }, []);

  const handleSelectPartner = async (partner: PartnerCandidate) => {
    if (!selectedPin || starting) return;
    setSelectedPartner(partner);
    setStarting(true);

    try {
      const resp = await cohabApi.startCohab({
        lat: selectedPin.lat,
        lon: selectedPin.lng,
        property_id: selectedPin.id,
        partner_user_id: partner.id,
        num_ticks: 24,
      });

      setRunId(resp.run_id);
      setPersonaAName(resp.persona_a_name);
      setPersonaBName(resp.persona_b_name);
      setPhase("running");
      startPolling(resp.run_id);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? "Failed to start simulation";
      toast.error(msg);
    } finally {
      setStarting(false);
    }
  };

  const startPolling = (id: string) => {
    if (pollerRef.current) clearInterval(pollerRef.current);
    pollerRef.current = setInterval(async () => {
      try {
        const s = await cohabApi.getStatus(id);
        setSimStatus(s);
        if (s.status === "completed") {
          clearInterval(pollerRef.current!);
          pollerRef.current = null;
          setTimeout(() => setPhase("report"), 800);
        } else if (s.status === "failed") {
          clearInterval(pollerRef.current!);
          pollerRef.current = null;
          toast.error(s.error ?? "Simulation failed");
        }
      } catch {
        // ignore transient errors
      }
    }, 3000);
  };

  const progress = simStatus?.progress ?? 0;
  const events = simStatus?.events ?? [];
  const feedEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <OverlayPanel
      title="Roommate Compatibility"
      subtitle={
        selectedPin
          ? `Testing cohabitation at ${selectedPin.title}`
          : "Select a property first"
      }
      size="lg"
    >
      {/* ── Phase: Partner Selection ──────────────────────────────────── */}
      {phase === "select" && (
        <div className="p-6 space-y-5">
          {/* Intro */}
          <div className="bg-gradient-to-br from-[hsl(var(--holo-cyan)/0.08)] to-transparent border border-[hsl(var(--holo-cyan)/0.2)] rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-[hsl(var(--holo-cyan)/0.15)] rounded-xl">
                <Users className="h-5 w-5 text-[hsl(var(--holo-cyan))]" />
              </div>
              <h3 className="font-semibold text-white">Choose Your Roommate</h3>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">
              Select a user from the list below to simulate cohabitation in this apartment's 3D space.
              Both of you need saved personas for the simulation to work.
            </p>
          </div>

          {/* Candidates list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--holo-cyan))]" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center gap-3">
              <UserX className="h-10 w-10 text-gray-600" />
              <p className="text-gray-400 text-sm">
                No eligible users found.
              </p>
              <p className="text-gray-600 text-xs max-w-xs">
                Eligible users must have marked interest in this property and completed their persona profile.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
                {candidates.length} candidate{candidates.length > 1 ? "s" : ""} available
              </p>
              {candidates.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-4 bg-[#1e1e35] border border-gray-800 hover:border-[hsl(var(--holo-cyan)/0.4)] rounded-2xl p-4 transition-all cursor-default"
                >
                  {/* Avatar placeholder */}
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center shrink-0 text-lg font-bold text-white">
                    {c.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{c.display_name}</p>
                    <p className="text-xs text-gray-400 truncate">{c.email}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <UserCheck className="h-3 w-3 text-emerald-400" />
                      <span className="text-xs text-emerald-400">Persona ready</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="rounded-xl bg-[hsl(var(--holo-cyan)/0.15)] hover:bg-[hsl(var(--holo-cyan)/0.25)] border border-[hsl(var(--holo-cyan)/0.4)] text-[hsl(var(--holo-cyan))] text-xs px-4 gap-1.5 shrink-0"
                    onClick={() => handleSelectPartner(c)}
                    disabled={starting}
                  >
                    {starting && selectedPartner?.id === c.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    Simulate
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Phase: Simulation Running ─────────────────────────────────── */}
      {phase === "running" && (
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[hsl(var(--holo-cyan)/0.15)] rounded-xl animate-pulse">
              <Heart className="h-5 w-5 text-[hsl(var(--holo-cyan))]" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Simulating Cohabitation</h3>
              <p className="text-xs text-gray-400">
                {personaAName} × {personaBName}
              </p>
            </div>
            <Badge className="ml-auto" variant="outline">
              {progress}%
            </Badge>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(90deg, hsl(var(--holo-cyan)), #a78bfa)",
              }}
            />
          </div>

          {/* Status label */}
          <p className="text-xs text-center text-gray-500">
            {progress < 20
              ? "Assessing environment…"
              : progress < 50
              ? "Running cohabitation simulation…"
              : progress < 85
              ? "Detecting conflicts & interactions…"
              : progress < 95
              ? "Applying mediation…"
              : "Scoring compatibility…"}
          </p>

          {/* Live event feed */}
          {events.length > 0 && (
            <div className="bg-[#0d0d1a] border border-gray-800 rounded-2xl p-3 max-h-72 overflow-y-auto custom-scrollbar space-y-1.5">
              {events.slice(-40).map((ev, i) => {
                const isConflict = ev.outcome_type === "blocked";
                const isFriction = ev.outcome_type === "success_with_friction";
                return (
                  <div
                    key={i}
                    className={`text-xs px-3 py-1.5 rounded-lg border ${
                      isConflict
                        ? "bg-red-950/20 border-red-900/30 text-red-300"
                        : isFriction
                        ? "bg-amber-950/20 border-amber-900/30 text-amber-300"
                        : "bg-gray-900/40 border-gray-800 text-gray-400"
                    }`}
                  >
                    <span className="font-mono text-gray-600 mr-2">
                      {ev.time_label ?? `T${ev.tick}`}
                    </span>
                    {ev.narrative ?? ev.action ?? ev.msg ?? "…"}
                  </div>
                );
              })}
              <div ref={feedEndRef} />
            </div>
          )}

          {events.length === 0 && (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-600 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Waiting for events…
            </div>
          )}
        </div>
      )}

      {/* ── Phase: Report Trigger ─────────────────────────────────────── */}
      {phase === "report" && simStatus && (
        <>
          {/* Completion bar */}
          <div className="px-6 py-4 flex items-center gap-3 bg-emerald-950/20 border-b border-emerald-900/20">
            <CheckCircle className="h-5 w-5 text-emerald-400" />
            <p className="text-sm text-emerald-400 font-medium">Simulation complete — see your report below.</p>
          </div>

          {/* Inline report */}
          <div className="p-6">
            <CohabReport
              status={simStatus}
              onReset={() => {
                setPhase("select");
                setSimStatus(null);
                setRunId(null);
                setSelectedPartner(null);
              }}
            />
          </div>
        </>
      )}
    </OverlayPanel>
  );
}
