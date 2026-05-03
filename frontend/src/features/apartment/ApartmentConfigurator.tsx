/**
 * ApartmentConfigurator.tsx — Landlord apartment configuration form.
 *
 * Saves apartment config fields to the existing Property model via PATCH.
 * Opened from PropertyDrawer overview tab by the property owner.
 */
import { useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/shared/store/useApp";
import api from "@/services/api";
import { toast } from "sonner";
import {
  Building2, Layers, Compass, Wifi, Wind, Flame, LayoutGrid, CheckCircle, Cigarette, Save
} from "lucide-react";

function SelectField({
  label, icon: Icon, value, onChange, options,
}: {
  label: string; icon: React.ElementType; value: string;
  onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3.5 w-3.5" />{label}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-all ${
              value === opt.value
                ? "border-primary bg-primary/15 text-primary shadow-sm"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"}`}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label, icon: Icon, value, onChange, min, max,
}: {
  label: string; icon: React.ElementType; value: number;
  onChange: (v: number) => void; min: number; max: number;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3.5 w-3.5" />{label}
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className="w-8 h-8 rounded-lg border border-border bg-muted/40 hover:bg-muted flex items-center justify-center font-bold text-lg"
          onClick={() => onChange(Math.max(min, value - 1))}>−</button>
        <span className="font-display text-2xl w-10 text-center">{value}</span>
        <button type="button" className="w-8 h-8 rounded-lg border border-border bg-muted/40 hover:bg-muted flex items-center justify-center font-bold text-lg"
          onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </div>
  );
}

function ToggleField({
  label, icon: Icon, value, onChange, description,
}: {
  label: string; icon: React.ElementType; value: boolean;
  onChange: (v: boolean) => void; description?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`flex items-start gap-3 p-3 rounded-xl border transition-all text-left ${
        value ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40"}`}>
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs opacity-70 mt-0.5">{description}</div>}
      </div>
      <div className={`w-8 h-4 rounded-full transition-colors relative ${value ? "bg-primary" : "bg-muted"}`}
        style={{ boxShadow: value ? "0 0 8px hsl(var(--primary) / 0.6)" : undefined }}>
        <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all ${value ? "left-4" : "left-0.5"}`} />
      </div>
    </button>
  );
}

export function ApartmentConfigurator() {
  const { pins, selectedPinId } = useApp();
  const pin = pins.find((p) => p.id === selectedPinId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [config, setConfig] = useState({
    floor_number: 2, orientation: "south", building_mass: "heavy",
    building_condition: "good", has_elevator: false, has_cooling: false,
    has_heating: true, has_balcony: false, has_internet: true,
    furnished: false, smoking_allowed: false,
  });

  const setField = <K extends keyof typeof config>(key: K, value: typeof config[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const handleSave = async () => {
    if (!pin?.id) return;
    setSaving(true);
    try {
      if (String(pin.id).startsWith("pin_")) {
        // Mock pin — just pretend it saved
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        // Real pin — update backend Property model
        const targetId = pin.apartmentId || pin.id;
        await api.patch(`/properties/${targetId}/`, { ...config, apt_configured: true });
      }
      
      // Update local pin state to immediately unlock the next pipeline step
      useApp.getState().setPins(
        useApp.getState().pins.map(p => p.id === pin.id ? { ...p, apt_configured: true } : p)
      );

      setSaved(true);
      toast.success("Apartment configuration saved!");
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  return (
    <OverlayPanel title="Configure Apartment"
      subtitle="Helps the AI life simulation understand your property's characteristics" size="lg">
      <div className="space-y-5">
        {pin && (
          <Card className="rounded-2xl p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{pin.title}</span>
              <Badge variant="secondary" className="ml-auto rounded-full text-xs">
                {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
              </Badge>
            </div>
          </Card>
        )}

        <Card className="rounded-2xl p-4">
          <NumberField label="Floor Number" icon={Layers} value={config.floor_number}
            onChange={(v) => setField("floor_number", v)} min={0} max={50} />
        </Card>

        <Card className="rounded-2xl p-4">
          <SelectField label="Main Orientation" icon={Compass} value={config.orientation}
            onChange={(v) => setField("orientation", v)}
            options={[
              { value: "north", label: "North ↑" }, { value: "south", label: "South ↓" },
              { value: "east", label: "East →" }, { value: "west", label: "West ←" },
              { value: "unknown", label: "Unknown" },
            ]} />
        </Card>

        <Card className="rounded-2xl p-4 space-y-4">
          <SelectField label="Building Mass" icon={LayoutGrid} value={config.building_mass}
            onChange={(v) => setField("building_mass", v)}
            options={[{ value: "heavy", label: "Heavy" }, { value: "medium", label: "Medium" }, { value: "light", label: "Light" }]} />
          <SelectField label="Building Condition" icon={Building2} value={config.building_condition}
            onChange={(v) => setField("building_condition", v)}
            options={[{ value: "new", label: "New" }, { value: "good", label: "Good" }, { value: "fair", label: "Fair" }, { value: "poor", label: "Poor" }]} />
        </Card>

        <Card className="rounded-2xl p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Amenities</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ToggleField label="Elevator" icon={Layers} value={config.has_elevator} onChange={(v) => setField("has_elevator", v)} />
            <ToggleField label="Air Conditioning" icon={Wind} value={config.has_cooling} onChange={(v) => setField("has_cooling", v)} />
            <ToggleField label="Heating" icon={Flame} value={config.has_heating} onChange={(v) => setField("has_heating", v)} />
            <ToggleField label="Balcony" icon={Compass} value={config.has_balcony} onChange={(v) => setField("has_balcony", v)} />
            <ToggleField label="Internet" icon={Wifi} value={config.has_internet} onChange={(v) => setField("has_internet", v)} />
            <ToggleField label="Furnished" icon={LayoutGrid} value={config.furnished} onChange={(v) => setField("furnished", v)} description="Comes with furniture" />
            <ToggleField label="Smoking Allowed" icon={Cigarette} value={config.smoking_allowed} onChange={(v) => setField("smoking_allowed", v)} />
          </div>
        </Card>

        <Button className="w-full rounded-2xl h-12 text-base font-semibold" onClick={handleSave} disabled={saving}
          style={{ background: saved ? "hsl(145 70% 45%)" : "linear-gradient(135deg, hsl(var(--primary)), hsl(185 95% 55%))", boxShadow: "0 0 24px hsl(var(--primary) / 0.4)" }}>
          {saving ? "Saving…" : saved
            ? <span className="flex items-center gap-2"><CheckCircle className="h-4 w-4" /> Saved!</span>
            : <span className="flex items-center gap-2"><Save className="h-4 w-4" /> Save Configuration</span>}
        </Button>
      </div>
    </OverlayPanel>
  );
}
