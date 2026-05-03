import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip as RechartsTooltip,
} from "recharts";
import {
  Bot, CheckCircle, Users,
  TrendingUp, TrendingDown, Shield, Heart, Star,
  ClipboardList, ChevronDown, ChevronRight,
} from "lucide-react";
import { useState } from "react";
import type { CohabStatus } from "@/services/lifeSimApi";

interface CohabReportProps {
  status: CohabStatus;
  onReset: () => void;
}

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-green-400",
  C: "text-amber-400",
  D: "text-orange-400",
  F: "text-red-400",
};

const COMPAT_COLOR = (score: number) => {
  if (score >= 0.75) return "text-emerald-400";
  if (score >= 0.60) return "text-green-400";
  if (score >= 0.45) return "text-amber-400";
  return "text-red-400";
};

const CONFLICT_ICON: Record<string, string> = {
  noise: "🔊",
  cleanliness: "🧹",
  smoking: "🚬",
  thermal: "🌡️",
  schedule: "⏰",
  space: "🏠",
  other: "⚡",
};

export function CohabReport({ status, onReset }: CohabReportProps) {
  const [showRejected, setShowRejected] = useState(false);

  if (!status.result) return null;

  const compat      = (status.result.roommate_compatibility ?? {}) as Record<string, any>;
  const medData     = (status.result.mediation ?? {}) as Record<string, any>;
  const scoreData   = (status.result.score ?? {}) as Record<string, any>;
  const soloA       = (status.result.persona_a_solo ?? {}) as Record<string, any>;
  const soloB       = (status.result.persona_b_solo ?? {}) as Record<string, any>;

  const compatScore     = status.compatibility_score ?? 0;
  const compatLabel     = status.compatibility_label ?? "—";
  const grade           = status.grade ?? "—";
  const gradeKey        = grade.charAt(0);
  const conflicts       = (compat.conflicts ?? []) as any[];
  const conflictSummary = (compat.conflict_summary ?? {}) as Record<string, number>;
  const leaseChecklist  = (status.mediation_rules ?? []) as string[];
  const mediations      = (medData.mediations ?? []) as any[];
  const llmEval         = String(scoreData.llm_evaluation ?? "");
  const overallScore    = typeof scoreData.overall_score === "number" ? scoreData.overall_score : null;

  const personaAName = (status.persona_a as any)?.name ?? "You";
  const personaBName = (status.persona_b as any)?.name ?? "Partner";

  const satisfA = typeof compat.persona_a_satisfaction === "number"
    ? Math.round(compat.persona_a_satisfaction * 100) : null;
  const satisfB = typeof compat.persona_b_satisfaction === "number"
    ? Math.round(compat.persona_b_satisfaction * 100) : null;

  const soloASatisf = typeof soloA.satisfaction_summary?.final_score === "number"
    ? Math.round(soloA.satisfaction_summary.final_score * 100) : null;
  const soloBSatisf = typeof soloB.satisfaction_summary?.final_score === "number"
    ? Math.round(soloB.satisfaction_summary.final_score * 100) : null;

  const radarData = [
    { subject: "Comfort",    A: scoreData.comfort_achievement   ?? 5, fullMark: 10 },
    { subject: "Social",     A: scoreData.social_compatibility  ?? 5, fullMark: 10 },
    { subject: "Conflict",   A: scoreData.conflict_intensity    ?? 5, fullMark: 10 },
    { subject: "Mediation",  A: scoreData.mediation_effectiveness ?? 5, fullMark: 10 },
    { subject: "Lifestyle",  A: scoreData.lifestyle_alignment   ?? 5, fullMark: 10 },
    { subject: "Acceptance", A: scoreData.resolution_acceptance ?? 5, fullMark: 10 },
  ];

  return (
    <div className="space-y-6">

      {/* ── Title ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-[hsl(var(--holo-cyan))] font-semibold">
        <Users className="h-5 w-5" />
        <span>Roommate Compatibility Report</span>
      </div>

      {/* ── Hero: Score + Grade ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#1e1e35] p-5 rounded-2xl border border-gray-800 flex flex-col justify-center relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Heart className="w-16 h-16" /></div>
          <span className="font-medium text-gray-400 text-xs mb-1 uppercase tracking-wider">Compatibility</span>
          <span className={`text-4xl font-bold ${COMPAT_COLOR(compatScore)}`}>
            {Math.round(compatScore * 100)}%
          </span>
          <span className="text-sm text-gray-400 mt-1">{compatLabel}</span>
        </div>

        <div className="bg-[#1e1e35] p-5 rounded-2xl border border-[hsl(var(--holo-cyan)/0.3)] flex flex-col justify-center">
          <span className="font-medium text-[hsl(var(--holo-cyan))] text-xs mb-1 uppercase tracking-wider">SOTOPIA Grade</span>
          <span className={`text-4xl font-bold ${GRADE_COLOR[gradeKey] ?? "text-gray-300"}`}>{gradeKey}</span>
          {overallScore !== null && (
            <span className="text-sm text-gray-400 mt-1">{overallScore.toFixed(1)} / 10</span>
          )}
          <span className="text-xs text-gray-500 mt-1">{grade.replace(/^[A-F] — /, "")}</span>
        </div>
      </div>

      {/* ── SOTOPIA Radar ─────────────────────────────────────────────── */}
      <div className="bg-[#151522] p-4 rounded-2xl border border-gray-800">
        <h4 className="text-gray-300 font-semibold mb-2 text-sm uppercase tracking-wider flex items-center gap-2">
          <Star className="h-4 w-4" /> Compatibility Dimensions
        </h4>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius={80}>
              <PolarGrid stroke="#2a2a3e" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <RechartsTooltip
                contentStyle={{ backgroundColor: "#1e1e35", borderColor: "#374151", borderRadius: "10px", fontSize: "12px" }}
                formatter={(v: number) => [`${v.toFixed(1)} / 10`, "Score"]}
              />
              <Radar name="Score" dataKey="A" stroke="hsl(var(--holo-cyan))" fill="hsl(var(--holo-cyan))" fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Individual Satisfaction ───────────────────────────────────── */}
      <div>
        <h4 className="text-gray-300 font-semibold mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Individual Satisfaction
        </h4>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: personaAName, cohabSatisf: satisfA, soloSatisf: soloASatisf, color: "hsl(var(--holo-cyan))" },
            { name: personaBName, cohabSatisf: satisfB, soloSatisf: soloBSatisf, color: "#a78bfa" },
          ].map(({ name, cohabSatisf, soloSatisf, color }) => (
            <div key={name} className="bg-[#1e1e35] p-4 rounded-2xl border border-gray-800">
              <p className="font-semibold text-sm mb-2" style={{ color }}>{name}</p>
              {cohabSatisf !== null && (
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Co-living</span>
                    <span className="font-mono" style={{ color }}>{cohabSatisf}%</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${cohabSatisf}%`, background: color }} />
                  </div>
                </div>
              )}
              {soloSatisf !== null && (
                <div>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Solo baseline</span>
                    <span className="font-mono text-gray-400">{soloSatisf}%</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gray-600" style={{ width: `${soloSatisf}%` }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Conflict Breakdown ────────────────────────────────────────── */}
      {Object.keys(conflictSummary).length > 0 && (
        <div>
          <h4 className="text-red-400 font-semibold mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
            <TrendingDown className="h-4 w-4" /> Conflict Breakdown
          </h4>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {Object.entries(conflictSummary).map(([type, count]) => (
              <div key={type} className="bg-red-950/20 border border-red-900/30 p-3 rounded-xl text-center">
                <div className="text-xl mb-1">{CONFLICT_ICON[type] ?? "⚡"}</div>
                <div className="text-lg font-bold text-red-400">{count}</div>
                <div className="text-xs text-gray-400 capitalize">{type}</div>
              </div>
            ))}
          </div>
          {conflicts.length > 0 && (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
              {conflicts.slice(0, 6).map((c: any, i: number) => (
                <div key={i} className="bg-red-950/10 border border-red-900/20 p-3 rounded-xl flex items-start gap-2">
                  <span className="text-base mt-0.5">{CONFLICT_ICON[c.conflict_type] ?? "⚡"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-red-300 capitalize">{c.conflict_type}</span>
                      <span className="text-xs text-gray-500">{c.room || "Shared space"}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto border-red-900/50 text-red-400">
                        {Math.round((c.severity ?? 0) * 100)}% severity
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-300 leading-snug truncate">{c.description}</p>
                    {c.resolved && c.resolution && (
                      <p className="text-xs text-emerald-400 mt-0.5">✓ {c.resolution}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Mediation Results ─────────────────────────────────────────── */}
      {mediations.length > 0 && (
        <div>
          <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
            <Shield className="h-4 w-4" /> Mediation Results
          </h4>
          {mediations.map((med: any, i: number) => {
            const proposed = med.proposed_rule;
            const rejected = med.rejected_rules ?? [];
            return (
              <div key={i} className="bg-[#1e1e35] border border-[hsl(var(--holo-cyan)/0.2)] p-4 rounded-2xl mb-3">
                {med.mediation_summary && (
                  <p className="text-xs text-gray-400 italic mb-3 border-l-4 border-[hsl(var(--holo-cyan)/0.4)] pl-3">
                    {med.mediation_summary}
                  </p>
                )}
                {proposed && (
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                      <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Accepted Rule</span>
                      <span className="ml-auto text-xs text-gray-400">
                        {Math.round((proposed.acceptance_likelihood ?? 0) * 100)}% acceptance
                      </span>
                    </div>
                    <p className="text-sm text-white">{proposed.description}</p>
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>+{Math.round((proposed.estimated_satisfaction_delta_a ?? 0) * 100)}% for {personaAName}</span>
                      <span>+{Math.round((proposed.estimated_satisfaction_delta_b ?? 0) * 100)}% for {personaBName}</span>
                    </div>
                  </div>
                )}
                {rejected.length > 0 && (
                  <button
                    onClick={() => setShowRejected((s) => !s)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showRejected ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {rejected.length} alternative rule{rejected.length > 1 ? "s" : ""} considered
                  </button>
                )}
                {showRejected && rejected.map((r: any, ri: number) => (
                  <div key={ri} className="mt-2 pl-4 border-l border-gray-700">
                    <p className="text-xs text-gray-500">{r.description}</p>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── AI Counselor Evaluation ───────────────────────────────────── */}
      {llmEval && (
        <div className="bg-gradient-to-br from-[#1e1e35] to-[#151525] p-5 rounded-2xl border border-[hsl(var(--holo-cyan)/0.3)]">
          <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-3 flex items-center gap-2">
            <Bot className="h-5 w-5" /> AI Counselor Evaluation
          </h4>
          <p className="text-gray-300 text-sm leading-relaxed italic border-l-4 border-[hsl(var(--holo-cyan)/0.5)] pl-4">
            "{llmEval}"
          </p>
        </div>
      )}

      {/* ── Lease Checklist ───────────────────────────────────────────── */}
      {leaseChecklist.length > 0 && (
        <div>
          <h4 className="text-gray-300 font-semibold mb-3 text-sm uppercase tracking-wider flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Lease Checklist
          </h4>
          <div className="space-y-2">
            {leaseChecklist.map((rule, i) => (
              <div key={i} className="flex items-start gap-2 bg-[#1e1e35] px-4 py-3 rounded-xl border border-gray-800">
                <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <p className="text-sm text-gray-200">{rule}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Overall Recommendation ────────────────────────────────────── */}
      {status.result.overall_recommendation && (
        <div className={`p-4 rounded-2xl border text-center font-semibold ${
          String(status.result.overall_recommendation).includes("Strongly Recommended")
            ? "bg-emerald-950/20 border-emerald-900/30 text-emerald-400"
            : String(status.result.overall_recommendation).includes("Recommended")
            ? "bg-green-950/20 border-green-900/30 text-green-400"
            : String(status.result.overall_recommendation).includes("Acceptable")
            ? "bg-amber-950/20 border-amber-900/30 text-amber-400"
            : "bg-red-950/20 border-red-900/30 text-red-400"
        }`}>
          {String(status.result.overall_recommendation)}
        </div>
      )}

      {/* ── Reset Button ──────────────────────────────────────────────── */}
      <div className="pt-2">
        <Button
          onClick={onReset}
          variant="outline"
          className="w-full rounded-2xl border-gray-700 hover:bg-gray-800 text-white"
        >
          ← Choose Another Roommate
        </Button>
      </div>

    </div>
  );
}
