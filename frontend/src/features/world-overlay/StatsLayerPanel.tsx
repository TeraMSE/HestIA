import { BarChart2, TrendingUp } from "lucide-react";

function pinSeed(pinId: string | null): number {
  if (!pinId) return 42;
  let h = 17;
  for (let i = 0; i < pinId.length; i++) h = (h * 31 + pinId.charCodeAt(i)) & 0xffff;
  return h % 100;
}

function scoreColor(score: number) {
  return score >= 75 ? "#4ade80" : score >= 50 ? "#facc15" : "#f87171";
}

interface Props {
  isActive: boolean;
  pinId: string | null;
}

export function StatsLayerPanel({ isActive, pinId }: Props) {
  const f = pinSeed(pinId) / 99;
  const v = (base: number, variance: number) =>
    parseFloat((base + f * variance * 2 - variance).toFixed(1));

  const temp        = v(21.8, 2.5);
  const humidity    = Math.round(v(54, 10));
  const co2         = Math.round(v(410, 45));
  const aqiScore    = Math.round(v(40, 18));
  const estValue    = Math.round(v(265, 55)) * 1000;
  const valueTrend  = v(2.8, 2.0);
  const rentalYield = v(5.2, 1.4);
  const walkability = Math.round(v(74, 14));
  const safety      = Math.round(v(80, 12));
  const transit     = Math.round(v(67, 18));
  const noiseDb     = Math.round(v(37, 10));

  const aqiLabel  = aqiScore < 50 ? "Good"    : aqiScore < 100 ? "Moderate" : "Poor";
  const aqiColor  = aqiScore < 50 ? "#4ade80" : aqiScore < 100 ? "#facc15"  : "#f87171";
  const noiseLabel = noiseDb < 40 ? "Quiet"   : noiseDb < 55   ? "Moderate" : "Loud";
  const noiseColor = noiseDb < 40 ? "#4ade80" : noiseDb < 55   ? "#facc15"  : "#f87171";

  const panelTransition = `transition-all duration-300 ease-out`;
  const stripTransition = `transition-all duration-500 ease-out delay-75`;

  /* ── shared pill wrapper ── */
  const pill = "flex bg-black/35 backdrop-blur-2xl border border-white/[0.06] rounded-[2rem] overflow-hidden divide-x divide-white/[0.06]";

  /* ── each stat cell ── */
  const cell = "flex flex-col items-center justify-center px-7 py-5 gap-0.5";

  return (
    <>
      {/* ── Left panel: Environment only ───────────────────────────── */}
      <div
        className={`absolute left-4 top-1/2 -translate-y-1/2 z-[1010] w-[280px] max-h-[78vh] ${panelTransition} ${
          isActive
            ? "translate-x-0 opacity-100 pointer-events-auto"
            : "-translate-x-[110%] opacity-0 pointer-events-none"
        }`}
      >
        <div className="holo-surface rounded-3xl flex flex-col overflow-hidden max-h-[78vh]">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[hsl(var(--holo-cyan)/0.2)] shrink-0">
            <div className="w-9 h-9 rounded-2xl bg-[hsl(var(--holo-cyan)/0.12)] border border-[hsl(var(--holo-cyan)/0.25)] flex items-center justify-center">
              <BarChart2 className="h-5 w-5 text-[hsl(var(--holo-cyan))]" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-white leading-tight">Environment</h3>
              <p className="text-xs text-white/50">Ambient sensors & air quality</p>
            </div>
          </div>

          {/* Rows */}
          <div className="px-5 py-4 space-y-3">
            {([
              { label: "Temperature", val: `${temp}°C`,    dot: "#f97316" },
              { label: "Humidity",    val: `${humidity}%`, dot: "#38bdf8" },
              { label: "CO₂",        val: `${co2} ppm`,   dot: "#a78bfa" },
            ] as { label: string; val: string; dot: string }[]).map(({ label, val, dot }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[10px] text-white/40">{label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-semibold text-white/80">{val}</span>
                  <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: dot }} />
                </div>
              </div>
            ))}

            {/* AQI footer */}
            <div className="pt-3 border-t border-white/[0.07] flex items-center justify-between">
              <span
                className="text-[9px] font-bold tracking-[0.15em] uppercase"
                style={{ color: aqiColor }}
              >
                Air Quality
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-lg border"
                  style={{ color: aqiColor, borderColor: aqiColor + "40", background: aqiColor + "15" }}
                >
                  {aqiLabel}
                </span>
                <span className="text-[9px] text-white/25 font-mono">AQI {aqiScore}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom center: Property Insights + Location Scores ─────── */}
      <div
        className={`absolute bottom-28 left-1/2 -translate-x-1/2 z-[1010] flex items-end gap-3 pointer-events-none select-none ${stripTransition} ${
          isActive ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
        }`}
      >
        {/* Property Insights pill */}
        <div className={pill}>
          {/* Est. Value */}
          <div className={cell}>
            <div
              className="text-[2.6rem] font-black leading-none tabular-nums text-white"
              style={{ textShadow: "0 0 28px rgba(255,255,255,0.22)" }}
            >
              {(estValue / 1000).toFixed(0)}
              <span className="text-[1.5rem] text-white/35 font-bold ml-0.5">K</span>
            </div>
            <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-white/35 mt-2">
              TND Value
            </div>
            <div className="flex items-center gap-1 mt-1">
              <TrendingUp className="h-2.5 w-2.5 text-emerald-400" />
              <span className="text-[9px] font-mono text-emerald-400">+{valueTrend}% / yr</span>
            </div>
          </div>

          {/* Rental Yield */}
          <div className={cell}>
            <div
              className="text-[2.6rem] font-black leading-none tabular-nums"
              style={{ color: "hsl(185 95% 58%)", textShadow: "0 0 28px hsl(185 95% 58% / 0.45)" }}
            >
              {rentalYield}
              <span className="text-[1.5rem] font-bold ml-0.5" style={{ color: "hsl(185 95% 58% / 0.45)" }}>%</span>
            </div>
            <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-white/35 mt-2">
              Rental Yield
            </div>
            <div className="text-[9px] text-white/20 font-mono mt-1">per year</div>
          </div>

          {/* Energy Class */}
          <div className={cell}>
            <div
              className="text-[2.6rem] font-black leading-none text-emerald-400"
              style={{ textShadow: "0 0 28px rgba(52,211,153,0.45)" }}
            >
              B
            </div>
            <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-white/35 mt-2">
              Energy Class
            </div>
            <div className="text-[9px] text-emerald-400/50 mt-1">Efficient</div>
          </div>
        </div>

        {/* Location Scores pill */}
        <div className={pill}>
          {([
            { label: "Walk",    score: walkability },
            { label: "Safety",  score: safety      },
            { label: "Transit", score: transit      },
          ] as { label: string; score: number }[]).map(({ label, score }) => {
            const col = scoreColor(score);
            return (
              <div key={label} className={cell}>
                <div
                  className="text-[2.6rem] font-black leading-none tabular-nums"
                  style={{ color: col, textShadow: `0 0 28px ${col}60` }}
                >
                  {score}
                </div>
                <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-white/35 mt-2">
                  {label}
                </div>
                <div
                  className="text-[9px] mt-1 font-mono"
                  style={{ color: col + "80" }}
                >
                  /100
                </div>
              </div>
            );
          })}

          {/* Noise */}
          <div className={cell}>
            <div
              className="text-[2.6rem] font-black leading-none tabular-nums"
              style={{ color: noiseColor, textShadow: `0 0 28px ${noiseColor}60` }}
            >
              {noiseDb}
              <span className="text-base font-semibold ml-0.5" style={{ color: noiseColor + "70" }}>dB</span>
            </div>
            <div className="text-[8.5px] font-semibold uppercase tracking-[0.18em] text-white/35 mt-2">
              Noise
            </div>
            <div
              className="text-[9px] mt-1 font-semibold"
              style={{ color: noiseColor }}
            >
              {noiseLabel}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
