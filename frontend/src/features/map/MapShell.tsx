import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useApp } from "@/shared/store/useApp";
import { pinService } from "@/services/mockApi";
import { overpassApi } from "@/services/overpassApi";
import { toast } from "sonner";
import type { PropertyPin, POINode, PoiType } from "@/contracts/types";
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

function poiIcon(type: PoiType) {
  let color = "hsl(45 90% 65%)";
  let emoji = "📌";
  if (type === "hospital") { color = "hsl(0 80% 65%)"; emoji = "🏥"; }
  else if (type === "school") { color = "hsl(220 80% 65%)"; emoji = "🏫"; }
  else if (type === "commodity") { color = "hsl(120 70% 50%)"; emoji = "🛒"; }

  const html = `
    <div style="width:24px;height:24px;border-radius:50%;background:${color};border:2px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px ${color};">
      <span style="font-size:12px;">${emoji}</span>
    </div>
  `;
  return L.divIcon({ html, className: "poi-pin", iconSize: [24, 24], iconAnchor: [12, 12] });
}

function POIFetcher({ onFetch }: { onFetch: (pois: POINode[]) => void }) {
  const { activeFilters } = useApp();
  const map = useMap();
  
  const activePoiTypes = useMemo(() => {
    return ["hospital", "school", "commodity"].filter(t => activeFilters.includes(t)) as PoiType[];
  }, [activeFilters]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    
    const fetchPOIs = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        if (map.getZoom() < 13 || activePoiTypes.length === 0) {
          onFetch([]);
          return;
        }
        const b = map.getBounds();
        const pois = await overpassApi.fetchPOIs({
          s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast()
        }, activePoiTypes);
        if (!cancelled) onFetch(pois);
      }, 500); // 500ms debounce
    };

    fetchPOIs();
    map.on("moveend", fetchPOIs);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      map.off("moveend", fetchPOIs);
    };
  }, [map, activePoiTypes, onFetch]);

  return null;
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
  const { pins, setSelectedPinId, selectedPinId, activeFilters } = useApp();
  const [pois, setPois] = useState<POINode[]>([]);
  const center = useMemo<[number, number]>(() => [36.8065, 10.1815], []);

  const filteredPins = useMemo(() => {
    return pins.filter((p) => activeFilters.includes(p.kind));
  }, [pins, activeFilters]);

  return (
    <MapContainer
      center={center}
      zoom={14}
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
      <POIFetcher onFetch={setPois} />
      
      {/* Real POIs from API */}
      {pois.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={poiIcon(p.type)}>
          <Tooltip direction="top" offset={[0, -10]} className="text-sm font-semibold capitalize">
            {p.name || p.type}
          </Tooltip>
        </Marker>
      ))}

      {/* Property Pins */}
      {filteredPins.map((p) => (
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
