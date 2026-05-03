import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Plumbob } from "./Plumbob";

interface Props {
  step: number;
  total: number;
  question: string;
  hint?: string;
  children: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  hideNext?: boolean;
}

export function OnboardingStep({ step, total, question, hint, children, onBack, onNext, nextDisabled, nextLabel = "Next", hideNext }: Props) {
  return (
    <main
      role="main"
      className="min-h-screen w-full bg-gradient-sky flex flex-col items-center justify-between px-6 py-10 animate-fade-in"
    >
      <header className="w-full max-w-3xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Plumbob className="h-9 w-9 animate-plumbob" />
          <span className="font-display text-2xl">HestIA</span>
        </div>
        <div className="flex items-center gap-1.5" aria-label={`Step ${step} of ${total}`}>
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={`h-2.5 rounded-full transition-all ${i < step ? "w-8 bg-primary" : i === step - 1 ? "w-10 bg-primary" : "w-4 bg-muted"}`}
            />
          ))}
        </div>
      </header>

      <section className="w-full max-w-2xl flex flex-col items-center text-center gap-8 my-12">
        <h1 className="font-display text-4xl md:text-5xl text-foreground leading-tight">{question}</h1>
        {hint && <p className="text-muted-foreground text-lg">{hint}</p>}
        <div className="w-full">{children}</div>
      </section>

      <footer className="w-full max-w-2xl flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={onBack} disabled={!onBack} className="rounded-full">
          ← Back
        </Button>
        {!hideNext && (
          <Button onClick={onNext} disabled={nextDisabled} size="lg" className="rounded-full px-10 shadow-sims">
            {nextLabel} →
          </Button>
        )}
      </footer>
    </main>
  );
}
