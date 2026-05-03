/**
 * AddPropertyModal.tsx
 * Shown when a landlord clicks/drops a pin on the map.
 * Collects the minimum required info to create a Property record.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { MapPin, Loader2 } from "lucide-react";

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

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg border-[hsl(var(--holo-cyan)/0.3)] bg-[#060610] text-white rounded-3xl max-h-[90vh] overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <DialogTitle className="text-[hsl(var(--holo-cyan))] flex items-center gap-2 text-xl font-semibold">
            <MapPin className="h-5 w-5" /> New Property
          </DialogTitle>
          <p className="text-xs text-gray-400 font-mono mt-1">
            📍 {lat.toFixed(5)}, {lng.toFixed(5)}
          </p>
        </DialogHeader>

        <div className="space-y-5 py-2">

          {/* Address */}
          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">Address / Label *</Label>
            <Input
              placeholder="e.g. 12 Rue Ibn Khaldoun, Tunis"
              className="bg-[#1e1e35] border-gray-700 rounded-xl text-white"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">Description</Label>
            <Textarea
              placeholder="Describe the property…"
              className="bg-[#1e1e35] border-gray-700 rounded-xl text-white text-sm resize-none"
              rows={2}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          {/* Bedrooms / Bathrooms / Floor */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Bedrooms</Label>
              <Input type="number" min={0} max={20}
                className="bg-[#1e1e35] border-gray-700 rounded-xl text-white"
                value={form.bedrooms}
                onChange={(e) => set("bedrooms", parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Bathrooms</Label>
              <Input type="number" min={0} max={10}
                className="bg-[#1e1e35] border-gray-700 rounded-xl text-white"
                value={form.bathrooms}
                onChange={(e) => set("bathrooms", parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Floor</Label>
              <Input type="number" min={0} max={50}
                className="bg-[#1e1e35] border-gray-700 rounded-xl text-white"
                value={form.floor_number}
                onChange={(e) => set("floor_number", parseInt(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Area / Price */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Area (m²)</Label>
              <Input type="number" min={1}
                placeholder="e.g. 85"
                className="bg-[#1e1e35] border-gray-700 rounded-xl text-white"
                value={form.area_m2 ?? ""}
                onChange={(e) => set("area_m2", e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Price (TND)</Label>
              <Input type="number" min={0}
                placeholder={form.for_rent ? "/ month" : "sale price"}
                className="bg-[#1e1e35] border-gray-700 rounded-xl text-white"
                value={form.price_tnd ?? ""}
                onChange={(e) => set("price_tnd", e.target.value ? parseFloat(e.target.value) : null)}
              />
            </div>
          </div>

          {/* For Rent / For Sale */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#1e1e35] p-3 rounded-xl border border-gray-800 flex items-center justify-between">
              <Label className="text-gray-300 text-sm">For Rent</Label>
              <Switch checked={form.for_rent} onCheckedChange={(v) => set("for_rent", v)} />
            </div>
            <div className="bg-[#1e1e35] p-3 rounded-xl border border-gray-800 flex items-center justify-between">
              <Label className="text-gray-300 text-sm">For Sale</Label>
              <Switch checked={form.for_sale} onCheckedChange={(v) => set("for_sale", v)} />
            </div>
          </div>

          {/* Orientation / Condition */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Orientation</Label>
              <Select value={form.orientation} onValueChange={(v) => set("orientation", v)}>
                <SelectTrigger className="bg-[#1e1e35] border-gray-700 rounded-xl text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1e1e35] border-gray-700 text-white">
                  <SelectItem value="north">North</SelectItem>
                  <SelectItem value="south">South</SelectItem>
                  <SelectItem value="east">East</SelectItem>
                  <SelectItem value="west">West</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Condition</Label>
              <Select value={form.building_condition} onValueChange={(v) => set("building_condition", v)}>
                <SelectTrigger className="bg-[#1e1e35] border-gray-700 rounded-xl text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1e1e35] border-gray-700 text-white">
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Amenity toggles */}
          <div className="grid grid-cols-2 gap-2">
            {([
              ["furnished", "Furnished"],
              ["has_elevator", "Elevator"],
              ["has_cooling", "Air Conditioning"],
              ["has_parking", "Parking"],
            ] as [keyof PropertyFormData, string][]).map(([key, label]) => (
              <div key={key} className="bg-[#1e1e35] p-3 rounded-xl border border-gray-800 flex items-center justify-between">
                <Label className="text-gray-400 text-xs">{label}</Label>
                <Switch
                  checked={form[key] as boolean}
                  onCheckedChange={(v) => set(key, v)}
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            className="rounded-2xl border-gray-700 text-gray-400 hover:bg-gray-800"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            className="rounded-2xl bg-[hsl(var(--holo-cyan)/0.15)] hover:bg-[hsl(var(--holo-cyan)/0.25)] border border-[hsl(var(--holo-cyan)/0.5)] text-[hsl(var(--holo-cyan))] gap-2 flex-1"
            onClick={handleSubmit}
            disabled={loading || !form.address.trim()}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            {loading ? "Creating…" : "Add Property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
