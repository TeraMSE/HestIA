import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useApp } from "@/shared/store/useApp";
import { pinService } from "@/services/mockApi";
import { toast } from "sonner";
import type { PropertyPin } from "@/contracts/types";
import { PinOrbitTools } from "./PinOrbitTools";

// Fix default marker icon for Leaflet in bundlers (we use custom anyway).
delete (L.Icon.Default.prototype as any)._getIconUrl;

function pinIcon(p: PropertyPin, selected: boolean) {
  const color =
    p.scan === "scanned" ? "hsl(185 95% 65%)" :
    p.kind === "user_pin" ? "hsl(320 90% 75%)" :
    "hsl(185 70% 60%)";
  const ring = selected ? `box-shadow:0 0 0 4px hsl(185 95% 65% / 0.5), 0 0 24px hsl(185 95% 65% / 0.9);` : "";
  const html = `
    <div class="holo-pin-glow" style="position:relative;display:flex;flex-direction:column;align-items:center;">
      <div style="width:38px;height:38px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:linear-gradient(135deg, ${color}, hsl(320 90% 75% / 0.7));border:2px solid hsl(185 95% 80% / 0.9);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);${ring}">
        <span style="transform:rotate(45deg);font-size:18px;filter:drop-shadow(0 0 4px rgba(255,255,255,0.8));">${p.kind === "user_pin" ? "📍" : "🏠"}</span>
      </div>
      ${p.scan === "scanned" ? `<span style="position:absolute;top:-6px;right:-2px;background:hsl(145 70% 50%);color:white;font-size:9px;font-weight:700;padding:2px 5px;border-radius:8px;border:2px solid white;box-shadow:0 0 8px hsl(145 70% 50% / 0.8);">3D</span>` : ""}
    </div>`;
  return L.divIcon({ html, className: "hestia-pin", iconSize: [38, 50], iconAnchor: [19, 46], popupAnchor: [0, -42] });
}

function PinAdder() {
  const { user, setPins, pins } = useApp();
  useMapEvents({
    async click(e) {
      if (!user) return;
      const title = window.prompt("Name this place:");
      if (!title) return;
      const pin = await pinService.add({
        kind: "user_pin", lat: e.latlng.lat, lng: e.latlng.lng,
        title, subtitle: "Your saved place", scan: "unscanned",
      });
      setPins([...pins, pin]);
      toast.success("Pin added");
    },
  });
  return null;
}

function MapEffects() {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 50);
  }, [map]);
  return null;
}

export function MapShell() {
  const { pins, setSelectedPinId, selectedPinId } = useApp();
  const center = useMemo<[number, number]>(() => [36.8065, 10.1815], []);

  return (
    <MapContainer
      center={center}
      zoom={11}
      zoomControl={true}
      className="absolute inset-0 z-0"
      attributionControl={true}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"
      />
      <MapEffects />
      <PinAdder />
      {pins.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={pinIcon(p, p.id === selectedPinId)}
          eventHandlers={{ click: () => setSelectedPinId(p.id) }}
        >
          <Popup className="holo-popup">
            <div className="font-display text-base holo-text-glow">{p.title}</div>
            <div className="text-xs text-muted-foreground">{p.subtitle}</div>
            {p.priceTND && (
              <div className="mt-1 text-sm font-semibold">
                {p.priceTND.toLocaleString()} TND {p.forRent ? "/ month" : ""}
              </div>
            )}
          </Popup>
        </Marker>
      ))}
      <PinOrbitTools />
    </MapContainer>
  );
}
