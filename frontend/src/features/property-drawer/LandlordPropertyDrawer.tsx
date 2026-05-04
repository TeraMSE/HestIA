import { useMemo, useState, useCallback } from "react";
import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { X, Box, Calculator, FileText, Home as HomeIcon, Layers, Settings2, Heart, Users } from "lucide-react";
import { AppliancePanoramaSection } from "@/features/appliance-energy/AppliancePanoramaSection";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PipelineTab } from "./PipelineTab";
import { socialApi } from "@/services/socialApi";

export function LandlordPropertyDrawer() {
  const { pins, selectedPinId, setSelectedPinId, apartments, setSelectedApartment, openOverlay } = useApp();
  const { user } = useAuthStore();
  const pin = useMemo(() => pins.find((p) => p.id === selectedPinId), [pins, selectedPinId]);

  // Interest / Favorite state
  const [isInterested, setIsInterested] = useState(false);
  const [interestLoading, setInterestLoading] = useState(false);

  const isRealPin = pin ? !isNaN(Number(pin.id)) : false;
  const isLandlord = user?.role === "landlord";

  const handleToggleInterest = useCallback(async () => {
    if (!pin || !user) { toast.error("Sign in to mark interest."); return; }
    if (!isRealPin) { toast.info("Demo properties cannot be favorited."); return; }
    setInterestLoading(true);
    try {
      const interested = await socialApi.togglePropertyInterest(pin.id);
      setIsInterested(interested);
      toast.success(interested ? "Added to your interested list!" : "Removed from interested list");
    } catch {
      toast.error("Could not update interest. Please try again.");
    } finally {
      setInterestLoading(false);
    }
  }, [pin, user, isRealPin]);

  if (!pin) return null;

  const apartment = pin.apartmentId ? apartments.find((a) => a.id === pin.apartmentId) : null;
  const close = () => setSelectedPinId(null);

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
          {/* Tabs: Overview | 3D | Pipeline | Materials | Admin | Roommate (for renters/buyers) */}
          <TabsList className={`m-3 grid rounded-2xl ${isLandlord ? "grid-cols-5" : "grid-cols-6"}`}>
            <TabsTrigger value="overview" title="Overview"><HomeIcon className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="3d" title="3D World"><Box className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="pipeline" title="Life Simulation Pipeline"><Layers className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="materials" title="Materials"><Calculator className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="admin" title="Admin"><FileText className="h-4 w-4" /></TabsTrigger>
            {!isLandlord && (
              <TabsTrigger value="roommate" title="Roommate Compatibility"><Users className="h-4 w-4" /></TabsTrigger>
            )}
          </TabsList>

          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {/* ── Overview ──────────────────────────────────────────────────── */}
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
              {/* Interest / Favorite button — shown to renters & buyers for real properties */}
              {!isLandlord && isRealPin && (
                <Button
                  variant={isInterested ? "default" : "outline"}
                  className={`w-full rounded-2xl gap-2 transition-all ${
                    isInterested
                      ? "bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/50 text-rose-400"
                      : "hover:bg-rose-500/10 hover:border-rose-500/40 hover:text-rose-400"
                  }`}
                  onClick={handleToggleInterest}
                  disabled={interestLoading}
                >
                  <Heart className={`h-4 w-4 ${isInterested ? "fill-rose-400 text-rose-400" : ""}`} />
                  {interestLoading ? "Updating..." : isInterested ? "Interested ✓" : "I'm Interested"}
                </Button>
              )}

              {user?.role === "renter" || user?.role === "buyer" ? (
                <Button className="w-full rounded-2xl" onClick={() => toast.success("Visit request sent (mock)")}>Request a visit</Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button className="w-full rounded-2xl" onClick={() => toast.success("Listing edit (mock)")}>Edit listing</Button>
                  <Button variant="outline" className="w-full rounded-2xl gap-1.5" onClick={() => openOverlay("apt-configurator")}>
                    <Settings2 className="h-4 w-4" /> Configure Apartment
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── 3D ────────────────────────────────────────────────────────── */}
            <TabsContent value="3d" className="mt-0 space-y-4">
              <div className="rounded-3xl bg-gradient-sky border border-border p-6 text-center">
                <Box className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <h3 className="font-display text-xl mb-1">3D Room World</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {pin.scan === "scanned"
                    ? "Explore this property in an immersive 3D environment with AI agents."
                    : "Upload a panorama to generate a 3D world for this property."}
                </p>
                <Button
                  className="rounded-2xl shadow-sims w-full"
                  onClick={() => openOverlay("visual-replay")}
                >
                  {pin.scan === "scanned" ? "🌍 Enter 3D World" : "📷 Upload & Generate 3D"}
                </Button>
              </div>
              <AppliancePanoramaSection pin={pin} />
            </TabsContent>

            {/* ── Pipeline (merged from Intel + Simulate) ───────────────────── */}
            <TabsContent value="pipeline" className="mt-0">
              <PipelineTab pin={pin} apartment={apartment} />
            </TabsContent>

            {/* ── Materials ─────────────────────────────────────────────────── */}
            <TabsContent value="materials" className="mt-0 space-y-3">
              <p className="text-sm text-muted-foreground">Estimate construction materials for a property like this one.</p>
              <Button className="w-full rounded-2xl" onClick={() => openOverlay("material-agent")}>Open Material Agent</Button>
            </TabsContent>

            {/* ── Admin ─────────────────────────────────────────────────────── */}
            <TabsContent value="admin" className="mt-0 space-y-3">
              <p className="text-sm text-muted-foreground">Get step-by-step guidance on Tunisian renting, buying, or listing.</p>
              <Button className="w-full rounded-2xl" onClick={() => openOverlay("admin-assistant")}>Ask the Admin Assistant</Button>
            </TabsContent>

            {/* ── Roommate Compatibility (renters & buyers only) ─────────── */}
            {!isLandlord && (
              <TabsContent value="roommate" className="mt-0 space-y-3">
                <div className="rounded-2xl bg-gradient-to-br from-[hsl(var(--holo-cyan)/0.08)] to-transparent border border-[hsl(var(--holo-cyan)/0.2)] p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-[hsl(var(--holo-cyan)/0.15)] rounded-xl">
                      <Users className="h-5 w-5 text-[hsl(var(--holo-cyan))]" />
                    </div>
                    <h3 className="font-semibold text-white">Roommate Compatibility</h3>
                  </div>
                  <p className="text-sm text-gray-400 leading-relaxed mb-4">
                    Find a compatible roommate from users who favorited this apartment.
                    Run an AI cohabitation simulation to see how well you'd live together.
                  </p>
                  <Button
                    className="w-full rounded-2xl bg-[hsl(var(--holo-cyan)/0.15)] hover:bg-[hsl(var(--holo-cyan)/0.25)] border border-[hsl(var(--holo-cyan)/0.4)] text-[hsl(var(--holo-cyan))] gap-2"
                    onClick={() => openOverlay("roommate-compat")}
                    disabled={!isRealPin}
                  >
                    <Users className="h-4 w-4" />
                    {isRealPin ? "Find a Roommate" : "Select a real property to use this feature"}
                  </Button>
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>
    </aside>
  );
}
