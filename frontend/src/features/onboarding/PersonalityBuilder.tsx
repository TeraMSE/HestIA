/**
 * PersonalityBuilder.tsx
 *
 * Three-mode personality builder for the HestIA onboarding flow:
 *   1. 💬 AI Interview  — LLM-driven chat, 6-20 exchanges
 *   2. 💬 Interview + Fine-tune  — interview, then adjust sliders
 *   3. 🎚️ Manual Sliders  — full control, instant
 *
 * Calls the Django /api/v1/personality/* endpoints.
 * Fires onComplete({ traitVector, sliderValues }) when the user confirms.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { personalityApi, TraitVector, SliderValues } from "@/services/personalityApi";
import { toast } from "sonner";
import {
  MessageCircle,
  SlidersHorizontal,
  Loader2,
  CheckCircle2,
  Bot,
  User,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersonalityResult {
  traitVector: TraitVector;
  sliderValues: SliderValues;
  mode: "interview" | "interview+manual" | "manual";
}

interface Props {
  userName?: string;
  onComplete: (result: PersonalityResult) => void;
}

type Mode = "interview" | "interview+sliders" | "sliders";

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TRAIT_LABELS: Record<string, string> = {
  openness: "Openness",
  conscientiousness: "Conscientiousness",
  extraversion: "Extraversion",
  agreeableness: "Agreeableness",
  neuroticism: "Neuroticism",
  introversion: "Introversion",
  noise_sensitivity: "Noise Sensitivity",
  cleanliness: "Cleanliness",
  thermal_sensitivity: "Thermal Sensitivity",
};

const NUMERIC_SLIDER_TRAITS = [
  { key: "openness", label: "Openness to new experiences", low: "Routine-oriented", high: "Adventurous" },
  { key: "conscientiousness", label: "Organization & reliability", low: "Flexible", high: "Very organized" },
  { key: "extraversion", label: "Social energy at home", low: "Private & quiet", high: "Always social" },
  { key: "agreeableness", label: "Ease of compromise", low: "Direct / own way", high: "Very accommodating" },
  { key: "neuroticism", label: "Stress sensitivity", low: "Calm under pressure", high: "Easily stressed" },
  { key: "noise_sensitivity", label: "Noise sensitivity", low: "Barely bothered", high: "Needs silence" },
  { key: "cleanliness", label: "Cleanliness standards", low: "Relaxed", high: "Very tidy" },
  { key: "thermal_sensitivity", label: "Temperature sensitivity", low: "Runs warm", high: "Easily cold" },
];

const DEFAULT_SLIDERS: Record<string, number> = {
  openness: 50,
  conscientiousness: 50,
  extraversion: 50,
  agreeableness: 50,
  neuroticism: 50,
  noise_sensitivity: 50,
  cleanliness: 70,
  thermal_sensitivity: 50,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function PersonalityBuilder({ userName, onComplete }: Props) {
  const [mode, setMode] = useState<Mode | null>(null);

  // Interview state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [exchangeCount, setExchangeCount] = useState(0);
  const [missingTraits, setMissingTraits] = useState<string[]>([]);

  // Result state (post-finalization)
  const [finalResult, setFinalResult] = useState<{
    traitVector: TraitVector;
    sliderValues: SliderValues;
    confidence: Record<string, number>;
    lowConfidence: string[];
    summary: string;
  } | null>(null);

  // Fine-tune override state (mirrors slider_values from finalization)
  const [ftSliders, setFtSliders] = useState<Record<string, number>>({});
  const [ftEarlyRiser, setFtEarlyRiser] = useState(false);
  const [ftSmoker, setFtSmoker] = useState(false);

  // Manual slider state
  const [manualSliders, setManualSliders] = useState<Record<string, number>>(DEFAULT_SLIDERS);
  const [manualEarlyRiser, setManualEarlyRiser] = useState(false);
  const [manualSmoker, setManualSmoker] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Start interview ────────────────────────────────────────────────────────

  const startInterview = useCallback(async () => {
    setIsLoading(true);
    try {
      const { session_id, first_question } = await personalityApi.startInterview(userName);
      setSessionId(session_id);
      setMessages([{ role: "assistant", content: first_question }]);
    } catch (err: any) {
      toast.error(`Couldn't start interview: ${err?.response?.data?.error ?? err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [userName]);

  useEffect(() => {
    if (mode === "interview" || mode === "interview+sliders") {
      startInterview();
    }
  }, [mode, startInterview]);

  // ── Send a message ─────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!inputText.trim() || !sessionId || isLoading || isComplete) return;
    const userMsg = inputText.trim();
    setInputText("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsLoading(true);

    try {
      const res = await personalityApi.respond(sessionId, userMsg);
      setMessages((prev) => [...prev, { role: "assistant", content: res.assistant_message }]);
      setExchangeCount(res.exchange_count);
      setMissingTraits(res.missing_traits);

      if (res.is_complete) {
        setIsComplete(true);
        await finalizeInterview();
      }
    } catch (err: any) {
      toast.error(`Error: ${err?.response?.data?.error ?? err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Finalize interview ─────────────────────────────────────────────────────

  const finalizeInterview = async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const res = await personalityApi.finalize(sessionId);
      setFinalResult({
        traitVector: res.trait_vector,
        sliderValues: res.slider_values,
        confidence: res.confidence_per_trait,
        lowConfidence: res.low_confidence_traits,
        summary: res.summary,
      });
      // Initialize fine-tune sliders from extracted values
      const sv = res.slider_values;
      setFtSliders({
        openness: sv.openness as number,
        conscientiousness: sv.conscientiousness as number,
        extraversion: sv.extraversion as number,
        agreeableness: sv.agreeableness as number,
        neuroticism: sv.neuroticism as number,
        noise_sensitivity: sv.noise_sensitivity as number,
        cleanliness: sv.cleanliness as number,
        thermal_sensitivity: sv.thermal_sensitivity as number,
      });
      setFtEarlyRiser(Boolean(sv.early_riser));
      setFtSmoker(Boolean(sv.smoker));
    } catch (err: any) {
      toast.error(`Finalization failed: ${err?.response?.data?.error ?? err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Apply fine-tune overrides and confirm ──────────────────────────────────

  const confirmInterview = async () => {
    if (!finalResult || !sessionId) return;

    if (mode === "interview+sliders") {
      // Apply overrides
      setIsLoading(true);
      try {
        const overrides: Record<string, number | boolean> = {
          ...ftSliders,
          early_riser: ftEarlyRiser,
          smoker: ftSmoker,
        };
        const res = await personalityApi.override(sessionId, overrides);
        onComplete({
          traitVector: res.trait_vector,
          sliderValues: res.slider_values,
          mode: "interview+manual",
        });
      } catch (err: any) {
        toast.error(`Couldn't apply overrides: ${err?.response?.data?.error ?? err.message}`);
      } finally {
        setIsLoading(false);
      }
    } else {
      onComplete({
        traitVector: finalResult.traitVector,
        sliderValues: finalResult.sliderValues,
        mode: "interview",
      });
    }
  };

  // ── Manual sliders confirm ─────────────────────────────────────────────────

  const confirmManual = async () => {
    setIsLoading(true);
    try {
      const res = await personalityApi.fromSliders({
        openness: manualSliders.openness,
        conscientiousness: manualSliders.conscientiousness,
        extraversion: manualSliders.extraversion,
        agreeableness: manualSliders.agreeableness,
        neuroticism: manualSliders.neuroticism,
        noise_sensitivity: manualSliders.noise_sensitivity,
        cleanliness: manualSliders.cleanliness,
        thermal_sensitivity: manualSliders.thermal_sensitivity,
        early_riser: manualEarlyRiser,
        smoker: manualSmoker,
      });
      onComplete({
        traitVector: res.trait_vector,
        sliderValues: res.slider_values,
        mode: "manual",
      });
    } catch (err: any) {
      toast.error(`Couldn't save profile: ${err?.response?.data?.error ?? err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Render: Mode picker ────────────────────────────────────────────────────

  if (!mode) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <h2 className="font-display text-2xl mb-1">Build Your Personality Profile</h2>
          <p className="text-sm text-muted-foreground">
            This helps us find the most compatible homes and roommates for you.
          </p>
        </div>

        {(["interview", "interview+sliders", "sliders"] as Mode[]).map((m) => {
          const config = {
            interview: {
              icon: <MessageCircle className="h-6 w-6" />,
              label: "💬 AI Interview",
              sub: "Recommended — just chat naturally for 6–15 minutes.",
              desc: "Our AI will ask you a few questions and automatically infer your personality traits. No sliders needed.",
              accent: "border-primary/60 bg-primary/5 hover:bg-primary/10",
            },
            "interview+sliders": {
              icon: <Bot className="h-6 w-6" />,
              label: "💬 Interview + Fine-tune",
              sub: "Best accuracy — chat then review.",
              desc: "Start with the AI interview, then review and adjust any inferred values using sliders.",
              accent: "border-violet-500/50 bg-violet-500/5 hover:bg-violet-500/10",
            },
            sliders: {
              icon: <SlidersHorizontal className="h-6 w-6" />,
              label: "🎚️ Manual Sliders",
              sub: "Fast — set your traits directly.",
              desc: "Full control over every trait. Great if you know yourself well or want a quick setup.",
              accent: "border-emerald-500/50 bg-emerald-500/5 hover:bg-emerald-500/10",
            },
          }[m];

          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`w-full rounded-2xl border-2 p-4 text-left transition-all group ${config.accent}`}
            >
              <div className="flex items-start gap-3">
                <div className="text-primary mt-0.5">{config.icon}</div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-base">{config.label}</span>
                    <Badge variant="secondary" className="text-xs rounded-full">{config.sub}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{config.desc}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // ── Render: Manual Sliders ────────────────────────────────────────────────

  if (mode === "sliders") {
    return (
      <div className="max-w-xl mx-auto space-y-5">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setMode(null)} className="text-muted-foreground hover:text-foreground text-sm">← Back</button>
          <h2 className="font-display text-xl">Manual Personality Sliders</h2>
        </div>

        <div className="space-y-4">
          {NUMERIC_SLIDER_TRAITS.map(({ key, label, low, high }) => (
            <div key={key}>
              <div className="flex justify-between mb-1">
                <Label className="text-sm font-medium">{label}</Label>
                <span className="text-xs text-muted-foreground">{manualSliders[key]}</span>
              </div>
              <Slider
                value={[manualSliders[key]]}
                min={0} max={100} step={1}
                onValueChange={([v]) => setManualSliders((s) => ({ ...s, [key]: v }))}
              />
              <div className="flex justify-between mt-0.5">
                <span className="text-xs text-muted-foreground">{low}</span>
                <span className="text-xs text-muted-foreground">{high}</span>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-2xl bg-card border border-border p-4">
            <Label htmlFor="manual-early">🌅 Early bird (I wake up before 8am)</Label>
            <Switch id="manual-early" checked={manualEarlyRiser} onCheckedChange={setManualEarlyRiser} />
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-card border border-border p-4">
            <Label htmlFor="manual-smoker">🚬 I smoke</Label>
            <Switch id="manual-smoker" checked={manualSmoker} onCheckedChange={setManualSmoker} />
          </div>
        </div>

        <Button
          size="lg"
          className="w-full rounded-2xl shadow-sims"
          onClick={confirmManual}
          disabled={isLoading}
        >
          {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-4 w-4 mr-2" /> Looks Good — Continue</>}
        </Button>
      </div>
    );
  }

  // ── Render: Interview (+ optional fine-tune) ───────────────────────────────

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={() => setMode(null)} className="text-muted-foreground hover:text-foreground text-sm">← Back</button>
        <h2 className="font-display text-xl">
          {mode === "interview+sliders" ? "AI Interview + Fine-tune" : "AI Personality Interview"}
        </h2>
        {sessionId && (
          <Badge variant="secondary" className="ml-auto text-xs rounded-full">
            {exchangeCount} / 14 turns
          </Badge>
        )}
      </div>

      {/* Chat window */}
      <div className="rounded-2xl border border-border bg-card/50 overflow-hidden flex flex-col" style={{ minHeight: 340 }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 360 }}>
          {messages.length === 0 && isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting interview…
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "assistant"
                  ? "bg-muted text-foreground rounded-tl-none"
                  : "bg-primary text-primary-foreground rounded-tr-none"
              }`}>
                {msg.content}
              </div>
              {msg.role === "user" && (
                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}
          {isLoading && messages.length > 0 && !finalResult && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm pl-9">
              <Loader2 className="h-4 w-4 animate-spin" />
              {isComplete ? "Analyzing your answers… this may take a minute." : "Thinking…"}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        {!isComplete && sessionId && (
          <div className="border-t border-border p-3 flex gap-2">
            <input
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              placeholder="Type your answer…"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              disabled={isLoading}
            />
            <Button size="sm" className="rounded-xl" onClick={sendMessage} disabled={isLoading || !inputText.trim()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
            </Button>
          </div>
        )}
      </div>

      {/* Missing traits progress */}
      {!isComplete && exchangeCount > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {missingTraits.length === 0
            ? "All traits covered — wrapping up soon!"
            : `Still gathering: ${missingTraits.map(t => t.replace(/_/g, " ")).join(", ")}`}
        </div>
      )}

      {/* Results panel */}
      {finalResult && (
        <div className="space-y-4">
          <Card className="p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-violet-500/10 border-primary/20">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-1">Personality profile built ✨</div>
                <p className="text-sm text-muted-foreground">{finalResult.summary}</p>
              </div>
            </div>
          </Card>

          {/* Confidence bars */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inference confidence</p>
            {Object.entries(finalResult.confidence)
              .filter(([k]) => TRAIT_LABELS[k])
              .sort(([, a], [, b]) => b - a)
              .map(([trait, conf]) => (
                <div key={trait} className="flex items-center gap-2">
                  <span className="text-xs w-36 truncate text-muted-foreground">{TRAIT_LABELS[trait] ?? trait}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${conf >= 0.6 ? "bg-primary" : conf >= 0.4 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${Math.round(conf * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs w-8 text-right text-muted-foreground">{Math.round(conf * 100)}%</span>
                </div>
              ))}
          </div>

          {finalResult.lowConfidence.length > 0 && (
            <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 text-xs text-yellow-300 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Low confidence on: <strong>{finalResult.lowConfidence.join(", ")}</strong>.
                {mode === "interview" ? " Switch to Interview + Fine-tune to adjust." : " Adjust the sliders below."}
              </span>
            </div>
          )}

          {/* Fine-tune sliders (interview+sliders mode only) */}
          {mode === "interview+sliders" && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium flex items-center gap-1 list-none mb-3">
                <ChevronRight className="h-4 w-4 group-open:rotate-90 transition-transform" />
                Fine-tune extracted values
              </summary>
              <div className="space-y-4 pl-5">
                {NUMERIC_SLIDER_TRAITS.map(({ key, label, low, high }) => (
                  <div key={key}>
                    <div className="flex justify-between mb-1">
                      <Label className="text-xs">{label}</Label>
                      <span className="text-xs text-muted-foreground">{ftSliders[key] ?? 50}</span>
                    </div>
                    <Slider
                      value={[ftSliders[key] ?? 50]}
                      min={0} max={100} step={1}
                      onValueChange={([v]) => setFtSliders((s) => ({ ...s, [key]: v }))}
                    />
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{low}</span>
                      <span className="text-[10px] text-muted-foreground">{high}</span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-xl bg-card border border-border p-3">
                  <Label htmlFor="ft-early" className="text-xs">🌅 Early bird</Label>
                  <Switch id="ft-early" checked={ftEarlyRiser} onCheckedChange={setFtEarlyRiser} />
                </div>
                <div className="flex items-center justify-between rounded-xl bg-card border border-border p-3">
                  <Label htmlFor="ft-smoker" className="text-xs">🚬 I smoke</Label>
                  <Switch id="ft-smoker" checked={ftSmoker} onCheckedChange={setFtSmoker} />
                </div>
              </div>
            </details>
          )}

          <Button
            size="lg"
            className="w-full rounded-2xl shadow-sims"
            onClick={confirmInterview}
            disabled={isLoading}
          >
            {isLoading
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
              : <><CheckCircle2 className="h-4 w-4 mr-2" /> Looks Good — Continue</>}
          </Button>
        </div>
      )}
    </div>
  );
}
