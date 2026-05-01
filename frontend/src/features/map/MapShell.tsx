import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useApp } from "@/shared/store/useApp";
import { pinService } from "@/services/mockApi";
import { overpassApi } from "@/services/overpassApi";
import { socialApi } from "@/services/socialApi";
import api from "@/services/api";
import { toast } from "sonner";
import type { PropertyPin, POINode, PoiType } from "@/contracts/types";
import { PinOrbitTools } from "./PinOrbitTools";

// Fix default marker icon for Leaflet in bundlers (we use custom anyway).
delete (L.Icon.Default.prototype as any)._getIconUrl;

// Clamp map to real-world bounds (no globe looping when zoomed out)
const WORLD_BOUNDS = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));

function pinIcon(p: PropertyPin, selected: boolean) {
  const color =
    p.scan === "scanned" ? "hsl(185 95% 65%)" :
    p.kind === "user_pin" ? "hsl(320 90% 75%)" :
    "hsl(185 70% 60%)";
  const ring = selected ? `box-shadow:0 0 0 4px hsl(185 95% 65% / 0.5), 0 0 24px hsl(185 95% 65% / 0.9);` : "";
  // Show "3D" badge if a 3D world exists for this property
  const has3dBadge = (p as any).has_3d
    ? `<span style="position:absolute;top:-6px;right:-2px;background:hsl(145 70% 50%);color:white;font-size:9px;font-weight:700;padding:2px 5px;border-radius:8px;border:2px solid white;box-shadow:0 0 8px hsl(145 70% 50% / 0.8);">3D</span>`
    : "";
  const html = `
    <div class="holo-pin-glow" style="position:relative;display:flex;flex-direction:column;align-items:center;">
      <div style="width:38px;height:38px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:linear-gradient(135deg, ${color}, hsl(320 90% 75% / 0.7));border:2px solid hsl(185 95% 80% / 0.9);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);${ring}">
        <span style="transform:rotate(45deg);font-size:18px;filter:drop-shadow(0 0 4px rgba(255,255,255,0.8));">${p.kind === "user_pin" ? "📍" : "🏠"}</span>
      </div>
      ${has3dBadge}
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
      }, 500);
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

/** Creates a real Django-backed property pin on map click. */
function PinAdder() {
  const { user, setPins, pins } = useApp();
  useMapEvents({
    async click(e) {
      if (!user) return;
      const title = window.prompt("Name this property (press Cancel to skip):");
      if (!title) return;
      try {
        const res = await api.post("/properties/", {
          address: title,
          lat: e.latlng.lat,
          lng: e.latlng.lng,
          bedrooms: 1,
          bathrooms: 1,
          for_sale: false,
          for_rent: true,
        });
        const prop = res.data;
        const pin: PropertyPin = {
          id: String(prop.id),
          kind: "user_pin",
          lat: Number(prop.lat),
          lng: Number(prop.lng),
          title: prop.address,
          subtitle: "Your property",
          ownerId: String(prop.owner_id ?? user.id),
          scan: "unscanned",
        };
        // Attach has_3d from serializer
        (pin as any).has_3d = prop.has_3d ?? false;
        setPins([...pins, pin]);
        toast.success("Property pin added!");
      } catch {
        // Fallback: local-only mock pin
        const pin = await pinService.add({
          kind: "user_pin", lat: e.latlng.lat, lng: e.latlng.lng,
          title, subtitle: "Your saved place", scan: "unscanned",
        });
        setPins([...pins, pin]);
        toast.success("Pin added (local)");
      }
    },
  });
  return null;
}

function MapEffects() {
  const map = useMap();
  useEffect(() => {
    let unmounted = false;
    map.whenReady(() => {
      setTimeout(() => {
        if (!unmounted && map) map.invalidateSize();
      }, 50);
    });
    return () => { unmounted = true; };
  }, [map]);
  return null;
}

export function MapShell() {
  const { pins, setSelectedPinId, selectedPinId, activeFilters, setSelectedPin, user } = useApp();
  const [pois, setPois] = useState<POINode[]>([]);
  const [interestedPins, setInterestedPins] = useState<Set<string>>(new Set());

  const handleToggleInterest = async (pin: PropertyPin) => {
    if (!user) { toast.error("Sign in to mark interest."); return; }
    try {
      const interested = await socialApi.togglePropertyInterest(pin.id);
      setInterestedPins(prev => {
        const next = new Set(prev);
        if (interested) next.add(pin.id); else next.delete(pin.id);
        return next;
      });
      toast.success(interested ? "Marked as interested!" : "Removed interest");
    } catch {
      toast.error("Could not update interest");
    }
  };

  const center = useMemo<[number, number]>(() => [36.8065, 10.1815], []);

  const filteredPins = useMemo(() => {
    return pins.filter((p) => activeFilters.includes(p.kind));
  }, [pins, activeFilters]);

  return (
    <MapContainer
      center={center}
      zoom={14}
      minZoom={2}
      maxZoom={19}
      maxBounds={WORLD_BOUNDS}
      maxBoundsViscosity={1.0}
      worldCopyJump={false}
      zoomControl={true}
      className="absolute inset-0 z-0"
      attributionControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={19}
        noWrap={true}
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
            {(p as any).has_3d && (
              <div className="mt-1 text-xs text-emerald-400 font-medium">✦ 3D world available</div>
            )}
            {p.kind === "property" && (
              <button
                className="mt-2 w-full text-xs rounded-lg border px-2 py-1 transition-colors"
                style={{
                  borderColor: interestedPins.has(p.id) ? "hsl(145 70% 50%)" : "hsl(var(--border))",
                  color: interestedPins.has(p.id) ? "hsl(145 70% 50%)" : "inherit",
                }}
                onClick={() => { setSelectedPin(p); handleToggleInterest(p); }}
              >
                {interestedPins.has(p.id) ? "✓ Interested" : "🤝 I'm interested"}
              </button>
            )}
          </Popup>
        </Marker>
      ))}
      <PinOrbitTools />
    </MapContainer>
  );
}
