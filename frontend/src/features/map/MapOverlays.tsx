import { useEffect } from "react";
import { Search, Layers, Filter, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plumbob } from "@/features/onboarding/Plumbob";
import { useApp } from "@/shared/store/useApp";
import { useNavigate } from "react-router-dom";
import { pinService, personaService, apartmentService } from "@/services/mockApi";

export function MapOverlays() {
  const { user, setUser, setPins, setPersonas, setApartments, pins, setSelectedPinId, selectedPinId } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, pers, apts] = await Promise.all([pinService.list(), personaService.list(), apartmentService.list()]);
      if (cancelled) return;
      setPins(p); setPersonas(pers); setApartments(apts);
    })();
    return () => { cancelled = true; };
  }, [setPins, setPersonas, setApartments]);

  const handleLogout = () => { setUser(null); navigate("/"); };

  const handleSearch = (q: string) => {
    const term = q.trim().toLowerCase();
    if (!term) return;
    const hit = pins.find((p) => p.title.toLowerCase().includes(term) || p.subtitle?.toLowerCase().includes(term));
    if (hit) setSelectedPinId(hit.id);
  };

  return (
    <>
      {/* Top-left brand + profile (holographic) */}
      <div className="absolute top-4 left-4 z-[500] flex items-center gap-3 holo-surface rounded-2xl pl-3 pr-4 py-2">
        <Plumbob className="h-7 w-7 animate-plumbob" />
        <span className="font-display text-lg holo-text-glow">HestIA</span>
        {user && (
          <>
            <span className="h-6 w-px bg-[hsl(var(--holo-cyan)/0.5)] mx-1" />
            <div className="h-8 w-8 rounded-full grid place-items-center font-display text-sm" style={{ background: user.avatarColor ?? "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block text-sm">
              <div className="font-medium leading-none">{user.displayName}</div>
              <div className="text-xs text-muted-foreground capitalize">{user.role}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Sign out" className="rounded-full hover:bg-[hsl(var(--holo-cyan)/0.2)]">
              <LogOut className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Top-right search + filters + layers (holographic) */}
      <div className="absolute top-4 right-4 z-[500] flex items-center gap-2">
        <div className="relative holo-surface rounded-2xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
          <Input
            placeholder="Search address or property…"
            className="pl-9 w-72 rounded-2xl bg-transparent border-0 relative z-10"
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch((e.target as HTMLInputElement).value); }}
          />
        </div>
        <div className="holo-surface rounded-2xl">
          <Button variant="ghost" size="icon" className="rounded-2xl" aria-label="Filter pins">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
        <div className="holo-surface rounded-2xl">
          <Button variant="ghost" size="icon" className="rounded-2xl" aria-label="Map layers">
            <Layers className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Hint pill — only when no pin selected */}
      {user && pins.length > 0 && !selectedPinId && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[400] holo-surface rounded-full px-5 py-2 text-xs holo-text-glow font-medium">
          ✨ Tap a pin to summon its tools — or click the map to drop your own
        </div>
      )}
    </>
  );
}
