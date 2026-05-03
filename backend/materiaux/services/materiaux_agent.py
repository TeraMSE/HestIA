# import json
# import os
# from groq import Groq
# import chromadb
# from sentence_transformers import SentenceTransformer


# # ── Coefficients de gamme (exporté pour import dans main.py) ─────────────────
# GAMME_CONFIG = {
#     "bas": {
#         "label": "Économique",
#         "coeff_prix": 0.75,
#         "coeff_qualite": 0.85,
#         "description": "Matériaux standards, marques locales tunisiennes, rapport qualité/prix optimisé",
#     },
#     "moyenne": {
#         "label": "Intermédiaire",
#         "coeff_prix": 1.0,
#         "coeff_qualite": 1.0,
#         "description": "Matériaux de qualité standard, marques reconnues sur le marché tunisien",
#     },
#     "haute": {
#         "label": "Premium",
#         "coeff_prix": 1.35,
#         "coeff_qualite": 1.2,
#         "description": "Matériaux haut de gamme, marques internationales, finitions premium",
#     },
# }

# # ── Coûts main d'œuvre Tunisie 2026 (TND/m²) ────────────────────────────────
# MAIN_OEUVRE_TUNISIE_2026 = {
#     "gros_oeuvre": {
#         "label": "Gros Œuvre (structure, maçonnerie, béton armé)",
#         "cout_m2": {"bas": 280, "moyenne": 380, "haute": 520},
#         "description": "Fondations, poteaux, poutres, dalles, maçonnerie — équipe maçon chef + 2 aides",
#         "source": "Barème UTICA BTP Tunisie 2026",
#     },
#     "etancheite": {
#         "label": "Étanchéité & Isolation",
#         "cout_m2": {"bas": 45, "moyenne": 65, "haute": 90},
#         "description": "Application membranes, crépi imperméabilisant, isolation toiture",
#         "source": "Tarif applicateurs agréés SIKA/WEBER Tunisie",
#     },
#     "revetements_sol": {
#         "label": "Revêtements Sol (carrelage, chape)",
#         "cout_m2": {"bas": 30, "moyenne": 45, "haute": 70},
#         "description": "Pose carrelage, ragréage, joints — carreleur qualifié",
#         "source": "Syndicat carreleurs Tunis 2026",
#     },
#     "revetements_mur": {
#         "label": "Revêtements Mur (enduit, faïence, peinture)",
#         "cout_m2": {"bas": 20, "moyenne": 32, "haute": 50},
#         "description": "Enduit plâtre, faïence SDB, peinture — peintre + plâtrier",
#         "source": "Barème UTICA BTP Tunisie 2026",
#     },
#     "menuiserie": {
#         "label": "Menuiserie (portes, fenêtres, volets)",
#         "cout_m2": {"bas": 25, "moyenne": 40, "haute": 65},
#         "description": "Pose et calage menuiseries aluminium/PVC/bois",
#         "source": "Tarif poseurs menuiserie Tunisie 2026",
#     },
#     "plomberie": {
#         "label": "Plomberie & Sanitaire",
#         "cout_m2": {"bas": 35, "moyenne": 55, "haute": 85},
#         "description": "Installation réseaux eau potable, évacuation, sanitaires — plombier qualifié",
#         "source": "FNAT Plomberie Tunisie 2026",
#     },
#     "electricite": {
#         "label": "Électricité (tableau, circuits, prises)",
#         "cout_m2": {"bas": 30, "moyenne": 48, "haute": 75},
#         "description": "Câblage, tableau électrique, prises, interrupteurs — électricien STEG agréé",
#         "source": "Tarif électriciens agréés STEG 2026",
#     },
#     "climatisation": {
#         "label": "Installation Climatisation & CVC",
#         "unite": "par unité",
#         "cout_unite": {"bas": 280, "moyenne": 420, "haute": 650},
#         "description": "Pose split mural: percement, support, connexion frigorifique, mise en service",
#         "source": "Techniciens CVC certifiés Tunisie 2026",
#     },
#     "finitions": {
#         "label": "Finitions (faux plafond, corniche, garde-corps)",
#         "cout_m2": {"bas": 30, "moyenne": 50, "haute": 90},
#         "description": "Staff plâtre, faux plafond BA13, menuiserie intérieure fine",
#         "source": "Artisans bâtiment Tunis/Sfax 2026",
#     },
# }


# class MateriauxAgent:
#     """
#     Agent principal: sélectionne et calcule TOUS les matériaux A→Z
#     selon surface, région, budget, GAMME (bas/moyenne/haute).
#     Chaque matériau est justifié. Calcul climatisation par pièce.
#     Estimation coût main d'œuvre Tunisie 2026 incluse.
#     """

#     CATALOGUE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "catalogue_materiaux.json")
#     CHROMA_PATH = os.path.join(os.path.dirname(__file__), "..", "rag", "chroma_db")

#     def __init__(self):
#         self.groq = Groq(api_key=os.getenv("GROQ_API_KEY"))
#         self.llm_model = "meta-llama/llama-4-scout-17b-16e-instruct"
#         self.embed_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")

#         with open(self.CATALOGUE_PATH, encoding="utf-8") as f:
#             self.catalogue = json.load(f)["catalogue"]

#         self.chroma = chromadb.PersistentClient(path=self.CHROMA_PATH)
#         self._init_rag()

#     # ─── RAG ────────────────────────────────────────────────────────────────

#     def _init_rag(self):
#         try:
#             self.collection = self.chroma.get_collection("materiaux_tn")
#         except Exception:
#             self.collection = self.chroma.create_collection("materiaux_tn")
#             docs, ids, metadatas = [], [], []
#             for mat in self.catalogue:
#                 text = (
#                     f"{mat['nom_marche']} {mat['categorie']} "
#                     f"{' '.join(mat.get('usage', []))} {mat.get('marque_tn', '')} "
#                     f"{'etancheite' if mat.get('etancheite') else ''} "
#                     f"{'anti_moisissure' if mat.get('anti_moisissure') else ''} "
#                     f"{'anti_fissure' if mat.get('anti_fissure') else ''}"
#                 )
#                 docs.append(text)
#                 ids.append(mat["id"])
#                 metadatas.append({
#                     "prix": str(mat.get("prix_unitaire_tnd", 0)),
#                     "categorie": str(mat.get("categorie", "")),
#                     "etancheite": str(mat.get("etancheite", False)),
#                     "anti_moisissure": str(mat.get("anti_moisissure", False)),
#                     "anti_fissure": str(mat.get("anti_fissure", False)),
#                 })
#             embeddings = self.embed_model.encode(docs).tolist()
#             self.collection.add(documents=docs, embeddings=embeddings, ids=ids, metadatas=metadatas)

#     def search_materiaux(self, query: str, n_results: int = 5) -> list:
#         q_embed = self.embed_model.encode([query]).tolist()
#         results = self.collection.query(query_embeddings=q_embed, n_results=n_results)
#         ids = results["ids"][0]
#         return [m for m in self.catalogue if m["id"] in ids]

#     # ─── PRIX RÉGION & GAMME ─────────────────────────────────────────────────

#     def get_prix_region(self, materiau: dict, region: str, gamme: str = "moyenne") -> float:
#         region_key = region.lower().strip()
#         if "prix_region" in materiau and region_key in materiau["prix_region"]:
#             prix_base = materiau["prix_region"][region_key]
#         else:
#             prix_base = materiau.get("prix_unitaire_tnd", 0)
#         coeff = GAMME_CONFIG.get(gamme, GAMME_CONFIG["moyenne"])["coeff_prix"]
#         return round(prix_base * coeff, 2)

#     # ─── CALCUL CLIMATISATION PAR PIÈCE ─────────────────────────────────────

#     def calculer_climatisation_par_piece(
#         self, plan_data: dict, region: str, climat: str, gamme: str
#     ) -> list:
#         pieces = plan_data.get("pieces", [])
#         S = float(plan_data.get("surface_habitable_m2", 100))
#         nb_chambres = int(plan_data.get("nb_chambres", 2))
#         climat_lower = climat.lower()

#         if climat_lower == "cote":
#             coeff_clim = 1.10
#             coeff_label = "+10% humidité marine"
#         elif climat_lower in ("sahel", "interieur"):
#             coeff_clim = 1.15
#             coeff_label = "+15% chaleur sèche"
#         else:
#             coeff_clim = 1.05
#             coeff_label = "+5% standard"

#         BTU_PAR_M2 = 550

#         PIECES_A_CLIMATISER = [
#             "salon", "séjour", "sejour", "living", "salle",
#             "chambre", "bedroom", "suite", "bureau",
#         ]
#         PIECES_NON_CLIMATISEES = [
#             "wc", "toilette", "couloir", "dégagement", "cellier",
#             "garage", "terrasse", "placard", "entrée", "hall",
#             "cuisine", "dressing",
#         ]

#         resultats_clim = []

#         if pieces:
#             pieces_traitees = set()
#             for piece in pieces:
#                 nom_lower = piece.get("nom", "").lower()
#                 surface_piece = float(piece.get("surface_m2", 0) or 0)

#                 if any(kw in nom_lower for kw in PIECES_NON_CLIMATISEES):
#                     continue
#                 if not any(kw in nom_lower for kw in PIECES_A_CLIMATISER):
#                     continue
#                 if surface_piece <= 0:
#                     continue

#                 cle_piece = "sejour" if any(kw in nom_lower for kw in ["séjour", "sejour", "salon", "salle"]) else nom_lower
#                 if cle_piece in pieces_traitees and cle_piece == "sejour":
#                     for r in resultats_clim:
#                         if "séjour" in r["piece"].lower() or "salon" in r["piece"].lower():
#                             r["surface_m2"] += surface_piece
#                             r["btu_calcule"] = round(r["surface_m2"] * BTU_PAR_M2 * coeff_clim)
#                             r["puissance_btu"], r["nb_unites"] = self._choisir_puissance_clim(r["btu_calcule"])
#                             r["justification"] = (
#                                 f"{r['surface_m2']:.1f} m² × {BTU_PAR_M2} BTU/m² × {coeff_clim} ({coeff_label}) "
#                                 f"= {r['btu_calcule']:,} BTU → {r['nb_unites']} × {r['puissance_btu']}"
#                             )
#                     continue

#                 pieces_traitees.add(cle_piece)
#                 btu = round(surface_piece * BTU_PAR_M2 * coeff_clim)
#                 puissance, nb_unites = self._choisir_puissance_clim(btu)

#                 resultats_clim.append({
#                     "piece": piece.get("nom", "Pièce"),
#                     "surface_m2": surface_piece,
#                     "btu_calcule": btu,
#                     "puissance_btu": puissance,
#                     "nb_unites": nb_unites,
#                     "justification": (
#                         f"{surface_piece:.1f} m² × {BTU_PAR_M2} BTU/m² × {coeff_clim} ({coeff_label}) "
#                         f"= {btu:,} BTU → {nb_unites} × {puissance}"
#                     ),
#                 })
#         else:
#             s_sejour = round(S * 0.40, 1)
#             btu_sejour = round(s_sejour * BTU_PAR_M2 * coeff_clim)
#             puissance_s, nb_s = self._choisir_puissance_clim(btu_sejour)
#             resultats_clim.append({
#                 "piece": "Séjour / Salon",
#                 "surface_m2": s_sejour,
#                 "btu_calcule": btu_sejour,
#                 "puissance_btu": puissance_s,
#                 "nb_unites": nb_s,
#                 "justification": (
#                     f"Estimation: {s_sejour} m² (40% de {S} m²) × {BTU_PAR_M2} × {coeff_clim} = {btu_sejour:,} BTU"
#                 ),
#             })

#             s_chambre_moy = round((S * 0.45) / max(nb_chambres, 1), 1)
#             for i in range(1, nb_chambres + 1):
#                 btu_ch = round(s_chambre_moy * BTU_PAR_M2 * coeff_clim)
#                 puissance_ch, nb_ch = self._choisir_puissance_clim(btu_ch)
#                 resultats_clim.append({
#                     "piece": f"Chambre {i}",
#                     "surface_m2": s_chambre_moy,
#                     "btu_calcule": btu_ch,
#                     "puissance_btu": puissance_ch,
#                     "nb_unites": nb_ch,
#                     "justification": (
#                         f"Chambre {i}: {s_chambre_moy} m² × {BTU_PAR_M2} × {coeff_clim} = {btu_ch:,} BTU"
#                     ),
#                 })

#         return resultats_clim

#     def _choisir_puissance_clim(self, btu: int) -> tuple:
#         if btu <= 9000:
#             return "9 000 BTU", 1
#         elif btu <= 12000:
#             return "12 000 BTU", 1
#         elif btu <= 18000:
#             return "18 000 BTU", 1
#         elif btu <= 24000:
#             return "24 000 BTU", 1
#         elif btu <= 36000:
#             return "18 000 BTU", 2
#         else:
#             return "24 000 BTU", 2

#     # ─── CALCUL MAIN D'ŒUVRE ────────────────────────────────────────────────

#     def calculer_main_oeuvre(
#         self, plan_data: dict, gamme: str, nb_clims: int
#     ) -> dict:
#         S = float(plan_data.get("surface_habitable_m2", 100))
#         S_facade = float(plan_data.get("surface_facade_m2", S * 0.8))
#         nb_etages = int(plan_data.get("nb_etages", 1))
#         gamme_key = gamme if gamme in ("bas", "moyenne", "haute") else "moyenne"

#         detail = {}
#         total = 0

#         for poste_key, poste in MAIN_OEUVRE_TUNISIE_2026.items():
#             if poste_key == "climatisation":
#                 cout = nb_clims * poste["cout_unite"][gamme_key]
#                 quantite = nb_clims
#                 unite = "unité"
#                 cout_u = poste["cout_unite"][gamme_key]
#             elif poste_key == "revetements_mur":
#                 quantite = round(S_facade + S * 0.6 * 2.8, 1)
#                 cout_u = poste["cout_m2"][gamme_key]
#                 cout = round(quantite * cout_u)
#                 unite = "m²"
#             elif poste_key == "menuiserie":
#                 quantite = round(S * 0.12, 1)
#                 cout_u = poste["cout_m2"][gamme_key]
#                 cout = round(quantite * cout_u)
#                 unite = "m²"
#             else:
#                 quantite = round(S * nb_etages if poste_key == "gros_oeuvre" else S, 1)
#                 cout_u = poste["cout_m2"][gamme_key]
#                 cout = round(quantite * cout_u)
#                 unite = "m²"

#             detail[poste_key] = {
#                 "label": poste["label"],
#                 "quantite": quantite,
#                 "unite": unite,
#                 "cout_unitaire_tnd": cout_u,
#                 "cout_total_tnd": cout,
#                 "description": poste["description"],
#                 "source": poste["source"],
#             }
#             total += cout

#         frais_chantier = round(total * 0.08)
#         detail["frais_chantier"] = {
#             "label": "Frais chantier, transport & imprévus (8%)",
#             "quantite": 1,
#             "unite": "forfait",
#             "cout_unitaire_tnd": frais_chantier,
#             "cout_total_tnd": frais_chantier,
#             "description": "Transport matériaux, nettoyage chantier, imprévus techniques",
#             "source": "Estimation standard BTP Tunisie",
#         }
#         total += frais_chantier

#         return {
#             "detail": detail,
#             "total_tnd": total,
#             "cout_m2_mo": round(total / max(S, 1), 0),
#             "gamme": GAMME_CONFIG[gamme_key]["label"],
#             "source_globale": "Barèmes UTICA BTP, FNAT, Syndicats professionnels Tunisie 2026",
#             "note": (
#                 "Estimation basée sur les tarifs du marché tunisien 2026. "
#                 "Les prix réels peuvent varier selon la disponibilité des artisans, "
#                 "la région et la complexité du chantier (±15%)."
#             ),
#         }

#     # ─── CALCUL QUANTITÉS MATÉRIAUX ─────────────────────────────────────────

#     def calculer_quantites(
#         self, plan_data: dict, region: str, climat: str, gamme: str = "moyenne"
#     ) -> list:
#         S = float(plan_data.get("surface_habitable_m2", 100) or 100)
#         S_tot = float(plan_data.get("surface_totale_m2", S * 1.18) or S * 1.18)
#         S_toiture = float(plan_data.get("surface_toiture_m2", S * 1.1) or S * 1.1)
#         S_facade = float(plan_data.get("surface_facade_m2", S * 0.8) or S * 0.8)
#         S_terrasse = float(plan_data.get("surface_terrasse_m2", S * 0.15) or 0)
#         perimetre = float(plan_data.get("perimetre_fondations_ml", (S ** 0.5) * 4.2) or (S ** 0.5) * 4.2)
#         nb_etages = int(plan_data.get("nb_etages", 1) or 1)
#         nb_chambres = int(plan_data.get("nb_chambres", 2) or 2)
#         nb_sdb = int(plan_data.get("nb_salles_bain", 1) or 1)
#         nb_wc = int(plan_data.get("nb_wc_separes", 1) or 1)
#         H = float(plan_data.get("hauteur_sous_plafond_m", 2.8) or 2.8)

#         S_murs_int = S * 0.55 * H
#         S_murs_ext = perimetre * H * nb_etages
#         S_sdb_total = nb_sdb * 6 + nb_wc * 2

#         clim_pieces = self.calculer_climatisation_par_piece(plan_data, region, climat, gamme)
#         nb_clims_total = sum(c["nb_unites"] for c in clim_pieces)

#         calculs = {
#             "GRO001": (S_tot * 0.35 * nb_etages, f"Béton armé: {S_tot:.0f} m² × 0.35 sac/m² × {nb_etages} étage(s)"),
#             "GRO002": (S_tot * 0.22 * nb_etages, f"Béton qualité: {S_tot:.0f} m² × 0.22 sac/m²"),
#             "GRO003": (S_tot * 0.08 * nb_etages * 1.5, f"Sable de carrière: {S_tot:.0f} m² × 0.12 t/m²"),
#             "GRO004": (S_tot * 0.12 * nb_etages * 1.5, f"Gravier: {S_tot:.0f} m² × 0.18 t/m²"),
#             "GRO005": (S_murs_ext * 50 + S_murs_int * 28, f"Briques creuses: murs ext {S_murs_ext:.0f} m² × 50 + murs int {S_murs_int:.0f} m² × 28"),
#             "GRO006": (perimetre * H * 0.45 * 80, f"Briques pleines soubassement: {perimetre:.1f} ml × {H:.1f}m × 0.45 × 80"),
#             "GRO007": (perimetre * 0.3 * 12.5, f"Blocs béton clôture: {perimetre:.1f} ml × 0.3m × 12.5 blocs/m²"),
#             "GRO008": (S_tot * 15 * nb_etages, f"Acier HA 8mm: {S_tot:.0f} m² × 15 kg/m² × {nb_etages} étage(s)"),
#             "GRO009": (S_tot * 22 * nb_etages, f"Acier HA 12mm: {S_tot:.0f} m² × 22 kg/m² × {nb_etages} étage(s)"),
#             "GRO010": ((S_tot / nb_etages) * 5.5, f"Hourdis plancher: {S_tot/nb_etages:.0f} m² × 5.5 hourdis/m²"),
#             "GRO011": ((S_tot / nb_etages) * 0.65, f"Poutrelles précontraintes: {S_tot/nb_etages:.0f} m² × 0.65 ml/m²"),
#             "ETN001": (S_toiture * 1.1, f"Membrane APP toiture: {S_toiture:.0f} m² × 1.1"),
#             "ETN002": (S_toiture * 1.05, f"Membrane SBS autoprotégée: {S_toiture:.0f} m² × 1.05"),
#             "ETN003": ((S + S_toiture) * 0.08, f"Hydrofuge SIKA 1: {S+S_toiture:.0f} m² × 0.08"),
#             "ETN004": ((S_sdb_total + 10) * 0.35, f"MAPELASTIC zones humides: {S_sdb_total:.0f} m² × 0.35"),
#             "ETN005": (perimetre * 2 + nb_sdb * 10, f"Bande armée fissures: {perimetre:.0f} ml × 2 + {nb_sdb} SDB × 10 ml"),
#             "ETN006": (perimetre * 0.07, f"Époxy injection: {perimetre:.0f} ml × 0.07"),
#             "ETN007": (S_facade * 1.8, f"Crépi WEBER.PRAL: {S_facade:.0f} m² × 1.8 kg/m²"),
#             "ETN008": (perimetre * 0.22, f"Drain fondation: {perimetre:.0f} ml × 0.22"),
#             "ISO001": (S_toiture * 1.05, f"Laine de roche toiture: {S_toiture:.0f} m² × 1.05"),
#             "ISO002": ((S_tot / nb_etages) * 1.0, f"Polystyrène EPS sous chape: {S_tot/nb_etages:.0f} m²"),
#             "ISO003": (S_facade * 0.45, f"Mousse PU projetée: {S_facade:.0f} m² × 0.45"),
#             "ISO004": (S * 0.28, f"Laine de verre acoustique: {S:.0f} m² × 0.28"),
#             "REV001": (S * 0.62 * 1.08, f"Carrelage séjour 60×60: {S:.0f} m² × 0.62 × 1.08"),
#             "REV002": (S_sdb_total * 1.1, f"Carrelage antidérapant SDB: {S_sdb_total:.0f} m² × 1.1"),
#             "REV003": (max(S_terrasse, 0) * 1.08, f"Carrelage terrasse R12: {max(S_terrasse,0):.0f} m² × 1.08"),
#             "REV004": (nb_sdb * 22 * 1.08, f"Faïence SDB: {nb_sdb} SDB × 22 m² × 1.08"),
#             "REV005": (S_facade * 1.4, f"Enduit façade monocouche: {S_facade:.0f} m² × 1.4 sac/m²"),
#             "REV006": ((S_murs_int + S) * 1.0, f"Plâtre intérieur: {S_murs_int:.0f} m² murs + {S:.0f} m² plafonds"),
#             "REV007": (S * 2.0, f"Chape autonivelante: {S:.0f} m² × 2.0 sac/m²"),
#             "COL001": ((S * 0.62 + S_sdb_total) * 0.45, f"Colle carrelage C2TE: ({S*0.62:.0f} + {S_sdb_total:.0f} m²) × 0.45"),
#             "COL002": (S_sdb_total * 0.42, f"Joint époxy KERAPOXY: {S_sdb_total:.0f} m² × 0.42"),
#             "COL003": (S * 0.62 * 0.28, f"Joint ciment flexible: {S*0.62:.0f} m² × 0.28"),
#             "MEN001": (nb_chambres * 1.2 + 2, f"Fenêtres aluminium DV: {nb_chambres} chambres × 1.2 + 2"),
#             "MEN002": (1, "Porte entrée aluminium blindée: 1 unité"),
#             "MEN003": (nb_chambres + 1, f"Fenêtres PVC DV: {nb_chambres} chambres + 1"),
#             "MEN004": (nb_chambres + nb_sdb + 3, f"Portes intérieures bois: {nb_chambres} + {nb_sdb} + 3"),
#             "MEN005": (nb_chambres + 2, f"Volets roulants motorisés: {nb_chambres} chambres + 2"),
#             "PLO001": ((S ** 0.5) * 4 * 2.2, f"Tube PVC évacuation: {(S**0.5)*4:.0f} ml × 2.2"),
#             "PLO002": (S * 1.3, f"Tube multicouche eau: {S:.0f} m² × 1.3 ml/m²"),
#             "PLO003": (nb_sdb + nb_wc, f"WC suspendu: {nb_sdb} SDB + {nb_wc} WC"),
#             "PLO004": (nb_sdb + 1, f"Lavabo + robinetterie: {nb_sdb} SDB + 1 cuisine"),
#             "PLO005": (1, "Chauffe-eau solaire 200L: 1 installation"),
#             "ELE001": (S * 8.5, f"Câble 3G2.5mm² COFICAB: {S:.0f} m² × 8.5 ml/m²"),
#             "ELE002": (1, "Tableau électrique 24 modules SCHNEIDER: 1 unité"),
#             "ELE003": (S * 0.48, f"Prises 2P+T 16A: {S:.0f} m² × 0.48"),
#             "ELE004": (S * 0.22, f"Interrupteurs: {S:.0f} m² × 0.22"),
#             "PEI001": ((S_murs_int + S) * 0.11, f"Peinture acrylique intérieure: {S_murs_int:.0f} + {S:.0f} m² × 0.11"),
#             "PEI002": (S_facade * 0.14, f"Peinture façade silicone: {S_facade:.0f} m² × 0.14"),
#             "PEI003": (S_sdb_total * 0.16, f"Peinture anti-humidité: {S_sdb_total:.0f} m² × 0.16"),
#             "PEI004": ((S_murs_int + S) * 0.09, f"Primaire accrochage: {S_murs_int:.0f} + {S:.0f} m² × 0.09"),
#             "CLO001": (S_murs_int * 0.55 * 1.08, f"BA13 standard KNAUF: {S_murs_int:.0f} m² × 0.55 × 1.08"),
#             "CLO002": (nb_sdb * 14 * 1.08, f"BA13 hydrofuge: {nb_sdb} SDB × 14 m² × 1.08"),
#             "REV008": (min(S * 0.12, 20), f"Marbre hall d'entrée: {min(S*0.12,20):.0f} m²"),
#             "REV009": (S_facade * 0.18, f"Pierre de taille façade: {S_facade:.0f} m² × 0.18"),
#             "CHA001": (
#                 nb_clims_total,
#                 f"Climatiseurs split inverter: {nb_clims_total} unités. "
#                 + " | ".join([f"{c['piece']}: {c['nb_unites']}×{c['puissance_btu']} ({c['btu_calcule']:,} BTU)"
#                                for c in clim_pieces])
#             ),
#             "FIN002": ((S ** 0.5) * 4 * 0.35, f"Corniche plâtre: {(S**0.5)*4:.0f} ml × 0.35"),
#             "FIN003": (max(int(nb_etages - 1) * 14, 0), f"Marches escalier: {max(nb_etages-1,0)} étage(s) × 14 marches"),
#             "FIN004": (max(int(nb_etages - 1) * 5 + S_terrasse * 0.04, 0), f"Garde-corps inox: escalier + terrasse"),
#             "VRD001": ((S ** 0.5) * 5.5, f"Tuyau PE100 alimentation: {(S**0.5)*5.5:.0f} ml"),
#             "VRD002": (4, "Regards béton: 4 unités"),
#             "VRD003": ((S ** 0.5) * 4 * 1.15, f"Grillage clôture: {(S**0.5)*4*1.15:.0f} ml"),
#         }

#         resultats = []
#         climat_lower = climat.lower()

#         for mat in self.catalogue:
#             mat_id = mat["id"]

#             climats_ok = mat.get("climat_recommande", ["cote", "sahel", "nord", "interieur"])
#             if "tous" not in climats_ok and climat_lower not in climats_ok:
#                 if not (mat.get("etancheite") or mat.get("anti_moisissure")):
#                     continue

#             if mat_id not in calculs:
#                 continue

#             quantite, justification_calcul = calculs[mat_id]
#             if quantite <= 0:
#                 continue

#             # ✅ gamme passé ici → prix change selon la gamme choisie
#             prix_u = self.get_prix_region(mat, region, gamme)
#             cout_total = round(quantite * prix_u, 2)

#             justification_choix = self._justifier_choix_materiau(mat, gamme, climat_lower)

#             resultats.append({
#                 "id": mat_id,
#                 "categorie": mat["categorie"],
#                 "nom": mat["nom_marche"],
#                 "marque": mat.get("marque_tn", ""),
#                 "description": mat.get("description", ""),
#                 "unite": mat.get("unite", "u"),
#                 "quantite": round(quantite, 2),
#                 "prix_unitaire_tnd": prix_u,
#                 "cout_total_tnd": cout_total,
#                 "etancheite": mat.get("etancheite", False),
#                 "anti_fissure": mat.get("anti_fissure", False),
#                 "anti_moisissure": mat.get("anti_moisissure", False),
#                 "justification_calcul": justification_calcul,
#                 "justification_choix": justification_choix,
#             })

#         for item in resultats:
#             if item["id"] == "CHA001":
#                 item["clim_detail_par_piece"] = clim_pieces

#         return sorted(resultats, key=lambda x: x["categorie"])

#     def _justifier_choix_materiau(self, mat: dict, gamme: str, climat: str) -> str:
#         justifs = []
#         if mat.get("etancheite") and climat == "cote":
#             justifs.append("Recommandé pour climat côtier (humidité marine, sel)")
#         if mat.get("anti_moisissure"):
#             justifs.append("Protection anti-moisissures essentielle en Tunisie")
#         if mat.get("anti_fissure"):
#             justifs.append("Résistance aux fissures (variations thermiques importantes)")
#         gamme_info = GAMME_CONFIG.get(gamme, GAMME_CONFIG["moyenne"])
#         justifs.append(f"Gamme {gamme_info['label']}: {gamme_info['description']}")
#         marque = mat.get("marque_tn", "")
#         if marque:
#             justifs.append(f"Disponible chez: {marque}")
#         return " · ".join(justifs) if justifs else "Matériau standard conforme DTT Tunisie"

#     # ─── ANALYSE LLM ────────────────────────────────────────────────────────

#     def generer_analyse_llama(
#         self,
#         plan_data: dict,
#         region: str,
#         climat: str,
#         budget: float,
#         materiaux: list,
#         gamme: str,
#         main_oeuvre: dict,
#         clim_pieces: list,
#     ) -> str:
#         cout_mat = sum(m["cout_total_tnd"] for m in materiaux)
#         cout_mo = main_oeuvre.get("total_tnd", 0)
#         cout_total_projet = cout_mat + cout_mo
#         top5 = sorted(materiaux, key=lambda x: x["cout_total_tnd"], reverse=True)[:5]
#         etancheite_list = [m["nom"] for m in materiaux if m.get("etancheite")]
#         gamme_label = GAMME_CONFIG.get(gamme, GAMME_CONFIG["moyenne"])["label"]

#         clim_resume = "\n".join([
#             f"  - {c['piece']}: {c['nb_unites']}×{c['puissance_btu']} ({c['btu_calcule']:,} BTU)"
#             for c in clim_pieces
#         ])

#         # ✅ Construire top5_json EN DEHORS du f-string pour éviter TypeError: unhashable type: dict
#         top5_json = json.dumps(
#             [{"nom": m["nom"], "cout": m["cout_total_tnd"]} for m in top5],
#             ensure_ascii=False, indent=2
#         )

#         prompt = f"""Tu es un expert en construction tunisienne certifié DTT, en 2026.

# DONNÉES DU PROJET:
# - Région: {region} (Climat: {climat}) | Gamme: {gamme_label}
# - Surface: {plan_data.get('surface_habitable_m2')} m² | Chambres: {plan_data.get('nb_chambres')} | SDB: {plan_data.get('nb_salles_bain')}
# - Budget: {budget:,.0f} TND | Matériaux: {cout_mat:,.0f} TND | MO: {cout_mo:,.0f} TND | TOTAL: {cout_total_projet:,.0f} TND

# CLIMATISATION PAR PIÈCE:
# {clim_resume}

# TOP 5 POSTES:
# {top5_json}

# Rédige 4 paragraphes: 1) Justification climatique 2) Justification climatisation BTU 3) Analyse budget 4) Recommandations locales tunisiennes. Max 500 mots."""

#         response = self.groq.chat.completions.create(
#             model=self.llm_model,
#             messages=[{"role": "user", "content": prompt}],
#             max_tokens=1200,
#             temperature=0.25,
#         )
#         return response.choices[0].message.content
import json
import os
from core.services import call_tokenfactory
import chromadb
from sentence_transformers import SentenceTransformer


# ── Coefficients de gamme (exporté pour import dans main.py) ─────────────────
GAMME_CONFIG = {
    "bas": {
        "label": "Économique",
        "coeff_prix": 0.75,
        "coeff_qualite": 0.85,
        "description": "Matériaux standards, marques locales tunisiennes, rapport qualité/prix optimisé",
    },
    "moyenne": {
        "label": "Intermédiaire",
        "coeff_prix": 1.0,
        "coeff_qualite": 1.0,
        "description": "Matériaux de qualité standard, marques reconnues sur le marché tunisien",
    },
    "haute": {
        "label": "Premium",
        "coeff_prix": 1.35,
        "coeff_qualite": 1.2,
        "description": "Matériaux haut de gamme, marques internationales, finitions premium",
    },
}

# ── Coûts main d'œuvre Tunisie 2026 (TND/m²) ────────────────────────────────
MAIN_OEUVRE_TUNISIE_2026 = {
    "gros_oeuvre": {
        "label": "Gros Œuvre (structure, maçonnerie, béton armé)",
        "cout_m2": {"bas": 280, "moyenne": 380, "haute": 520},
        "description": "Fondations, poteaux, poutres, dalles, maçonnerie — équipe maçon chef + 2 aides",
        "source": "Barème UTICA BTP Tunisie 2026",
    },
    "etancheite": {
        "label": "Étanchéité & Isolation",
        "cout_m2": {"bas": 45, "moyenne": 65, "haute": 90},
        "description": "Application membranes, crépi imperméabilisant, isolation toiture",
        "source": "Tarif applicateurs agréés SIKA/WEBER Tunisie",
    },
    "revetements_sol": {
        "label": "Revêtements Sol (carrelage, chape)",
        "cout_m2": {"bas": 30, "moyenne": 45, "haute": 70},
        "description": "Pose carrelage, ragréage, joints — carreleur qualifié",
        "source": "Syndicat carreleurs Tunis 2026",
    },
    "revetements_mur": {
        "label": "Revêtements Mur (enduit, faïence, peinture)",
        "cout_m2": {"bas": 20, "moyenne": 32, "haute": 50},
        "description": "Enduit plâtre, faïence SDB, peinture — peintre + plâtrier",
        "source": "Barème UTICA BTP Tunisie 2026",
    },
    "menuiserie": {
        "label": "Menuiserie (portes, fenêtres, volets)",
        "cout_m2": {"bas": 25, "moyenne": 40, "haute": 65},
        "description": "Pose et calage menuiseries aluminium/PVC/bois",
        "source": "Tarif poseurs menuiserie Tunisie 2026",
    },
    "plomberie": {
        "label": "Plomberie & Sanitaire",
        "cout_m2": {"bas": 35, "moyenne": 55, "haute": 85},
        "description": "Installation réseaux eau potable, évacuation, sanitaires — plombier qualifié",
        "source": "FNAT Plomberie Tunisie 2026",
    },
    "electricite": {
        "label": "Électricité (tableau, circuits, prises)",
        "cout_m2": {"bas": 30, "moyenne": 48, "haute": 75},
        "description": "Câblage, tableau électrique, prises, interrupteurs — électricien STEG agréé",
        "source": "Tarif électriciens agréés STEG 2026",
    },
    "climatisation": {
        "label": "Installation Climatisation & CVC",
        "unite": "par unité",
        "cout_unite": {"bas": 280, "moyenne": 420, "haute": 650},
        "description": "Pose split mural: percement, support, connexion frigorifique, mise en service",
        "source": "Techniciens CVC certifiés Tunisie 2026",
    },
    "finitions": {
        "label": "Finitions (faux plafond, corniche, garde-corps)",
        "cout_m2": {"bas": 30, "moyenne": 50, "haute": 90},
        "description": "Staff plâtre, faux plafond BA13, menuiserie intérieure fine",
        "source": "Artisans bâtiment Tunis/Sfax 2026",
    },
}


class MateriauxAgent:
    """
    Agent principal: sélectionne et calcule TOUS les matériaux A→Z
    selon surface, région, budget, GAMME (bas/moyenne/haute).
    Chaque matériau est justifié. Calcul climatisation par pièce.
    Estimation coût main d'œuvre Tunisie 2026 incluse.

    CORRECTION 2026-v2:
    - Périmètre LLM validé et stabilisé avant utilisation
    - S_facade calculée depuis périmètre stabilisé × H (RDC uniquement)
    - ETN007 (crépi façade) corrigé: S_facade_rdc × 1.6 sac/m²
    """

    CATALOGUE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "catalogue_materiaux.json")
    CHROMA_PATH = os.path.join(os.path.dirname(__file__), "..", "rag", "chroma_db")

    def __init__(self):
        self.embed_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")

        with open(self.CATALOGUE_PATH, encoding="utf-8") as f:
            self.catalogue = json.load(f)["catalogue"]

        self.chroma = chromadb.PersistentClient(path=self.CHROMA_PATH)
        self._init_rag()

    # ─── RAG ────────────────────────────────────────────────────────────────

    def _init_rag(self):
        try:
            self.collection = self.chroma.get_collection("materiaux_tn")
        except Exception:
            self.collection = self.chroma.create_collection("materiaux_tn")
            docs, ids, metadatas = [], [], []
            for mat in self.catalogue:
                text = (
                    f"{mat['nom_marche']} {mat['categorie']} "
                    f"{' '.join(mat.get('usage', []))} {mat.get('marque_tn', '')} "
                    f"{'etancheite' if mat.get('etancheite') else ''} "
                    f"{'anti_moisissure' if mat.get('anti_moisissure') else ''} "
                    f"{'anti_fissure' if mat.get('anti_fissure') else ''}"
                )
                docs.append(text)
                ids.append(mat["id"])
                metadatas.append({
                    "prix": str(mat.get("prix_unitaire_tnd", 0)),
                    "categorie": str(mat.get("categorie", "")),
                    "etancheite": str(mat.get("etancheite", False)),
                    "anti_moisissure": str(mat.get("anti_moisissure", False)),
                    "anti_fissure": str(mat.get("anti_fissure", False)),
                })
            embeddings = self.embed_model.encode(docs).tolist()
            self.collection.add(documents=docs, embeddings=embeddings, ids=ids, metadatas=metadatas)

    def search_materiaux(self, query: str, n_results: int = 5) -> list:
        q_embed = self.embed_model.encode([query]).tolist()
        results = self.collection.query(query_embeddings=q_embed, n_results=n_results)
        ids = results["ids"][0]
        return [m for m in self.catalogue if m["id"] in ids]

    # ─── PRIX RÉGION & GAMME ─────────────────────────────────────────────────

    def get_prix_region(self, materiau: dict, region: str, gamme: str = "moyenne") -> float:
        region_key = region.lower().strip()
        if "prix_region" in materiau and region_key in materiau["prix_region"]:
            prix_base = materiau["prix_region"][region_key]
        else:
            prix_base = materiau.get("prix_unitaire_tnd", 0)
        coeff = GAMME_CONFIG.get(gamme, GAMME_CONFIG["moyenne"])["coeff_prix"]
        return round(prix_base * coeff, 2)

    # ─── STABILISATION PÉRIMÈTRE ────────────────────────────────────────────

    def _stabiliser_perimetre(self, perimetre: float, S: float, nb_etages: int, H: float) -> tuple:
        """
        Valide le périmètre fourni par le LLM.
        Borne: entre maison carrée compacte (×3.5) et très allongée (×5.5).
        Retourne (perimetre_stable, S_facade_rdc, note).

        Exemple réel: plan 12 × 19.10 m → périmètre = (12+19.10)×2 = 62.2 ml
                      S_facade RDC = 62.2 × 2.8 = 174.2 m²
        """
        S_par_etage = S / max(nb_etages, 1)
        perimetre_min = (S_par_etage ** 0.5) * 3.5   # maison carrée compacte
        perimetre_max = (S_par_etage ** 0.5) * 5.5   # maison très allongée

        if perimetre_min <= perimetre <= perimetre_max:
            perimetre_stable = perimetre
            note = f"Périmètre LLM validé: {perimetre:.1f} ml (borne [{perimetre_min:.1f} – {perimetre_max:.1f}])"
        else:
            perimetre_stable = round((S_par_etage ** 0.5) * 4.2, 1)
            note = (
                f"Périmètre LLM hors borne ({perimetre:.1f} ml, attendu [{perimetre_min:.1f} – {perimetre_max:.1f}]). "
                f"Valeur stabilisée: {perimetre_stable:.1f} ml"
            )

        # Façade RDC uniquement (1 seul niveau de hauteur, indépendant de nb_etages)
        S_facade_rdc = round(perimetre_stable * H, 1)

        return perimetre_stable, S_facade_rdc, note

    # ─── CALCUL CLIMATISATION PAR PIÈCE ─────────────────────────────────────

    def calculer_climatisation_par_piece(
        self, plan_data: dict, region: str, climat: str, gamme: str
    ) -> list:
        pieces = plan_data.get("pieces", [])
        S = float(plan_data.get("surface_habitable_m2", 100))
        nb_chambres = int(plan_data.get("nb_chambres", 2))
        climat_lower = climat.lower()

        if climat_lower == "cote":
            coeff_clim = 1.10
            coeff_label = "+10% humidité marine"
        elif climat_lower in ("sahel", "interieur"):
            coeff_clim = 1.15
            coeff_label = "+15% chaleur sèche"
        else:
            coeff_clim = 1.05
            coeff_label = "+5% standard"

        BTU_PAR_M2 = 550

        PIECES_A_CLIMATISER = [
            "salon", "séjour", "sejour", "living", "salle",
            "chambre", "bedroom", "suite", "bureau",
        ]
        PIECES_NON_CLIMATISEES = [
            "wc", "toilette", "couloir", "dégagement", "cellier",
            "garage", "terrasse", "placard", "entrée", "hall",
            "cuisine", "dressing",
        ]

        resultats_clim = []

        if pieces:
            pieces_traitees = set()
            for piece in pieces:
                nom_lower = piece.get("nom", "").lower()
                surface_piece = float(piece.get("surface_m2", 0) or 0)

                if any(kw in nom_lower for kw in PIECES_NON_CLIMATISEES):
                    continue
                if not any(kw in nom_lower for kw in PIECES_A_CLIMATISER):
                    continue
                if surface_piece <= 0:
                    continue

                cle_piece = "sejour" if any(kw in nom_lower for kw in ["séjour", "sejour", "salon", "salle"]) else nom_lower
                if cle_piece in pieces_traitees and cle_piece == "sejour":
                    for r in resultats_clim:
                        if "séjour" in r["piece"].lower() or "salon" in r["piece"].lower():
                            r["surface_m2"] += surface_piece
                            r["btu_calcule"] = round(r["surface_m2"] * BTU_PAR_M2 * coeff_clim)
                            r["puissance_btu"], r["nb_unites"] = self._choisir_puissance_clim(r["btu_calcule"])
                            r["justification"] = (
                                f"{r['surface_m2']:.1f} m² × {BTU_PAR_M2} BTU/m² × {coeff_clim} ({coeff_label}) "
                                f"= {r['btu_calcule']:,} BTU → {r['nb_unites']} × {r['puissance_btu']}"
                            )
                    continue

                pieces_traitees.add(cle_piece)
                btu = round(surface_piece * BTU_PAR_M2 * coeff_clim)
                puissance, nb_unites = self._choisir_puissance_clim(btu)

                resultats_clim.append({
                    "piece": piece.get("nom", "Pièce"),
                    "surface_m2": surface_piece,
                    "btu_calcule": btu,
                    "puissance_btu": puissance,
                    "nb_unites": nb_unites,
                    "justification": (
                        f"{surface_piece:.1f} m² × {BTU_PAR_M2} BTU/m² × {coeff_clim} ({coeff_label}) "
                        f"= {btu:,} BTU → {nb_unites} × {puissance}"
                    ),
                })
        else:
            s_sejour = round(S * 0.40, 1)
            btu_sejour = round(s_sejour * BTU_PAR_M2 * coeff_clim)
            puissance_s, nb_s = self._choisir_puissance_clim(btu_sejour)
            resultats_clim.append({
                "piece": "Séjour / Salon",
                "surface_m2": s_sejour,
                "btu_calcule": btu_sejour,
                "puissance_btu": puissance_s,
                "nb_unites": nb_s,
                "justification": (
                    f"Estimation: {s_sejour} m² (40% de {S} m²) × {BTU_PAR_M2} × {coeff_clim} = {btu_sejour:,} BTU"
                ),
            })

            s_chambre_moy = round((S * 0.45) / max(nb_chambres, 1), 1)
            for i in range(1, nb_chambres + 1):
                btu_ch = round(s_chambre_moy * BTU_PAR_M2 * coeff_clim)
                puissance_ch, nb_ch = self._choisir_puissance_clim(btu_ch)
                resultats_clim.append({
                    "piece": f"Chambre {i}",
                    "surface_m2": s_chambre_moy,
                    "btu_calcule": btu_ch,
                    "puissance_btu": puissance_ch,
                    "nb_unites": nb_ch,
                    "justification": (
                        f"Chambre {i}: {s_chambre_moy} m² × {BTU_PAR_M2} × {coeff_clim} = {btu_ch:,} BTU"
                    ),
                })

        return resultats_clim

    def _choisir_puissance_clim(self, btu: int) -> tuple:
        if btu <= 9000:
            return "9 000 BTU", 1
        elif btu <= 12000:
            return "12 000 BTU", 1
        elif btu <= 18000:
            return "18 000 BTU", 1
        elif btu <= 24000:
            return "24 000 BTU", 1
        elif btu <= 36000:
            return "18 000 BTU", 2
        else:
            return "24 000 BTU", 2

    # ─── CALCUL MAIN D'ŒUVRE ────────────────────────────────────────────────

    def calculer_main_oeuvre(
        self, plan_data: dict, gamme: str, nb_clims: int
    ) -> dict:
        S = float(plan_data.get("surface_habitable_m2", 100))
        nb_etages = int(plan_data.get("nb_etages", 1))
        H = float(plan_data.get("hauteur_sous_plafond_m", 2.8) or 2.8)
        perimetre_raw = float(plan_data.get("perimetre_fondations_ml", (S / max(nb_etages, 1)) ** 0.5 * 4.2) or (S / max(nb_etages, 1)) ** 0.5 * 4.2)

        # Stabilisation périmètre pour main d'œuvre façade
        perimetre_stable, S_facade_rdc, _ = self._stabiliser_perimetre(perimetre_raw, S, nb_etages, H)

        gamme_key = gamme if gamme in ("bas", "moyenne", "haute") else "moyenne"

        detail = {}
        total = 0

        for poste_key, poste in MAIN_OEUVRE_TUNISIE_2026.items():
            if poste_key == "climatisation":
                cout = nb_clims * poste["cout_unite"][gamme_key]
                quantite = nb_clims
                unite = "unité"
                cout_u = poste["cout_unite"][gamme_key]
            elif poste_key == "revetements_mur":
                # Façade RDC + murs intérieurs
                quantite = round(S_facade_rdc + S * 0.6 * 2.8, 1)
                cout_u = poste["cout_m2"][gamme_key]
                cout = round(quantite * cout_u)
                unite = "m²"
            elif poste_key == "menuiserie":
                quantite = round(S * 0.12, 1)
                cout_u = poste["cout_m2"][gamme_key]
                cout = round(quantite * cout_u)
                unite = "m²"
            else:
                quantite = round(S * nb_etages if poste_key == "gros_oeuvre" else S, 1)
                cout_u = poste["cout_m2"][gamme_key]
                cout = round(quantite * cout_u)
                unite = "m²"

            detail[poste_key] = {
                "label": poste["label"],
                "quantite": quantite,
                "unite": unite,
                "cout_unitaire_tnd": cout_u,
                "cout_total_tnd": cout,
                "description": poste["description"],
                "source": poste["source"],
            }
            total += cout

        frais_chantier = round(total * 0.08)
        detail["frais_chantier"] = {
            "label": "Frais chantier, transport & imprévus (8%)",
            "quantite": 1,
            "unite": "forfait",
            "cout_unitaire_tnd": frais_chantier,
            "cout_total_tnd": frais_chantier,
            "description": "Transport matériaux, nettoyage chantier, imprévus techniques",
            "source": "Estimation standard BTP Tunisie",
        }
        total += frais_chantier

        return {
            "detail": detail,
            "total_tnd": total,
            "cout_m2_mo": round(total / max(S, 1), 0),
            "gamme": GAMME_CONFIG[gamme_key]["label"],
            "source_globale": "Barèmes UTICA BTP, FNAT, Syndicats professionnels Tunisie 2026",
            "note": (
                "Estimation basée sur les tarifs du marché tunisien 2026. "
                "Les prix réels peuvent varier selon la disponibilité des artisans, "
                "la région et la complexité du chantier (±15%)."
            ),
        }

    # ─── CALCUL QUANTITÉS MATÉRIAUX ─────────────────────────────────────────

    def calculer_quantites(
        self, plan_data: dict, region: str, climat: str, gamme: str = "moyenne"
    ) -> list:
        S = float(plan_data.get("surface_habitable_m2", 100) or 100)
        S_tot = float(plan_data.get("surface_totale_m2", S * 1.18) or S * 1.18)
        S_toiture = float(plan_data.get("surface_toiture_m2", S * 1.1) or S * 1.1)
        S_terrasse = float(plan_data.get("surface_terrasse_m2", S * 0.15) or 0)
        nb_etages = int(plan_data.get("nb_etages", 1) or 1)
        nb_chambres = int(plan_data.get("nb_chambres", 2) or 2)
        nb_sdb = int(plan_data.get("nb_salles_bain", 1) or 1)
        nb_wc = int(plan_data.get("nb_wc_separes", 1) or 1)
        H = float(plan_data.get("hauteur_sous_plafond_m", 2.8) or 2.8)

        # ── Périmètre: validation et stabilisation ───────────────────────────
        perimetre_raw = float(
            plan_data.get("perimetre_fondations_ml")
            or (S / max(nb_etages, 1)) ** 0.5 * 4.2
        )
        perimetre, S_facade_rdc, perimetre_note = self._stabiliser_perimetre(
            perimetre_raw, S, nb_etages, H
        )
        # S_facade pour usages internes (murs ext. multi-étages) reste basée sur périmètre stable
        S_facade = S_facade_rdc  # façade de référence = RDC, conformément à la correction

        S_murs_int = S * 0.55 * H
        S_murs_ext = perimetre * H * nb_etages
        S_sdb_total = nb_sdb * 6 + nb_wc * 2

        clim_pieces = self.calculer_climatisation_par_piece(plan_data, region, climat, gamme)
        nb_clims_total = sum(c["nb_unites"] for c in clim_pieces)

        calculs = {
            "GRO001": (S_tot * 0.35 * nb_etages, f"Béton armé: {S_tot:.0f} m² × 0.35 sac/m² × {nb_etages} étage(s)"),
            "GRO002": (S_tot * 0.22 * nb_etages, f"Béton qualité: {S_tot:.0f} m² × 0.22 sac/m²"),
            "GRO003": (S_tot * 0.08 * nb_etages * 1.5, f"Sable de carrière: {S_tot:.0f} m² × 0.12 t/m²"),
            "GRO004": (S_tot * 0.12 * nb_etages * 1.5, f"Gravier: {S_tot:.0f} m² × 0.18 t/m²"),
            "GRO005": (S_murs_ext * 50 + S_murs_int * 28, f"Briques creuses: murs ext {S_murs_ext:.0f} m² × 50 + murs int {S_murs_int:.0f} m² × 28"),
            "GRO006": (perimetre * H * 0.45 * 80, f"Briques pleines soubassement: {perimetre:.1f} ml × {H:.1f}m × 0.45 × 80"),
            "GRO007": (perimetre * 0.3 * 12.5, f"Blocs béton clôture: {perimetre:.1f} ml × 0.3m × 12.5 blocs/m²"),
            "GRO008": (S_tot * 15 * nb_etages, f"Acier HA 8mm: {S_tot:.0f} m² × 15 kg/m² × {nb_etages} étage(s)"),
            "GRO009": (S_tot * 22 * nb_etages, f"Acier HA 12mm: {S_tot:.0f} m² × 22 kg/m² × {nb_etages} étage(s)"),
            "GRO010": ((S_tot / nb_etages) * 5.5, f"Hourdis plancher: {S_tot/nb_etages:.0f} m² × 5.5 hourdis/m²"),
            "GRO011": ((S_tot / nb_etages) * 0.65, f"Poutrelles précontraintes: {S_tot/nb_etages:.0f} m² × 0.65 ml/m²"),
            "ETN001": (S_toiture * 1.1, f"Membrane APP toiture: {S_toiture:.0f} m² × 1.1"),
            "ETN002": (S_toiture * 1.05, f"Membrane SBS autoprotégée: {S_toiture:.0f} m² × 1.05"),
            "ETN003": ((S + S_toiture) * 0.08, f"Hydrofuge SIKA 1: {S+S_toiture:.0f} m² × 0.08"),
            "ETN004": ((S_sdb_total + 10) * 0.35, f"MAPELASTIC zones humides: {S_sdb_total:.0f} m² × 0.35"),
            "ETN005": (perimetre * 2 + nb_sdb * 10, f"Bande armée fissures: {perimetre:.0f} ml × 2 + {nb_sdb} SDB × 10 ml"),
            "ETN006": (perimetre * 0.07, f"Époxy injection: {perimetre:.0f} ml × 0.07"),
            # ✅ CORRECTION: crépi façade basé sur S_facade_rdc (périmètre stabilisé × H, RDC uniquement)
            "ETN007": (
                S_facade_rdc * 1.6,
                f"Crépi WEBER.PRAL: {S_facade_rdc:.0f} m² façade RDC (périmètre {perimetre:.1f} ml × H {H:.1f} m) × 1.6 sac/m²"
            ),
            "ETN008": (perimetre * 0.22, f"Drain fondation: {perimetre:.0f} ml × 0.22"),
            "ISO001": (S_toiture * 1.05, f"Laine de roche toiture: {S_toiture:.0f} m² × 1.05"),
            "ISO002": ((S_tot / nb_etages) * 1.0, f"Polystyrène EPS sous chape: {S_tot/nb_etages:.0f} m²"),
            "ISO003": (S_facade_rdc * 0.45, f"Mousse PU projetée: {S_facade_rdc:.0f} m² façade RDC × 0.45"),
            "ISO004": (S * 0.28, f"Laine de verre acoustique: {S:.0f} m² × 0.28"),
            "REV001": (S * 0.62 * 1.08, f"Carrelage séjour 60×60: {S:.0f} m² × 0.62 × 1.08"),
            "REV002": (S_sdb_total * 1.1, f"Carrelage antidérapant SDB: {S_sdb_total:.0f} m² × 1.1"),
            "REV003": (max(S_terrasse, 0) * 1.08, f"Carrelage terrasse R12: {max(S_terrasse,0):.0f} m² × 1.08"),
            "REV004": (nb_sdb * 22 * 1.08, f"Faïence SDB: {nb_sdb} SDB × 22 m² × 1.08"),
            "REV005": (S_facade_rdc * 1.4, f"Enduit façade monocouche: {S_facade_rdc:.0f} m² façade RDC × 1.4 sac/m²"),
            "REV006": ((S_murs_int + S) * 1.0, f"Plâtre intérieur: {S_murs_int:.0f} m² murs + {S:.0f} m² plafonds"),
            "REV007": (S * 2.0, f"Chape autonivelante: {S:.0f} m² × 2.0 sac/m²"),
            "COL001": ((S * 0.62 + S_sdb_total) * 0.45, f"Colle carrelage C2TE: ({S*0.62:.0f} + {S_sdb_total:.0f} m²) × 0.45"),
            "COL002": (S_sdb_total * 0.42, f"Joint époxy KERAPOXY: {S_sdb_total:.0f} m² × 0.42"),
            "COL003": (S * 0.62 * 0.28, f"Joint ciment flexible: {S*0.62:.0f} m² × 0.28"),
            "MEN001": (nb_chambres * 1.2 + 2, f"Fenêtres aluminium DV: {nb_chambres} chambres × 1.2 + 2"),
            "MEN002": (1, "Porte entrée aluminium blindée: 1 unité"),
            "MEN003": (nb_chambres + 1, f"Fenêtres PVC DV: {nb_chambres} chambres + 1"),
            "MEN004": (nb_chambres + nb_sdb + 3, f"Portes intérieures bois: {nb_chambres} + {nb_sdb} + 3"),
            "MEN005": (nb_chambres + 2, f"Volets roulants motorisés: {nb_chambres} chambres + 2"),
            "PLO001": ((S ** 0.5) * 4 * 2.2, f"Tube PVC évacuation: {(S**0.5)*4:.0f} ml × 2.2"),
            "PLO002": (S * 1.3, f"Tube multicouche eau: {S:.0f} m² × 1.3 ml/m²"),
            "PLO003": (nb_sdb + nb_wc, f"WC suspendu: {nb_sdb} SDB + {nb_wc} WC"),
            "PLO004": (nb_sdb + 1, f"Lavabo + robinetterie: {nb_sdb} SDB + 1 cuisine"),
            "PLO005": (1, "Chauffe-eau solaire 200L: 1 installation"),
            "ELE001": (S * 8.5, f"Câble 3G2.5mm² COFICAB: {S:.0f} m² × 8.5 ml/m²"),
            "ELE002": (1, "Tableau électrique 24 modules SCHNEIDER: 1 unité"),
            "ELE003": (S * 0.48, f"Prises 2P+T 16A: {S:.0f} m² × 0.48"),
            "ELE004": (S * 0.22, f"Interrupteurs: {S:.0f} m² × 0.22"),
            "PEI001": ((S_murs_int + S) * 0.11, f"Peinture acrylique intérieure: {S_murs_int:.0f} + {S:.0f} m² × 0.11"),
            "PEI002": (S_facade_rdc * 0.14, f"Peinture façade silicone: {S_facade_rdc:.0f} m² façade RDC × 0.14"),
            "PEI003": (S_sdb_total * 0.16, f"Peinture anti-humidité: {S_sdb_total:.0f} m² × 0.16"),
            "PEI004": ((S_murs_int + S) * 0.09, f"Primaire accrochage: {S_murs_int:.0f} + {S:.0f} m² × 0.09"),
            "CLO001": (S_murs_int * 0.55 * 1.08, f"BA13 standard KNAUF: {S_murs_int:.0f} m² × 0.55 × 1.08"),
            "CLO002": (nb_sdb * 14 * 1.08, f"BA13 hydrofuge: {nb_sdb} SDB × 14 m² × 1.08"),
            "REV008": (min(S * 0.12, 20), f"Marbre hall d'entrée: {min(S*0.12,20):.0f} m²"),
            "REV009": (S_facade_rdc * 0.18, f"Pierre de taille façade: {S_facade_rdc:.0f} m² façade RDC × 0.18"),
            "CHA001": (
                nb_clims_total,
                f"Climatiseurs split inverter: {nb_clims_total} unités. "
                + " | ".join([f"{c['piece']}: {c['nb_unites']}×{c['puissance_btu']} ({c['btu_calcule']:,} BTU)"
                               for c in clim_pieces])
            ),
            "FIN002": ((S ** 0.5) * 4 * 0.35, f"Corniche plâtre: {(S**0.5)*4:.0f} ml × 0.35"),
            "FIN003": (max(int(nb_etages - 1) * 14, 0), f"Marches escalier: {max(nb_etages-1,0)} étage(s) × 14 marches"),
            "FIN004": (max(int(nb_etages - 1) * 5 + S_terrasse * 0.04, 0), f"Garde-corps inox: escalier + terrasse"),
            "VRD001": ((S ** 0.5) * 5.5, f"Tuyau PE100 alimentation: {(S**0.5)*5.5:.0f} ml"),
            "VRD002": (4, "Regards béton: 4 unités"),
            "VRD003": ((S ** 0.5) * 4 * 1.15, f"Grillage clôture: {(S**0.5)*4*1.15:.0f} ml"),
        }

        resultats = []
        climat_lower = climat.lower()

        for mat in self.catalogue:
            mat_id = mat["id"]

            climats_ok = mat.get("climat_recommande", ["cote", "sahel", "nord", "interieur"])
            if "tous" not in climats_ok and climat_lower not in climats_ok:
                if not (mat.get("etancheite") or mat.get("anti_moisissure")):
                    continue

            if mat_id not in calculs:
                continue

            quantite, justification_calcul = calculs[mat_id]
            if quantite <= 0:
                continue

            prix_u = self.get_prix_region(mat, region, gamme)
            cout_total = round(quantite * prix_u, 2)

            justification_choix = self._justifier_choix_materiau(mat, gamme, climat_lower)

            resultats.append({
                "id": mat_id,
                "categorie": mat["categorie"],
                "nom": mat["nom_marche"],
                "marque": mat.get("marque_tn", ""),
                "description": mat.get("description", ""),
                "unite": mat.get("unite", "u"),
                "quantite": round(quantite, 2),
                "prix_unitaire_tnd": prix_u,
                "cout_total_tnd": cout_total,
                "etancheite": mat.get("etancheite", False),
                "anti_fissure": mat.get("anti_fissure", False),
                "anti_moisissure": mat.get("anti_moisissure", False),
                "justification_calcul": justification_calcul,
                "justification_choix": justification_choix,
                # Méta de traçabilité périmètre
                "_meta_perimetre": {
                    "perimetre_raw_ml": perimetre_raw,
                    "perimetre_stable_ml": perimetre,
                    "S_facade_rdc_m2": S_facade_rdc,
                    "note": perimetre_note,
                } if mat_id in ("ETN007", "REV005", "REV009", "PEI002", "ISO003") else None,
            })

        for item in resultats:
            if item["id"] == "CHA001":
                item["clim_detail_par_piece"] = clim_pieces

        return sorted(resultats, key=lambda x: x["categorie"])

    def _justifier_choix_materiau(self, mat: dict, gamme: str, climat: str) -> str:
        justifs = []
        if mat.get("etancheite") and climat == "cote":
            justifs.append("Recommandé pour climat côtier (humidité marine, sel)")
        if mat.get("anti_moisissure"):
            justifs.append("Protection anti-moisissures essentielle en Tunisie")
        if mat.get("anti_fissure"):
            justifs.append("Résistance aux fissures (variations thermiques importantes)")
        gamme_info = GAMME_CONFIG.get(gamme, GAMME_CONFIG["moyenne"])
        justifs.append(f"Gamme {gamme_info['label']}: {gamme_info['description']}")
        marque = mat.get("marque_tn", "")
        if marque:
            justifs.append(f"Disponible chez: {marque}")
        return " · ".join(justifs) if justifs else "Matériau standard conforme DTT Tunisie"

    # ─── ANALYSE LLM ────────────────────────────────────────────────────────

    def generer_analyse_llama(
        self,
        plan_data: dict,
        region: str,
        climat: str,
        budget: float,
        materiaux: list,
        gamme: str,
        main_oeuvre: dict,
        clim_pieces: list,
    ) -> str:
        cout_mat = sum(m["cout_total_tnd"] for m in materiaux)
        cout_mo = main_oeuvre.get("total_tnd", 0)
        cout_total_projet = cout_mat + cout_mo
        top5 = sorted(materiaux, key=lambda x: x["cout_total_tnd"], reverse=True)[:5]
        etancheite_list = [m["nom"] for m in materiaux if m.get("etancheite")]
        gamme_label = GAMME_CONFIG.get(gamme, GAMME_CONFIG["moyenne"])["label"]

        clim_resume = "\n".join([
            f"  - {c['piece']}: {c['nb_unites']}×{c['puissance_btu']} ({c['btu_calcule']:,} BTU)"
            for c in clim_pieces
        ])

        top5_json = json.dumps(
            [{"nom": m["nom"], "cout": m["cout_total_tnd"]} for m in top5],
            ensure_ascii=False, indent=2
        )

        prompt = f"""Tu es un expert en construction tunisienne certifié DTT, en 2026.

DONNÉES DU PROJET:
- Région: {region} (Climat: {climat}) | Gamme: {gamme_label}
- Surface: {plan_data.get('surface_habitable_m2')} m² | Chambres: {plan_data.get('nb_chambres')} | SDB: {plan_data.get('nb_salles_bain')}
- Budget: {budget:,.0f} TND | Matériaux: {cout_mat:,.0f} TND | MO: {cout_mo:,.0f} TND | TOTAL: {cout_total_projet:,.0f} TND

CLIMATISATION PAR PIÈCE:
{clim_resume}

TOP 5 POSTES:
{top5_json}

Rédige 4 paragraphes: 1) Justification climatique 2) Justification climatisation BTU 3) Analyse budget 4) Recommandations locales tunisiennes. Max 500 mots."""

        text = call_tokenfactory(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1200,
            temperature=0.25,
        )
        return text
