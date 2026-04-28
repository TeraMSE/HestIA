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

    // Poll
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const sr = await fetch(`/api/jobs/${job_id}/status/`);
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
      if (d.state === "failed") throw new Error(d.error || "Failed");
    }
    throw new Error("Timeout");
  }
}
