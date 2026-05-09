import { Microscope, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface MoldSpot {
  area: string;
  severity: "low" | "medium" | "high";
  coverage: number;
  note: string;
}

const MOCK_MOLD_FINDINGS: MoldSpot[] = [
  { area: "Bathroom ceiling (NE corner)", severity: "high",   coverage: 34, note: "Condensation hotspot — poor ventilation" },
  { area: "Behind refrigerator (north wall)", severity: "high", coverage: 28, note: "Cold wall + humidity gradient" },
  { area: "Window frame (front wall)",  severity: "medium", coverage: 14, note: "Condensation on cold glass edge" },
  { area: "Living area ceiling (center)", severity: "medium", coverage: 9,  note: "Roof leak suspected, monitoring" },
  { area: "Wardrobe interior (south wall)", severity: "low", coverage: 4, note: "Low airflow — occasional spores" },
];

const SEVERITY_STYLE = {
  low:    { badge: "bg-lime-950/40 border-lime-500/40 text-lime-300",    dot: "bg-lime-400",    icon: CheckCircle2,   label: "Low" },
  medium: { badge: "bg-amber-950/40 border-amber-500/40 text-amber-300", dot: "bg-amber-400",   icon: AlertTriangle,  label: "Medium" },
  high:   { badge: "bg-red-950/40 border-red-500/40 text-red-300",       dot: "bg-red-500",     icon: XCircle,        label: "High" },
};

interface Props {
  isActive: boolean;
}

export function MoldLayerPanel({ isActive }: Props) {
  const highCount   = MOCK_MOLD_FINDINGS.filter(f => f.severity === "high").length;
  const mediumCount = MOCK_MOLD_FINDINGS.filter(f => f.severity === "medium").length;
  const lowCount    = MOCK_MOLD_FINDINGS.filter(f => f.severity === "low").length;

  return (
    <div
      className={`absolute left-4 top-1/2 -translate-y-1/2 z-[1010] w-[300px] max-h-[78vh] transition-all duration-300 ease-out ${
        isActive ? "translate-x-0 opacity-100 pointer-events-auto" : "-translate-x-[110%] opacity-0 pointer-events-none"
      }`}
    >
      <div className="holo-surface rounded-3xl flex flex-col overflow-hidden max-h-[78vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[hsl(var(--holo-cyan)/0.2)] shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-red-500/10 border border-red-500/25 flex items-center justify-center">
            <Microscope className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-white leading-tight">Mold Detection</h3>
            <p className="text-xs text-white/55">AI-assisted visual scan (mock)</p>
          </div>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-3 gap-2 px-5 pt-4 pb-2 shrink-0">
          {[
            { label: "High",   count: highCount,   style: "border-red-500/40 bg-red-950/30 text-red-300" },
            { label: "Medium", count: mediumCount, style: "border-amber-500/40 bg-amber-950/30 text-amber-300" },
            { label: "Low",    count: lowCount,    style: "border-lime-500/40 bg-lime-950/30 text-lime-300" },
          ].map(({ label, count, style }) => (
            <div key={label} className={`rounded-xl border px-2 py-2 text-center ${style}`}>
              <div className="text-xl font-bold">{count}</div>
              <div className="text-[10px] font-medium uppercase tracking-wide opacity-80">{label}</div>
            </div>
          ))}
        </div>

        {/* Findings list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {MOCK_MOLD_FINDINGS.map((f, i) => {
            const sty = SEVERITY_STYLE[f.severity];
            const Icon = sty.icon;
            return (
              <div key={i} className="rounded-2xl bg-black/20 border border-white/8 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${sty.dot}`} />
                  <span className="text-xs font-semibold text-white leading-tight flex-1">{f.area}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg border ${sty.badge} shrink-0`}>
                    {f.severity === "high" ? "🔴" : f.severity === "medium" ? "🟡" : "🟢"} {sty.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-1">
                  <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${f.severity === "high" ? "bg-red-500" : f.severity === "medium" ? "bg-amber-400" : "bg-lime-400"}`}
                      style={{ width: `${f.coverage}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-white/50 w-8 text-right">{f.coverage}%</span>
                </div>
                <p className="text-[10px] text-white/45 italic px-1">{f.note}</p>
              </div>
            );
          })}
        </div>

        {/* Disclaimer */}
        <div className="px-5 py-3 border-t border-white/8 shrink-0">
          <p className="text-[10px] text-white/30 text-center">
            ⚠ Simulated scan — consult a professional for real assessment
          </p>
        </div>
      </div>
    </div>
  );
}

export { MOCK_MOLD_FINDINGS };
