import { useEffect, useRef, useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { useApp } from "@/shared/store/useApp";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, SkipForward, RotateCcw, Box } from "lucide-react";

export function VisualReplay() {
  const { frameSequence, currentFrame, setCurrentFrame, playing, setPlaying, speed, setSpeed, replayMode, setReplayMode } = useApp();
  const [showSummary, setShowSummary] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!frameSequence || !playing) return;
    const id = window.setInterval(() => {
      const next = currentFrame + 1;
      if (next >= frameSequence.frames.length) {
        setPlaying(false);
        setShowSummary(true);
        return;
      }
      setCurrentFrame(next);
    }, 600 / speed);
    intervalRef.current = id;
    return () => { window.clearInterval(id); };
  }, [playing, currentFrame, frameSequence, speed, setCurrentFrame, setPlaying]);

  if (!frameSequence) {
    return (
      <OverlayPanel title="Visual Replay" subtitle="Run a simulation first" size="lg">
        <p className="text-muted-foreground">No simulation has been run yet. Open the Simulation Runner to generate a replay.</p>
      </OverlayPanel>
    );
  }

  const frame = frameSequence.frames[currentFrame];
  const summary = frameSequence.simulation_summary;
  const restart = () => { setCurrentFrame(0); setPlaying(false); setShowSummary(false); };
  const step = () => setCurrentFrame(Math.min(currentFrame + 1, frameSequence.frames.length - 1));
  const onScrub = (v: number[]) => { setPlaying(false); setCurrentFrame(v[0]); };

  return (
    <OverlayPanel title="Visual Replay" subtitle={`${frameSequence.apartment.label} · ${frameSequence.personas.map((p) => p.name).join(" & ")}`} size="xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Badge className="rounded-full">tick {frame.tick}</Badge>
          <span className="font-display text-lg">{frame.timeLabel}</span>
        </div>
        <div className="inline-flex rounded-full bg-muted p-1">
          <button onClick={() => setReplayMode("2d")} className={`px-3 py-1 text-sm rounded-full ${replayMode === "2d" ? "bg-card shadow-soft" : "text-muted-foreground"}`}>2D</button>
          <button onClick={() => setReplayMode("3d")} className={`px-3 py-1 text-sm rounded-full ${replayMode === "3d" ? "bg-card shadow-soft" : "text-muted-foreground"}`}>3D</button>
        </div>
      </div>

      {/* Viewport */}
      <Card className="relative rounded-3xl overflow-hidden h-72 bg-gradient-sky border border-border">
        {replayMode === "2d" ? (
          <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-foreground/20 bg-card/40">
            {frame.personas.map((p) => {
              const persona = frameSequence.personas.find((x) => x.id === p.personaId);
              return (
                <div key={p.personaId} className="absolute transition-all duration-300 ease-out" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(-50%, -50%)" }}>
                  <div className="relative">
                    <div className="h-9 w-9 rounded-full grid place-items-center font-display text-sm border-2 border-white shadow-sims" style={{ background: persona?.avatarColor }}>{persona?.name.charAt(0)}</div>
                    {p.speech && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full max-w-[160px] text-xs bg-card rounded-2xl px-3 py-1.5 shadow-sims border border-border">{p.speech}</div>
                    )}
                  </div>
                </div>
              );
            })}
            {frame.events.some((e) => e.type === "conflict") && (
              <div className="absolute inset-0 ring-4 ring-destructive/40 rounded-2xl pointer-events-none animate-pulse" />
            )}
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-center p-6">
            <div>
              <Box className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <div className="font-display text-xl">3D mode coming soon</div>
              <div className="text-sm text-muted-foreground">Playback state is preserved.</div>
            </div>
          </div>
        )}
      </Card>

      {/* Timeline */}
      <div className="mt-4">
        <Slider value={[currentFrame]} min={0} max={frameSequence.frames.length - 1} step={1} onValueChange={onScrub} aria-label="Timeline" />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>0</span><span>{frameSequence.frames.length - 1}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <div className="flex gap-2">
          <Button variant="outline" size="icon" className="rounded-full" onClick={restart} aria-label="Restart"><RotateCcw className="h-4 w-4" /></Button>
          <Button size="icon" className="rounded-full" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
          <Button variant="outline" size="icon" className="rounded-full" onClick={step} aria-label="Step"><SkipForward className="h-4 w-4" /></Button>
        </div>
        <div className="inline-flex rounded-full bg-muted p-1">
          {([0.5, 1, 2, 4] as const).map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={`px-3 py-1 text-sm rounded-full ${speed === s ? "bg-card shadow-soft" : "text-muted-foreground"}`}>{s}×</button>
          ))}
        </div>
      </div>

      {/* Event drawer */}
      <Card className="mt-4 rounded-2xl p-3">
        <div className="font-medium mb-2">Events at tick {frame.tick}</div>
        {frame.events.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nothing notable.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {frame.events.map((e, i) => (
              <li key={i} className="flex items-start gap-2">
                <Badge variant={e.type === "conflict" ? "destructive" : e.type === "positive" ? "default" : "secondary"} className="rounded-full">{e.type}</Badge>
                <span>{e.description}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {showSummary && (
        <div className="fixed inset-0 z-[1100] grid place-items-center bg-foreground/40 backdrop-blur-sm" onClick={() => setShowSummary(false)}>
          <Card className="rounded-3xl p-6 max-w-md w-full mx-4 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-2xl mb-2">End of run</div>
            <div className="grid grid-cols-2 gap-2 my-4">
              <div className="rounded-2xl bg-secondary/50 p-3"><div className="text-xs text-muted-foreground">Grade</div><div className="font-display text-3xl">{summary.grade}</div></div>
              <div className="rounded-2xl bg-primary/15 p-3"><div className="text-xs text-muted-foreground">Score</div><div className="font-display text-3xl">{summary.overallScore}</div></div>
            </div>
            <Button onClick={() => setShowSummary(false)} className="rounded-2xl w-full">Close</Button>
          </Card>
        </div>
      )}
    </OverlayPanel>
  );
}
