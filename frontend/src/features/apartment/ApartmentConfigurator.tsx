import { useEffect, useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/shared/store/useApp";
import { apartmentService } from "@/services/mockApi";
import { toast } from "sonner";
import type { ApartmentConfig, Orientation } from "@/contracts/types";

const blank = (): Omit<ApartmentConfig, "id" | "updatedAt"> => ({
  label: "New apartment",
  address: "",
  lat: 36.8065, lng: 10.1815,
  rooms: { bedrooms: 1, bathrooms: 1, livingRooms: 1, kitchens: 1, balconies: 0 },
  building: { floor: 1, condition: "renovated", mass: "medium", orientation: "S", elevator: false, heating: false, cooling: true, windows: "double" },
  utilities: { internet: true, water: true, electricity: true, gas: false },
});

export function ApartmentConfigurator() {
  const { apartments, setApartments, pins, selectedPinId } = useApp();
  const pin = pins.find((p) => p.id === selectedPinId);
  const [draft, setDraft] = useState<Omit<ApartmentConfig, "id" | "updatedAt"> & { id?: string }>(() => {
    const base = blank();
    if (pin) { base.label = pin.title; base.address = pin.subtitle ?? ""; base.lat = pin.lat; base.lng = pin.lng; }
    return base;
  });

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

  const runChecks = async () => {
    if (!draft.id) { toast.error("Save first"); return; }
    const a = await apartmentService.runChecks(draft.id);
    setApartments(await apartmentService.list());
    upd(a);
    toast.success("Checks complete");
  };

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
          <h3 className="font-display text-lg">Utilities & assessment</h3>
          {(Object.keys(draft.utilities) as Array<keyof ApartmentConfig["utilities"]>).map((k) => (
            <div key={k} className="flex items-center justify-between rounded-2xl bg-muted px-3 py-2">
              <Label className="capitalize">{k}</Label>
              <Switch checked={draft.utilities[k]} onCheckedChange={(v) => updUtil(k, v)} />
            </div>
          ))}
          <div className="grid grid-cols-3 gap-2 pt-2">
            <Card className="rounded-2xl p-2 text-center bg-secondary/40"><div className="text-xs text-muted-foreground">Noise</div><div className="font-display text-xl">{draft.noiseScore ?? "—"}</div></Card>
            <Card className="rounded-2xl p-2 text-center bg-secondary/40"><div className="text-xs text-muted-foreground">Neighborhood</div><div className="font-display text-xl">{draft.neighborhoodScore ?? "—"}</div></Card>
            <Card className="rounded-2xl p-2 text-center bg-secondary/40"><div className="text-xs text-muted-foreground">Thermal</div><div className="font-display text-xl">{draft.thermalScore ?? "—"}</div></Card>
          </div>
          <Button variant="outline" className="rounded-2xl w-full" onClick={runChecks}>Run noise / neighborhood / thermal checks</Button>
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
            </Card>
          ))}
        </div>
      </div>
    </OverlayPanel>
  );
}
