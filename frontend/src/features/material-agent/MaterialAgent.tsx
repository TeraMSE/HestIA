import { useState, useEffect } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, Loader2, HardHat, Thermometer, Zap } from "lucide-react";
import { materiauxApi, type MateriauxAnalysisResult, type MatRegion, type MatGamme } from "@/services/materiauxApi";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  "OPTIMAL":     "bg-emerald-500",
  "INSUFFISANT": "bg-red-500",
  "EXCÉDENT":    "bg-yellow-500",
};

const FALLBACK_GAMMES: MatGamme[] = [
  { id: "bas",     label: "Economy",   description: "Simple finishes, local materials",    coeff_prix: 0.85 },
  { id: "moyenne", label: "Mid-range", description: "Quality finishes, recognized brands", coeff_prix: 1.0  },
  { id: "haute",   label: "Premium",   description: "Luxury finishes, imported materials", coeff_prix: 1.35 },
];

export function MaterialAgent() {
  const [regions, setRegions] = useState<MatRegion[]>([]);
  const [gammes, setGammes]   = useState<MatGamme[]>(FALLBACK_GAMMES);
  const [region, setRegion]   = useState("Tunis");
  const [gamme, setGamme]     = useState<"bas" | "moyenne" | "haute">("moyenne");
  const [budget, setBudget]   = useState(180000);
  const [surfaceM2, setSurfaceM2]     = useState(120);
  const [nbChambres, setNbChambres]   = useState(3);
  const [nbSdb, setNbSdb]             = useState(1);
  const [planFile, setPlanFile]       = useState<File | null>(null);
  const [result, setResult]           = useState<MateriauxAnalysisResult | null>(null);
  const [loading, setLoading]         = useState(false);

  useEffect(() => {
    Promise.all([materiauxApi.getRegions(), materiauxApi.getGammes()])
      .then(([r, g]) => { if (r.length) setRegions(r); if (g.length) setGammes(g); })
      .catch(() => {/* use fallbacks silently */});
  }, []);

  const generate = async () => {
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("region", region);
      fd.append("gamme", gamme);
      fd.append("budget", String(budget));
      fd.append("nb_chambres", String(nbChambres));
      fd.append("nb_sdb", String(nbSdb));
      if (planFile) {
        fd.append("plan", planFile);
      } else {
        fd.append("surface_manuelle", String(surfaceM2));
      }
      const r = await materiauxApi.analyserPlan(fd);
      setResult(r);
      toast.success(`Estimate #${r.estimate_id} — ${r.cout_total.toLocaleString()} TND`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? e.message ?? "Estimation failed");
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!result) return;
    const rows = [
      ["Category", "Material", "Qty", "Unit", "Unit TND", "Total TND"],
      ...result.materiaux.map(m => [m.categorie, m.nom, m.quantite, m.unite, m.prix_unitaire_tnd, m.cout_total_tnd]),
    ];
    const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `estimate-${result.estimate_id}.csv`;
    a.click();
    toast.success("CSV exported");
  };

  const regionList = regions.length ? regions : [{ nom: "Tunis", climat: "cote" }] as MatRegion[];
  const selectedClimat = regionList.find(r => r.nom === region)?.climat ?? "";
  const statusColor = result ? STATUS_COLORS[result.eval_budget.statut] ?? "bg-gray-500" : "";
  const surplus = result ? result.eval_budget.ecart : 0;

  return (
    <OverlayPanel title="Material Agent" subtitle="Tunisian construction estimate · 2026 prices" size="xl">
      {/* ── Form ────────────────────────────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        <Card className="rounded-2xl p-4 space-y-3">
          <div>
            <Label>
              Region
              {selectedClimat && <span className="text-xs text-muted-foreground ml-1">· {selectedClimat} climate</span>}
            </Label>
            <select value={region} onChange={(e) => setRegion(e.target.value)} className="mt-1 w-full rounded-2xl border border-border bg-background h-11 px-3 text-sm">
              {regionList.map(r => <option key={r.nom} value={r.nom}>{r.nom}</option>)}
            </select>
          </div>

          <div>
            <Label>Construction tier</Label>
            <select value={gamme} onChange={(e) => setGamme(e.target.value as "bas" | "moyenne" | "haute")} className="mt-1 w-full rounded-2xl border border-border bg-background h-11 px-3 text-sm">
              {gammes.map(g => <option key={g.id} value={g.id}>{g.label} — {g.description}</option>)}
            </select>
          </div>

          <div>
            <Label>Budget (TND)</Label>
            <Input type="number" value={budget} onChange={(e) => setBudget(+e.target.value)} className="rounded-2xl mt-1" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Area m²</Label>
              <Input type="number" value={surfaceM2} onChange={(e) => setSurfaceM2(+e.target.value)} className="rounded-2xl mt-1" disabled={!!planFile} />
            </div>
            <div>
              <Label>Bedrooms</Label>
              <Input type="number" min={1} value={nbChambres} onChange={(e) => setNbChambres(+e.target.value)} className="rounded-2xl mt-1" />
            </div>
            <div>
              <Label>Bathrooms</Label>
              <Input type="number" min={1} value={nbSdb} onChange={(e) => setNbSdb(+e.target.value)} className="rounded-2xl mt-1" />
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl p-4 space-y-3">
          <Label>2D floor plan (optional — vision AI)</Label>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-2xl p-6 cursor-pointer hover:bg-muted/40 transition-colors">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground text-center">
              {planFile ? planFile.name : "Click to upload image or PDF"}
            </span>
            <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setPlanFile(e.target.files?.[0] ?? null)} />
          </label>
          {planFile ? (
            <Button variant="ghost" size="sm" className="w-full rounded-xl text-xs" onClick={() => setPlanFile(null)}>
              Remove — use manual area ({surfaceM2} m²)
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Without a plan, the area and rooms you entered are used directly. Upload a floor plan for vision-based extraction.
            </p>
          )}
        </Card>
      </div>

      <Button className="rounded-2xl w-full shadow-sims" size="lg" onClick={generate} disabled={loading}>
        {loading
          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running material analysis… (may take up to 2 min)</>
          : "Generate estimate"
        }
      </Button>

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {result && (
        <div className="mt-6 space-y-4">

          {/* Cost summary */}
          <Card className="rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Total project cost</div>
                <div className="font-display text-3xl">{result.cout_total.toLocaleString()} TND</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Materials {result.cout_materiaux.toLocaleString()} TND · Labor {result.main_oeuvre.total_tnd.toLocaleString()} TND
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className={`rounded-xl px-3 py-1.5 text-white text-sm font-bold ${statusColor}`}>
                  {result.eval_budget.statut}
                </div>
                <div className="text-xs text-muted-foreground text-right max-w-[220px] leading-snug">
                  {result.eval_budget.message_court}
                </div>
              </div>
              <Button variant="outline" className="rounded-2xl shrink-0" onClick={exportCsv}>
                <Download className="h-4 w-4 mr-2" />CSV
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs text-center">
              <div className="rounded-xl bg-muted/50 p-2">
                <div className="text-muted-foreground">Budget</div>
                <div className="font-mono font-medium">{result.budget.toLocaleString()} TND</div>
              </div>
              <div className="rounded-xl bg-muted/50 p-2">
                <div className="text-muted-foreground">Estimate</div>
                <div className="font-mono font-medium">{result.cout_total.toLocaleString()} TND</div>
              </div>
              <div className="rounded-xl bg-muted/50 p-2">
                <div className="text-muted-foreground">Difference</div>
                <div className={`font-mono font-medium ${surplus >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {surplus >= 0 ? "+" : ""}{surplus.toLocaleString()} TND
                </div>
              </div>
            </div>
          </Card>

          {/* LLM material analysis */}
          {result.analyse_materiaux && (
            <Card className="rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HardHat className="h-4 w-4" />Material analysis
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{result.analyse_materiaux}</p>
            </Card>
          )}

          {/* LLM recommendation */}
          {result.recommandation && (
            <Card className="rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Zap className="h-4 w-4" />Recommendation
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{result.recommandation}</p>
            </Card>
          )}

          {/* AC plan */}
          {result.clim_detail.length > 0 && (
            <Card className="rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Thermometer className="h-4 w-4" />
                AC plan — {result.nb_clims_total} unit{result.nb_clims_total !== 1 ? "s" : ""} total
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-1 pr-3">Room</th>
                      <th className="py-1 pr-3 text-right">m²</th>
                      <th className="py-1 pr-3 text-right">BTU</th>
                      <th className="py-1 pr-3 text-right">Units</th>
                      <th className="py-1 text-right">Power</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.clim_detail.map((c, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="py-1 pr-3 capitalize">{c.piece}</td>
                        <td className="py-1 pr-3 text-right">{c.surface_m2}</td>
                        <td className="py-1 pr-3 text-right font-mono">{(c.btu_calcule || 0).toLocaleString()}</td>
                        <td className="py-1 pr-3 text-right">{c.nb_unites}</td>
                        <td className="py-1 text-right">{c.puissance_btu}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Labor breakdown */}
          {result.main_oeuvre.detail.length > 0 && (
            <Card className="rounded-2xl p-4 space-y-2">
              <div className="text-sm font-medium">
                Labor costs — {result.main_oeuvre.total_tnd.toLocaleString()} TND
              </div>
              {result.main_oeuvre.detail.map((d, i) => (
                <div key={i} className="flex justify-between text-xs py-0.5">
                  <span className="text-muted-foreground capitalize">{d.poste}</span>
                  <span className="font-mono">{d.cout_tnd.toLocaleString()} TND</span>
                </div>
              ))}
            </Card>
          )}

          {/* Materials table */}
          <Card className="rounded-2xl overflow-hidden">
            <div className="p-3 border-b border-border text-sm font-medium">
              Materials — {result.nb_materiaux} items · {result.cout_materiaux.toLocaleString()} TND
            </div>
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr className="text-left">
                    <th className="p-2">Category</th>
                    <th className="p-2">Material</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2">Unit</th>
                    <th className="p-2 text-right">Unit TND</th>
                    <th className="p-2 text-right">Total TND</th>
                  </tr>
                </thead>
                <tbody>
                  {result.materiaux.map((m, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2">
                        <Badge variant="outline" className="rounded-full text-[10px] whitespace-nowrap">
                          {m.categorie.split(" - ")[0]}
                        </Badge>
                      </td>
                      <td className="p-2">{m.nom}</td>
                      <td className="p-2 text-right font-mono">{m.quantite}</td>
                      <td className="p-2 text-muted-foreground">{m.unite}</td>
                      <td className="p-2 text-right font-mono">{m.prix_unitaire_tnd.toLocaleString()}</td>
                      <td className="p-2 text-right font-medium font-mono">{m.cout_total_tnd.toLocaleString()}</td>
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
