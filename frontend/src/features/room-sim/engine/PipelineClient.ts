/**
 * PipelineClient — Submits panorama to HorizonNet and polls for completion.
 * Ported from sim.html PipelineClient class.
 */

export type StepCallback = (
  state: string,
  step: string,
  logs: string
) => void;

export type CompleteCallback = (
  jobId: string,
  result: any
) => Promise<void>;

export class PipelineClient {
  async run(
    file: File,
    options: Record<string, string>,
    onStep: StepCallback,
    onComplete: CompleteCallback
  ): Promise<void> {
    const fd = new FormData();
    fd.append("image", file);
    for (const [k, v] of Object.entries(options)) fd.append(k, v);

    const resp = await fetch("/api/jobs/start/", {
      method: "POST",
      body: fd,
    });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try {
        msg = (await resp.json()).error || msg;
      } catch (_) {}
      throw new Error(msg);
    }
    const { job_id } = await resp.json();
    if (!job_id) throw new Error("No job_id returned");
    console.log("[Pipeline] Job started:", job_id);
    onStep("queued", "queued", "");

    // Poll — keep interval ≤ 1.5 s so the dev-tunnel stays alive (tunnels drop
    // inactive connections after ~60 s). On repeated 5xx / network errors we
    // back off exponentially (max 8 s) but never stop retrying.
    const POLL_BASE_MS = 1500;
    const MAX_BACKOFF_MS = 8000;
    const MAX_ITERS = 800;          // ~20 min ceiling
    let consecutiveFails = 0;

    for (let i = 0; i < MAX_ITERS; i++) {
      // Delay: base interval, with backoff only after repeated failures
      const delay = consecutiveFails > 0
        ? Math.min(POLL_BASE_MS * Math.pow(1.5, consecutiveFails - 1), MAX_BACKOFF_MS)
        : POLL_BASE_MS;
      await new Promise((r) => setTimeout(r, delay));

      try {
        const sr = await fetch(`/api/jobs/${job_id}/status/`);
        if (!sr.ok) {
          consecutiveFails++;
          console.warn(`[Pipeline] Polling got HTTP ${sr.status}, retrying... (fail #${consecutiveFails})`);
          continue;
        }
        consecutiveFails = 0; // reset on success
        const d = await sr.json();
        onStep(
          d.state,
          d.current_step,
          (d.logs_tail || []).slice(-3).join("\n")
        );
        if (d.state === "completed") {
          await onComplete(job_id, d);
          return;
        }
        if (d.state === "failed") throw new Error(d.error || "Pipeline failed");
      } catch (err: any) {
        // Re-throw real pipeline/logic errors; swallow transient network errors.
        const msg: string = err?.message ?? "";
        const isTransient =
          msg === "Timeout" ||
          msg.includes("fetch") ||
          msg.includes("NetworkError") ||
          msg.includes("Failed to fetch") ||
          msg.includes("Unexpected token") ||
          msg.includes("ERR_ABORTED") ||
          msg.includes("504") ||
          msg.includes("502");
        if (!isTransient) throw err;
        consecutiveFails++;
        console.warn(`[Pipeline] Polling network error (fail #${consecutiveFails}):`, err.message);
      }
    }
    throw new Error("Timeout — pipeline exceeded maximum wait time");
  }
}
