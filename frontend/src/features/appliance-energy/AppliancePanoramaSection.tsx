/**
 * Inline appliance-energy section for the 3D tab of PropertyDrawer.
 * Uses panoramas already uploaded for 3D reconstruction — no separate photo import.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Camera, Zap, Loader2, Clock, CheckCircle2 } from "lucide-react";
import { applianceApi, type PanoramaRecord, type JobScanResult } from "@/services/applianceApi";
import { toast } from "sonner";
import type { PropertyPin } from "@/contracts/types";

const GRADE_COLORS: Record<string, string> = {
  "A+++": "bg-emerald-500", "A++": "bg-emerald-400", "A+": "bg-green-400",
  "A":    "bg-green-300",   "B":   "bg-lime-400",    "C":  "bg-yellow-400",
  "D":    "bg-orange-400",  "E":   "bg-orange-500",  "F":  "bg-red-500",
};

const FACE_ORDER = ["front", "back", "left", "right", "top", "bottom"] as const;

function JobScanCard({ result }: { result: JobScanResult }) {
  const gradeColor = GRADE_COLORS[result.global_grade] ?? "bg-gray-500";
  return (
    <Card className="rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Household EPS Score</div>
          <div className="text-2xl font-display font-bold">
            {result.global_score.toFixed(1)}
            <span className="text-sm font-normal text-muted-foreground">/100</span>
          </div>
        </div>
        <div className={`rounded-xl px-4 py-2 text-white font-display text-2xl font-bold ${gradeColor}`}>
          {result.global_grade}
        </div>
      </div>
      <Progress value={result.global_score} className="h-2 rounded-full" />
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Detected appliances ({result.appliances.length})
        </div>
        {result.appliances.map((ap, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
            <div>
              <div className="text-xs font-medium capitalize">{ap.detected_class}</div>
              <div className="text-[10px] text-muted-foreground">
                {ap.source_detection.cubemap_face} · {(ap.source_detection.yolo_confidence * 100).toFixed(0)}% conf
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <Progress value={ap.efficiency_score} className="w-12 h-1.5" />
              <div className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white shrink-0 ${GRADE_COLORS[ap.grade] ?? "bg-gray-500"}`}>
                {ap.grade}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PanoramaRow({
  panorama, scanning, result, onScan,
}: {
  panorama: PanoramaRecord;
  scanning: boolean;
  result: JobScanResult | null;
  onScan: () => void;
}) {
  const faceUrls = panorama.face_urls ?? {};
  const date = new Date(panorama.created_at).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
  const isReady   = panorama.job_state === "completed" && panorama.has_cubemap_faces;
  const isRunning = panorama.job_state === "running" || panorama.job_state === "queued";

  return (
    <div className="space-y-2">
      <Card className="rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">{date}</span>
            {panorama.has_appliance_scan && !result && (
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-[10px]">
                <CheckCircle2 className="h-2.5 w-2.5 mr-1" />Scanned
              </Badge>
            )}
            {isRunning && (
              <Badge variant="outline" className="text-blue-400 border-blue-500/30 bg-blue-500/10 text-[10px]">
                <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />Processing…
              </Badge>
            )}
          </div>
          <Button size="sm" className="rounded-xl h-7 text-xs shrink-0" disabled={!isReady || scanning} onClick={onScan}>
            {scanning ? (
              <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Scanning…</>
            ) : isRunning ? (
              <><Clock className="h-3 w-3 mr-1" />Processing</>
            ) : !isReady ? (
              "Not ready"
            ) : panorama.has_appliance_scan ? (
              <><Zap className="h-3 w-3 mr-1" />Re-scan</>
            ) : (
              <><Zap className="h-3 w-3 mr-1" />Scan appliances</>
            )}
          </Button>
        </div>

        <div className="grid grid-cols-6 gap-1">
          {FACE_ORDER.map((face) =>
            faceUrls[face] ? (
              <div key={face} className="relative aspect-square rounded-md overflow-hidden bg-muted">
                <img src={faceUrls[face]} alt={face} className="w-full h-full object-cover" />
                <div className="absolute bottom-0 inset-x-0 text-center text-[8px] bg-black/50 text-white py-0.5 capitalize">
                  {face}
                </div>
              </div>
            ) : (
              <div key={face} className="aspect-square rounded-md bg-muted/30 flex items-center justify-center">
                <span className="text-[8px] text-muted-foreground capitalize">{face}</span>
              </div>
            )
          )}
        </div>

        {scanning && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            Running CNN + rule engine on cubemap faces…
          </div>
        )}
      </Card>
      {result && <JobScanCard result={result} />}
    </div>
  );
}

export function AppliancePanoramaSection({ pin }: { pin: PropertyPin | null }) {
  const propertyId =
    pin?.id && !isNaN(parseInt(pin.id)) ? parseInt(pin.id) : undefined;

  const [panoramas, setPanoramas]       = useState<PanoramaRecord[]>([]);
  const [loading, setLoading]           = useState(false);
  const [scanningJobId, setScanningJobId] = useState<string | null>(null);
  const [jobResults, setJobResults]     = useState<Record<string, JobScanResult>>({});

  useEffect(() => {
    if (!propertyId) return;
    setLoading(true);
    applianceApi.listPanoramasForProperty(propertyId)
      .then(setPanoramas)
      .catch(() => toast.error("Could not load panoramas"))
      .finally(() => setLoading(false));
  }, [propertyId]);

  const handleJobScan = async (jobId: string) => {
    setScanningJobId(jobId);
    try {
      const r = await applianceApi.scanFromJob(jobId);
      setJobResults((prev) => ({ ...prev, [jobId]: r }));
      toast.success(`EPS ${r.global_score.toFixed(1)}/100 — Grade ${r.global_grade}`);
      if (propertyId) {
        const updated = await applianceApi.listPanoramasForProperty(propertyId);
        setPanoramas(updated);
      }
    } catch (e: any) {
      const msg: string = e?.response?.data?.detail ?? e.message ?? "Scan failed";
      toast.error(msg.includes("No appliances") ? "No appliances detected in this panorama" : msg);
    } finally {
      setScanningJobId(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 pt-1">
        <Zap className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Appliance Energy</span>
      </div>

      {!propertyId ? (
        <p className="text-xs text-muted-foreground">
          Upload a panorama via the 3D World to enable appliance energy scanning.
        </p>
      ) : loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Loading panoramas…</span>
        </div>
      ) : panoramas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No panoramas yet — upload one via "Enter 3D World" above.
        </p>
      ) : (
        panoramas.map((p) => (
          <PanoramaRow
            key={p.id}
            panorama={p}
            scanning={scanningJobId === p.job_id}
            result={p.job_id ? (jobResults[p.job_id] ?? null) : null}
            onScan={() => p.job_id && handleJobScan(p.job_id)}
          />
        ))
      )}
    </div>
  );
}
