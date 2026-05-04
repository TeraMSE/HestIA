/**
 * materiauxApi.ts — typed Axios client for /api/v1/materiaux/*
 */
import api from "./api";

// ── Types ──────────────────────────────────────────────────────────────────

export interface MatRegion {
  nom: string;
  climat: string;
}

export interface MatGamme {
  id: "bas" | "moyenne" | "haute";
  label: string;
  description: string;
  coeff_prix: number;
}

export interface MateriauItem {
  nom: string;
  categorie: string;
  quantite: number;
  unite: string;
  prix_unitaire_tnd: number;
  cout_total_tnd: number;
}

export interface MainOeuvreDetail {
  poste: string;
  cout_tnd: number;
}

export interface MainOeuvre {
  total_tnd: number;
  detail: MainOeuvreDetail[];
}

export interface ClimPiece {
  piece: string;
  surface_m2: number;
  btu_calcule: number;
  nb_unites: number;
  puissance_btu: string;
}

export interface EvalBudget {
  statut: "OPTIMAL" | "INSUFFISANT" | "EXCÉDENT";
  ratio: number;
  pourcentage: number;
  message_court: string;
  cout_total: number;
  budget: number;
  ecart: number;
  cout_materiaux: number;
  cout_main_oeuvre: number;
  cout_total_projet: number;
}

export interface MateriauxAnalysisResult {
  success: boolean;
  estimate_id: number;
  plan_data: Record<string, unknown>;
  region: string;
  climat: string;
  gamme: string;
  gamme_label: string;
  budget: number;
  materiaux: MateriauItem[];
  cout_materiaux: number;
  cout_total: number;
  nb_materiaux: number;
  eval_budget: EvalBudget;
  main_oeuvre: MainOeuvre;
  clim_detail: ClimPiece[];
  nb_clims_total: number;
  analyse_materiaux: string;
  recommandation: string;
  conseil_deco?: string;
}

export interface MateriauxEstimateListItem {
  id: number;
  region: string;
  gamme: string;
  budget_tnd: string;
  surface_m2: number;
  nb_chambres: number;
  cout_total_tnd: string;
  created_at: string;
}

// ── API client ─────────────────────────────────────────────────────────────

export const materiauxApi = {
  async getRegions(): Promise<MatRegion[]> {
    const res = await api.get("/materiaux/regions/");
    return res.data.regions;
  },

  async getGammes(): Promise<MatGamme[]> {
    const res = await api.get("/materiaux/gammes/");
    return res.data.gammes;
  },

  async analyserPlan(formData: FormData): Promise<MateriauxAnalysisResult> {
    const res = await api.post("/materiaux/analyser-plan/", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,
    });
    return res.data;
  },

  async listEstimates(): Promise<MateriauxEstimateListItem[]> {
    const res = await api.get("/materiaux/estimates/");
    return res.data;
  },

  async getEstimate(id: number): Promise<MateriauxAnalysisResult> {
    const res = await api.get(`/materiaux/estimates/${id}/`);
    return res.data;
  },
};
