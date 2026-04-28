import { useEffect, useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { simulationService } from "@/services/mockApi";
import type { ReportEntry } from "@/contracts/types";
import { toast } from "sonner";

export function Reports() {
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReportEntry | null>(null);

  useEffect(() => { simulationService.listReports().then(setReports); }, []);

  const filtered = reports.filter((r) =>
    !filter || r.personaA.toLowerCase().includes(filter.toLowerCase()) ||
    r.personaB.toLowerCase().includes(filter.toLowerCase()) ||
    r.apartmentLabel.toLowerCase().includes(filter.toLowerCase())
  );

  const exportJson = (r: ReportEntry) => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `report-${r.id}.json`; a.click();
    toast.success("JSON exported");
  };

  return (
    <OverlayPanel title="Reports & History" subtitle="Past simulation runs" size="xl">
      <div className="flex gap-2 mb-3">
        <Input placeholder="Filter by persona or apartment…" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-2xl" />
      </div>
      {filtered.length === 0 ? (
        <Card className="p-8 rounded-3xl text-center text-muted-foreground">No runs yet. Open Simulation Runner to create one.</Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {filtered.map((r) => (
            <Card key={r.id} className="p-4 rounded-2xl">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">{r.personaA} ↔ {r.personaB}</div>
                <Badge className="rounded-full">{r.grade}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">{r.apartmentLabel}</div>
              <div className="text-xs text-muted-foreground mt-1">{new Date(r.createdAt).toLocaleString()}</div>
              <div className="flex justify-between items-end mt-3">
                <div><span className="text-xs text-muted-foreground">Score</span><div className="font-display text-2xl">{r.score}</div></div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => setSelected(r)}>View</Button>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => exportJson(r)}>JSON</Button>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => toast.info("PDF export coming soon")}>PDF</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[1100] grid place-items-center bg-foreground/40 p-4" onClick={() => setSelected(null)}>
          <Card className="max-w-lg w-full p-5 rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl mb-2">Run detail</h3>
            <pre className="text-xs bg-muted p-3 rounded-xl overflow-auto max-h-80">{JSON.stringify(selected, null, 2)}</pre>
            <Button className="rounded-2xl w-full mt-3" onClick={() => setSelected(null)}>Close</Button>
          </Card>
        </div>
      )}
    </OverlayPanel>
  );
}
