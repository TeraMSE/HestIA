import { useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/shared/store/useApp";
import { simulationService, replayService } from "@/services/mockApi";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Play } from "lucide-react";

export function SimulationRunner() {
  const {
    personas, apartments,
    selectedPersonaA, selectedPersonaB, selectedApartment,
    setSelectedPersonaA, setSelectedPersonaB, setSelectedApartment,
    setLastResult, setFrameSequence, openOverlay, lastResult,
  } = useApp();
  const [ticks, setTicks] = useState(48);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const canRun = !!(selectedPersonaA && selectedPersonaB && selectedApartment) && selectedPersonaA !== selectedPersonaB;

  const run = async () => {
    if (!canRun) { toast.error("Pick two different personas and an apartment"); return; }
    setRunning(true); setProgress(0);
    try {
      const result = await simulationService.run({
        personaAId: selectedPersonaA!, personaBId: selectedPersonaB!, apartmentId: selectedApartment!,
        ticks, onProgress: setProgress,
      });
      setLastResult(result);
      const seq = await replayService.generate(result);
      setFrameSequence(seq);
      toast.success(`Score ${result.overallScore} · grade ${result.grade}`);
    } catch (e: any) {
      toast.error(e.message ?? "Simulation failed");
    } finally { setRunning(false); }
  };

  const Selector = ({ label, value, onChange }: { label: string; value: string | null; onChange: (id: string) => void }) => (
    <div>
      <Label>{label}</Label>
      <select className="mt-1 w-full rounded-2xl border border-border bg-background h-11 px-3" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );

  const toggle = (k: string) => setOpen((s) => ({ ...s, [k]: !s[k] }));

  return (
    <OverlayPanel title="Simulation Runner" subtitle="Match two personas in an apartment" size="xl">
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <Selector label="Persona A" value={selectedPersonaA} onChange={setSelectedPersonaA} />
        <Selector label="Persona B" value={selectedPersonaB} onChange={setSelectedPersonaB} />
        <div>
          <Label>Apartment</Label>
          <select className="mt-1 w-full rounded-2xl border border-border bg-background h-11 px-3" value={selectedApartment ?? ""} onChange={(e) => setSelectedApartment(e.target.value)}>
            <option value="">Select…</option>
            {apartments.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
      </div>

      <Card className="p-4 rounded-2xl mb-4">
        <div className="flex justify-between mb-1"><Label>Simulation length (ticks ≈ hours)</Label><span className="text-sm text-muted-foreground">{ticks}h</span></div>
        <Slider value={[ticks]} min={12} max={168} step={4} onValueChange={(v) => setTicks(v[0])} />
      </Card>

      <Button size="lg" onClick={run} disabled={!canRun || running} className="w-full rounded-2xl shadow-sims">
        <Play className="h-4 w-4 mr-2" /> {running ? `Running… ${progress}%` : "Run simulation"}
      </Button>
      {running && (
        <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {lastResult && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="p-3 rounded-2xl text-center"><div className="text-xs text-muted-foreground">Compatibility</div><div className="font-display text-2xl">{lastResult.compatibilityPct}%</div></Card>
            <Card className="p-3 rounded-2xl text-center"><div className="text-xs text-muted-foreground">Conflicts</div><div className="font-display text-2xl">{lastResult.conflicts.length}</div></Card>
            <Card className="p-3 rounded-2xl text-center"><div className="text-xs text-muted-foreground">Positives</div><div className="font-display text-2xl">{lastResult.positives.length}</div></Card>
            <Card className="p-3 rounded-2xl text-center bg-primary/10"><div className="text-xs text-muted-foreground">Grade</div><div className="font-display text-2xl">{lastResult.grade}</div></Card>
            <Card className="p-3 rounded-2xl text-center bg-secondary/40"><div className="text-xs text-muted-foreground">Score</div><div className="font-display text-2xl">{lastResult.overallScore}</div></Card>
          </div>

          {[
            { key: "conflicts", title: "Conflict log", body: (
              <ul className="space-y-2">{lastResult.conflicts.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Badge variant={c.severity === "high" ? "destructive" : "secondary"} className="rounded-full">{c.severity}</Badge>
                  <span><span className="text-muted-foreground">tick {c.tick} · {c.category}</span> — {c.description}</span>
                </li>
              ))}{lastResult.conflicts.length === 0 && <li className="text-muted-foreground text-sm">No conflicts 🎉</li>}</ul>
            ) },
            { key: "mediation", title: "Mediation checklist", body: (
              <ul className="space-y-1 text-sm">
                <li>☐ Agree on quiet hours (10pm–7am)</li>
                <li>☐ Weekly cleaning rotation</li>
                <li>☐ Shared thermostat range 22–25°C</li>
                <li>☐ Guest policy in writing</li>
              </ul>
            ) },
            { key: "breakdown", title: "Score breakdown", body: (
              <div className="grid grid-cols-5 gap-2">{Object.entries(lastResult.breakdown).map(([k, v]) => (
                <div key={k} className="text-center"><div className="text-xs text-muted-foreground capitalize">{k}</div><div className="font-display text-lg">{Math.round(v)}</div></div>
              ))}</div>
            ) },
            { key: "raw", title: "Raw payload", body: (<pre className="text-xs bg-muted p-3 rounded-xl overflow-auto max-h-64">{JSON.stringify(lastResult, null, 2)}</pre>) },
          ].map((section) => (
            <Card key={section.key} className="rounded-2xl">
              <button className="w-full flex items-center justify-between p-3" onClick={() => toggle(section.key)}>
                <span className="font-medium">{section.title}</span>
                {open[section.key] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {open[section.key] && <div className="px-4 pb-4">{section.body}</div>}
            </Card>
          ))}

          <Button variant="outline" className="rounded-2xl w-full" onClick={() => openOverlay("visual-replay")}>Open visual replay →</Button>
        </div>
      )}
    </OverlayPanel>
  );
}
