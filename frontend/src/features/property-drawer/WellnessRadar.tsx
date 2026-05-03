import { useEffect, useState } from "react";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import api from "@/services/api";
import { useApp } from "@/shared/store/useApp";

interface PillarData {
  score: number | null;
  source: string | null;
  stale: boolean;
  ts: string | null;
}

interface WellnessPayload {
  property_id: number;
  wellness_score: number;
  grade: string;
  pillars: Record<string, PillarData>;
  weights: Record<string, number>;
  missing: string[];
}

const PILLAR_LABELS: Record<string, string> = {
  noise: "Noise",
  neighborhood: "Neighborhood",
  thermal: "Thermal",
  materiaux: "Build Quality",
  appliances: "Appliances",
  compatibility: "Compatibility",
};

const OVERLAY_FOR_PILLAR: Record<string, string> = {
  noise: "neighborhood-intel",
  neighborhood: "neighborhood-intel",
  thermal: "neighborhood-intel",
  materiaux: "material-agent",
  appliances: "appliance-energy",
  compatibility: "simulation-runner",
};

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-green-400",
  C: "text-yellow-400",
  D: "text-orange-400",
  F: "text-red-400",
};

interface Props {
  propertyId: number;
}

export function WellnessRadar({ propertyId }: Props) {
  const { openOverlay } = useApp();
  const [data, setData] = useState<WellnessPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    api
      .get(`/social-sim/wellness/${propertyId}/`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e.response?.data?.detail ?? e.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  if (loading) {
    return (
      <div className="rounded-2xl bg-muted/50 p-4 flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading Wellness Score…</span>
      </div>
    );
  }

  if (error || !data) {
    return null; // fail silently — wellness is a bonus, not required
  }

  const chartData = Object.entries(data.pillars).map(([key, val]) => ({
    subject: PILLAR_LABELS[key] ?? key,
    score: val.score ?? 0,
    fullMark: 100,
    key,
  }));

  const gradeStyle = GRADE_COLORS[data.grade] ?? "text-muted-foreground";

  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Property Wellness</div>
          <div className={`font-display text-3xl leading-none ${gradeStyle}`}>
            {data.wellness_score}{" "}
            <span className="text-base font-normal text-muted-foreground">/ 100</span>
          </div>
        </div>
        <div className={`rounded-2xl px-3 py-1.5 text-sm font-bold border ${gradeStyle} border-current`}>
          {data.grade}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <RadarChart data={chartData}>
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
            formatter={(v: number) => [`${v}/100`]}
          />
          <Radar
            name="Score"
            dataKey="score"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.25}
          />
        </RadarChart>
      </ResponsiveContainer>

      {data.missing.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Missing assessments:</div>
          <div className="flex flex-wrap gap-1.5">
            {data.missing.map((key) => (
              <Button
                key={key}
                variant="outline"
                size="sm"
                className="h-6 rounded-full text-xs px-2"
                onClick={() => openOverlay(OVERLAY_FOR_PILLAR[key] as any)}
              >
                Run {PILLAR_LABELS[key] ?? key}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Stale indicators */}
      {Object.entries(data.pillars).some(([, v]) => v.stale && v.source) && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(data.pillars)
            .filter(([, v]) => v.stale && v.source)
            .map(([key]) => (
              <Badge key={key} variant="outline" className="text-[10px] rounded-full opacity-60">
                {PILLAR_LABELS[key]} stale
              </Badge>
            ))}
        </div>
      )}
    </div>
  );
}
