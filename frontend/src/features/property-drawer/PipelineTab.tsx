/**
 * PipelineTab.tsx — Sequential life-simulation pipeline checklist.
 *
 * Steps:
 *   1. Configure Apartment  → opens apartment configurator overlay
 *   2. Noise Assessment     → calls assessmentApi.noiseAssess()
 *   3. Thermal Assessment   → calls assessmentApi.thermalAssess()
 *   4. Neighbourhood Scan   → calls assessmentApi.neighborhoodProfile()
 *   5. Life Simulation      → opens visual-replay overlay (gated by 1-4)
 */
import { useState } from "react";
import { useApp } from "@/shared/store/useApp";
import { useSimStore } from "@/shared/store/useSimStore";
import { assessmentApi } from "@/services/assessmentApi";
import type { NoiseAssessmentResult, ThermalAssessmentResult, NeighborhoodProfile } from "@/services/assessmentApi";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import {
  Settings2, Volume2, Thermometer, MapPin, Play,
  CheckCircle2, Circle, Loader2, Lock, ChevronDown, ChevronUp, FileText, Sparkles
} from "lucide-react";
import type { PropertyPin, ApartmentConfig } from "@/contracts/types";

interface PipelineTabProps {
  pin: PropertyPin;
  apartment: ApartmentConfig | null | undefined;
}

interface StepState {
  noise: { loading: boolean; result: NoiseAssessmentResult | null };
  thermal: { loading: boolean; result: ThermalAssessmentResult | null };
  neighbourhood: { loading: boolean; result: NeighborhoodProfile | null };
}

function scoreColor(v: number) {
  if (v >= 75) return "text-emerald-400";
  if (v >= 50) return "text-amber-400";
  return "text-red-400";
}

export function PipelineTab({ pin, apartment }: PipelineTabProps) {
  const { openOverlay } = useApp();
  const { setNoiseSources, setNeighbourhoodPois, setShowSimOverlay } = useSimStore();

  const [steps, setSteps] = useState<StepState>({
    noise: { loading: false, result: null },
    thermal: { loading: false, result: null },
    neighbourhood: { loading: false, result: null },
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<"noise" | "thermal" | "neighbourhood" | null>(null);

  const isConfigured = apartment != null || pin.scan === "scanned" || (pin as any).apt_configured === true;

  // ── Assessment handlers ─────────────────────────────────────────────────

  const runNoise = async () => {
    setSteps((s) => ({ ...s, noise: { ...s.noise, loading: true } }));
    try {
      const startTime = Date.now();
      const result = await assessmentApi.noiseAssess({ lat: pin.lat, lon: pin.lng, radius_m: 500, force_refresh: true });
      
      const elapsed = Date.now() - startTime;
      if (elapsed < 1500) await new Promise(r => setTimeout(r, 1500 - elapsed));
      
      setSteps((s) => ({ ...s, noise: { loading: false, result } }));

      // Push geo noise sources to the map store
      if (result.sources) {
        setNoiseSources(result.sources.map((s) => ({
          type: s.type, name: s.type, lat: pin.lat, lon: pin.lng,
          distance_m: s.distance_m, weight: s.weight,
        })));
      }
      toast.success(`Noise: ${result.noise_category} (${Math.round(result.noise_level * 100)}%)`);
    } catch (e: any) {
      toast.error("Noise assessment failed: " + (e?.response?.data?.detail || e.message));
      setSteps((s) => ({ ...s, noise: { loading: false, result: null } }));
    }
  };

  const runThermal = async () => {
    setSteps((s) => ({ ...s, thermal: { ...s.thermal, loading: true } }));
    try {
      const startTime = Date.now();
      const result = await assessmentApi.thermalAssess({
        lat: pin.lat, lon: pin.lng,
        floor_number: apartment?.building?.floor ?? 1,
        orientation: (apartment?.building?.orientation ?? "unknown") as any,
        building_mass: "heavy",
        building_condition: (apartment?.building?.condition ?? "good") as any,
        has_cooling: apartment?.building?.cooling ?? false,
        has_heating: apartment?.building?.heating ?? false,
        has_balcony: false,
        has_windows: apartment?.building?.windows != null,
        force_refresh: true
      });

      const elapsed = Date.now() - startTime;
      if (elapsed < 1500) await new Promise(r => setTimeout(r, 1500 - elapsed));

      setSteps((s) => ({ ...s, thermal: { loading: false, result } }));
      toast.success(`Thermal comfort: ${result.comfort_report.comfort_score}%`);
    } catch (e: any) {
      toast.error("Thermal assessment failed: " + (e?.response?.data?.detail || e.message));
      setSteps((s) => ({ ...s, thermal: { loading: false, result: null } }));
    }
  };

  const runNeighbourhood = async () => {
    setSteps((s) => ({ ...s, neighbourhood: { ...s.neighbourhood, loading: true } }));
    try {
      const startTime = Date.now();
      const noisePayload = steps.noise.result ? { noise_level: steps.noise.result.noise_level } : undefined;
      const result = await assessmentApi.neighborhoodProfile({
        lat: pin.lat, lon: pin.lng, radius_m: 1000,
        noise_assessment: noisePayload,
        force_refresh: true
      });

      const elapsed = Date.now() - startTime;
      if (elapsed < 1500) await new Promise(r => setTimeout(r, 1500 - elapsed));

      setSteps((s) => ({ ...s, neighbourhood: { loading: false, result } }));

      // Push POIs to map store
      if (result.poi_details) {
        const flat = Object.entries(result.poi_details).flatMap(([cat, items]) =>
          (items || []).map((i) => ({
            category: cat, name: i.name, lat: i.lat, lon: i.lon, distance_m: i.distance_m,
          }))
        );
        setNeighbourhoodPois(flat);
      }
      setShowSimOverlay(true);
      toast.success(`Walkability: ${Math.round(result.walkability.overall_score * 100)}%`);
    } catch (e: any) {
      toast.error("Neighbourhood scan failed: " + (e?.response?.data?.detail || e.message));
      setSteps((s) => ({ ...s, neighbourhood: { loading: false, result: null } }));
    }
  };

  // ── Readiness checks ────────────────────────────────────────────────────

  const noiseReady = !!steps.noise.result;
  const thermalReady = !!steps.thermal.result;
  const nbhdReady = !!steps.neighbourhood.result;
  const allReady = isConfigured && noiseReady && thermalReady && nbhdReady;

  // ── Step rendering helper ───────────────────────────────────────────────

  const toggle = (id: string) => setExpanded((e) => (e === id ? null : id));

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-3">
        Complete each step to unlock the Life Simulation. Results feed into the simulation engine.
      </p>

      {/* ── Step 1: Apartment Config ─────────────────────────────────── */}
      <StepCard
        num={1}
        title="Configure Apartment"
        icon={<Settings2 className="h-4 w-4" />}
        done={isConfigured}
        locked={false}
        expanded={expanded === "config"}
        onToggle={() => toggle("config")}
        summary={isConfigured ? "Configured" : "Not configured"}
      >
        {isConfigured ? (
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Floor: {apartment?.building?.floor ?? "?"} · {apartment?.building?.condition ?? "?"}</div>
            <div>Orientation: {apartment?.building?.orientation ?? "unknown"}</div>
            <Button size="sm" variant="outline" className="mt-2 w-full rounded-xl text-xs"
              onClick={() => openOverlay("apt-configurator")}>
              Reconfigure
            </Button>
          </div>
        ) : (
          <Button size="sm" className="w-full rounded-xl text-xs"
            onClick={() => openOverlay("apt-configurator")}>
            <Settings2 className="h-3 w-3 mr-1" /> Open Configurator
          </Button>
        )}
      </StepCard>

      {/* ── Step 2: Noise ────────────────────────────────────────────── */}
      <StepCard
        num={2}
        title="Noise Assessment"
        icon={<Volume2 className="h-4 w-4" />}
        done={noiseReady}
        locked={!isConfigured}
        expanded={expanded === "noise"}
        onToggle={() => toggle("noise")}
        summary={noiseReady ? `${steps.noise.result!.noise_category} · ${Math.round(steps.noise.result!.noise_level * 100)}%` : undefined}
      >
        {noiseReady ? (
          <div className="text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Noise level</span>
              <span className={scoreColor(steps.noise.result!.noise_score)}>{steps.noise.result!.noise_score}/100</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dominant</span>
              <span>{steps.noise.result!.dominant_source ?? "—"}</span>
            </div>
            <p className="text-muted-foreground italic">{steps.noise.result!.assessment_summary}</p>
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline" className="flex-1 rounded-xl text-xs" onClick={runNoise}>
                Re-scan
              </Button>
              <Button size="sm" variant="secondary" className="flex-1 rounded-xl text-xs bg-primary/10 text-primary hover:bg-primary/20" onClick={() => setActiveReport("noise")}>
                <FileText className="h-3 w-3 mr-1" /> Report
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" className="w-full rounded-xl text-xs" disabled={steps.noise.loading || !isConfigured} onClick={runNoise}>
            {steps.noise.loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Volume2 className="h-3 w-3 mr-1" />}
            {steps.noise.loading ? "Scanning…" : "Scan Noise Sources"}
          </Button>
        )}
      </StepCard>

      {/* ── Step 3: Thermal ──────────────────────────────────────────── */}
      <StepCard
        num={3}
        title="Thermal Assessment"
        icon={<Thermometer className="h-4 w-4" />}
        done={thermalReady}
        locked={!noiseReady}
        expanded={expanded === "thermal"}
        onToggle={() => toggle("thermal")}
        summary={thermalReady ? `Comfort ${steps.thermal.result!.comfort_report.comfort_score}%` : undefined}
      >
        {thermalReady ? (
          <div className="text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Comfort score</span>
              <span className={scoreColor(steps.thermal.result!.comfort_report.comfort_score)}>{steps.thermal.result!.comfort_report.comfort_score}/100</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Hottest month</span>
              <span>{steps.thermal.result!.climate_summary.hottest_month} ({steps.thermal.result!.climate_summary.hottest_month_avg}°C)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Coldest month</span>
              <span>{steps.thermal.result!.climate_summary.coldest_month} ({steps.thermal.result!.climate_summary.coldest_month_avg}°C)</span>
            </div>
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline" className="flex-1 rounded-xl text-xs" onClick={runThermal}>
                Re-assess
              </Button>
              <Button size="sm" variant="secondary" className="flex-1 rounded-xl text-xs bg-primary/10 text-primary hover:bg-primary/20" onClick={() => setActiveReport("thermal")}>
                <FileText className="h-3 w-3 mr-1" /> Report
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" className="w-full rounded-xl text-xs" disabled={steps.thermal.loading || !noiseReady} onClick={runThermal}>
            {steps.thermal.loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Thermometer className="h-3 w-3 mr-1" />}
            {steps.thermal.loading ? "Assessing…" : "Run Thermal Assessment"}
          </Button>
        )}
      </StepCard>

      {/* ── Step 4: Neighbourhood ────────────────────────────────────── */}
      <StepCard
        num={4}
        title="Neighbourhood Scan"
        icon={<MapPin className="h-4 w-4" />}
        done={nbhdReady}
        locked={!thermalReady}
        expanded={expanded === "nbhd"}
        onToggle={() => toggle("nbhd")}
        summary={nbhdReady ? `Walkability ${Math.round(steps.neighbourhood.result!.walkability.overall_score * 100)}%` : undefined}
      >
        {nbhdReady ? (
          <div className="text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Walkability</span>
              <span className={scoreColor(steps.neighbourhood.result!.walkability.overall_score * 100)}>
                {Math.round(steps.neighbourhood.result!.walkability.overall_score * 100)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Overall score</span>
              <span className={scoreColor(steps.neighbourhood.result!.overall_neighborhood_score)}>
                {steps.neighbourhood.result!.overall_neighborhood_score}/100
              </span>
            </div>
            <p className="text-muted-foreground italic">{steps.neighbourhood.result!.neighborhood_summary}</p>
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline" className="flex-1 rounded-xl text-xs" onClick={runNeighbourhood}>
                Re-scan
              </Button>
              <Button size="sm" variant="secondary" className="flex-1 rounded-xl text-xs bg-primary/10 text-primary hover:bg-primary/20" onClick={() => setActiveReport("neighbourhood")}>
                <FileText className="h-3 w-3 mr-1" /> Report
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" className="w-full rounded-xl text-xs" disabled={steps.neighbourhood.loading || !thermalReady} onClick={runNeighbourhood}>
            {steps.neighbourhood.loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <MapPin className="h-3 w-3 mr-1" />}
            {steps.neighbourhood.loading ? "Scanning…" : "Scan Neighbourhood"}
          </Button>
        )}
      </StepCard>

      {/* ── Step 5: Life Simulation ──────────────────────────────────── */}
      <StepCard
        num={5}
        title="Life Simulation"
        icon={<Play className="h-4 w-4" />}
        done={false}
        locked={!allReady}
        expanded={expanded === "sim"}
        onToggle={() => toggle("sim")}
        highlight
      >
        <Button
          size="sm"
          className="w-full rounded-xl text-xs"
          disabled={!allReady}
          onClick={() => openOverlay("visual-replay")}
          style={allReady ? {
            background: "linear-gradient(135deg, hsl(var(--primary)), hsl(185 95% 55%))",
            boxShadow: "0 0 20px hsl(var(--primary)/0.4)",
          } : undefined}
        >
          {allReady ? (
            <><Play className="h-3 w-3 mr-1" /> Launch Life Simulation</>
          ) : (
            <><Lock className="h-3 w-3 mr-1" /> Complete steps 1–4 first</>
          )}
        </Button>
      </StepCard>

      {/* ── Report Modals ────────────────────────────────────────────── */}
      <Dialog open={activeReport === "noise"} onOpenChange={(o) => !o && setActiveReport(null)}>
        <DialogContent className="sm:max-w-xl border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold flex items-center gap-2">
              <Volume2 className="h-5 w-5" />
              Noise Assessment Report
            </DialogTitle>
          </DialogHeader>
          {steps.noise.result && (
            <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex items-center justify-between bg-[#1e1e35] p-4 rounded-2xl shadow-sm border border-gray-800">
                <div>
                  <span className="font-medium text-gray-300 block">Overall Noise</span>
                  <span className="text-sm text-[hsl(var(--holo-cyan))] capitalize">{steps.noise.result.noise_category?.replace("_", " ") || "Moderate"}</span>
                </div>
                <span className={`text-3xl font-bold ${scoreColor(steps.noise.result.noise_score)}`}>
                  {steps.noise.result.noise_score}/100
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] bg-[#1e1e35]/50 flex flex-col justify-center">
                  <h4 className="font-semibold text-xs text-gray-400 mb-1">Assessment</h4>
                  <p className="text-lg font-bold text-gray-200 capitalize">
                    {steps.noise.result.noise_category?.replace("_", " ") || "Moderate"}
                  </p>
                </div>
                <div className="p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] bg-[#1e1e35]/50 flex flex-col justify-center">
                  <h4 className="font-semibold text-xs text-gray-400 mb-1">Sources Found</h4>
                  <p className="text-lg font-bold text-gray-200">
                    {steps.noise.result.sources?.reduce((acc, s) => acc + s.count, 0) || 0}
                  </p>
                </div>
              </div>

              <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-3 text-sm">Noise Breakdown</h4>
                {steps.noise.result.sources && steps.noise.result.sources.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {steps.noise.result.sources.map((s, i) => (
                      <div key={i} className="flex justify-between items-center bg-[#060610] p-2 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-300 capitalize">{s.type?.replace("_", " ") || "Source"}</span>
                        <div className="text-right">
                          <span className="text-xs font-semibold text-gray-200 block">{s.count} found</span>
                          <span className="text-[10px] text-gray-500 block">Nearest: {Math.round(s.distance_m)}m</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No significant noise sources detected nearby.</p>
                )}
              </div>

              <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-2 text-sm">Summary</h4>
                <p className="text-gray-300 text-sm leading-relaxed">{steps.noise.result.assessment_summary}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setActiveReport(null)} variant="outline" className="w-full rounded-2xl border-gray-700 hover:bg-gray-800 text-white">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={activeReport === "thermal"} onOpenChange={(o) => !o && setActiveReport(null)}>
        <DialogContent className="sm:max-w-xl border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold flex items-center gap-2">
              <Thermometer className="h-5 w-5" />
              Thermal Analysis Report
            </DialogTitle>
          </DialogHeader>
          {steps.thermal.result && (
            <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
              {/* Top Metrics Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] bg-[#1e1e35]/50 flex flex-col justify-center">
                  <h4 className="font-semibold text-xs text-gray-400 mb-1">Comfort Score</h4>
                  <p className={`text-xl font-bold ${scoreColor(steps.thermal.result.comfort_report.comfort_score)}`}>
                    {steps.thermal.result.comfort_report.comfort_score}/100
                  </p>
                </div>
                <div className="p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] bg-[#1e1e35]/50 flex flex-col justify-center">
                  <h4 className="font-semibold text-xs text-gray-400 mb-1">Comfortable Months</h4>
                  <p className="text-xl font-bold text-gray-200">
                    {steps.thermal.result.comfort_report.months_in_comfort_band}/12
                  </p>
                </div>
                <div className="p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] bg-[#1e1e35]/50 flex flex-col justify-center">
                  <h4 className="font-semibold text-xs text-gray-400 mb-1">Hottest Month</h4>
                  <div className="flex items-baseline gap-1">
                    <p className="text-xl font-bold text-gray-200">{steps.thermal.result.climate_summary.hottest_month?.slice(0, 3)}</p>
                    <span className="text-xs text-red-400 font-medium">{Math.round(steps.thermal.result.climate_summary.hottest_month_avg)}°C</span>
                  </div>
                </div>
                <div className="p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] bg-[#1e1e35]/50 flex flex-col justify-center">
                  <h4 className="font-semibold text-xs text-gray-400 mb-1">Climate Type</h4>
                  <p className="text-sm font-bold text-gray-200 truncate" title={steps.thermal.result.climate_summary.climate_type || "Unknown"}>
                    {steps.thermal.result.climate_summary.climate_type || "Unknown"}
                  </p>
                </div>
              </div>

              {/* Warnings */}
              {(steps.thermal.result.comfort_report.overheating_risk === "high" || steps.thermal.result.comfort_report.undercooling_risk === "high") && (
                <div className="grid grid-cols-2 gap-3">
                  {steps.thermal.result.comfort_report.overheating_risk === "high" && (
                    <div className="p-3 rounded-2xl border border-red-900/30 bg-red-950/20 text-red-400 flex items-center gap-2 text-sm">
                      <span className="text-lg">🌡️</span> Overheating risk detected
                    </div>
                  )}
                  {steps.thermal.result.comfort_report.undercooling_risk === "high" && (
                    <div className="p-3 rounded-2xl border border-blue-900/30 bg-blue-950/20 text-blue-400 flex items-center gap-2 text-sm">
                      <span className="text-lg">❄️</span> Undercooling risk detected
                    </div>
                  )}
                </div>
              )}

              {/* Line Chart */}
              {steps.thermal.result.monthly_estimates && steps.thermal.result.monthly_estimates.length > 0 && (
                <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] h-64">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-4 text-sm">Indoor vs Outdoor Temp (°C)</h4>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={steps.thermal.result.monthly_estimates} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="month_name" tickFormatter={(v) => v.slice(0, 3)} stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} domain={['dataMin - 2', 'dataMax + 2']} />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#060610', borderColor: 'hsl(var(--holo-cyan)/0.3)', borderRadius: '12px', fontSize: '12px' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                      <Line type="monotone" name="Est. Indoor" dataKey="indoor_mean" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" name="Outdoor Avg" dataKey="outdoor_mean" stroke="#888" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Monthly Comfort Grid */}
              {steps.thermal.result.monthly_estimates && steps.thermal.result.monthly_estimates.length > 0 && (
                <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-3 text-sm">Monthly Comfort Status</h4>
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                    {steps.thermal.result.monthly_estimates.map((est, i) => {
                      const isSevereHot = est.overheating_risk === "severe";
                      const isMildHot = est.overheating_risk === "mild";
                      const isCold = est.cold_risk !== "none";
                      const colorClass = isSevereHot ? "text-red-400 border-red-900/30 bg-red-950/20" : isMildHot ? "text-amber-400 border-amber-900/30 bg-amber-950/20" : isCold ? "text-blue-400 border-blue-900/30 bg-blue-950/20" : "text-emerald-400 border-emerald-900/30 bg-emerald-950/20";
                      return (
                        <div key={i} className={`p-2 rounded-xl border text-center ${colorClass}`}>
                          <div className="font-bold text-xs mb-1">{est.month_name?.slice(0, 3)}</div>
                          <div className="text-xs font-medium">{Math.round(est.indoor_mean)}°C In</div>
                          <div className="text-[10px] opacity-70">({Math.round(est.outdoor_mean)}°C Out)</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {steps.thermal.result.recommendations && steps.thermal.result.recommendations.length > 0 && (
                <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4" /> Recommendations
                  </h4>
                  <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                    {steps.thermal.result.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setActiveReport(null)} variant="outline" className="w-full rounded-2xl border-gray-700 hover:bg-gray-800 text-white">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={activeReport === "neighbourhood"} onOpenChange={(o) => !o && setActiveReport(null)}>
        <DialogContent className="sm:max-w-xl border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-[hsl(var(--holo-cyan))] text-xl font-semibold flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Neighbourhood Scan Report
            </DialogTitle>
          </DialogHeader>
          {steps.neighbourhood.result && (
            <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex items-center justify-between bg-[#1e1e35] p-4 rounded-2xl shadow-sm border border-gray-800">
                <div>
                  <span className="font-medium text-gray-300 block">Overall Score</span>
                  <span className="text-sm text-[hsl(var(--holo-cyan))]">{steps.neighbourhood.result.walkability.label || "Neighborhood Scan"}</span>
                </div>
                <span className={`text-3xl font-bold ${scoreColor(steps.neighbourhood.result.overall_neighborhood_score)}`}>
                  {steps.neighbourhood.result.overall_neighborhood_score}/100
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] bg-[#1e1e35]/50 text-center">
                  <h4 className="font-semibold text-xs text-gray-400 mb-1">Walkability</h4>
                  <p className={`text-xl font-bold ${scoreColor(steps.neighbourhood.result.walkability.overall_score * 100)}`}>
                    {Math.round(steps.neighbourhood.result.walkability.overall_score * 100)}%
                  </p>
                </div>
                <div className="p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] bg-[#1e1e35]/50 text-center">
                  <h4 className="font-semibold text-xs text-gray-400 mb-1">Mobility</h4>
                  <p className={`text-xl font-bold ${scoreColor(steps.neighbourhood.result.transport.mobility_score * 100)}`}>
                    {Math.round(steps.neighbourhood.result.transport.mobility_score * 100)}%
                  </p>
                </div>
                <div className="p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)] bg-[#1e1e35]/50 text-center">
                  <h4 className="font-semibold text-xs text-gray-400 mb-1">Emergency</h4>
                  <p className={`text-xl font-bold ${scoreColor(steps.neighbourhood.result.emergency_accessibility.score * 100)}`}>
                    {Math.round(steps.neighbourhood.result.emergency_accessibility.score * 100)}%
                  </p>
                </div>
              </div>

              {/* Assets and Gaps */}
              {(steps.neighbourhood.result.walkability.top_assets?.length || steps.neighbourhood.result.walkability.top_gaps?.length) ? (
                <div className="grid grid-cols-2 gap-3">
                  {steps.neighbourhood.result.walkability.top_assets && steps.neighbourhood.result.walkability.top_assets.length > 0 && (
                    <div className="bg-[#1e1e35]/50 p-3 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                      <h4 className="text-emerald-400 font-semibold mb-2 text-sm flex items-center gap-1">✅ Walking Distance</h4>
                      <ul className="list-disc pl-4 text-xs space-y-1 text-gray-300">
                        {steps.neighbourhood.result.walkability.top_assets.slice(0, 5).map((asset, i) => (
                          <li key={i} className="capitalize">{asset?.replace("_", " ") || "Asset"}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {steps.neighbourhood.result.walkability.top_gaps && steps.neighbourhood.result.walkability.top_gaps.length > 0 && (
                    <div className="bg-[#1e1e35]/50 p-3 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                      <h4 className="text-amber-400 font-semibold mb-2 text-sm flex items-center gap-1">⚠️ Far/Missing</h4>
                      <ul className="list-disc pl-4 text-xs space-y-1 text-gray-300">
                        {steps.neighbourhood.result.walkability.top_gaps.slice(0, 5).map((gap, i) => (
                          <li key={i} className="capitalize">{gap?.replace("_", " ") || "Gap"}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Walk Times */}
              {steps.neighbourhood.result.walk_times && Object.keys(steps.neighbourhood.result.walk_times).length > 0 && (
                <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                  <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-3 text-sm">Estimated Walk Times</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.entries(steps.neighbourhood.result.walk_times).slice(0, 6).map(([key, min]) => (
                      <div key={key} className="flex justify-between items-center bg-[#060610] p-2 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-400 capitalize">{key.replace("_", " ")}</span>
                        <span className="text-xs font-semibold text-gray-200">{Math.round(min)} min</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-2 text-sm">Transport Profile</h4>
                <div className="grid grid-cols-2 gap-4 mb-2">
                  <div className="bg-[#060610] p-3 rounded-xl border border-gray-800">
                    <span className="block text-xs text-gray-400 mb-1">Transit Lines</span>
                    <span className="text-lg font-bold text-gray-200">{steps.neighbourhood.result.transport.total_lines_count || 0}</span>
                  </div>
                  <div className="bg-[#060610] p-3 rounded-xl border border-gray-800">
                    <span className="block text-xs text-gray-400 mb-1">Available Types</span>
                    <span className="text-xs font-semibold text-gray-200 capitalize">
                      {steps.neighbourhood.result.transport.transport_types_available?.join(", ") || "None"}
                    </span>
                  </div>
                </div>
                <ul className="list-disc pl-5 text-sm space-y-1 text-gray-300">
                  <li>Bus Stops: {steps.neighbourhood.result.transport.bus_stops} (Nearest: {steps.neighbourhood.result.transport.nearest_bus_m ?? "N/A"}m)</li>
                  <li>Metro Stations: {steps.neighbourhood.result.transport.metro_stations} (Nearest: {steps.neighbourhood.result.transport.nearest_metro_m ?? "N/A"}m)</li>
                  <li>Tram Stops: {steps.neighbourhood.result.transport.tram_stops}</li>
                </ul>
              </div>
              <div className="bg-[#1e1e35]/50 p-4 rounded-2xl border border-[hsl(var(--holo-cyan)/0.2)]">
                <h4 className="text-[hsl(var(--holo-cyan))] font-semibold mb-2 text-sm">Summary</h4>
                <p className="text-gray-300 text-sm leading-relaxed">{steps.neighbourhood.result.neighborhood_summary}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setActiveReport(null)} variant="outline" className="w-full rounded-2xl border-gray-700 hover:bg-gray-800 text-white">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


// ── Generic step card ─────────────────────────────────────────────────────

interface StepCardProps {
  num: number;
  title: string;
  icon: React.ReactNode;
  done: boolean;
  locked: boolean;
  expanded: boolean;
  onToggle: () => void;
  summary?: string;
  highlight?: boolean;
  children: React.ReactNode;
}

function StepCard({ num, title, icon, done, locked, expanded, onToggle, summary, highlight, children }: StepCardProps) {
  return (
    <div className={`rounded-2xl border transition-all duration-200 ${
      done ? "border-emerald-500/40 bg-emerald-500/5" :
      highlight ? "border-primary/40 bg-primary/5" :
      locked ? "border-border/30 bg-muted/20 opacity-60" :
      "border-border bg-card"
    }`}>
      <button
        className="w-full flex items-center gap-3 p-3 text-left"
        onClick={onToggle}
        disabled={locked}
      >
        {/* Step indicator */}
        <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold shrink-0 ${
          done ? "bg-emerald-500 text-white" : locked ? "bg-muted text-muted-foreground" : "bg-primary/20 text-primary"
        }`}>
          {done ? <CheckCircle2 className="h-4 w-4" /> : num}
        </div>

        {/* Title + icon */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {icon}
            {title}
          </div>
          {summary && <div className="text-xs text-muted-foreground mt-0.5">{summary}</div>}
        </div>

        {/* Chevron */}
        {!locked && (
          expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        {locked && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
      </button>

      {/* Expandable content */}
      {expanded && !locked && (
        <div className="px-3 pb-3 pt-0">
          {children}
        </div>
      )}
    </div>
  );
}
