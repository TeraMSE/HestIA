/**
 * AddPropertyModal.tsx
 * Shown when a landlord clicks/drops a pin on the map.
 * Collects the minimum required info to create a Property record.
 */
import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MapPin, Loader2, BedDouble, Bath, Layers, Ruler, Coins,
  Tag, Compass, Wrench, Sofa, ArrowUpDown, Wind, Car, Building2, CheckCircle2, LocateFixed,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AddPropertyModalProps {
  lat: number;
  lng: number;
  onConfirm: (data: PropertyFormData) => Promise<void>;
  onCancel: () => void;
}

export interface PropertyFormData {
  address: string;
  description: string;
  bedrooms: number;
  bathrooms: number;
  area_m2: number | null;
  price_tnd: number | null;
  for_rent: boolean;
  for_sale: boolean;
  floor_number: number;
  orientation: string;
  building_condition: string;
  furnished: boolean;
  has_elevator: boolean;
  has_cooling: boolean;
  has_parking: boolean;
}

const AMENITIES: { key: keyof PropertyFormData; label: string; icon: typeof Sofa }[] = [
  { key: "furnished",    label: "Furnished",    icon: Sofa },
  { key: "has_elevator", label: "Elevator",     icon: ArrowUpDown },
  { key: "has_cooling",  label: "A/C",          icon: Wind },
  { key: "has_parking",  label: "Parking",      icon: Car },
];

function SectionLabel({ icon: Icon, label }: { icon: typeof MapPin; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-3.5 w-3.5 text-[hsl(var(--holo-cyan))]" />
      <span className="text-[10px] font-semibold tracking-widest uppercase text-[hsl(var(--holo-cyan)/0.7)]">{label}</span>
      <div className="flex-1 h-px bg-[hsl(var(--holo-cyan)/0.15)]" />
    </div>
  );
}

function HoloInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        "bg-white/5 border-white/10 rounded-xl text-white placeholder:text-white/30 focus-visible:ring-[hsl(var(--holo-cyan)/0.4)] focus-visible:border-[hsl(var(--holo-cyan)/0.5)] transition-colors",
        className
      )}
      {...props}
    />
  );
}

export function AddPropertyModal({ lat, lng, onConfirm, onCancel }: AddPropertyModalProps) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<PropertyFormData>({
    address: "",
    description: "",
    bedrooms: 2,
    bathrooms: 1,
    area_m2: null,
    price_tnd: null,
    for_rent: true,
    for_sale: false,
    floor_number: 1,
    orientation: "unknown",
    building_condition: "good",
    furnished: false,
    has_elevator: false,
    has_cooling: false,
    has_parking: false,
  });

  const [geocoding, setGeocoding] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=en`,
          { headers: { "User-Agent": "HestIA/1.0" } }
        );
        const data = await res.json();
        if (cancelled) return;
        const a = data.address ?? {};
        const parts = [
          a.house_number,
          a.road,
          a.suburb ?? a.neighbourhood ?? a.village,
          a.city ?? a.town ?? a.municipality,
          a.country,
        ].filter(Boolean);
        const formatted = parts.length ? parts.join(", ") : data.display_name ?? "";
        setForm((f) => ({ ...f, address: formatted }));
      } catch {
        // leave blank for manual entry
      } finally {
        if (!cancelled) setGeocoding(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng]);

  const set = (key: keyof PropertyFormData, value: any) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.address.trim()) return;
    setLoading(true);
    try {
      await onConfirm(form);
    } finally {
      setLoading(false);
    }
  };

  const listingActive = form.for_rent || form.for_sale;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="p-0 sm:max-w-lg border-0 bg-transparent rounded-3xl shadow-[0_0_60px_hsl(var(--holo-cyan)/0.12),0_32px_64px_rgba(0,0,0,0.6)] overflow-hidden max-h-[92vh] flex flex-col">

        {/* ── Header ── */}
        <div className="relative flex-shrink-0 px-6 pt-6 pb-5 overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #0a0a1a 0%, #0d1127 60%, #0a0f20 100%)",
            borderBottom: "1px solid hsl(var(--holo-cyan)/0.15)",
          }}
        >
          {/* decorative glow orb */}
          <div className="absolute -top-6 -right-6 w-40 h-40 rounded-full opacity-20 pointer-events-none"
            style={{ background: "radial-gradient(circle, hsl(var(--holo-cyan)) 0%, transparent 70%)" }} />
          <div className="absolute -bottom-4 -left-4 w-24 h-24 rounded-full opacity-10 pointer-events-none"
            style={{ background: "radial-gradient(circle, hsl(var(--holo-pink)) 0%, transparent 70%)" }} />

          <div className="relative flex items-start gap-4">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, hsl(var(--holo-cyan)/0.25), hsl(var(--holo-cyan)/0.08))", border: "1px solid hsl(var(--holo-cyan)/0.4)" }}
            >
              <Building2 className="h-5 w-5 text-[hsl(var(--holo-cyan))]" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-white leading-tight">New Property</h2>
              <p className="text-xs text-white/40 mt-0.5">Fill in the details to list your property</p>
            </div>
          </div>

          {/* Coordinate badge */}
          <div className="relative mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-mono text-[hsl(var(--holo-cyan)/0.8)]"
            style={{ background: "hsl(var(--holo-cyan)/0.08)", border: "1px solid hsl(var(--holo-cyan)/0.2)" }}
          >
            <MapPin className="h-3 w-3" />
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-6"
          style={{ background: "#080816" }}
        >

          {/* Location */}
          <section>
            <SectionLabel icon={MapPin} label="Location" />
            <div className="space-y-3">
              <div>
                <Label className="text-white/50 text-xs mb-1.5 flex items-center gap-1.5">
                  Address / Label <span className="text-[hsl(var(--holo-cyan))]">*</span>
                  {geocoding && (
                    <span className="ml-auto flex items-center gap-1 text-[hsl(var(--holo-cyan)/0.7)] text-[10px]">
                      <LocateFixed className="h-3 w-3 animate-pulse" /> Locating…
                    </span>
                  )}
                </Label>
                <div className="relative">
                  <HoloInput
                    placeholder={geocoding ? "Fetching address from map…" : "e.g. 12 Rue Ibn Khaldoun, Tunis"}
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                    disabled={geocoding}
                    autoFocus={!geocoding}
                    className={geocoding ? "opacity-60 cursor-wait" : ""}
                  />
                  {geocoding && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[hsl(var(--holo-cyan)/0.5)] animate-spin" />
                  )}
                </div>
              </div>
              <div>
                <Label className="text-white/50 text-xs mb-1.5 block">Description</Label>
                <Textarea
                  placeholder="Describe the property — layout, views, neighbourhood highlights…"
                  className="bg-white/5 border-white/10 rounded-xl text-white text-sm placeholder:text-white/30 resize-none focus-visible:ring-[hsl(var(--holo-cyan)/0.4)] focus-visible:border-[hsl(var(--holo-cyan)/0.5)] transition-colors"
                  rows={2}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* Layout */}
          <section>
            <SectionLabel icon={Layers} label="Layout" />
            <div className="grid grid-cols-3 gap-3">
              {([
                { key: "bedrooms",     label: "Bedrooms", icon: BedDouble, min: 0, max: 20 },
                { key: "bathrooms",    label: "Bathrooms", icon: Bath,      min: 0, max: 10 },
                { key: "floor_number", label: "Floor",     icon: Layers,    min: 0, max: 50 },
              ] as { key: keyof PropertyFormData; label: string; icon: typeof BedDouble; min: number; max: number }[]).map(({ key, label, icon: Icon, min, max }) => (
                <div key={key}>
                  <Label className="text-white/50 text-xs mb-1.5 flex items-center gap-1">
                    <Icon className="h-3 w-3 text-white/30" /> {label}
                  </Label>
                  <HoloInput
                    type="number" min={min} max={max}
                    value={form[key] as number}
                    onChange={(e) => set(key, parseInt(e.target.value) || 0)}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Pricing */}
          <section>
            <SectionLabel icon={Coins} label="Pricing" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/50 text-xs mb-1.5 flex items-center gap-1">
                  <Ruler className="h-3 w-3 text-white/30" /> Area (m²)
                </Label>
                <HoloInput
                  type="number" min={1} placeholder="e.g. 85"
                  value={form.area_m2 ?? ""}
                  onChange={(e) => set("area_m2", e.target.value ? parseFloat(e.target.value) : null)}
                />
              </div>
              <div>
                <Label className="text-white/50 text-xs mb-1.5 flex items-center gap-1">
                  <Coins className="h-3 w-3 text-white/30" /> Price (TND)
                </Label>
                <HoloInput
                  type="number" min={0} placeholder={form.for_rent ? "per month" : "sale price"}
                  value={form.price_tnd ?? ""}
                  onChange={(e) => set("price_tnd", e.target.value ? parseFloat(e.target.value) : null)}
                />
              </div>
            </div>
          </section>

          {/* Listing type */}
          <section>
            <SectionLabel icon={Tag} label="Listing Type" />
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: "for_rent", label: "For Rent", sub: "Monthly tenants" },
                { key: "for_sale", label: "For Sale", sub: "Permanent buyers" },
              ] as { key: keyof PropertyFormData; label: string; sub: string }[]).map(({ key, label, sub }) => {
                const active = form[key] as boolean;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set(key, !active)}
                    className={cn(
                      "relative p-3.5 rounded-2xl border text-left transition-all duration-200",
                      active
                        ? "border-[hsl(var(--holo-cyan)/0.6)] bg-[hsl(var(--holo-cyan)/0.08)] shadow-[0_0_16px_hsl(var(--holo-cyan)/0.12)]"
                        : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8"
                    )}
                  >
                    {active && (
                      <CheckCircle2 className="absolute top-2.5 right-2.5 h-3.5 w-3.5 text-[hsl(var(--holo-cyan))]" />
                    )}
                    <p className={cn("text-sm font-medium", active ? "text-white" : "text-white/60")}>{label}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">{sub}</p>
                  </button>
                );
              })}
            </div>
            {!listingActive && (
              <p className="text-[10px] text-amber-400/70 mt-2 pl-1">Select at least one listing type</p>
            )}
          </section>

          {/* Condition & Orientation */}
          <section>
            <SectionLabel icon={Wrench} label="Property Details" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/50 text-xs mb-1.5 flex items-center gap-1">
                  <Compass className="h-3 w-3 text-white/30" /> Orientation
                </Label>
                <Select value={form.orientation} onValueChange={(v) => set("orientation", v)}>
                  <SelectTrigger className="bg-white/5 border-white/10 rounded-xl text-white focus:ring-[hsl(var(--holo-cyan)/0.4)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0e0e22] border-white/10 text-white">
                    {["north","south","east","west","unknown"].map(v => (
                      <SelectItem key={v} value={v} className="capitalize focus:bg-[hsl(var(--holo-cyan)/0.15)]">{v.charAt(0).toUpperCase() + v.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-white/50 text-xs mb-1.5 flex items-center gap-1">
                  <Wrench className="h-3 w-3 text-white/30" /> Condition
                </Label>
                <Select value={form.building_condition} onValueChange={(v) => set("building_condition", v)}>
                  <SelectTrigger className="bg-white/5 border-white/10 rounded-xl text-white focus:ring-[hsl(var(--holo-cyan)/0.4)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0e0e22] border-white/10 text-white">
                    {(["new","good","fair","poor"] as const).map(v => (
                      <SelectItem key={v} value={v} className="capitalize focus:bg-[hsl(var(--holo-cyan)/0.15)]">{v.charAt(0).toUpperCase() + v.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Amenities */}
          <section>
            <SectionLabel icon={Sofa} label="Amenities" />
            <div className="grid grid-cols-4 gap-2">
              {AMENITIES.map(({ key, label, icon: Icon }) => {
                const active = form[key] as boolean;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set(key, !active)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl border transition-all duration-200",
                      active
                        ? "border-[hsl(var(--holo-cyan)/0.6)] bg-[hsl(var(--holo-cyan)/0.1)] shadow-[0_0_12px_hsl(var(--holo-cyan)/0.15)]"
                        : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", active ? "text-[hsl(var(--holo-cyan))]" : "text-white/30")} />
                    <span className={cn("text-[10px] font-medium leading-none", active ? "text-white" : "text-white/40")}>{label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 flex gap-3 px-6 py-4"
          style={{ background: "#080816", borderTop: "1px solid hsl(var(--holo-cyan)/0.1)" }}
        >
          <Button
            variant="ghost"
            className="rounded-2xl border border-white/10 text-white/40 hover:bg-white/5 hover:text-white/70 hover:border-white/20 transition-all"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 rounded-2xl gap-2 font-semibold transition-all duration-200 disabled:opacity-40"
            style={{
              background: (!geocoding && form.address.trim())
                ? "linear-gradient(135deg, hsl(var(--holo-cyan)/0.9) 0%, hsl(185 95% 35%) 100%)"
                : "hsl(var(--holo-cyan)/0.15)",
              border: "1px solid hsl(var(--holo-cyan)/0.5)",
              color: (!geocoding && form.address.trim()) ? "#060a10" : "hsl(var(--holo-cyan)/0.5)",
              boxShadow: (!geocoding && form.address.trim()) ? "0 0 24px hsl(var(--holo-cyan)/0.3)" : "none",
            }}
            onClick={handleSubmit}
            disabled={loading || geocoding || !form.address.trim()}
          >
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
              : <><MapPin className="h-4 w-4" /> Add Property</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
