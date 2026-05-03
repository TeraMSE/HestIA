import { useApp } from "@/shared/store/useApp";
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

export default function MapHome() {
  const { activeOverlay } = useApp();

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
    </div>
  );
}

