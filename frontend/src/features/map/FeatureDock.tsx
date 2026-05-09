import {
  User, Home, BarChart2, Layers, Map, Zap, Users, ShieldAlert,
} from "lucide-react";
import { useApp } from "@/shared/store/useApp";
import type { OverlayId } from "@/shared/store/useApp";

const DOCK_ITEMS: { id: OverlayId; icon: typeof User; label: string }[] = [
  { id: "persona-builder",        icon: User,        label: "Persona" },
  { id: "apartment-configurator", icon: Home,        label: "Apartment" },
  { id: "reports",                icon: BarChart2,   label: "Reports" },
  { id: "material-agent",         icon: Layers,      label: "Materials" },
  { id: "neighborhood-intel",     icon: Map,         label: "Neighborhood" },
  { id: "appliance-energy",       icon: Zap,         label: "Energy" },
  { id: "roommate-compat",        icon: Users,       label: "Roommates" },
  { id: "admin-assistant",        icon: ShieldAlert, label: "Assistant" },
];

export function FeatureDock() {
  const { activeOverlay, openOverlay, closeOverlay } = useApp();

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[600] flex items-center gap-1.5 px-3 py-2 rounded-2xl holo-surface">
      {DOCK_ITEMS.map(({ id, icon: Icon, label }) => {
        const isActive = activeOverlay === id;
        return (
          <div key={id} className="relative group">
            <button
              onClick={() => isActive ? closeOverlay() : openOverlay(id)}
              aria-label={label}
              className={`
                w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200
                ${isActive
                  ? "bg-[hsl(var(--holo-cyan)/0.2)] border border-[hsl(var(--holo-cyan)/0.6)] text-[hsl(var(--holo-cyan))] shadow-[0_0_12px_hsl(var(--holo-cyan)/0.4)] scale-110"
                  : "border border-transparent text-[hsl(220_20%_50%)] hover:text-[hsl(185_95%_38%)] hover:bg-[hsl(var(--holo-cyan)/0.1)] hover:border-[hsl(var(--holo-cyan)/0.3)] hover:scale-105"
                }
              `}
            >
              <Icon className="h-4 w-4" />
            </button>
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10">
              <div className="bg-black/90 text-white text-[10px] font-medium px-2 py-1 rounded-lg border border-white/20 whitespace-nowrap">
                {label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
