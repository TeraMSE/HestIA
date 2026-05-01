/**
 * SimulationRunner.tsx — Roommate compatibility simulation overlay.
 *
 * Uses the real HestIA-LS backend (LLM-driven) via assessmentApi.compatibilitySimulate().
 * Falls back to displaying detailed progress while the LLM inference runs.
 *
 * Personas: pulled from the socialApi (saved on backend) — "me" + a friend/user.
 * Also reads the currently selected apartment's lat/lon for property_config.
 */
import { useState, useEffect } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { assessmentApi } from "@/services/assessmentApi";
import type { CompatibilitySimulationResult } from "@/services/assessmentApi";
import { socialApi } from "@/services/socialApi";
import { userToLifeSimPersona, toLifeSimPersona } from "@/features/persona/toLifeSimPersona";
import { toast } from "sonner";
import {
  ChevronDown, ChevronUp, Play, Loader2, AlertTriangle,
  Users, Brain, CheckSquare, BarChart2, ClipboardList,
} from "lucide-react";

// ── Grade badge ───────────────────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    B: "bg-teal-500/20 text-teal-300 border-teal-500/40",
    C: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    D: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    F: "bg-red-500/20 text-red-300 border-red-500/40",
  };
  return (
    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full border-2 font-display text-2xl font-bold ${colors[grade] ?? "bg-muted text-muted-foreground"}`}>
      {grade}
    </span>
  );
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="rounded-2xl overflow-hidden">
      <button
        className="w-full flex items-center gap-2 p-3 hover:bg-muted/40 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <span className="font-medium text-left flex-1">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-border">{children}</div>}
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SimulationRunner() {
  const {
    personas, apartments,
    selectedPersonaA, selectedPersonaB, selectedApartment,
    setSelectedPersonaA, setSelectedPersonaB, setSelectedApartment,
    openOverlay,
  } = useApp();
  const { user } = useAuthStore();

  // Ticks for the simulation
  const [ticks, setTicks] = useState(12);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CompatibilitySimulationResult | null>(null);
  const [stage, setStage] = useState<string>("");
  const [friends, setFriends] = useState<Array<{ id: number; email: string; display_name: string; has_persona: boolean }>>([]);
  const [personaBUserId, setPersonaBUserId] = useState<string>("");

  useEffect(() => {
    // Only fetch friends when we have an authenticated user and a valid token
    const token = localStorage.getItem("access_token");
    if (!user || !token) return;
    socialApi.getFriends().then(setFriends).catch(() => {});
  }, [user]);

  const selectedApt = selectedApartment ? apartments.find(a => a.id === selectedApartment) : null;
  const mePersona = user ? userToLifeSimPersona(user) : null;
  const frontendPersonaA = selectedPersonaA ? personas.find(p => p.id === selectedPersonaA) : null;

  // Subjects: A is always "me" (from user settings), B is a friend or a local persona
  const subjectAId = user ? String(user.id) : (selectedPersonaA ?? "persona_a");
  const subjectBId = personaBUserId || selectedPersonaB || "persona_b";

  const traitsA = mePersona?.traits ?? {};
  const traitsB = frontendPersonaA ? toLifeSimPersona(
    personas.find(p => p.id === selectedPersonaB) ??
    personas.find(p => p.id === selectedPersonaA)!
  ).traits : {};

  const canRun = !!user && (!!personaBUserId || !!selectedPersonaB);

  const run = async () => {
    if (!user) { toast.error("You must be logged in."); return; }
    if (!canRun) { toast.error("Select a roommate persona to compare against."); return; }

    setRunning(true);
    setResult(null);
    setStage("Initialising personas…");

    try {
      // Build property config from apartment if selected
      const property_config = selectedApt ? {
        noise_level: selectedApt.noiseScore ? (100 - selectedApt.noiseScore) / 100 : 0.5,
        temperature: selectedApt.thermalScore ? selectedApt.thermalScore / 100 : 0.5,
        smoking_allowed: false,
      } : {};

      setStage("Running LLM-driven cohabitation simulation… (this takes 1–2 min)");

      const res = await assessmentApi.compatibilitySimulate({
        subject_a_id: subjectAId,
        subject_b_id: subjectBId,
        traits_a: traitsA as any,
        traits_b: traitsB as any,
        property_config,
        num_ticks: ticks,
      });

      setResult(res);
      toast.success(`Grade ${res.grade} · ${Math.round(res.compatibility_score * 100)}% compatibility`);
    } catch (err: any) {
      toast.error(`Simulation failed: ${err.response?.data?.detail ?? err.message}`);
    } finally {
      setRunning(false);
      setStage("");
    }
  };

  return (
    <OverlayPanel title="Simulation Runner" subtitle="LLM-driven roommate compatibility · powered by HestIA-LS" size="xl">

      {/* ── Configuration grid ─────────────────────────────────────────────── */}
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        {/* Persona A — always "me" */}
        <div className="rounded-2xl border border-border bg-muted/30 p-3 space-y-1">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Persona A (you)</Label>
          {mePersona ? (
            <div className="font-medium">{mePersona.name}</div>
          ) : (
            <div className="text-sm text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Set preferences in <a href="/settings" className="underline">Settings</a>
            </div>
          )}
          {mePersona && (
            <div className="flex flex-wrap gap-1 mt-1">
              {mePersona.behavioral_adjectives.slice(0, 3).map(a => (
                <Badge key={a} variant="secondary" className="rounded-full text-xs capitalize">{a}</Badge>
              ))}
            </div>
          )}
        </div>

        {/* Persona B — friend or local persona */}
        <div className="space-y-1">
          <Label>Persona B — roommate</Label>
          <select
            className="mt-1 w-full rounded-2xl border border-border bg-background h-11 px-3 text-sm"
            value={personaBUserId || selectedPersonaB || ""}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith("user:")) {
                setPersonaBUserId(val.replace("user:", ""));
                setSelectedPersonaB(null);
              } else {
                setPersonaBUserId("");
                setSelectedPersonaB(val || null);
              }
            }}
          >
            <option value="">— Solo (no roommate) —</option>
            {/* Local personas */}
            {personas.length > 0 && (
              <optgroup label="Local personas">
                {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            )}
            {/* Friends with persona */}
            {friends.filter(f => f.has_persona).length > 0 && (
              <optgroup label="Friends">
                {friends.filter(f => f.has_persona).map(f => (
                  <option key={f.id} value={`user:${f.id}`}>{f.display_name || f.email}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* Apartment */}
        <div>
          <Label>Apartment (optional)</Label>
          <select
            className="mt-1 w-full rounded-2xl border border-border bg-background h-11 px-3 text-sm"
            value={selectedApartment ?? ""}
            onChange={(e) => setSelectedApartment(e.target.value || null)}
          >
            <option value="">No apartment selected</option>
            {apartments.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          {selectedApt?.noiseScore != null && (
            <div className="text-xs text-muted-foreground mt-1">
              Noise: {selectedApt.noiseScore} · Thermal: {selectedApt.thermalScore ?? "—"}
            </div>
          )}
        </div>
      </div>

      {/* ── Simulation length ──────────────────────────────────────────────── */}
      <Card className="p-4 rounded-2xl mb-4">
        <div className="flex justify-between mb-1">
          <Label>Simulation length (ticks ≈ hours)</Label>
          <span className="text-sm text-muted-foreground">{ticks}h</span>
        </div>
        <Slider value={[ticks]} min={6} max={48} step={6} onValueChange={(v) => setTicks(v[0])} />
        <p className="text-xs text-muted-foreground mt-2">
          ⏱ Longer simulations = more conflicts detected but take more time (LLM inference: ~{Math.round(ticks * 2 / 60)} min).
        </p>
      </Card>

      {/* ── Warning ────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-sm text-yellow-300 flex items-center gap-2 mb-4">
        <Brain className="h-4 w-4 shrink-0" />
        This uses an LLM agent to simulate cohabitation. Expect <strong>1–3 minutes</strong> per run.
      </div>

      {/* ── Run button ─────────────────────────────────────────────────────── */}
      <Button
        size="lg" onClick={run}
        disabled={!canRun || running}
        className="w-full rounded-2xl shadow-sims"
      >
        {running
          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{stage || "Simulating…"}</>
          : <><Play className="h-4 w-4 mr-2" />Run LLM Simulation</>}
      </Button>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {result && (
        <div className="mt-6 space-y-4">

          {/* Score cards */}
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/20">
            <GradeBadge grade={result.grade} />
            <div className="flex-1">
              <div className="text-lg font-display">
                {Math.round(result.compatibility_score * 100)}% compatible
              </div>
              <div className="text-sm text-muted-foreground">
                Overall score: {Math.round(result.overall_score)}/100
                {result.needs_mediation && " · ⚠ Mediation recommended"}
              </div>
            </div>
            <Badge
              variant="secondary"
              className={`rounded-full text-sm px-3 py-1 ${result.llm_backend_used?.includes("tokenfactory") ? "bg-purple-500/20 text-purple-300" : "bg-blue-500/20 text-blue-300"}`}
            >
              {result.llm_backend_used?.includes("tokenfactory") ? "TokenFactory" : "Ollama"}
            </Badge>
          </div>

          {/* Lease checklist */}
          <Section title={`Lease checklist (${result.lease_checklist?.length ?? 0} items)`} icon={CheckSquare}>
            {result.lease_checklist?.length ? (
              <ul className="space-y-1.5 pt-3">
                {result.lease_checklist.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-primary mt-0.5">☐</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground pt-3">No specific checklist items generated.</p>
            )}
          </Section>

          {/* Full report link */}
          {result.report_id && (
            <Section title="Full compatibility report" icon={BarChart2}>
              <div className="pt-3 space-y-2 text-sm">
                <div className="font-mono text-xs text-muted-foreground">Report ID: {result.report_id}</div>
                <p className="text-muted-foreground">
                  The full LLM-generated report (conflict events, mediation analysis, SOTOPIA scores) is stored on the backend.
                </p>
                <Button
                  variant="outline" size="sm" className="rounded-2xl"
                  onClick={() => assessmentApi.compatibilityReport(result.report_id).then(r => {
                    toast.info(`Full report loaded — ${Object.keys(r.full_report ?? {}).join(", ")}`);
                  })}
                >
                  Load full report payload
                </Button>
              </div>
            </Section>
          )}

          {/* Raw JSON */}
          <Section title="Raw payload" icon={ClipboardList}>
            <pre className="text-xs bg-muted p-3 rounded-xl overflow-auto max-h-64 mt-3">
              {JSON.stringify(result, null, 2)}
            </pre>
          </Section>

          <Button variant="outline" className="rounded-2xl w-full" onClick={() => openOverlay("visual-replay")}>
            Open visual replay →
          </Button>
        </div>
      )}
    </OverlayPanel>
  );
}
