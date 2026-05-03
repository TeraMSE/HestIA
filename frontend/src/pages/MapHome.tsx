import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { MapShell } from "@/features/map/MapShell";
import { MapOverlays } from "@/features/map/MapOverlays";
import { PropertyDrawer } from "@/features/property-drawer/PropertyDrawer";
import { ModuleDashboard } from "@/features/dashboard/ModuleDashboard";
import { PersonaBuilder } from "@/features/persona/PersonaBuilder";
import { ApartmentConfigurator } from "@/features/apartment/ApartmentConfigurator";
import { VisualReplay } from "@/features/replay/VisualReplay";
import { Reports } from "@/features/reports/Reports";
import { MaterialAgent } from "@/features/material-agent/MaterialAgent";
import { AdminAssistant } from "@/features/admin-assistant/AdminAssistant";
import { NeighborhoodIntel } from "@/features/neighborhood/NeighborhoodIntel";
import { ApplianceEnergy } from "@/features/appliance-energy/ApplianceEnergy";
import { RoommatePanel } from "@/features/roommate/RoommatePanel";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function MapHome() {
  const { activeOverlay, placementMode, setPlacementMode, user: appUser } = useApp();
  const authUser = useAuthStore((s) => s.user);
  // Check both stores — appUser from old system, authUser from JWT store
  const isLandlord = authUser?.role === "landlord" || appUser?.role === "landlord";
  
  // Debug: log current role to verify auth state
  if (process.env.NODE_ENV === 'development') {
    console.log("MapHome role check — authUser:", authUser?.role, "appUser:", appUser?.role, "isLandlord:", isLandlord);
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      <MapShell />
      <MapOverlays />
      <PropertyDrawer />

      {activeOverlay === "module-dashboard" && <ModuleDashboard />}
      {activeOverlay === "persona-builder" && <PersonaBuilder />}
      {activeOverlay === "apartment-configurator" && <ApartmentConfigurator />}
      {activeOverlay === "visual-replay" && <VisualReplay />}
      {activeOverlay === "reports" && <Reports />}
      {activeOverlay === "material-agent" && <MaterialAgent />}
      {activeOverlay === "admin-assistant" && <AdminAssistant />}
      {activeOverlay === "neighborhood-intel" && <NeighborhoodIntel />}
      {activeOverlay === "appliance-energy" && <ApplianceEnergy />}
      {activeOverlay === "apt-configurator" && <ApartmentConfigurator />}
      {activeOverlay === "roommate-compat" && <RoommatePanel />}

      {/* Landlord: Add Property button — only visible for landlord accounts */}
      {isLandlord && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[600] flex flex-col items-center gap-2 pointer-events-auto">
          {placementMode ? (
            <Button
              variant="destructive"
              className="rounded-full shadow-xl px-8 py-5 text-base font-semibold"
              onClick={() => setPlacementMode(false)}
            >
              &#x2715; Cancel Placement
            </Button>
          ) : (
            <Button
              className="rounded-full shadow-xl px-8 py-5 text-base font-semibold bg-[hsl(185_95%_65%/0.15)] hover:bg-[hsl(185_95%_65%/0.25)] border border-[hsl(185_95%_65%/0.5)] text-[hsl(185,95%,65%)] transition-all hover:scale-105 active:scale-95"
              onClick={() => setPlacementMode(true)}
            >
              <Plus className="h-5 w-5 mr-2" /> Add Property
            </Button>
          )}
          {placementMode && (
            <div className="bg-black/80 text-[hsl(185,95%,65%)] text-sm px-4 py-2 rounded-full border border-[hsl(185_95%_65%/0.4)] animate-pulse">
              Click on the map to place your property
            </div>
          )}
        </div>
      )}
    </div>
  );
}

