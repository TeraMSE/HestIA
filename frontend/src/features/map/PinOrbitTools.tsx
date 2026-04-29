import { useEffect, useState } from "react";
import { useMap } from "react-leaflet";
import { useApp, OverlayId } from "@/shared/store/useApp";
import { LayoutDashboard, Users, Home, Calculator, History, Sparkles, MessageCircle, Box, X, Activity } from "lucide-react";

interface ToolDef { id: Exclude<OverlayId, null>; label: string; Icon: typeof Users }

const TOOLS: ToolDef[] = [
  { id: "module-dashboard",      label: "Dashboard",  Icon: LayoutDashboard },
  { id: "persona-builder",       label: "Personas",   Icon: Users },
  { id: "apartment-configurator",label: "Apartment",  Icon: Home },
  { id: "visual-replay",         label: "Simulation", Icon: Box },
  { id: "simulation-runner",     label: "Setup Sim",  Icon: Activity },
  { id: "material-agent",        label: "Materials",  Icon: Calculator },
  { id: "reports",               label: "Reports",    Icon: History },
  { id: "admin-assistant",       label: "Admin help", Icon: MessageCircle },
];

/**
 * Renders the feature tools in a holographic ring around the
 * currently-selected map pin. Mounted inside <MapContainer> so it
 * has access to the Leaflet map for projection + flyTo.
 */
export function PinOrbitTools() {
  const map = useMap();
  const { pins, selectedPinId, setSelectedPinId, openOverlay } = useApp();
  const pin = pins.find((p) => p.id === selectedPinId);

  // Position re-projected on map move/zoom
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!pin) { setPos(null); return; }

    // Smooth zoom toward the pin
    map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });

    const project = () => {
      const p = map.latLngToContainerPoint([pin.lat, pin.lng]);
      setPos({ x: p.x, y: p.y });
    };
    project();
    map.on("move zoom moveend zoomend resize", project);
    return () => { map.off("move zoom moveend zoomend resize", project); };
  }, [pin, map]);

  if (!pin || !pos) return null;

  // Push the ring slightly to the LEFT so the right-side property drawer doesn't cover it
  const cx = Math.min(pos.x, (map.getContainer().clientWidth ?? 0) - 480);
  const cy = pos.y;
  const radius = 130;
  const startAngle = -Math.PI; // start at left
  const endAngle = 0;          // end at right (top semicircle)

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[600]"
      aria-label="Property tools"
    >
      {/* Pulse ring centered on pin */}
      <div className="orbit-pulse" style={{ left: cx, top: cy }} />
      <div className="orbit-pulse" style={{ left: cx, top: cy, animationDelay: "1.1s" }} />

      {/* Radial tool buttons (top semicircle) */}
      {TOOLS.map((t, i) => {
        const angle = startAngle + ((endAngle - startAngle) * i) / (TOOLS.length - 1);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        return (
          <button
            key={t.id}
            onClick={() => openOverlay(t.id)}
            className="orbit-tool pointer-events-auto group flex flex-col items-center"
            style={{
              left: cx,
              top: cy,
              ["--orbit-x" as any]: `calc(-50% + ${dx}px)`,
              ["--orbit-y" as any]: `calc(-50% + ${dy}px)`,
              animationDelay: `${i * 70}ms`,
            }}
            aria-label={t.label}
          >
            <div className="holo-surface rounded-full h-12 w-12 flex items-center justify-center transition-transform group-hover:scale-110">
              <t.Icon className="h-5 w-5 text-foreground holo-text-glow" />
            </div>
            <span className="mt-1 text-[10px] font-medium text-foreground holo-text-glow opacity-0 group-hover:opacity-100 transition-opacity bg-card/40 backdrop-blur px-2 py-0.5 rounded-full whitespace-nowrap">
              {t.label}
            </span>
          </button>
        );
      })}

      {/* Close ring button */}
      <button
        onClick={() => setSelectedPinId(null)}
        className="orbit-tool pointer-events-auto"
        style={{
          left: cx, top: cy,
          ["--orbit-x" as any]: `calc(-50% + 0px)`,
          ["--orbit-y" as any]: `calc(-50% + ${radius + 30}px)`,
          animationDelay: `${TOOLS.length * 70}ms`,
        }}
        aria-label="Close pin tools"
      >
        <div className="holo-surface rounded-full h-9 w-9 flex items-center justify-center hover:scale-110 transition-transform">
          <X className="h-4 w-4" />
        </div>
      </button>
    </div>
  );
}
