import { useEffect, useState } from "react";
import { Zap, Loader2, ScanLine, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applianceApi } from "@/services/applianceApi";
import type { JobScanResult } from "@/services/applianceApi";
import type { PropertyPin } from "@/contracts/types";
import { toast } from "sonner";

interface Props {
  currentJobId: string | null;
  selectedPin: PropertyPin | null;
  isActive: boolean;
}

const GRADE_COLOR: Record<string, string> = {
  "A+++": "text-emerald-300 bg-emerald-950/40 border-emerald-500/30",
  "A++":  "text-emerald-300 bg-emerald-950/40 border-emerald-500/30",
  "A+":   "text-emerald-400 bg-emerald-950/30 border-emerald-500/20",
  "A":    "text-green-400   bg-green-950/30   border-green-500/20",
  "B":    "text-lime-400    bg-lime-950/30    border-lime-500/20",
  "C":    "text-yellow-400  bg-yellow-950/30  border-yellow-500/20",
  "D":    "text-orange-400  bg-orange-950/30  border-orange-500/20",
  "E":    "text-red-400     bg-red-950/30     border-red-500/20",
  "F":    "text-red-500     bg-red-950/40     border-red-500/30",
};

function gradeColor(grade: string) {
  return GRADE_COLOR[grade] ?? "text-gray-400 bg-gray-900/30 border-gray-500/20";
}

function GradeBadge({ grade }: { grade: string }) {
  return (
    <span className={`inline-flex items-center justify-center text-xs font-bold px-2 py-0.5 rounded-lg border ${gradeColor(grade)}`}>
      {grade}
    </span>
  );
}

export function EnergyLayerPanel({ currentJobId, selectedPin, isActive }: Props) {
  const [scanResult, setScanResult] = useState<JobScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [autoScanAttempted, setAutoScanAttempted] = useState(false);

  // Reset when job changes
  useEffect(() => {
    setScanResult(null);
    setAutoScanAttempted(false);
  }, [currentJobId]);

  // Auto-scan when panel becomes active with a valid job
  useEffect(() => {
    if (isActive && currentJobId && !autoScanAttempted && !scanResult && !scanning) {
      setAutoScanAttempted(true);
      handleScan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, currentJobId, autoScanAttempted]);

  async function handleScan() {
    if (!currentJobId) { toast.error("No 3D world generated yet."); return; }
    setScanning(true);
    try {
      const result = await applianceApi.scanFromJob(currentJobId);
      setScanResult(result);
      toast.success("Appliance scan complete.");
    } catch (e: any) {
      toast.error("Scan failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div
      className={`absolute left-4 top-1/2 -translate-y-1/2 z-[1010] w-[300px] max-h-[78vh] transition-all duration-300 ease-out ${
        isActive ? "translate-x-0 opacity-100 pointer-events-auto" : "-translate-x-[110%] opacity-0 pointer-events-none"
      }`}
    >
      <div className="holo-surface rounded-3xl flex flex-col overflow-hidden max-h-[78vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[hsl(var(--holo-cyan)/0.2)] shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
            <Zap className="h-5 w-5 text-yellow-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-white leading-tight">Energy Layer</h3>
            <p className="text-xs text-white/55">EPS score from appliance detection</p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!currentJobId ? (
            <div className="text-center py-8 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto">
                <Plug className="h-6 w-6 text-white/60" />
              </div>
              <p className="text-sm text-white/60">Generate a 3D world first to scan appliances.</p>
            </div>
          ) : scanning ? (
            <div className="text-center py-8 space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--holo-cyan))] mx-auto" />
              <p className="text-sm text-white/60">Detecting appliances from panorama…</p>
              <p className="text-xs text-white/60/60">Analyzing 5 directions</p>
            </div>
          ) : scanResult ? (
            <>
              {/* Global EPS score */}
              <div className="bg-black/40 rounded-2xl border border-white/10 p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/60 uppercase tracking-wider mb-1">EPS Score</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-white">{Math.round(scanResult.global_score)}</span>
                    <span className="text-sm text-white/60">/100</span>
                  </div>
                </div>
                <div className={`text-4xl font-black px-4 py-2 rounded-2xl border ${gradeColor(scanResult.global_grade)}`}>
                  {scanResult.global_grade}
                </div>
              </div>

              {/* Score bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-white/60">
                  <span>Energy Efficiency</span>
                  <span className="font-mono">{Math.round(scanResult.global_score)}%</span>
                </div>
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${scanResult.global_score}%`,
                      background: "linear-gradient(90deg, hsl(185 95% 45%), hsl(145 70% 55%))",
                    }}
                  />
                </div>
              </div>

              {/* Appliances list */}
              {scanResult.appliances.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-white/60 uppercase tracking-wider">Detected Appliances</p>
                  {scanResult.appliances.map((a, i) => (
                    <div key={i} className="bg-black/30 rounded-2xl border border-white/10 p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white capitalize truncate">
                          {a.detected_class.replace("_", " ")}
                        </span>
                        <GradeBadge grade={a.grade} />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-white/60">
                        <span className="font-mono">{Math.round(a.efficiency_score)}/100</span>
                        <span>·</span>
                        <span>{a.etat_visuel}</span>
                        <span>·</span>
                        <span>{Math.round(a.source_detection.yolo_confidence * 100)}% conf.</span>
                      </div>
                      {a.recommendation && (
                        <p className="text-xs text-white/60 italic leading-snug">{a.recommendation}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {scanResult.appliances.length === 0 && (
                <p className="text-sm text-white/60 text-center py-4">No appliances detected in panorama.</p>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleScan}
                disabled={scanning}
                className="w-full rounded-2xl border-white/20 hover:bg-white/10 text-xs"
              >
                <ScanLine className="h-3 w-3 mr-1.5" /> Re-scan
              </Button>
            </>
          ) : (
            <div className="text-center py-8 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center mx-auto">
                <ScanLine className="h-6 w-6 text-yellow-400" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-white">Scan Appliances</p>
                <p className="text-xs text-white/60">
                  Detect appliances from the panorama and calculate an EPS efficiency score.
                </p>
              </div>
              <Button
                onClick={handleScan}
                disabled={scanning}
                className="w-full rounded-2xl font-semibold"
                style={{ background: "linear-gradient(135deg, hsl(50 100% 50%), hsl(35 100% 55%))", color: "#000" }}
              >
                <Zap className="h-4 w-4 mr-2" /> Scan Now
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
