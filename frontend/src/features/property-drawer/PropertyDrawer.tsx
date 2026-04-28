import { useMemo } from "react";
import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { X, Box, Users, Calculator, FileText, Home as HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export function PropertyDrawer() {
  const { pins, selectedPinId, setSelectedPinId, apartments, setSelectedApartment, openOverlay } = useApp();
  const { user } = useAuthStore();
  const pin = useMemo(() => pins.find((p) => p.id === selectedPinId), [pins, selectedPinId]);
  if (!pin) return null;

  const apartment = pin.apartmentId ? apartments.find((a) => a.id === pin.apartmentId) : null;
  const close = () => setSelectedPinId(null);

  const startCompatibility = () => {
    if (apartment) setSelectedApartment(apartment.id);
    openOverlay("simulation-runner");
  };

  return (
    <aside
      role="complementary"
      aria-label={`Details for ${pin.title}`}
      className="absolute top-4 right-4 bottom-4 z-[700] w-full sm:w-[440px] rounded-3xl animate-slide-in-right flex flex-col overflow-hidden holo-surface"
    >
      <header className="relative z-10 p-5 border-b border-[hsl(var(--holo-cyan)/0.4)] flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={pin.scan === "scanned" ? "default" : "secondary"} className="rounded-full">
              {pin.scan === "scanned" ? "3D scanned" : "Not scanned"}
            </Badge>
            {pin.kind === "user_pin" && <Badge variant="outline" className="rounded-full">Your pin</Badge>}
          </div>
          <h2 className="font-display text-2xl leading-tight holo-text-glow">{pin.title}</h2>
          {pin.subtitle && <p className="text-sm text-muted-foreground">{pin.subtitle}</p>}
          {pin.priceTND && (
            <p className="mt-2 font-semibold">
              {pin.priceTND.toLocaleString()} TND{pin.forRent ? " / month" : ""}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={close} aria-label="Close" className="rounded-full hover:bg-[hsl(var(--holo-cyan)/0.2)]">
          <X className="h-5 w-5" />
        </Button>
      </header>

      <div className="relative z-10 flex-1 flex flex-col min-h-0">
      <Tabs defaultValue="overview" className="flex-1 flex flex-col">
        <TabsList className="m-3 grid grid-cols-5 rounded-2xl">
          <TabsTrigger value="overview"><HomeIcon className="h-4 w-4" /></TabsTrigger>
          <TabsTrigger value="3d"><Box className="h-4 w-4" /></TabsTrigger>
          <TabsTrigger value="compat"><Users className="h-4 w-4" /></TabsTrigger>
          <TabsTrigger value="materials"><Calculator className="h-4 w-4" /></TabsTrigger>
          <TabsTrigger value="admin"><FileText className="h-4 w-4" /></TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          <TabsContent value="overview" className="space-y-3 mt-0">
            <div className="rounded-2xl bg-muted p-4">
              <div className="text-xs text-muted-foreground">Location</div>
              <div className="font-mono text-sm">{pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}</div>
            </div>
            {apartment && (
              <div className="rounded-2xl bg-muted p-4 space-y-1 text-sm">
                <div className="font-medium mb-2">Apartment details</div>
                <div>Bedrooms: {apartment.rooms.bedrooms} · Bathrooms: {apartment.rooms.bathrooms}</div>
                <div>Floor: {apartment.building.floor} · {apartment.building.condition}</div>
                <div>Orientation: {apartment.building.orientation}</div>
                <div>Windows: {apartment.building.windows} · {apartment.building.cooling ? "AC" : "no AC"}</div>
              </div>
            )}
            {user?.role === "renter" || user?.role === "buyer" ? (
              <Button className="w-full rounded-2xl" onClick={() => toast.success("Visit request sent (mock)")}>Request a visit</Button>
            ) : (
              <Button className="w-full rounded-2xl" onClick={() => toast.success("Listing edit (mock)")}>Edit listing</Button>
            )}
          </TabsContent>

          <TabsContent value="3d" className="mt-0">
            <div className="rounded-3xl bg-gradient-sky border border-border p-6 text-center">
              <Box className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-display text-xl mb-1">3D Room World</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {pin.scan === "scanned"
                  ? "Explore this property in an immersive 3D environment with AI agents."
                  : "Upload a panorama to generate a 3D world for this property."}
              </p>
              <div className="flex flex-col gap-2">
                <Button
                  className="rounded-2xl shadow-sims"
                  onClick={() => openOverlay("room-sim")}
                >
                  {pin.scan === "scanned" ? "🌍 Enter 3D World" : "📷 Upload & Generate 3D"}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="compat" className="mt-0 space-y-3">
            <p className="text-sm text-muted-foreground">Run a HestIA compatibility simulation between two personas in this apartment.</p>
            <Button className="w-full rounded-2xl" onClick={startCompatibility}>Open Simulation Runner</Button>
          </TabsContent>

          <TabsContent value="materials" className="mt-0 space-y-3">
            <p className="text-sm text-muted-foreground">Estimate construction materials for a property like this one.</p>
            <Button className="w-full rounded-2xl" onClick={() => openOverlay("material-agent")}>Open Material Agent</Button>
          </TabsContent>

          <TabsContent value="admin" className="mt-0 space-y-3">
            <p className="text-sm text-muted-foreground">Get step-by-step guidance on Tunisian renting, buying, or listing.</p>
            <Button className="w-full rounded-2xl" onClick={() => openOverlay("admin-assistant")}>Ask the Admin Assistant</Button>
          </TabsContent>
        </div>
      </Tabs>
      </div>
    </aside>
  );
}
