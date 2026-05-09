import { Zap, Bot, Microscope, BarChart2, Eye, EyeOff } from "lucide-react";
import { useApp } from "@/shared/store/useApp";
import type { WorldLayerId } from "@/shared/store/useApp";

const LAYERS: { id: WorldLayerId; icon: typeof Zap; label: string }[] = [
  { id: "energy",     icon: Zap,        label: "Energy Layer" },
  { id: "simulation", icon: Bot,        label: "Simulation Layer" },
  { id: "mold",       icon: Microscope, label: "Mold Detection" },
  { id: "stats",      icon: BarChart2,  label: "Property Stats" },
];

export function LayerToolbar() {
  const { activeWorldLayer, toggleWorldLayer, showCeiling, toggleCeiling } = useApp();

  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2 z-[1020] flex flex-col gap-2">
      {LAYERS.map(({ id, icon: Icon, label }) => {
        const isActive = activeWorldLayer === id;
        return (
          <div key={id} className="relative group">
            <button
              onClick={() => toggleWorldLayer(id)}
              aria-label={label}
              className={`
                w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-200
                bg-black/60 backdrop-blur-md border
                ${isActive
                  ? "border-[hsl(var(--holo-cyan))] text-[hsl(var(--holo-cyan))] shadow-[0_0_16px_hsl(var(--holo-cyan)/0.5)] ring-2 ring-[hsl(var(--holo-cyan)/0.3)]"
                  : "border-white/20 text-white/60 hover:text-white hover:border-white/40 hover:bg-white/10"
                }
              `}
            >
              <Icon className="h-5 w-5" />
            </button>
            <div className="absolute right-14 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <div className="bg-black/80 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-xl border border-white/20 whitespace-nowrap">
                {label}
              </div>
            </div>
          </div>
        );
      })}

      {/* Ceiling toggle — always visible below layers */}
      <div className="relative group mt-1 border-t border-white/10 pt-2">
        <button
          onClick={toggleCeiling}
          aria-label={showCeiling ? "Hide Ceiling" : "Show Ceiling"}
          className={`
            w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-200
            bg-black/60 backdrop-blur-md border
            ${showCeiling
              ? "border-amber-400/60 text-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.3)]"
              : "border-white/20 text-white/60 hover:text-white hover:border-white/40 hover:bg-white/10"
            }
          `}
        >
          {showCeiling ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
        </button>
        <div className="absolute right-14 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <div className="bg-black/80 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-xl border border-white/20 whitespace-nowrap">
            {showCeiling ? "Hide Ceiling" : "Show Ceiling"}
          </div>
        </div>
      </div>
    </div>
  );
}
