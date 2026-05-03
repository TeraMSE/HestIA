import { useEffect } from "react";
import { Search, Layers, Filter, LogOut, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plumbob } from "@/features/onboarding/Plumbob";
import { useApp } from "@/shared/store/useApp";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { useNavigate } from "react-router-dom";
import { pinService, personaService, apartmentService } from "@/services/mockApi";
import api from "@/services/api";
import type { PropertyPin } from "@/contracts/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";

export function MapOverlays() {
  const { setPins, setPersonas, setApartments, pins, setSelectedPinId, selectedPinId, activeFilters, toggleFilter } = useApp();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Load mock personas + apartments (still used by simulation features)
      const [pers, apts] = await Promise.all([personaService.list(), apartmentService.list()]);
      if (cancelled) return;
      setPersonas(pers);
      setApartments(apts);

      // Load real backend properties and merge with local mock seed pins
      const mockPins = await pinService.list();
      try {
        const res = await api.get("/properties/");
        const backendPins: PropertyPin[] = (res.data.results ?? res.data).map((p: any) => ({
          id: String(p.id),
          kind: "user_pin" as const,
          lat: Number(p.lat),
          lng: Number(p.lng),
          title: p.address,
          subtitle: p.owner_name ? `Owner: ${p.owner_name}` : undefined,
          ownerId: String(p.owner_id),
          scan: (p.has_3d ? "scanned" : "unscanned") as "scanned" | "unscanned",
          priceTND: p.price_tnd ? Number(p.price_tnd) : undefined,
          forSale: p.for_sale,
          forRent: p.for_rent,
        }));
        // Attach has_3d so icon renderer can show the badge
        const pinsWithMeta = backendPins.map((pin, i) => Object.assign({}, pin, { has_3d: !!(res.data.results ?? res.data)[i]?.has_3d }));
        if (!cancelled) setPins([...pinsWithMeta, ...mockPins]);
      } catch {
        if (!cancelled) setPins(mockPins);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = () => { logout(); navigate("/"); };
  const displayName = user ? (user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : user.email.split("@")[0]) : "";

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
            <div className="h-8 w-8 rounded-full grid place-items-center font-display text-sm" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block text-sm">
              <div className="font-medium leading-none">{displayName}</div>
              <div className="text-xs text-muted-foreground capitalize">{user.role}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => navigate("/settings")} aria-label="Settings" className="rounded-full hover:bg-[hsl(var(--holo-cyan)/0.2)]">
              <Settings className="h-4 w-4" />
            </Button>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-2xl" aria-label="Filter pins">
                <Filter className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 holo-surface bg-background/80 backdrop-blur-xl border-white/10">
              <DropdownMenuLabel>Show on map</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={activeFilters.includes("property")} onCheckedChange={() => toggleFilter("property")}>Properties</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={activeFilters.includes("hospital")} onCheckedChange={() => toggleFilter("hospital")}>Hospitals</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={activeFilters.includes("school")} onCheckedChange={() => toggleFilter("school")}>Schools</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={activeFilters.includes("commodity")} onCheckedChange={() => toggleFilter("commodity")}>Commodities</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={activeFilters.includes("user_pin")} onCheckedChange={() => toggleFilter("user_pin")}>My Pins</DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="holo-surface rounded-2xl">
          <Button variant="ghost" size="icon" className="rounded-2xl" aria-label="Map layers">
            <Layers className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Hint pill */}
      {user && pins.length > 0 && !selectedPinId && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[400] holo-surface rounded-full px-5 py-2 text-xs holo-text-glow font-medium">
          ✨ Tap a pin to summon its tools — or click the map to add your property
        </div>
      )}
    </>
  );
}
