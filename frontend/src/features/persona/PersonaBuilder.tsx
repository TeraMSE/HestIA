import { useEffect, useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Send, Trash2, Save } from "lucide-react";
import { personaService } from "@/services/mockApi";
import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { toast } from "sonner";
import type { PersonaProfile } from "@/contracts/types";
import { socialApi } from "@/services/socialApi";
import { toLifeSimPersona } from "./toLifeSimPersona";

const interviewQuestions = [
  "Hi! What's your name?",
  "How do you feel about loud parties at home?",
  "How tidy do you keep shared spaces?",
  "Are you sensitive to heat or cold?",
  "Are you an early bird or a night owl?",
  "Do you smoke?",
  "How do you handle disagreements with roommates?",
];

function emptyPersona(slot: "A" | "B"): Omit<PersonaProfile, "id" | "updatedAt"> {
  return {
    name: `Persona ${slot}`,
    avatarColor: slot === "A" ? "#ffb3c1" : "#a0e7e5",
    bigFive: { openness: 50, conscientiousness: 50, extraversion: 50, agreeableness: 50, neuroticism: 50 },
    lifestyle: { noiseTolerance: 50, cleanliness: 50, thermalSensitivity: 50, smoker: false, schedule: "flexible" },
    traitCoverage: 0,
  };
}

export function PersonaBuilder() {
  const { personas, setPersonas } = useApp();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<"A" | "B">("A");
  const [drafts, setDrafts] = useState<Record<"A" | "B", Omit<PersonaProfile, "id" | "updatedAt"> & { id?: string }>>({
    A: emptyPersona("A"),
    B: emptyPersona("B"),
  });
  const [chat, setChat] = useState<{ role: "assistant" | "user"; text: string }[]>([{ role: "assistant", text: interviewQuestions[0] }]);
  const [chatInput, setChatInput] = useState("");
  const [qIdx, setQIdx] = useState(0);

  // Pre-fill Persona A sliders from user profile if no saved persona exists
  useEffect(() => {
    (async () => {
      try {
        const saved = await socialApi.getMyPersona();
        if (saved || !user) return;
        const hasPref = user.noise_tolerance != null || user.cleanliness != null || user.thermal_sensitivity != null;
        if (!hasPref) return;
        setDrafts(d => ({
          ...d,
          A: {
            ...d.A,
            name: user.first_name ? `${user.first_name}'s Persona` : d.A.name,
            lifestyle: {
              noiseTolerance: user.noise_tolerance ?? d.A.lifestyle.noiseTolerance,
              cleanliness: user.cleanliness ?? d.A.lifestyle.cleanliness,
              thermalSensitivity: user.thermal_sensitivity ?? d.A.lifestyle.thermalSensitivity,
              smoker: user.smoker ?? d.A.lifestyle.smoker,
              schedule: (user.daily_schedule || d.A.lifestyle.schedule) as PersonaProfile["lifestyle"]["schedule"],
            },
          },
        }));
      } catch {
        // Non-fatal
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = drafts[tab];
  const updateDraft = (patch: Partial<typeof cur>) => setDrafts((d) => ({ ...d, [tab]: { ...d[tab], ...patch } }));
  const updateBig = (k: keyof PersonaProfile["bigFive"], v: number) => updateDraft({ bigFive: { ...cur.bigFive, [k]: v } });
  const updateLife = (patch: Partial<PersonaProfile["lifestyle"]>) => updateDraft({ lifestyle: { ...cur.lifestyle, ...patch } });

  const sendChat = () => {
    if (!chatInput.trim()) return;
    const next = [...chat, { role: "user" as const, text: chatInput }];
    const newQIdx = Math.min(qIdx + 1, interviewQuestions.length - 1);
    if (qIdx < interviewQuestions.length - 1) next.push({ role: "assistant", text: interviewQuestions[newQIdx] });
    setChat(next);
    setChatInput("");
    setQIdx(newQIdx);
    const coverage = Math.min(100, Math.round(((newQIdx + 1) / interviewQuestions.length) * 100));
    updateDraft({ traitCoverage: coverage });
  };

  const save = async () => {
    const saved = await personaService.save(cur);
    setPersonas(await personaService.list());
    updateDraft({ id: saved.id });
    // Auto-sync Persona A as the current user's canonical persona on the backend
    if (tab === "A") {
      try {
        await socialApi.saveMyPersona(toLifeSimPersona(saved));
      } catch {
        // Non-fatal: user may not be logged in or backend not running
      }
    }
    toast.success(`Saved ${saved.name}`);
  };

  const remove = async () => {
    if (!cur.id) return;
    await personaService.remove(cur.id);
    setPersonas(await personaService.list());
    setDrafts((d) => ({ ...d, [tab]: emptyPersona(tab) }));
    setChat([{ role: "assistant", text: interviewQuestions[0] }]);
    setQIdx(0);
    toast.success("Persona removed");
  };

  return (
    <OverlayPanel title="Persona Builder" subtitle="Interview chat or manual editor — A & B" size="xl">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "A" | "B")}>
        <TabsList className="rounded-2xl mb-4">
          <TabsTrigger value="A">Persona A</TabsTrigger>
          <TabsTrigger value="B">Persona B</TabsTrigger>
        </TabsList>

        {(["A", "B"] as const).map((slot) => (
          <TabsContent key={slot} value={slot} className="grid md:grid-cols-2 gap-5 mt-0">
            {/* Chat */}
            <Card className="rounded-3xl p-4 flex flex-col h-[460px]">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">Interview chat</div>
                <div className="text-xs text-muted-foreground">Coverage: {drafts[slot].traitCoverage}%</div>
              </div>
              <div className="h-2 rounded-full bg-muted mb-3 overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${drafts[slot].traitCoverage}%` }} />
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {chat.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-3">
                <Input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type your answer…" onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }} className="rounded-2xl" />
                <Button onClick={sendChat} className="rounded-2xl" aria-label="Send"><Send className="h-4 w-4" /></Button>
              </div>
            </Card>

            {/* Manual editor */}
            <Card className="rounded-3xl p-4 space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={drafts[slot].name} onChange={(e) => updateDraft({ name: e.target.value })} className="rounded-2xl mt-1" />
              </div>
              <div className="grid gap-3">
                {(Object.keys(drafts[slot].bigFive) as Array<keyof PersonaProfile["bigFive"]>).map((k) => (
                  <div key={k}>
                    <div className="flex justify-between text-sm mb-1"><span className="capitalize">{k}</span><span className="text-muted-foreground">{drafts[slot].bigFive[k]}</span></div>
                    <Slider value={[drafts[slot].bigFive[k]]} min={0} max={100} step={1} onValueChange={(v) => updateBig(k, v[0])} />
                  </div>
                ))}
              </div>
              <div className="grid gap-3">
                {(["noiseTolerance", "cleanliness", "thermalSensitivity"] as const).map((k) => (
                  <div key={k}>
                    <div className="flex justify-between text-sm mb-1"><span className="capitalize">{k.replace(/([A-Z])/g, " $1")}</span><span className="text-muted-foreground">{drafts[slot].lifestyle[k]}</span></div>
                    <Slider value={[drafts[slot].lifestyle[k] as number]} min={0} max={100} step={1} onValueChange={(v) => updateLife({ [k]: v[0] } as any)} />
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-2xl bg-muted p-3">
                  <Label>Smoker</Label>
                  <Switch checked={drafts[slot].lifestyle.smoker} onCheckedChange={(v) => updateLife({ smoker: v })} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["early_bird", "flexible", "night_owl"] as const).map((s) => (
                    <button key={s} onClick={() => updateLife({ schedule: s })} className={`rounded-full px-4 py-1.5 text-sm border-2 ${drafts[slot].lifestyle.schedule === s ? "border-primary bg-primary/15" : "border-border"}`}>
                      {s.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={save} className="rounded-2xl flex-1"><Save className="h-4 w-4 mr-2" />Save</Button>
                <Button onClick={remove} variant="outline" className="rounded-2xl" disabled={!drafts[slot].id}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <div className="mt-6">
        <h3 className="font-display text-lg mb-2">Library ({personas.length})</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {personas.map((p) => (
            <Card key={p.id} className="p-3 rounded-2xl flex items-center gap-3">
              <div className="h-10 w-10 rounded-full grid place-items-center font-display" style={{ background: p.avatarColor }}>{p.name.charAt(0)}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground">Coverage {p.traitCoverage}%</div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </OverlayPanel>
  );
}
