import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { useApp } from "@/shared/store/useApp";

/** Keeps the map auto-focused on the selected pin. No visual overlay. */
export function PinOrbitTools() {
  const map = useMap();
  const { pins, selectedPinId } = useApp();
  const pin = pins.find((p) => p.id === selectedPinId);

  useEffect(() => {
    if (!pin) return;
    map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [pin, map]);

  return null;
}
