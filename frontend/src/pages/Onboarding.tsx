/**
 * Onboarding.tsx — streamlined signup flow.
 *
 * Steps:
 *   0  Welcome
 *   1  Role picker
 *   2  Name
 *   3  Personality Builder  ← replaces old steps 3-8 (Big Five + lifestyle sliders)
 *   4  Finish / Create account
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { OnboardingStep } from "@/features/onboarding/OnboardingStep";
import { Plumbob } from "@/features/onboarding/Plumbob";
import { SimAvatar, AvatarKind } from "@/features/onboarding/SimAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { socialApi } from "@/services/socialApi";
import { userToLifeSimPersona } from "@/features/persona/toLifeSimPersona";
import { toast } from "sonner";
import type { UserRole } from "@/contracts/types";
import { PersonalityBuilder, PersonalityResult } from "@/features/onboarding/PersonalityBuilder";

const TOTAL = 4; // steps 1–4 (excluding welcome)

export default function Onboarding() {
  const [step, setStep] = useState(0); // 0 = welcome

  // Account details
  const [role, setRole] = useState<UserRole | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Personality result from PersonalityBuilder
  const [personalityResult, setPersonalityResult] = useState<PersonalityResult | null>(null);

  const { signup } = useAuthStore();
  const navigate = useNavigate();

  const next = () => setStep((s) => Math.min(TOTAL, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const passwordValid = password.length >= 8 && password === confirmPassword;

  // ── Finish — signup + persist persona ──────────────────────────────────────
  const finish = async () => {
    if (!role || !email.includes("@") || !name.trim()) {
      toast.error("Please fill in your name and a valid email.");
      return;
    }
    if (!passwordValid) {
      toast.error("Passwords must match and be at least 8 characters.");
      return;
    }

    setIsLoading(true);
    try {
      const parts = name.trim().split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || "";

      await signup(email, password, firstName, lastName, role);

      const token = localStorage.getItem("access_token");

      // If we have a personality result, persist lifestyle prefs to the user profile
      if (personalityResult && token) {
        const tv = personalityResult.traitVector;
        await fetch("/api/v1/auth/users/me/", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            noise_tolerance: Math.round((1 - tv.noise_sensitivity) * 100),
            cleanliness: Math.round(tv.cleanliness * 100),
            thermal_sensitivity: Math.round(tv.thermal_sensitivity * 100),
            smoker: tv.smoker,
            daily_schedule: tv.early_riser ? "early_bird" : "night_owl",
          }),
        });
      }

      // Always re-fetch /me/ after all updates to get the complete user object
      // (role + any patched fields) and update localStorage + the auth store
      let freshUser: any = null;
      if (token) {
        const meRes = await fetch("/api/v1/auth/users/me/", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (meRes.ok) {
          freshUser = await meRes.json();
          localStorage.setItem("user", JSON.stringify(freshUser));
          useAuthStore.getState().initializeAuth();
        }
      }

      // Save persona to UserPersona so has_persona=true in the backend.
      // This makes the user eligible for the Roommate Compatibility candidate list.
      // Build from the fresh user object (which now has personality preference fields).
      if (freshUser) {
        try {
          const lsPersona = userToLifeSimPersona(freshUser);
          await socialApi.saveMyPersona(lsPersona);
        } catch {
          // Non-fatal: persona save failure doesn't block signup
          console.warn("Could not save persona during onboarding");
        }
      }

      toast.success(`Welcome to HestIA, ${firstName}! 🎉`);
      navigate("/map");
    } catch (err: any) {
      const storeError = useAuthStore.getState().error;
      toast.error(storeError || "Account creation failed. Please try again.");
      setIsLoading(false);
    }
  };

  // ── Step 0: Welcome ─────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <main className="min-h-screen bg-gradient-sky flex flex-col items-center justify-center px-6 text-center animate-fade-in">
        <Plumbob className="h-24 w-24 animate-plumbob mb-8" />
        <h1 className="font-display text-6xl md:text-7xl mb-4">HestIA</h1>
        <p className="text-xl text-muted-foreground max-w-xl mb-10">
          Find your home, your way. A map-first, Sims-inspired real estate experience for Tunisia.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <Button size="lg" className="rounded-full px-12 shadow-sims text-lg" onClick={() => setStep(1)}>
            Begin →
          </Button>
          <Button
            size="lg" variant="outline" className="rounded-full px-12 text-lg"
            onClick={() => navigate("/login")}
          >
            Login instead
          </Button>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">4 quick steps · about 5 minutes</p>
      </main>
    );
  }

  // ── Step 1: Role ───────────────────────────────────────────────────────────
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

  // ── Step 2: Name ───────────────────────────────────────────────────────────
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

  // ── Step 3: Personality Builder ────────────────────────────────────────────
  if (step === 3) {
    return (
      <OnboardingStep
        step={3}
        total={TOTAL}
        question={personalityResult ? "Personality profile ready ✨" : `Nice to meet you, ${name}! Let's build your profile.`}
        hint={personalityResult ? "You can always refine this later from your settings." : "Tell us about yourself — we'll infer your traits automatically."}
        onBack={back}
        onNext={personalityResult ? next : undefined}
        nextDisabled={!personalityResult}
        nextLabel={personalityResult ? "Continue →" : undefined}
        hideNext={!personalityResult}
      >
        {personalityResult ? (
          // Show summary after completion
          <div className="max-w-xl mx-auto space-y-3 text-center">
            <div className="text-5xl mb-2">🎉</div>
            <p className="text-muted-foreground text-sm">
              Profile built using <strong>{personalityResult.mode}</strong> mode. Your traits have been saved and will be used to match you with compatible homes and roommates.
            </p>
            <Button variant="outline" className="rounded-2xl text-sm" onClick={() => setPersonalityResult(null)}>
              Redo personality profile
            </Button>
          </div>
        ) : (
          <PersonalityBuilder
            userName={name}
            onComplete={(result) => {
              setPersonalityResult(result);
            }}
          />
        )}
      </OnboardingStep>
    );
  }

  // ── Step 4: Credentials + Finish ───────────────────────────────────────────
  return (
    <OnboardingStep
      step={4}
      total={TOTAL}
      question={`Almost there, ${name}!`}
      hint="Set up your login credentials to create your account."
      onBack={back}
      onNext={finish}
      nextLabel={isLoading ? "Creating account…" : "Enter the map ✨"}
      nextDisabled={isLoading || !email.includes("@") || !passwordValid}
    >
      <div className="max-w-md mx-auto space-y-4">
        <div>
          <Label className="mb-1 block">Email</Label>
          <Input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-14 text-lg text-center rounded-2xl shadow-soft"
          />
        </div>

        <div className="relative">
          <Label className="mb-1 block">Password</Label>
          <Input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 chars)"
            className="h-14 text-lg text-center rounded-2xl shadow-soft pr-14"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-4 bottom-4 text-muted-foreground hover:text-foreground text-sm"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        <div>
          <Label className="mb-1 block">Confirm Password</Label>
          <Input
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat password"
            className="h-14 text-lg text-center rounded-2xl shadow-soft"
          />
        </div>

        {confirmPassword && !passwordValid && (
          <p className="text-sm text-destructive text-center">
            {password.length < 8 ? "Password must be at least 8 characters." : "Passwords don't match."}
          </p>
        )}
        {passwordValid && (
          <p className="text-sm text-green-500 text-center">✓ Passwords match</p>
        )}

        {!personalityResult && (
          <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 text-xs text-yellow-300">
            ⚠ You skipped the personality step — you can complete it later from your profile.
          </div>
        )}
      </div>
    </OnboardingStep>
  );
}
