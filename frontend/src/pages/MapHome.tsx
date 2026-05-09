import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { MapShell } from "@/features/map/MapShell";
import { MapOverlays } from "@/features/map/MapOverlays";
import { WorldOverlay } from "@/features/world-overlay/WorldOverlay";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { CatChatWidget } from "@/features/rag-assistant/CatChatWidget";

export default function MapHome() {
  const { worldOpen, placementMode, setPlacementMode, user: appUser } = useApp();
  const authUser = useAuthStore((s) => s.user);
  const isLandlord = authUser?.role === "landlord" || appUser?.role === "landlord";

  if (process.env.NODE_ENV === 'development') {
    console.log("MapHome role check — authUser:", authUser?.role, "appUser:", appUser?.role, "isLandlord:", isLandlord);
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      <MapShell />
      <MapOverlays />

      {worldOpen && <WorldOverlay />}

      {/* Landlord: Add Property button — hidden while 3D world is open */}
      {isLandlord && !worldOpen && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[601] flex flex-col items-center gap-2 pointer-events-auto">
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
              className="rounded-full shadow-xl px-8 py-5 text-base font-semibold bg-[hsl(185_95%_42%)] hover:bg-[hsl(185_95%_37%)] border border-[hsl(185_95%_65%/0.7)] text-white shadow-[0_0_20px_hsl(185_95%_65%/0.45)] transition-all hover:scale-105 active:scale-95"
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
      <CatChatWidget />
    </div>
  );
}
