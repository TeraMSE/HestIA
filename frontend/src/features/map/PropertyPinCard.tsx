import { useCallback, useState } from "react";
import { useMemo } from "react";
import { X, Box, Heart, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { socialApi } from "@/services/socialApi";
import { toast } from "sonner";

export function PropertyPinCard() {
  const { pins, selectedPinId, setSelectedPinId, openOverlay } = useApp();
  const { user } = useAuthStore();
  const pin = useMemo(() => pins.find((p) => p.id === selectedPinId), [pins, selectedPinId]);

  const [isInterested, setIsInterested] = useState(false);
  const [interestLoading, setInterestLoading] = useState(false);

  const isRealPin = pin ? !isNaN(Number(pin.id)) : false;

  const handleToggleInterest = useCallback(async () => {
    if (!pin || !user) { toast.error("Sign in to mark interest."); return; }
    if (!isRealPin) { toast.info("Demo properties cannot be favorited."); return; }
    setInterestLoading(true);
    try {
      const interested = await socialApi.togglePropertyInterest(pin.id);
      setIsInterested(interested);
      toast.success(interested ? "Added to your interested list!" : "Removed from interested list");
    } catch {
      toast.error("Could not update interest.");
    } finally {
      setInterestLoading(false);
    }
  }, [pin, user, isRealPin]);

  if (!pin) return null;

  const isScanned = pin.scan === "scanned";

  return (
    <div className="absolute right-4 bottom-8 z-[700] w-[288px] animate-slide-in-right">
      <div className="holo-surface rounded-3xl overflow-hidden">
        {/* Close */}
        <button
          onClick={() => setSelectedPinId(null)}
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/40 flex items-center justify-center text-white/70 hover:text-white hover:bg-black/60 transition-all"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Scan badge strip */}
        <div className={`h-1.5 w-full ${isScanned ? "bg-gradient-to-r from-[hsl(185_95%_45%)] to-[hsl(185_95%_65%)]" : "bg-white/10"}`} />

        <div className="px-5 pt-4 pb-5 space-y-4">
          {/* Property info */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Badge
                variant={isScanned ? "default" : "secondary"}
                className="rounded-full text-xs"
              >
                {isScanned ? "3D Scanned" : "Not Scanned"}
              </Badge>
              {pin.kind === "user_pin" && (
                <Badge variant="outline" className="rounded-full text-xs">Your pin</Badge>
              )}
            </div>
            <h2 className="font-display text-lg font-semibold leading-tight holo-text-glow">{pin.title}</h2>
            {pin.subtitle && <p className="text-xs text-white/60 mt-0.5">{pin.subtitle}</p>}
            {pin.priceTND && (
              <p className="mt-2 text-base font-bold text-white">
                {pin.priceTND.toLocaleString()} <span className="text-sm font-normal text-white/50">TND{pin.forRent ? " / month" : ""}</span>
              </p>
            )}
          </div>

          {/* Hero CTA */}
          <Button
            onClick={() => openOverlay("visual-replay")}
            className="w-full rounded-2xl font-semibold py-5 text-sm flex items-center justify-center gap-2"
            style={{
              background: isScanned
                ? "linear-gradient(135deg, hsl(185 95% 40%), hsl(185 95% 62%))"
                : "linear-gradient(135deg, hsl(220 30% 22%), hsl(220 30% 30%))",
              boxShadow: isScanned ? "0 0 20px hsl(185 95% 65% / 0.4), 0 4px 12px rgba(0,0,0,0.3)" : "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            {isScanned ? (
              <><Box className="h-4 w-4" /> Enter 3D World</>
            ) : (
              <><Upload className="h-4 w-4" /> Upload &amp; Generate 3D</>
            )}
          </Button>

          {/* Secondary actions */}
          <div className="flex items-center gap-2">
            {user && (
              <button
                onClick={handleToggleInterest}
                disabled={interestLoading}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-all ${
                  isInterested
                    ? "bg-[hsl(var(--holo-pink)/0.15)] border-[hsl(var(--holo-pink)/0.4)] text-[hsl(var(--holo-pink))]"
                    : "bg-white/5 border-white/15 text-white/60 hover:text-white hover:border-white/30"
                }`}
              >
                <Heart className={`h-3.5 w-3.5 ${isInterested ? "fill-current" : ""}`} />
                {isInterested ? "Interested" : "Mark Interest"}
              </button>
            )}

            {isScanned && (
              <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--holo-cyan))] ml-auto">
                <Sparkles className="h-3 w-3" />
                <span>Ready to explore</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
