import { useEffect, useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/shared/store/useApp";
import { apartmentService } from "@/services/mockApi";
import { assessmentApi } from "@/services/assessmentApi";
import { toast } from "sonner";
import { Loader2, Volume2, MapPin, Thermometer, ChevronRight } from "lucide-react";
import type { ApartmentConfig, Orientation } from "@/contracts/types";

const blank = (): Omit<ApartmentConfig, "id" | "updatedAt"> => ({
  label: "New apartment",
  address: "",
  lat: 36.8065, lng: 10.1815,
  rooms: { bedrooms: 1, bathrooms: 1, livingRooms: 1, kitchens: 1, balconies: 0 },
  building: { floor: 1, condition: "renovated", mass: "medium", orientation: "S", elevator: false, heating: false, cooling: true, windows: "double" },
  utilities: { internet: true, water: true, electricity: true, gas: false },
});

function ScorePill({ label, score, icon: Icon, loading }: { label: string; score?: number; icon: React.ElementType; loading?: boolean }) {
  return (
    <Card className="rounded-2xl p-2 text-center bg-secondary/40 relative overflow-hidden">
      <Icon className="h-3 w-3 mx-auto text-muted-foreground mb-1" />
      <div className="text-xs text-muted-foreground">{label}</div>
      {loading ? (
        <Loader2 className="h-5 w-5 mx-auto animate-spin text-primary mt-1" />
      ) : (
        <div className={`font-display text-xl ${score != null ? (score >= 70 ? "text-emerald-400" : score >= 45 ? "text-yellow-400" : "text-red-400") : ""}`}>
          {score ?? "—"}
        </div>
      )}
    </Card>
  );
}

export function ApartmentConfigurator() {
  const { apartments, setApartments, pins, selectedPinId } = useApp();
  const pin = pins.find((p) => p.id === selectedPinId);
  const [draft, setDraft] = useState<Omit<ApartmentConfig, "id" | "updatedAt"> & { id?: string }>(() => {
    const base = blank();
    if (pin) { base.label = pin.title; base.address = pin.subtitle ?? ""; base.lat = pin.lat; base.lng = pin.lng; }
    return base;
  });

  const [checkingNoise, setCheckingNoise] = useState(false);
  const [checkingNeighborhood, setCheckingNeighborhood] = useState(false);
  const [checkingThermal, setCheckingThermal] = useState(false);

  const upd = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const updRooms = (k: keyof ApartmentConfig["rooms"], v: number) => upd({ rooms: { ...draft.rooms, [k]: Math.max(0, v) } });
  const updBuilding = (patch: Partial<ApartmentConfig["building"]>) => upd({ building: { ...draft.building, ...patch } });
  const updUtil = (k: keyof ApartmentConfig["utilities"], v: boolean) => upd({ utilities: { ...draft.utilities, [k]: v } });

  const save = async () => {
    const saved = await apartmentService.save(draft);
    setApartments(await apartmentService.list());
    upd({ id: saved.id });
    toast.success("Apartment saved");
  };

  const orientMap: Record<string, string> = { N: "north", S: "south", E: "east", W: "west", NE: "east", NW: "north", SE: "east", SW: "south" };
  const condMap: Record<string, string> = { new: "new", renovated: "good", old: "fair" };

  const runNoise = async () => {
    setCheckingNoise(true);
    try {
      const result = await assessmentApi.noiseAssess({ lat: draft.lat, lon: draft.lng, radius_m: 500 });
      upd({
        noiseScore: Math.round(result.noise_score),
        noiseAssessment: result,
      });
      toast.success(`Noise: ${result.noise_category.replace(/_/g, " ")} (${Math.round(result.noise_score)}/100)`);
    } catch (err: any) {
      toast.error(`Noise check failed: ${err.message}`);
    } finally {
      setCheckingNoise(false);
    }
  };

  const runNeighborhood = async () => {
    setCheckingNeighborhood(true);
    try {
      const result = await assessmentApi.neighborhoodProfile({ lat: draft.lat, lon: draft.lng, radius_m: 1000 });
      upd({
        neighborhoodScore: Math.round(result.overall_neighborhood_score),
        neighborhoodProfile: result,
      });
      toast.success(`Walkability: ${Math.round(result.overall_neighborhood_score)}/100`);
    } catch (err: any) {
      toast.error(`Neighborhood check failed: ${err.message}`);
    } finally {
      setCheckingNeighborhood(false);
    }
  };

  const runThermal = async () => {
    setCheckingThermal(true);
    try {
      const result = await assessmentApi.thermalAssess({
        lat: draft.lat,
        lon: draft.lng,
        floor_number: draft.building.floor,
        orientation: (orientMap[draft.building.orientation] ?? "unknown") as any,
        building_mass: draft.building.mass as any,
        building_condition: (condMap[draft.building.condition] ?? "good") as any,
        has_cooling: draft.building.cooling,
        has_heating: draft.building.heating,
        has_balcony: draft.rooms.balconies > 0,
        has_windows: true,
        address: draft.address || draft.label,
      });
      upd({
        thermalScore: Math.round(result.comfort_report.comfort_score),
        thermalAssessment: result,
      });
      toast.success(`Thermal comfort: ${Math.round(result.comfort_report.comfort_score)}/100 · ${result.comfort_report.months_in_comfort_band}/12 comfortable months`);
    } catch (err: any) {
      toast.error(`Thermal check failed: ${err.message}`);
    } finally {
      setCheckingThermal(false);
    }
  };

  const runAllChecks = async () => {
    await Promise.allSettled([runNoise(), runNeighborhood(), runThermal()]);
  };

  const anyChecking = checkingNoise || checkingNeighborhood || checkingThermal;

  return (
    <OverlayPanel title="Apartment Configurator" subtitle={pin ? `Pre-filled from "${pin.title}"` : "Build a saveable apartment preset"} size="xl">
      <div className="grid md:grid-cols-2 gap-5">
        <Card className="rounded-3xl p-4 space-y-3">
          <h3 className="font-display text-lg">Address & label</h3>
          <div><Label>Label</Label><Input value={draft.label} onChange={(e) => upd({ label: e.target.value })} className="rounded-2xl mt-1" /></div>
          <div><Label>Address</Label><Input value={draft.address} onChange={(e) => upd({ address: e.target.value })} className="rounded-2xl mt-1" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Lat</Label><Input type="number" value={draft.lat} onChange={(e) => upd({ lat: +e.target.value })} className="rounded-2xl mt-1" /></div>
            <div><Label>Lng</Label><Input type="number" value={draft.lng} onChange={(e) => upd({ lng: +e.target.value })} className="rounded-2xl mt-1" /></div>
          </div>
        </Card>

        <Card className="rounded-3xl p-4 space-y-3">
          <h3 className="font-display text-lg">Room topology</h3>
          {(Object.keys(draft.rooms) as Array<keyof ApartmentConfig["rooms"]>).map((k) => (
            <div key={k} className="flex items-center justify-between">
              <Label className="capitalize">{k}</Label>
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" className="rounded-full h-8 w-8" onClick={() => updRooms(k, draft.rooms[k] - 1)}>−</Button>
                <span className="w-6 text-center font-mono">{draft.rooms[k]}</span>
                <Button size="icon" variant="outline" className="rounded-full h-8 w-8" onClick={() => updRooms(k, draft.rooms[k] + 1)}>+</Button>
              </div>
            </div>
          ))}
        </Card>

        <Card className="rounded-3xl p-4 space-y-3">
          <h3 className="font-display text-lg">Building</h3>
          <div><Label>Floor</Label><Input type="number" value={draft.building.floor} onChange={(e) => updBuilding({ floor: +e.target.value })} className="rounded-2xl mt-1" /></div>
          <div className="grid grid-cols-3 gap-2">
            {(["new", "renovated", "old"] as const).map((c) => (
              <button key={c} onClick={() => updBuilding({ condition: c })} className={`rounded-full py-1 text-sm border-2 capitalize ${draft.building.condition === c ? "border-primary bg-primary/10" : "border-border"}`}>{c}</button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {(["N","NE","E","SE","S","SW","W","NW"] as Orientation[]).map((o) => (
              <button key={o} onClick={() => updBuilding({ orientation: o })} className={`rounded-xl py-1 text-xs border-2 ${draft.building.orientation === o ? "border-primary bg-primary/10" : "border-border"}`}>{o}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([["elevator","Elevator"],["heating","Heating"],["cooling","Cooling"]] as const).map(([k,l]) => (
              <div key={k} className="flex items-center justify-between rounded-2xl bg-muted px-3 py-2">
                <Label>{l}</Label>
                <Switch checked={draft.building[k]} onCheckedChange={(v) => updBuilding({ [k]: v } as any)} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["single", "double", "triple"] as const).map((w) => (
              <button key={w} onClick={() => updBuilding({ windows: w })} className={`rounded-full py-1 text-sm border-2 capitalize ${draft.building.windows === w ? "border-primary bg-primary/10" : "border-border"}`}>{w}</button>
            ))}
          </div>
        </Card>

        <Card className="rounded-3xl p-4 space-y-3">
          <h3 className="font-display text-lg">Utilities & environment</h3>
          {(Object.keys(draft.utilities) as Array<keyof ApartmentConfig["utilities"]>).map((k) => (
            <div key={k} className="flex items-center justify-between rounded-2xl bg-muted px-3 py-2">
              <Label className="capitalize">{k}</Label>
              <Switch checked={draft.utilities[k]} onCheckedChange={(v) => updUtil(k, v)} />
            </div>
          ))}

          {/* Score display */}
          <div className="grid grid-cols-3 gap-2 pt-2">
            <ScorePill label="Noise" score={draft.noiseScore} icon={Volume2} loading={checkingNoise} />
            <ScorePill label="Walkability" score={draft.neighborhoodScore} icon={MapPin} loading={checkingNeighborhood} />
            <ScorePill label="Thermal" score={draft.thermalScore} icon={Thermometer} loading={checkingThermal} />
          </div>

          {/* Individual check buttons */}
          <div className="grid grid-cols-3 gap-2">
            <Button
              size="sm" variant="outline" className="rounded-2xl text-xs"
              onClick={runNoise} disabled={checkingNoise}
            >
              {checkingNoise ? <Loader2 className="h-3 w-3 animate-spin" /> : <Volume2 className="h-3 w-3" />}
              <span className="ml-1">Noise</span>
            </Button>
            <Button
              size="sm" variant="outline" className="rounded-2xl text-xs"
              onClick={runNeighborhood} disabled={checkingNeighborhood}
            >
              {checkingNeighborhood ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
              <span className="ml-1">Area</span>
            </Button>
            <Button
              size="sm" variant="outline" className="rounded-2xl text-xs"
              onClick={runThermal} disabled={checkingThermal}
            >
              {checkingThermal ? <Loader2 className="h-3 w-3 animate-spin" /> : <Thermometer className="h-3 w-3" />}
              <span className="ml-1">Thermal</span>
            </Button>
          </div>

          <Button
            variant="default" className="rounded-2xl w-full"
            onClick={runAllChecks} disabled={anyChecking}
          >
            {anyChecking
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running checks…</>
              : "🔍 Run all environment checks"}
          </Button>

          {/* Inline summaries from cached assessments */}
          {(draft as any).noiseAssessment && (
            <div className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Noise: {(draft as any).noiseAssessment.assessment_summary?.slice(0, 80)}…
            </div>
          )}
          {(draft as any).thermalAssessment && (
            <div className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Thermal: {(draft as any).thermalAssessment.comfort_report?.months_in_comfort_band}/12 comfortable months ·{" "}
              hottest {(draft as any).thermalAssessment.climate_summary?.hottest_month_avg?.toFixed(1)}°C
            </div>
          )}
        </Card>
      </div>

      <div className="flex gap-2 mt-5">
        <Button onClick={save} className="rounded-2xl">Save apartment</Button>
        <Button variant="outline" className="rounded-2xl" onClick={() => setDraft(blank())}>New blank</Button>
      </div>

      <div className="mt-6">
        <h3 className="font-display text-lg mb-2">Saved presets ({apartments.length})</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {apartments.map((a) => (
            <Card key={a.id} className="p-3 rounded-2xl cursor-pointer hover:bg-muted" onClick={() => setDraft(a)}>
              <div className="font-medium truncate">{a.label}</div>
              <div className="text-xs text-muted-foreground truncate">{a.address}</div>
              {(a.noiseScore || a.neighborhoodScore || a.thermalScore) && (
                <div className="flex gap-2 mt-1">
                  {a.noiseScore != null && <span className="text-[10px] bg-primary/10 text-primary rounded-full px-1.5 py-0.5">N:{a.noiseScore}</span>}
                  {a.neighborhoodScore != null && <span className="text-[10px] bg-primary/10 text-primary rounded-full px-1.5 py-0.5">W:{a.neighborhoodScore}</span>}
                  {a.thermalScore != null && <span className="text-[10px] bg-primary/10 text-primary rounded-full px-1.5 py-0.5">T:{a.thermalScore}</span>}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </OverlayPanel>
  );
}
