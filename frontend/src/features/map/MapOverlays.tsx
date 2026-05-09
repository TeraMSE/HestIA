import { useEffect } from "react";
import { Search, Filter, LogOut, Settings } from "lucide-react";
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
      const [pers, apts] = await Promise.all([personaService.list(), apartmentService.list()]);
      if (cancelled) return;
      setPersonas(pers);
      setApartments(apts);

      const mockPins = await pinService.list();
      try {
        const res = await api.get("/properties/");
        const backendPins: PropertyPin[] = (res.data.results ?? res.data).map((p: any) => ({
          id: String(p.id),
          kind: "property" as const,
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
      {/* Single unified top bar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] holo-surface rounded-2xl flex items-center pl-3 pr-2 py-1.5 gap-2 w-max max-w-[calc(100vw-2rem)]">
        {/* Brand logo — drop your image at frontend/public/logo.png */}
        <img
          src="/logo.png"
          alt="HestIA"
          className="h-7 w-auto flex-shrink-0 object-contain"
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = "none";
            const fallback = el.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = "flex";
          }}
        />
        <span
          className="items-center gap-1.5 font-display text-base holo-text-glow flex-shrink-0"
          style={{ display: "none" }}
        >
          <Plumbob className="h-5 w-5 animate-plumbob" /> HestIA
        </span>

        <span className="h-6 w-px bg-[hsl(var(--holo-cyan)/0.5)] flex-shrink-0" />

        {/* Search */}
        <div className="relative flex items-center">
          <Search className="absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--holo-cyan))] pointer-events-none" />
          <Input
            placeholder="Search…"
            className="pl-5 w-40 h-7 rounded-xl bg-transparent border-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch((e.target as HTMLInputElement).value); }}
          />
        </div>

        {/* Filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost" size="icon"
              className="rounded-xl w-8 h-8 flex-shrink-0 text-[hsl(var(--holo-cyan))] hover:bg-[hsl(var(--holo-cyan)/0.15)] hover:text-[hsl(var(--holo-cyan))]"
              aria-label="Filter pins"
            >
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

        {user && (
          <>
            <span className="h-6 w-px bg-[hsl(var(--holo-cyan)/0.5)] flex-shrink-0" />
            <div
              className="h-7 w-7 rounded-full grid place-items-center font-display text-xs flex-shrink-0"
              style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block text-xs flex-shrink-0">
              <div className="font-medium leading-none">{displayName}</div>
              <div className="text-[10px] text-muted-foreground capitalize">{user.role}</div>
            </div>
            <Button
              variant="ghost" size="icon"
              onClick={() => navigate("/settings")}
              aria-label="Settings"
              className="rounded-full w-7 h-7 hover:bg-[hsl(var(--holo-cyan)/0.2)] text-[hsl(220_20%_50%)] hover:text-[hsl(var(--holo-cyan))]"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              onClick={handleLogout}
              aria-label="Sign out"
              className="rounded-full w-7 h-7 hover:bg-[hsl(var(--holo-cyan)/0.2)] text-[hsl(220_20%_50%)] hover:text-[hsl(var(--holo-cyan))]"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </>
  );
}
