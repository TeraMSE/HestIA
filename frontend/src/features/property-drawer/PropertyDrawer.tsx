import { useMemo, useRef, useState, useEffect } from "react";
import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { X, Box, Users, Calculator, FileText, Home as HomeIcon, BarChart2, Loader2, Volume2, MapPin, Thermometer, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { assessmentApi } from "@/services/assessmentApi";
import type { NoiseAssessmentResult, NeighborhoodProfile, ThermalAssessmentResult } from "@/services/assessmentApi";

function scoreColor(score: number) {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

function scoreLabel(score: number) {
  if (score >= 80) return "Excellent";
  if (score >= 65) return "Good";
  if (score >= 45) return "Moderate";
  return "Poor";
}

function noiseCatLabel(cat: string) {
  return cat?.replace(/_/g, " ") ?? "—";
}

function formatDist(m: number | null | undefined) {
  if (m == null) return "—";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function MiniScore({ label, score, icon: Icon }: { label: string; score: number | undefined; icon: React.ElementType }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-3 flex items-center gap-3">
      <Icon className="h-4 w-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        {score != null ? (
          <div className={`font-display text-lg leading-none ${scoreColor(score)}`}>{Math.round(score)} <span className="text-xs font-normal text-muted-foreground">/ 100</span></div>
        ) : (
          <div className="text-sm text-muted-foreground">—</div>
        )}
      </div>
      {score != null && <span className="text-xs font-medium text-muted-foreground">{scoreLabel(score)}</span>}
    </div>
  );
}

export function PropertyDrawer() {
  const { pins, selectedPinId, setSelectedPinId, apartments, setSelectedApartment, openOverlay } = useApp();
  const { user } = useAuthStore();
  const pin = useMemo(() => pins.find((p) => p.id === selectedPinId), [pins, selectedPinId]);
  if (!pin) return null;

  const apartment = pin.apartmentId ? apartments.find((a) => a.id === pin.apartmentId) : null;
  const close = () => setSelectedPinId(null);

  const startCompatibility = () => {
    if (apartment) setSelectedApartment(apartment.id);
    openOverlay("simulation-runner");
  };

  return (
    <aside
      role="complementary"
      aria-label={`Details for ${pin.title}`}
      className="absolute top-4 right-4 bottom-4 z-[700] w-full sm:w-[440px] rounded-3xl animate-slide-in-right flex flex-col overflow-hidden holo-surface"
    >
      <header className="relative z-10 p-5 border-b border-[hsl(var(--holo-cyan)/0.4)] flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={pin.scan === "scanned" ? "default" : "secondary"} className="rounded-full">
              {pin.scan === "scanned" ? "3D scanned" : "Not scanned"}
            </Badge>
            {pin.kind === "user_pin" && <Badge variant="outline" className="rounded-full">Your pin</Badge>}
          </div>
          <h2 className="font-display text-2xl leading-tight holo-text-glow">{pin.title}</h2>
          {pin.subtitle && <p className="text-sm text-muted-foreground">{pin.subtitle}</p>}
          {pin.priceTND && (
            <p className="mt-2 font-semibold">
              {pin.priceTND.toLocaleString()} TND{pin.forRent ? " / month" : ""}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={close} aria-label="Close" className="rounded-full hover:bg-[hsl(var(--holo-cyan)/0.2)]">
          <X className="h-5 w-5" />
        </Button>
      </header>

      <div className="relative z-10 flex-1 flex flex-col min-h-0">
      <Tabs defaultValue="overview" className="flex-1 flex flex-col">
        {/* 6 tabs — scroll on small screens */}
        <TabsList className="m-3 grid grid-cols-6 rounded-2xl">
          <TabsTrigger value="overview"><HomeIcon className="h-4 w-4" /></TabsTrigger>
          <TabsTrigger value="3d"><Box className="h-4 w-4" /></TabsTrigger>
          <TabsTrigger value="intel"><BarChart2 className="h-4 w-4" /></TabsTrigger>
          <TabsTrigger value="compat"><Users className="h-4 w-4" /></TabsTrigger>
          <TabsTrigger value="materials"><Calculator className="h-4 w-4" /></TabsTrigger>
          <TabsTrigger value="admin"><FileText className="h-4 w-4" /></TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {/* ── Overview ──────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-3 mt-0">
            <div className="rounded-2xl bg-muted p-4">
              <div className="text-xs text-muted-foreground">Location</div>
              <div className="font-mono text-sm">{pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}</div>
            </div>
            {apartment && (
              <div className="rounded-2xl bg-muted p-4 space-y-1 text-sm">
                <div className="font-medium mb-2">Apartment details</div>
                <div>Bedrooms: {apartment.rooms.bedrooms} · Bathrooms: {apartment.rooms.bathrooms}</div>
                <div>Floor: {apartment.building.floor} · {apartment.building.condition}</div>
                <div>Orientation: {apartment.building.orientation}</div>
                <div>Windows: {apartment.building.windows} · {apartment.building.cooling ? "AC" : "no AC"}</div>
              </div>
            )}
            {user?.role === "renter" || user?.role === "buyer" ? (
              <Button className="w-full rounded-2xl" onClick={() => toast.success("Visit request sent (mock)")}>Request a visit</Button>
            ) : (
              <Button className="w-full rounded-2xl" onClick={() => toast.success("Listing edit (mock)")}>Edit listing</Button>
            )}
          </TabsContent>

          {/* ── 3D ────────────────────────────────────────────────────────── */}
          <TabsContent value="3d" className="mt-0">
            <div className="rounded-3xl bg-gradient-sky border border-border p-6 text-center">
              <Box className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-display text-xl mb-1">3D Room World</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {pin.scan === "scanned"
                  ? "Explore this property in an immersive 3D environment with AI agents."
                  : "Upload a panorama to generate a 3D world for this property."}
              </p>
              <div className="flex flex-col gap-2">
                <Button
                  className="rounded-2xl shadow-sims"
                  onClick={() => openOverlay("visual-replay")}
                >
                  {pin.scan === "scanned" ? "🌍 Enter 3D World" : "📷 Upload & Generate 3D"}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ── Intel (new!) ──────────────────────────────────────────────── */}
          <TabsContent value="intel" className="mt-0">
            <IntelTab pin={pin} apartment={apartment} onOpenFull={() => openOverlay("neighborhood-intel")} />
          </TabsContent>

          {/* ── Compat ────────────────────────────────────────────────────── */}
          <TabsContent value="compat" className="mt-0 space-y-3">
            <p className="text-sm text-muted-foreground">Run a HestIA compatibility simulation between two personas in this apartment.</p>
            <Button className="w-full rounded-2xl" onClick={startCompatibility}>Open Simulation Runner</Button>
          </TabsContent>

          {/* ── Materials ─────────────────────────────────────────────────── */}
          <TabsContent value="materials" className="mt-0 space-y-3">
            <p className="text-sm text-muted-foreground">Estimate construction materials for a property like this one.</p>
            <Button className="w-full rounded-2xl" onClick={() => openOverlay("material-agent")}>Open Material Agent</Button>
          </TabsContent>

          {/* ── Admin ─────────────────────────────────────────────────────── */}
          <TabsContent value="admin" className="mt-0 space-y-3">
            <p className="text-sm text-muted-foreground">Get step-by-step guidance on Tunisian renting, buying, or listing.</p>
            <Button className="w-full rounded-2xl" onClick={() => openOverlay("admin-assistant")}>Ask the Admin Assistant</Button>
          </TabsContent>
        </div>
      </Tabs>
      </div>
    </aside>
  );
}

// ── Intel tab content (lazy-loaded) ─────────────────────────────────────────

interface IntelTabProps {
  pin: { lat: number; lng: number; title: string; apartmentId?: string };
  apartment: any | null;
  onOpenFull: () => void;
}

function IntelTab({ pin, apartment, onOpenFull }: IntelTabProps) {
  const [noise, setNoise] = useState<NoiseAssessmentResult | null>(null);
  const [neighborhood, setNeighborhood] = useState<NeighborhoodProfile | null>(null);
  const [thermal, setThermal] = useState<ThermalAssessmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const fetchAll = async () => {
    if (fetched) return;
    setLoading(true);
    setFetched(true);
    try {
      const lat = pin.lat;
      const lon = pin.lng;

      const [n, nb] = await Promise.allSettled([
        assessmentApi.noiseAssess({ lat, lon, radius_m: 500 }),
        assessmentApi.neighborhoodProfile({ lat, lon, radius_m: 1000 }),
      ]);

      if (n.status === "fulfilled") setNoise(n.value);
      if (nb.status === "fulfilled") setNeighborhood(nb.value);

      if (apartment) {
        const b = apartment.building;
        const orientMap: Record<string, string> = { N: "north", S: "south", E: "east", W: "west", NE: "east", NW: "north", SE: "east", SW: "south" };
        const condMap: Record<string, string> = { new: "new", renovated: "good", old: "fair" };
        try {
          const th = await assessmentApi.thermalAssess({
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
          });
          setThermal(th);
        } catch { /* thermal optional */ }
      }
    } catch (err: any) {
      toast.error(`Intel failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on mount
  useEffect(() => { fetchAll(); }, []); // eslint-disable-line

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading environment intelligence…</p>
      </div>
    );
  }

  const noScore = !noise && !neighborhood && !thermal;

  return (
    <div className="space-y-3">
      {noScore ? (
        <div className="rounded-2xl bg-muted p-5 text-center text-sm text-muted-foreground space-y-3">
          <p>No intelligence data loaded yet.</p>
          <Button variant="outline" className="rounded-2xl" onClick={() => { setFetched(false); fetchAll(); }}>
            Run assessment
          </Button>
        </div>
      ) : (
        <>
          <MiniScore label="Noise score" score={noise?.noise_score} icon={Volume2} />
          <MiniScore label="Walkability" score={neighborhood?.overall_neighborhood_score} icon={MapPin} />
          <MiniScore label="Thermal comfort" score={thermal?.comfort_report.comfort_score} icon={Thermometer} />

          {noise && (
            <div className="rounded-2xl bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Noise category: </span>
              <span className="font-medium capitalize">{noiseCatLabel(noise.noise_category ?? "unknown")}</span>
              {noise.dominant_source && <span className="text-muted-foreground"> · dominant: {noise.dominant_source.replace(/_/g, " ")}</span>}
            </div>
          )}

          {neighborhood && (
            <div className="rounded-2xl bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Nearest hospital: </span>
              <span className="font-medium">{formatDist(neighborhood.emergency_accessibility.nearest_hospital_m)}</span>
              <span className="text-muted-foreground"> · Nearest bus: </span>
              <span className="font-medium">{formatDist(neighborhood.transport.nearest_bus_m)}</span>
            </div>
          )}

          {thermal && (
            <div className="rounded-2xl bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{thermal.comfort_report.months_in_comfort_band}/12 comfortable months</span>
              {thermal.comfort_report.overheating_risk !== "low" && (
                <span className="ml-2 text-orange-400">⚠ Overheating risk: {thermal.comfort_report.overheating_risk}</span>
              )}
            </div>
          )}

          <Button variant="outline" className="w-full rounded-2xl flex items-center gap-2" onClick={onOpenFull}>
            <BarChart2 className="h-4 w-4" />
            View Full Neighborhood Report
            <ChevronRight className="h-4 w-4 ml-auto" />
          </Button>
        </>
      )}
    </div>
  );
}
