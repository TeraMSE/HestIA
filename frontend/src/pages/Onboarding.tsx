import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { OnboardingStep } from "@/features/onboarding/OnboardingStep";
import { Plumbob } from "@/features/onboarding/Plumbob";
import { SimAvatar, AvatarKind } from "@/features/onboarding/SimAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useApp } from "@/shared/store/useApp";
import { toast } from "sonner";
import { personaService } from "@/services/mockApi";
import type { UserRole } from "@/contracts/types";

const TOTAL = 10;

export default function Onboarding() {
  const [step, setStep] = useState(0); // 0 = welcome
  const [role, setRole] = useState<UserRole | null>(null);
  const [name, setName] = useState("");
  const [openness, setOpenness] = useState(50);
  const [conscientiousness, setConscientiousness] = useState(50);
  const [extraversion, setExtraversion] = useState(50);
  const [agreeableness, setAgreeableness] = useState(50);
  const [neuroticism, setNeuroticism] = useState(50);
  const [noiseTolerance, setNoiseTolerance] = useState(50);
  const [cleanliness, setCleanliness] = useState(70);
  const [thermal, setThermal] = useState(50);
  const [smoker, setSmoker] = useState(false);
  const [schedule, setSchedule] = useState<"early_bird" | "night_owl" | "flexible">("flexible");
  const [email, setEmail] = useState("");

  const { setUser } = useApp();
  const navigate = useNavigate();

  const next = () => setStep((s) => Math.min(TOTAL, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const finish = async () => {
    if (!role || !email.includes("@") || !name.trim()) {
      toast.error("Please fill name and a valid email.");
      return;
    }
    const user = {
      id: `u_${Math.random().toString(36).slice(2, 8)}`,
      email,
      displayName: name,
      role,
      avatarColor: "#a0e7e5",
    };
    setUser(user);
    await personaService.save({
      name: `${name} (you)`,
      avatarColor: "#a0e7e5",
      bigFive: { openness, conscientiousness, extraversion, agreeableness, neuroticism },
      lifestyle: { noiseTolerance, cleanliness, thermalSensitivity: thermal, smoker, schedule },
      traitCoverage: 100,
    });
    toast.success(`Welcome, ${name}!`);
    navigate("/map");
  };

  // === Welcome ===
  if (step === 0) {
    return (
      <main className="min-h-screen bg-gradient-sky flex flex-col items-center justify-center px-6 text-center animate-fade-in">
        <Plumbob className="h-24 w-24 animate-plumbob mb-8" />
        <h1 className="font-display text-6xl md:text-7xl mb-4">HestIA</h1>
        <p className="text-xl text-muted-foreground max-w-xl mb-10">
          Find your home, your way. A map-first, Sims-inspired real estate experience for Tunisia.
        </p>
        <Button size="lg" className="rounded-full px-12 shadow-sims text-lg" onClick={() => setStep(1)}>
          Begin →
        </Button>
        <p className="mt-6 text-sm text-muted-foreground">10 quick questions · about 2 minutes</p>
      </main>
    );
  }

  // === Step 1: role ===
  if (step === 1) {
    return (
      <OnboardingStep step={1} total={TOTAL} question="Who are you?" hint="Pick the path that fits you today." onBack={back} onNext={next} nextDisabled={!role}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(["renter", "buyer", "landlord"] as UserRole[]).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`rounded-3xl p-6 border-2 transition-all shadow-soft hover:shadow-sims hover:-translate-y-1 ${
                role === r ? "border-primary bg-primary/10" : "border-border bg-card"
              }`}
            >
              <div className="flex justify-center mb-2">
                <SimAvatar kind={r as AvatarKind} size={140} />
              </div>
              <div className="font-display text-xl capitalize">{r}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {r === "renter" ? "Looking to rent" : r === "buyer" ? "Looking to buy" : "Listing properties"}
              </div>
            </button>
          ))}
        </div>
      </OnboardingStep>
    );
  }

  // === Step 2: Name ===
  if (step === 2) {
    return (
      <OnboardingStep step={2} total={TOTAL} question="What should we call you?" onBack={back} onNext={next} nextDisabled={!name.trim()}>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="h-16 text-2xl text-center rounded-2xl shadow-soft max-w-md mx-auto"
        />
      </OnboardingStep>
    );
  }

  // === Steps 3–7: Big Five ===
  const traitStep = (s: number, label: string, val: number, set: (v: number) => void, low: string, high: string, avatar: AvatarKind) => (
    <OnboardingStep step={s} total={TOTAL} question={label} hint={`${low}  ←→  ${high}`} onBack={back} onNext={next}>
      <div className="max-w-xl mx-auto flex flex-col items-center gap-6">
        <SimAvatar kind={avatar} size={170} />
        <Slider value={[val]} min={0} max={100} step={1} onValueChange={(v) => set(v[0])} aria-label={label} />
        <div className="text-3xl font-display">{val}</div>
      </div>
    </OnboardingStep>
  );

  if (step === 3) return traitStep(3, "How open are you to new experiences?", openness, setOpenness, "Routine", "Adventurous", "explorer");
  if (step === 4) return traitStep(4, "How organized do you like things?", conscientiousness, setConscientiousness, "Free-flow", "Planner", "planner");
  if (step === 5) return traitStep(5, "How much do you enjoy social energy at home?", extraversion, setExtraversion, "Quiet alone time", "Always hosting", "host");
  if (step === 6) return traitStep(6, "How easy-going are you with others?", agreeableness, setAgreeableness, "Direct", "Accommodating", "peacemaker");
  if (step === 7) return traitStep(7, "How sensitive are you to stress?", neuroticism, setNeuroticism, "Calm", "Easily stressed", "calm");

  // === Step 8: Lifestyle bundle ===
  if (step === 8) {
    return (
      <OnboardingStep step={8} total={TOTAL} question="A few lifestyle details" hint="These help match you with compatible homes." onBack={back} onNext={next}>
        <div className="max-w-xl mx-auto grid gap-6">
          <div className="flex justify-center"><SimAvatar kind="lifestyle" size={130} /></div>
          <div>
            <Label className="mb-2 block">Noise tolerance</Label>
            <Slider value={[noiseTolerance]} min={0} max={100} step={1} onValueChange={(v) => setNoiseTolerance(v[0])} />
          </div>
          <div>
            <Label className="mb-2 block">Cleanliness preference</Label>
            <Slider value={[cleanliness]} min={0} max={100} step={1} onValueChange={(v) => setCleanliness(v[0])} />
          </div>
          <div>
            <Label className="mb-2 block">Thermal sensitivity</Label>
            <Slider value={[thermal]} min={0} max={100} step={1} onValueChange={(v) => setThermal(v[0])} />
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-card p-4 shadow-soft">
            <Label htmlFor="smoker">Smoker</Label>
            <Switch id="smoker" checked={smoker} onCheckedChange={setSmoker} />
          </div>
          <div className="flex flex-wrap gap-2">
            {(["early_bird", "flexible", "night_owl"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSchedule(s)}
                className={`rounded-full px-5 py-2 border-2 transition ${schedule === s ? "border-primary bg-primary/15" : "border-border bg-card"}`}
              >
                {s === "early_bird" ? "🌅 Early bird" : s === "night_owl" ? "🌙 Night owl" : "🕊 Flexible"}
              </button>
            ))}
          </div>
        </div>
      </OnboardingStep>
    );
  }

  // === Step 9: email ===
  if (step === 9) {
    return (
      <OnboardingStep step={9} total={TOTAL} question="Create your account" hint="We use email to save your personas and pins." onBack={back} onNext={next} nextDisabled={!email.includes("@")}>
        <Input
          autoFocus
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="h-16 text-2xl text-center rounded-2xl shadow-soft max-w-md mx-auto"
        />
      </OnboardingStep>
    );
  }

  // === Step 10: drop into map ===
  return (
    <OnboardingStep step={10} total={TOTAL} question={`All set, ${name}!`} hint="Let's drop you on the map." onBack={back} onNext={finish} nextLabel="Enter the map ✨">
      <div className="flex justify-center">
        <Plumbob className="h-32 w-32 animate-plumbob" />
      </div>
    </OnboardingStep>
  );
}
