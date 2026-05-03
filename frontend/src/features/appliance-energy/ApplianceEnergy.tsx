import { useState, useEffect } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Camera, Zap, Loader2, Clock, CheckCircle2, MapPin } from "lucide-react";
import { applianceApi, type JobScanResult, type PanoramaRecord } from "@/services/applianceApi";
import { toast } from "sonner";
import { useApp } from "@/shared/store/useApp";

const GRADE_COLORS: Record<string, string> = {
  "A+++": "bg-emerald-500", "A++": "bg-emerald-400", "A+": "bg-green-400",
  "A": "bg-green-300", "B": "bg-lime-400", "C": "bg-yellow-400",
  "D": "bg-orange-400", "E": "bg-orange-500", "F": "bg-red-500",
};

const FACE_ORDER = ["front", "back", "left", "right", "top", "bottom"] as const;

// ── Household scan result ───────────────────────────────────────────────────

function JobScanCard({ result }: { result: JobScanResult }) {
  const gradeColor = GRADE_COLORS[result.global_grade] ?? "bg-gray-500";
  return (
    <Card className="rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Household EPS Score</div>
          <div className="text-3xl font-display font-bold">
            {result.global_score.toFixed(1)}
            <span className="text-base font-normal text-muted-foreground">/100</span>
          </div>
        </div>
        <div className={`rounded-2xl px-5 py-3 text-white font-display text-3xl font-bold ${gradeColor}`}>
          {result.global_grade}
        </div>
      </div>

      <Progress value={result.global_score} className="h-3 rounded-full" />

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Detected appliances ({result.appliances.length})
        </div>
        {result.appliances.map((ap, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
            <div>
              <div className="text-sm font-medium capitalize">{ap.detected_class}</div>
              <div className="text-xs text-muted-foreground">
                {ap.source_detection.cubemap_face} face ·{" "}
                YOLO {(ap.source_detection.yolo_confidence * 100).toFixed(0)}% ·{" "}
                {ap.recommendation}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <Progress value={ap.efficiency_score} className="w-14 h-2" />
              <div className={`rounded-lg px-2 py-0.5 text-xs font-bold text-white shrink-0 ${GRADE_COLORS[ap.grade] ?? "bg-gray-500"}`}>
                {ap.grade}
              </div>
            </div>
          </div>
        ))}
      </div>

      {Object.keys(result.scores_by_device).length > 0 && (
        <div className="rounded-xl bg-muted/50 p-3">
          <div className="text-xs font-medium mb-2">Score by device</div>
          {Object.entries(result.scores_by_device).map(([device, score]) => (
            <div key={device} className="flex justify-between text-xs py-0.5">
              <span className="text-muted-foreground capitalize">{device.replace(/_/g, " ")}</span>
              <span className="font-mono">{score}/100</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Single panorama row ─────────────────────────────────────────────────────

function PanoramaRow({
  panorama,
  scanning,
  result,
  onScan,
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
  const isReady = panorama.job_state === "completed" && panorama.has_cubemap_faces;
  const isRunning = panorama.job_state === "running" || panorama.job_state === "queued";

  return (
    <div className="space-y-3">
      <Card className="rounded-2xl p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{date}</span>
            {panorama.has_appliance_scan && !result && (
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" />Already scanned
              </Badge>
            )}
            {isRunning && (
              <Badge variant="outline" className="text-blue-400 border-blue-500/30 bg-blue-500/10 text-xs">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />Processing 3D…
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            className="rounded-xl h-8 shrink-0"
            disabled={!isReady || scanning}
            onClick={onScan}
          >
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

        {/* 6 cubemap face thumbnails */}
        <div className="grid grid-cols-6 gap-1">
          {FACE_ORDER.map((face) =>
            faceUrls[face] ? (
              <div key={face} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                <img src={faceUrls[face]} alt={face} className="w-full h-full object-cover" />
                <div className="absolute bottom-0 inset-x-0 text-center text-[9px] bg-black/50 text-white py-0.5 capitalize">
                  {face}
                </div>
              </div>
            ) : (
              <div key={face} className="aspect-square rounded-lg bg-muted/30 flex items-center justify-center">
                <span className="text-[9px] text-muted-foreground capitalize">{face}</span>
              </div>
            )
          )}
        </div>

        {scanning && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running CNN + rule engine on cubemap crops…
          </div>
        )}
      </Card>

      {result && <JobScanCard result={result} />}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function ApplianceEnergy() {
  const { selectedPin } = useApp();

  // selectedPin.id is the backend property ID for user_pin kind
  const propertyId =
    selectedPin?.kind === "user_pin" && selectedPin.id && !isNaN(parseInt(selectedPin.id))
      ? parseInt(selectedPin.id)
      : undefined;

  const [panoramas, setPanoramas] = useState<PanoramaRecord[]>([]);
  const [loadingPanoramas, setLoadingPanoramas] = useState(false);
  const [scanningJobId, setScanningJobId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, JobScanResult>>({});

  useEffect(() => {
    if (!propertyId) return;
    setLoadingPanoramas(true);
    applianceApi.listPanoramasForProperty(propertyId)
      .then(setPanoramas)
      .catch(() => toast.error("Could not load panoramas"))
      .finally(() => setLoadingPanoramas(false));
  }, [propertyId]);

  const handleScan = async (jobId: string) => {
    setScanningJobId(jobId);
    try {
      const r = await applianceApi.scanFromJob(jobId);
      setResults((prev) => ({ ...prev, [jobId]: r }));
      toast.success(`EPS ${r.global_score.toFixed(1)}/100 — Grade ${r.global_grade}`);
      // Refresh list so has_appliance_scan updates
      if (propertyId) {
        const updated = await applianceApi.listPanoramasForProperty(propertyId);
        setPanoramas(updated);
      }
    } catch (e: any) {
      const msg: string = e.response?.data?.detail ?? e.message ?? "Scan failed";
      toast.error(msg.includes("No appliances") ? "No appliances detected in this panorama" : msg);
    } finally {
      setScanningJobId(null);
    }
  };

  return (
    <OverlayPanel
      title="Appliance Energy"
      subtitle="Automatic EPS scoring from your 3D panorama"
      size="xl"
    >
      {/* No property selected */}
      {!propertyId && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <MapPin className="h-10 w-10 text-muted-foreground opacity-40" />
          <p className="text-sm font-medium">No property selected</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Click a property pin on the map, then open the Materials tab in the Property Drawer
            and press "Scan Appliances".
          </p>
        </div>
      )}

      {/* Property selected — show panoramas */}
      {propertyId && (
        <div className="space-y-4">
          {loadingPanoramas ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading panoramas…
            </div>
          ) : panoramas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <Camera className="h-10 w-10 text-muted-foreground opacity-30" />
              <p className="text-sm font-medium">No panoramas yet</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Upload a panorama via the 3D World button in the Property Drawer. Once the
                pipeline finishes, the 6 cubemap faces will appear here and you can scan for
                appliances automatically.
              </p>
            </div>
          ) : (
            panoramas.map((p) => (
              <PanoramaRow
                key={p.id}
                panorama={p}
                scanning={scanningJobId === p.job_id}
                result={p.job_id ? (results[p.job_id] ?? null) : null}
                onScan={() => p.job_id && handleScan(p.job_id)}
              />
            ))
          )}
        </div>
      )}
    </OverlayPanel>
  );
}
