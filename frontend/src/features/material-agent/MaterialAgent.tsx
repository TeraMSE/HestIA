import { useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, Download } from "lucide-react";
import { materialService } from "@/services/mockApi";
import type { MaterialEstimate } from "@/contracts/types";
import { toast } from "sonner";

const REGIONS = ["Tunis", "Bizerte", "Nabeul", "Hammamet", "Sousse", "Monastir", "Mahdia", "Sfax", "Beja", "Jendouba", "Kef", "Kairouan", "Gafsa", "Tozeur", "Tataouine"];

export function MaterialAgent() {
  const [region, setRegion] = useState("Tunis");
  const [budget, setBudget] = useState(180000);
  const [areaM2, setAreaM2] = useState(120);
  const [rooms, setRooms] = useState(4);
  const [estimate, setEstimate] = useState<MaterialEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const analyze = async (file?: File) => {
    setAnalyzing(true);
    try {
      const r = await materialService.analyzePlan(file);
      setAreaM2(r.areaM2); setRooms(r.rooms);
      toast.success(`Plan analyzed: ${r.areaM2} m² · ${r.rooms} rooms · ${r.dimensions}`);
    } finally { setAnalyzing(false); }
  };

  const generate = async () => {
    setLoading(true);
    try {
      const e = await materialService.estimate({ region, budgetTND: budget, areaM2, rooms });
      setEstimate(e);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const exportCsv = () => {
    if (!estimate) return;
    const blob = new Blob([materialService.toCSV(estimate)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `materials-${estimate.id}.csv`; a.click();
    toast.success("CSV exported");
  };

  const verdictColor = estimate?.verdict === "optimal" ? "default" : estimate?.verdict === "excess" ? "secondary" : "destructive";

  return (
    <OverlayPanel title="Material Agent" subtitle="Tunisian construction estimate · 2026 prices" size="xl">
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        <Card className="rounded-2xl p-4 space-y-3">
          <div>
            <Label>Region</Label>
            <select value={region} onChange={(e) => setRegion(e.target.value)} className="mt-1 w-full rounded-2xl border border-border bg-background h-11 px-3">
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <Label>Budget (TND)</Label>
            <Input type="number" value={budget} onChange={(e) => setBudget(+e.target.value)} className="rounded-2xl mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Area m²</Label><Input type="number" value={areaM2} onChange={(e) => setAreaM2(+e.target.value)} className="rounded-2xl mt-1" /></div>
            <div><Label>Rooms</Label><Input type="number" value={rooms} onChange={(e) => setRooms(+e.target.value)} className="rounded-2xl mt-1" /></div>
          </div>
        </Card>
        <Card className="rounded-2xl p-4 space-y-3">
          <Label>2D plan upload (vision analysis)</Label>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-2xl p-6 cursor-pointer hover:bg-muted/40">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{analyzing ? "Analyzing…" : "Click to upload (mock)"}</span>
            <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => analyze(e.target.files?.[0] ?? undefined)} />
          </label>
          <p className="text-xs text-muted-foreground">Mock vision returns area & rooms — wire LLaMA 4 / Gemini 3.1 Pro later.</p>
        </Card>
      </div>

      <Button className="rounded-2xl w-full shadow-sims" size="lg" onClick={generate} disabled={loading}>{loading ? "Estimating…" : "Generate estimate"}</Button>

      {estimate && (
        <div className="mt-6 space-y-4">
          <Card className="rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Total estimated cost</div>
              <div className="font-display text-3xl">{estimate.totalTND.toLocaleString()} TND</div>
            </div>
            <div>
              <Badge variant={verdictColor as any} className="rounded-full text-base px-4 py-1 capitalize">{estimate.verdict}</Badge>
              <div className="text-sm text-muted-foreground mt-1">{estimate.verdictExplanation}</div>
              {estimate.reductionSuggestion && <div className="text-sm mt-1">💡 {estimate.reductionSuggestion}</div>}
              {estimate.upgrades && (
                <ul className="mt-1 text-sm list-disc pl-5">{estimate.upgrades.map((u) => <li key={u}>{u}</li>)}</ul>
              )}
            </div>
            <Button variant="outline" className="rounded-2xl" onClick={exportCsv}><Download className="h-4 w-4 mr-2" />CSV</Button>
          </Card>

          <Card className="rounded-2xl p-4">
            <h3 className="font-display text-lg mb-2">Climate-justified waterproofing plan ({estimate.climate})</h3>
            <div className="grid md:grid-cols-3 gap-3 text-sm">
              <div><div className="font-medium mb-1">Anti-mold</div><ul className="list-disc pl-5 text-muted-foreground">{estimate.waterproofingPlan.antiMold.map((x) => <li key={x}>{x}</li>)}</ul></div>
              <div><div className="font-medium mb-1">Anti-cracking</div><ul className="list-disc pl-5 text-muted-foreground">{estimate.waterproofingPlan.antiCracking.map((x) => <li key={x}>{x}</li>)}</ul></div>
              <div><div className="font-medium mb-1">Anti-infiltration</div><ul className="list-disc pl-5 text-muted-foreground">{estimate.waterproofingPlan.antiInfiltration.map((x) => <li key={x}>{x}</li>)}</ul></div>
            </div>
          </Card>

          <Card className="rounded-2xl overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-left">
                    <th className="p-2">Category</th><th className="p-2">Material</th><th className="p-2">Brand</th>
                    <th className="p-2 text-right">Qty</th><th className="p-2">Unit</th>
                    <th className="p-2 text-right">Unit TND</th><th className="p-2 text-right">Total TND</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.items.map((i) => (
                    <tr key={i.id} className="border-t border-border">
                      <td className="p-2"><Badge variant="outline" className="rounded-full text-[10px]">{i.category}</Badge></td>
                      <td className="p-2">{i.name}</td>
                      <td className="p-2 text-muted-foreground">{i.brand ?? "—"}</td>
                      <td className="p-2 text-right">{i.quantity}</td>
                      <td className="p-2">{i.unit}</td>
                      <td className="p-2 text-right">{i.unitPriceTND}</td>
                      <td className="p-2 text-right font-medium">{i.totalTND.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </OverlayPanel>
  );
}
