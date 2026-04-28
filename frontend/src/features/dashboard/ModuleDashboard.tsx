import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { useApp } from "@/shared/store/useApp";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Users, Home, History } from "lucide-react";

export function ModuleDashboard() {
  const { personas, apartments, openOverlay } = useApp();
  const services = [
    { name: "Mock API", status: "ok" },
    { name: "Map tiles", status: "ok" },
    { name: "Material vision", status: "stub" },
    { name: "Gemini 3.1 Pro (planned)", status: "pending" },
  ];

  return (
    <OverlayPanel title="Module Dashboard" subtitle="Quick actions and module status" size="lg">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="p-4 rounded-2xl">
          <div className="text-xs text-muted-foreground">Saved personas</div>
          <div className="font-display text-3xl">{personas.length}</div>
        </Card>
        <Card className="p-4 rounded-2xl">
          <div className="text-xs text-muted-foreground">Saved apartments</div>
          <div className="font-display text-3xl">{apartments.length}</div>
        </Card>
        <Card className="p-4 rounded-2xl bg-secondary/40">
          <div className="text-xs text-muted-foreground">Recent runs</div>
          <div className="font-display text-3xl">—</div>
        </Card>
        <Card className="p-4 rounded-2xl bg-primary/10">
          <div className="text-xs text-muted-foreground">Mode</div>
          <div className="font-display text-lg">Mock data</div>
        </Card>
      </div>

      <h3 className="font-display text-lg mb-3">Quick actions</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Button variant="outline" className="rounded-2xl h-20 flex-col gap-1" onClick={() => openOverlay("persona-builder")}>
          <Users className="h-5 w-5" /> Persona Builder
        </Button>
        <Button variant="outline" className="rounded-2xl h-20 flex-col gap-1" onClick={() => openOverlay("apartment-configurator")}>
          <Home className="h-5 w-5" /> Configure apt
        </Button>
        <Button variant="outline" className="rounded-2xl h-20 flex-col gap-1" onClick={() => openOverlay("simulation-runner")}>
          <Sparkles className="h-5 w-5" /> Run sim
        </Button>
        <Button variant="outline" className="rounded-2xl h-20 flex-col gap-1" onClick={() => openOverlay("reports")}>
          <History className="h-5 w-5" /> History
        </Button>
      </div>

      <h3 className="font-display text-lg mb-3">Backend health</h3>
      <div className="space-y-2">
        {services.map((s) => (
          <div key={s.name} className="flex items-center justify-between rounded-2xl border border-border p-3">
            <span>{s.name}</span>
            <Badge
              className="rounded-full"
              variant={s.status === "ok" ? "default" : s.status === "stub" ? "secondary" : "outline"}
            >
              {s.status}
            </Badge>
          </div>
        ))}
      </div>
    </OverlayPanel>
  );
}
