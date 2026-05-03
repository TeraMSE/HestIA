/**
 * applianceApi.ts — typed Axios client for /api/v1/appliances/*
 */
import api from "./api";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PanoramaRecord {
  id: number;
  job_id: string | null;
  status: "uploading" | "processing" | "completed" | "failed";
  created_at: string;
  job_state: "queued" | "running" | "completed" | "failed" | null;
  has_cubemap_faces: boolean;
  has_appliance_scan: boolean;
  face_urls: Record<string, string>; // face name → URL
}

export interface JobScanResult {
  global_score: number;
  global_grade: string;
  scores_by_device: Record<string, number>;
  appliances: {
    detected_class: string;
    confidence: number;
    etat_visuel: string;
    efficiency_score: number;
    grade: string;
    recommendation: string;
    score_details: Record<string, unknown>;
    source_detection: {
      yolo_class: string;
      cubemap_face: string;
      crop_file: string;
      yolo_confidence: number;
    };
  }[];
}

export interface ApplianceResult {
  appliance_id: number;
  detected_class: string;
  confidence: number;
  etat_visuel: "propre" | "normal" | "endommagé" | "rouillé";
  efficiency_score: number;
  grade: string;
  score_details: Record<string, unknown>;
}

export interface ApplianceScanResult {
  scan_id: number;
  global_score: number;
  grade: string;
  appliances: {
    id: number;
    detected_class: string;
    efficiency_score: number;
    grade: string;
  }[];
}

export interface ApplianceScanSummary {
  id: number;
  global_score: number;
  grade: string;
  created_at: string;
  property_id: number | null;
  nb_appliances: number;
}

export interface ApplianceSpecsResult {
  brand?: string;
  model?: string;
  category?: string;
  kwh_per_year?: number;
  energy_class?: string;
  [key: string]: unknown;
}

// ── API client ─────────────────────────────────────────────────────────────

export const applianceApi = {
  async analyze(formData: FormData, propertyId?: number): Promise<ApplianceResult> {
    const url = propertyId
      ? `/appliances/analyze/?property_id=${propertyId}`
      : "/appliances/analyze/";
    const res = await api.post(url, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120_000,
    });
    return res.data;
  },

  async analyzeMultiple(formData: FormData, propertyId?: number): Promise<ApplianceScanResult> {
    const url = propertyId
      ? `/appliances/analyze/multiple/?property_id=${propertyId}`
      : "/appliances/analyze/multiple/";
    const res = await api.post(url, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return res.data;
  },

  async listScans(): Promise<ApplianceScanSummary[]> {
    const res = await api.get("/appliances/");
    return res.data;
  },

  /** Download PDF as blob */
  async downloadReportPdf(applianceId: number): Promise<Blob> {
    const res = await api.post(
      `/appliances/${applianceId}/report/pdf/`,
      {},
      { responseType: "blob", timeout: 60_000 }
    );
    return res.data;
  },

  /** Download STEG invoice as blob */
  async downloadStegInvoice(applianceId: number): Promise<Blob> {
    const res = await api.post(
      `/appliances/${applianceId}/invoice/steg/`,
      {},
      { responseType: "blob", timeout: 60_000 }
    );
    return res.data;
  },

  async searchSpecs(brand: string, model: string, category: string): Promise<ApplianceSpecsResult> {
    const res = await api.post("/appliances/search-specs/", { brand, model, category });
    return res.data;
  },

  /** Fetch panoramas for a property (each includes face URLs and scan status). */
  async listPanoramasForProperty(propertyId: number): Promise<PanoramaRecord[]> {
    const res = await api.get(`/properties/${propertyId}/panoramas/`);
    return res.data;
  },

  /**
   * Trigger (or retrieve cached) appliance scan from a completed reconstruction
   * job's stored cubemap faces. No image upload needed.
   */
  async scanFromJob(jobId: string): Promise<JobScanResult> {
    const res = await api.post(`/appliances/scan-from-job/${jobId}/`, {}, { timeout: 180_000 });
    return res.data;
  },
};
