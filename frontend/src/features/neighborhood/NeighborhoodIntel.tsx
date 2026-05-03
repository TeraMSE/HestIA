/**
 * NeighborhoodIntel.tsx — Full-screen overlay showing complete neighborhood
 * intelligence for a property pin: POIs by category, transport, emergency
 * access, noise, and thermal comfort.
 *
 * Opened via openOverlay("neighborhood-intel") from PropertyDrawer.
 * Reads lat/lon from the currently selected pin.
 */
import { useEffect, useRef, useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApp } from "@/shared/store/useApp";
import { useSimStore } from "@/shared/store/useSimStore";
import { assessmentApi } from "@/services/assessmentApi";
import type {
  NeighborhoodProfile,
  NoiseAssessmentResult,
  ThermalAssessmentResult,
} from "@/services/assessmentApi";
import { toast } from "sonner";
import {
  MapPin, Thermometer, Volume2, Building2, Bus, Heart,
  AlertTriangle, CheckCircle, Loader2, ChevronDown, ChevronUp,
  ShoppingCart, School, Coffee, Dumbbell, Landmark, Bike,
  Hospital, Leaf, Library, Banknote, Map,
} from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  hospital: Hospital,
  clinic: Heart,
  pharmacy: Heart,
  dentist: Heart,
  supermarket: ShoppingCart,
  bakery: ShoppingCart,
  cafe: Coffee,
  restaurant: Coffee,
  fast_food: ShoppingCart,
  bus_stop: Bus,
  metro_station: Bus,
  tram_stop: Bus,
  taxi_stand: Bus,
  school: School,
  university: School,
  library: Library,
  bank: Banknote,
  atm: Banknote,
  post_office: Landmark,
  government: Landmark,
  park: Leaf,
  gym: Dumbbell,
  coworking: Building2,
  place_of_worship: Landmark,
  bar: Coffee,
  nightclub: Coffee,
};

function scoreColor(score: number | null | undefined): string {
  if (score == null || !isFinite(score)) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

function scoreLabel(score: number | null | undefined): string {
  if (score == null || !isFinite(score)) return "Unknown";
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 45) return "Moderate";
  return "Poor";
}

function noiseBadgeColor(cat: string) {
  const map: Record<string, string> = {
    very_quiet: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    quiet: "bg-teal-500/20 text-teal-300 border-teal-500/40",
    moderate: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    noisy: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    very_noisy: "bg-red-500/20 text-red-300 border-red-500/40",
  };
  return map[cat] ?? "bg-muted text-muted-foreground";
}

function formatDist(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function ScoreGauge({ score, label, size = "md" }: { score: number | null | undefined; label: string; size?: "sm" | "md" }) {
  const safeScore = (typeof score === "number" && isFinite(score)) ? score : null;
  const r = size === "sm" ? 28 : 36;
  const circ = 2 * Math.PI * r;
  const filled = safeScore != null ? (safeScore / 100) * circ : 0;
  const svgSize = size === "sm" ? 72 : 90;

  if (safeScore == null) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div style={{ width: svgSize, height: svgSize }} className="flex items-center justify-center">
          <span className="text-2xl font-display text-muted-foreground">—</span>
        </div>
        <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`}>
        <circle cx={svgSize / 2} cy={svgSize / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
        <circle
          cx={svgSize / 2} cy={svgSize / 2} r={r} fill="none"
          stroke={safeScore >= 70 ? "#34d399" : safeScore >= 45 ? "#facc15" : "#f87171"}
          strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${filled} ${circ}`}
          strokeDashoffset={circ / 4}
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
        <text x="50%" y="54%" textAnchor="middle" fill="currentColor" fontSize={size === "sm" ? "14" : "18"} fontWeight="700" className={scoreColor(safeScore)}>
          {Math.round(safeScore)}
        </text>
      </svg>
      <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ── POI Category group ───────────────────────────────────────────────────────

function POIGroup({
  category, items
}: {
  category: string;
  items: Array<{ name: string; distance_m: number; lat: number; lon: number }>;
}) {
  const [open, setOpen] = useState(false);
  const Icon = CATEGORY_ICONS[category] ?? MapPin;
  const nearest = items[0];
  return (
    <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary" />
          <span className="capitalize font-medium">{category.replace(/_/g, " ")}</span>
          <Badge variant="secondary" className="rounded-full text-xs px-1.5 py-0">{items.length}</Badge>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          {nearest && <span className="text-xs">{formatDist(nearest.distance_m)}</span>}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-border divide-y divide-border">
          {items.slice(0, 10).map((poi, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
              <span className="text-muted-foreground truncate max-w-[160px]">
                {poi.name || "(unnamed)"}
              </span>
              <span className="font-mono text-primary">{formatDist(poi.distance_m)}</span>
            </div>
          ))}
          {items.length > 10 && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">
              +{items.length - 10} more not shown
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function NeighborhoodIntel() {
  const { pins, selectedPinId, apartments } = useApp();
  const { setNoiseSources, setNeighbourhoodPois, toggleSimOverlay, showSimOverlay } = useSimStore();
  const pin = pins.find(p => p.id === selectedPinId);
  const apartment = pin?.apartmentId ? apartments.find(a => a.id === pin.apartmentId) : null;

  const [neighborhood, setNeighborhood] = useState<NeighborhoodProfile | null>(null);
  const [noise, setNoise] = useState<NoiseAssessmentResult | null>(null);
  const [thermal, setThermal] = useState<ThermalAssessmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetched = useRef(false);

  useEffect(() => {
    if (!pin || fetched.current) return;
    fetched.current = true;
    setLoading(true);
    setError(null);

    const lat = pin.lat;
    const lon = pin.lng;

    const noiseP = assessmentApi.noiseAssess({ lat, lon, radius_m: 500 }).catch(() => null);
    const neighborhoodP = assessmentApi.neighborhoodProfile({ lat, lon, radius_m: 1000 }).catch(() => null);

    // Thermal only possible when we have building metadata
    let thermalP: Promise<ThermalAssessmentResult | null> = Promise.resolve(null);
    if (apartment) {
      const b = apartment.building;
      const orientMap: Record<string, string> = {
        N: "north", S: "south", E: "east", W: "west",
        NE: "east", NW: "north", SE: "east", SW: "south",
      };
      const condMap: Record<string, string> = {
        new: "new", renovated: "good", old: "fair",
      };
      thermalP = assessmentApi.thermalAssess({
        lat, lon,
        floor_number: b.floor,
        orientation: (orientMap[b.orientation] ?? "unknown") as any,
        building_mass: b.mass as any,
        building_condition: (condMap[b.condition] ?? "good") as any,
        has_cooling: b.cooling,
        has_heating: b.heating,
        has_balcony: apartment.rooms.balconies > 0,
        has_windows: true,
        address: apartment.address || pin.title,
      }).catch(() => null);
    }

    Promise.all([noiseP, neighborhoodP, thermalP])
      .then(([n, nb, th]) => {
        setNoise(n);
        setNeighborhood(nb);
        setThermal(th);
        // Dispatch to sim store for map overlay
        if (n?.geo_sources?.length) setNoiseSources(n.geo_sources as any);
        if (nb?.poi_details) {
          const flat = Object.entries(nb.poi_details).flatMap(([cat, items]) =>
            (items as any[]).filter(i => i.lat && i.lon).map(i => ({ category: cat, name: i.name || cat, lat: i.lat, lon: i.lon, distance_m: i.distance_m }))
          );
          setNeighbourhoodPois(flat);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [pin, apartment]);

  const title = pin ? `${pin.title} — Neighborhood Intel` : "Neighborhood Intel";

  return (
    <OverlayPanel title={title} subtitle="Real-time environment intelligence powered by OpenStreetMap" size="xl">
      {/* Show on map toggle */}
      <div className="flex justify-end mb-2">
        <Button variant={showSimOverlay ? "default" : "outline"} size="sm"
          className="rounded-xl gap-1.5 text-xs"
          onClick={toggleSimOverlay}>
          <Map className="h-3.5 w-3.5" />
          {showSimOverlay ? "Hide from map" : "Show on map"}
        </Button>
      </div>
      {loading && (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Querying OpenStreetMap and climate data…</p>
          <p className="text-xs text-muted-foreground/60">This may take 10–30 seconds</p>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="font-medium">Assessment failed</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
          <Button variant="outline" className="mt-4 rounded-2xl" onClick={() => { fetched.current = false; setError(null); }}>
            Retry
          </Button>
        </div>
      )}

      {!loading && !error && (neighborhood || noise || thermal) && (
        <div className="space-y-6">

          {/* ── Score overview ────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            {noise && (
              <Card className="rounded-2xl p-4 flex flex-col items-center gap-2 bg-gradient-to-b from-card to-card/60">
                <Volume2 className="h-4 w-4 text-primary mb-1" />
                <ScoreGauge score={noise.noise_score} label="Noise Score" />
                <Badge className={`rounded-full text-xs border ${noiseBadgeColor(noise.noise_category ?? "")}`}>
                  {(noise.noise_category ?? "unknown").replace(/_/g, " ")}
                </Badge>
              </Card>
            )}
            {neighborhood && (
              <Card className="rounded-2xl p-4 flex flex-col items-center gap-2 bg-gradient-to-b from-card to-card/60">
                <MapPin className="h-4 w-4 text-primary mb-1" />
                <ScoreGauge score={neighborhood.overall_neighborhood_score} label="Walkability" />
                {typeof neighborhood.overall_neighborhood_score === "number" && isFinite(neighborhood.overall_neighborhood_score) && (
                  <span className={`text-xs font-medium ${scoreColor(neighborhood.overall_neighborhood_score)}`}>
                    {scoreLabel(neighborhood.overall_neighborhood_score)}
                  </span>
                )}
              </Card>
            )}
            {thermal && (
              <Card className="rounded-2xl p-4 flex flex-col items-center gap-2 bg-gradient-to-b from-card to-card/60">
                <Thermometer className="h-4 w-4 text-primary mb-1" />
                <ScoreGauge score={thermal.comfort_report?.comfort_score} label="Thermal Comfort" />
                {thermal.comfort_report?.months_in_comfort_band != null && (
                  <span className="text-xs text-muted-foreground">
                    {thermal.comfort_report.months_in_comfort_band}/12 comfortable months
                  </span>
                )}
              </Card>
            )}
            {!noise && <Card className="rounded-2xl p-4 flex flex-col items-center gap-2 opacity-40"><Volume2 className="h-6 w-6 text-muted-foreground" /><span className="text-xs text-muted-foreground">Noise N/A</span></Card>}
            {!neighborhood && <Card className="rounded-2xl p-4 flex flex-col items-center gap-2 opacity-40"><MapPin className="h-6 w-6 text-muted-foreground" /><span className="text-xs text-muted-foreground">Walkability N/A</span></Card>}
            {!thermal && <Card className="rounded-2xl p-4 flex flex-col items-center gap-2 opacity-40"><Thermometer className="h-6 w-6 text-muted-foreground" /><span className="text-xs text-muted-foreground">Thermal N/A{!apartment ? " (no apt data)" : ""}</span></Card>}
          </div>

          {/* ── Noise detail ─────────────────────────────────────────────── */}
          {noise && (
            <Card className="rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Volume2 className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Noise Assessment</h3>
              </div>
              <p className="text-sm text-muted-foreground">{noise.assessment_summary ?? "No summary available."}</p>
              {(noise.sources ?? []).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Noise sources</p>
                  {(noise.sources ?? []).slice(0, 6).map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm rounded-xl bg-muted/40 px-3 py-1.5">
                      <span className="capitalize">{(s.type ?? "unknown").replace(/_/g, " ")}</span>
                      <div className="flex items-center gap-3 text-muted-foreground text-xs">
                        <span>{s.count ?? 0} nearby</span>
                        <span>{formatDist(s.distance_m)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* ── Transport ────────────────────────────────────────────────── */}
          {neighborhood && (
            <Card className="rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Bus className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Transport & Mobility</h3>
                <Badge variant="secondary" className="rounded-full ml-auto">
                  Score: {Math.round(neighborhood.transport.mobility_score)}
                </Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Bus stops", value: neighborhood.transport.bus_stops },
                  { label: "Metro", value: neighborhood.transport.metro_stations },
                  { label: "Tram", value: neighborhood.transport.tram_stops },
                  { label: "Taxi", value: neighborhood.transport.taxi_stands },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-muted/40 p-3 text-center">
                    <div className="font-display text-xl">{item.value}</div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Nearest bus</span>
                  <div className="font-mono text-primary">{formatDist(neighborhood.transport.nearest_bus_m)}</div>
                </div>
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Nearest metro</span>
                  <div className="font-mono text-primary">{formatDist(neighborhood.transport.nearest_metro_m)}</div>
                </div>
              </div>
              {(neighborhood.transport?.commute_feasibility) && (
                <p className="text-sm text-muted-foreground">{neighborhood.transport.commute_feasibility}</p>
              )}
            </Card>
          )}

          {/* ── Emergency access ─────────────────────────────────────────── */}
          {neighborhood && (
            <Card className="rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Heart className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Emergency Accessibility</h3>
                <Badge
                  variant="secondary"
                  className={`rounded-full ml-auto ${neighborhood.emergency_accessibility.score >= 70 ? "bg-emerald-500/20 text-emerald-300" : neighborhood.emergency_accessibility.score >= 45 ? "bg-yellow-500/20 text-yellow-300" : "bg-red-500/20 text-red-300"}`}
                >
                  {scoreLabel(neighborhood.emergency_accessibility.score)}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Hospital", dist: neighborhood.emergency_accessibility.nearest_hospital_m },
                  { label: "Clinic", dist: neighborhood.emergency_accessibility.nearest_clinic_m },
                  { label: "Pharmacy", dist: neighborhood.emergency_accessibility.nearest_pharmacy_m },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-muted/40 p-3 text-center">
                    <div className={`font-mono text-lg ${item.dist != null && item.dist < 500 ? "text-emerald-400" : item.dist != null && item.dist < 2000 ? "text-yellow-400" : "text-red-400"}`}>
                      {formatDist(item.dist)}
                    </div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>
              {neighborhood.emergency_accessibility?.assessment && (
                <p className="text-sm text-muted-foreground">{neighborhood.emergency_accessibility.assessment}</p>
              )}
            </Card>
          )}

          {/* ── Thermal detail ───────────────────────────────────────────── */}
          {thermal && (
            <Card className="rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Thermometer className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Thermal Comfort Analysis</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Hottest month</span>
                  <div className="font-mono text-orange-400">{thermal.climate_summary.hottest_month} · {thermal.climate_summary.hottest_month_avg.toFixed(1)}°C</div>
                </div>
                <div className="rounded-xl bg-muted/40 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Coldest month</span>
                  <div className="font-mono text-blue-400">{thermal.climate_summary.coldest_month} · {thermal.climate_summary.coldest_month_avg.toFixed(1)}°C</div>
                </div>
              </div>
              {/* Monthly temp chart (simple bars) */}
              {thermal.monthly_indoor_temps && Object.keys(thermal.monthly_indoor_temps).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Indoor temperature by month</p>
                  <div className="flex items-end gap-1 h-16">
                    {Object.entries(thermal.monthly_indoor_temps).map(([month, temp]) => {
                      const pct = Math.max(5, Math.min(100, ((temp - 10) / 30) * 100));
                      const color = temp >= 28 ? "bg-red-400" : temp >= 22 ? "bg-emerald-400" : temp >= 16 ? "bg-yellow-400" : "bg-blue-400";
                      return (
                        <div key={month} className="flex-1 flex flex-col items-center gap-0.5">
                          <div className={`w-full rounded-t-sm ${color} transition-all`} style={{ height: `${pct}%` }} title={`${month}: ${temp.toFixed(1)}°C`} />
                          <span className="text-[9px] text-muted-foreground">{month.slice(0, 1)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>🔵 Cold  🟡 Mild  🟢 Comfort  🔴 Hot</span>
                    <span>18–26°C = comfort zone</span>
                  </div>
                </div>
              )}
              <div className="space-y-1 text-sm">
                {thermal.comfort_report?.overheating_risk && thermal.comfort_report.overheating_risk !== "low" && (
                  <div className="flex items-center gap-2 text-orange-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>Overheating risk: <strong className="capitalize">{thermal.comfort_report.overheating_risk}</strong></span>
                  </div>
                )}
                {thermal.comfort_report?.undercooling_risk && thermal.comfort_report.undercooling_risk !== "low" && (
                  <div className="flex items-center gap-2 text-blue-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>Cold risk: <strong className="capitalize">{thermal.comfort_report.undercooling_risk}</strong></span>
                  </div>
                )}
                {(!thermal.comfort_report?.overheating_risk || thermal.comfort_report.overheating_risk === "low") &&
                 (!thermal.comfort_report?.undercooling_risk || thermal.comfort_report.undercooling_risk === "low") && (
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span>Good year-round comfort expected</span>
                  </div>
                )}
              </div>
              {thermal.recommendations?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recommendations</p>
                  <ul className="space-y-1">
                    {thermal.recommendations.slice(0, 5).map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-primary mt-0.5">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {/* ── All POI categories ───────────────────────────────────────── */}
          {neighborhood && Object.keys(neighborhood.poi_details ?? {}).length > 0 && (
            <Card className="rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Points of Interest — All Categories</h3>
                <Badge variant="secondary" className="rounded-full ml-auto text-xs">
                  {Object.values(neighborhood.poi_details ?? {}).reduce((s, arr) => s + (arr?.length ?? 0), 0)} total
                </Badge>
              </div>
              <div className="space-y-1.5">
                {Object.entries(neighborhood.poi_details ?? {})
                  .filter(([, items]) => (items?.length ?? 0) > 0)
                  .sort((a, b) => {
                    const priority = ["hospital", "clinic", "pharmacy", "supermarket", "bus_stop", "metro_station"];
                    const ai = priority.indexOf(a[0]);
                    const bi = priority.indexOf(b[0]);
                    if (ai >= 0 && bi >= 0) return ai - bi;
                    if (ai >= 0) return -1;
                    if (bi >= 0) return 1;
                    return (b[1]?.length ?? 0) - (a[1]?.length ?? 0);
                  })
                  .map(([cat, items]) => (
                    <POIGroup key={cat} category={cat} items={items ?? []} />
                  ))}
                {Object.values(neighborhood.poi_details ?? {}).every(arr => (arr?.length ?? 0) === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No POIs found in this area.</p>
                )}
              </div>
            </Card>
          )}

          {/* ── Summary ──────────────────────────────────────────────────── */}
          {neighborhood?.neighborhood_summary && (
            <Card className="rounded-2xl p-4 bg-primary/5 border-primary/20">
              <p className="text-sm leading-relaxed">{neighborhood.neighborhood_summary}</p>
            </Card>
          )}
        </div>
      )}

      {!loading && !error && !neighborhood && !noise && !thermal && !pin && (
        <div className="text-center py-16 text-muted-foreground">
          <MapPin className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Select a property pin on the map first.</p>
        </div>
      )}
    </OverlayPanel>
  );
}
