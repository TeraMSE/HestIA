import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/shared/store/useApp";
import { MapShell } from "@/features/map/MapShell";
import { MapOverlays } from "@/features/map/MapOverlays";
import { PropertyDrawer } from "@/features/property-drawer/PropertyDrawer";
import { ModuleDashboard } from "@/features/dashboard/ModuleDashboard";
import { PersonaBuilder } from "@/features/persona/PersonaBuilder";
import { ApartmentConfigurator } from "@/features/apartment/ApartmentConfigurator";
import { SimulationRunner } from "@/features/simulation/SimulationRunner";
import { VisualReplay } from "@/features/replay/VisualReplay";
import { Reports } from "@/features/reports/Reports";
import { MaterialAgent } from "@/features/material-agent/MaterialAgent";
import { AdminAssistant } from "@/features/admin-assistant/AdminAssistant";

export default function MapHome() {
  const { user, activeOverlay } = useApp();
  const navigate = useNavigate();

  useEffect(() => { if (!user) navigate("/"); }, [user, navigate]);
  if (!user) return null;

  return (
    <div className="fixed inset-0 overflow-hidden">
      <MapShell />
      <MapOverlays />
      <PropertyDrawer />

      {activeOverlay === "module-dashboard" && <ModuleDashboard />}
      {activeOverlay === "persona-builder" && <PersonaBuilder />}
      {activeOverlay === "apartment-configurator" && <ApartmentConfigurator />}
      {activeOverlay === "simulation-runner" && <SimulationRunner />}
      {activeOverlay === "visual-replay" && <VisualReplay />}
      {activeOverlay === "reports" && <Reports />}
      {activeOverlay === "material-agent" && <MaterialAgent />}
      {activeOverlay === "admin-assistant" && <AdminAssistant />}
    </div>
  );
}
