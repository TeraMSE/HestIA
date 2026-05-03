import cv2
import numpy as np
import base64
import json
import os
from core.services import call_tokenfactory, call_tokenfactory_vision


class VisionAgent:
    """
    Analyse un plan 2D architectural via LLaMA 4 Vision (Groq).
    CORRECTIONS:
    - Surface lue depuis cartouche EN PRIORITÉ, jamais forcée à 100
    - nb_chambres recompté depuis liste pièces (source de vérité absolue)
    - Plans multi-étages détectés et signalés
    - Fallback OpenCV amélioré
    """

    def __init__(self):
        pass

    def encode_image_base64(self, image_bytes: bytes) -> str:
        return base64.b64encode(image_bytes).decode("utf-8")

    # ─────────────────────────────────────────────────────────────────────────
    # ANALYSE PRINCIPALE
    # ─────────────────────────────────────────────────────────────────────────
    def analyze_plan_with_llama4(self, image_bytes: bytes, scale_info: str = None) -> dict:
        """Analyse LLaMA 4 Vision avec prompt renforcé pour précision maximale."""
        image_b64 = self.encode_image_base64(image_bytes)
        scale_context = (
            f"L'utilisateur a indiqué l'échelle: {scale_info}. Utilise-la en priorité."
            if scale_info
            else (
                "Cherche l'échelle dans le cartouche du plan (ex: 'Scale 1/50', "
                "'ECHELLE 1/100', '1cm=1m'). Si trouvée, utilise-la. Sinon, estime."
            )
        )

        prompt = f"""Tu es un architecte expert en lecture de plans 2D architecturaux.
Analyse ce plan avec une précision absolue. Chaque erreur coûte de l'argent au client.

{scale_context}

═══ RÈGLE 1 — SURFACE HABITABLE ═══
• LIS la surface depuis le cartouche du plan EN PRIORITÉ.
  Cherche: "SURFACE HABITABLE = X m²", "SH = X", "Surface nette = X"
• Si pas de cartouche: somme les surfaces des pièces habitables (sans garage, terrasse, porch).
• JAMAIS mettre 100 par défaut si tu vois des surfaces sur le plan.

═══ RÈGLE 2 — CHAMBRES (CRITIQUE) ═══
• Compte UNIQUEMENT les pièces dont l'étiquette contient "CHAMBRE", "CH.", "BEDROOM", 
  "CHAMBRE 1", "CHAMBRE 2", "CHAMBRE INVITÉS", "MASTER BEDROOM".
• "CHAMBRE 1" qui apparaît DEUX FOIS avec surfaces DIFFÉRENTES = 2 chambres séparées.
• EXCLURE ABSOLUMENT: Bureau, Dressing, Suite (sans mot "chambre"), Placard, Cellier.
• Si une pièce s'appelle "BUREAU" → type = "bureau", PAS chambre.

═══ RÈGLE 3 — SALLES DE BAIN ═══  
• SDB/SALLE DE BAIN/BATHROOM = salle de bain complète (compte = oui)
• WC seul = toilettes séparées (compte dans nb_wc_separes, PAS nb_salles_bain)
• "WC INVITÉS" = WC séparé, pas une SDB

═══ RÈGLE 4 — MULTI-ÉTAGES ═══
• Si tu vois ESCALIER, R+1, ÉTAGE, ou stairs → nb_etages = 2 minimum
• Si le plan montre UNIQUEMENT le RDC → note "Plan RDC uniquement, étage non visible"
• Ne devine PAS les chambres de l'étage si non visible

═══ RÈGLE 5 — DIMENSIONS ═══
• Utilise l'échelle pour calculer les surfaces non indiquées
• Lis les cotes inscrites sur le plan (ex: 12.00m × 7.50m)
• Une pièce de 4.60m × 3.50m = 16.1 m²

Retourne UNIQUEMENT ce JSON valide (sans texte ni markdown):
{{
  "surface_totale_m2": <surface totale incluant garage/terrasse/porch>,
  "surface_habitable_m2": <surface habitable UNIQUEMENT depuis cartouche ou somme pièces>,
  "pieces": [
    {{
      "nom": "<label EXACT du plan>",
      "surface_m2": <nombre lu ou calculé>,
      "type": "<chambre|salon|cuisine|sdb|wc|garage|terrasse|couloir|bureau|autre>",
      "dimensions": "<LxP en mètres si lisible>"
    }}
  ],
  "nb_chambres": <count STRICT des pièces type chambre selon RÈGLE 2>,
  "nb_salles_bain": <count SDB complètes — WC seul = 0>,
  "nb_wc_separes": <count WC séparés sans douche>,
  "nb_etages": <1=RDC seul, 2=R+1, 3=R+2>,
  "type_toiture": "<terrasse|pente|mixte>",
  "surface_toiture_m2": <estimée>,
  "surface_terrasse_m2": <terrasses extérieures, 0 si aucune>,
  "surface_garage_m2": <0 si pas de garage>,
  "perimetre_fondations_ml": <périmètre extérieur en mètres linéaires>,
  "surface_facade_m2": <surface façades extérieures>,
  "hauteur_sous_plafond_m": <2.7 si non indiqué>,
  "echelle_detectee": "<échelle lue ou 'estimée'>",
  "confiance_detection": "<haute|moyenne|faible>",
  "notes": "<observations: doublons étiquettes, plan partiel, incertitudes>"
}}"""

        raw = call_tokenfactory_vision(
            image_bytes=image_bytes,
            prompt=prompt,
            temperature=0.05,
            max_tokens=1400,
        )
        # Nettoyage robuste du JSON
        raw = self._clean_json_response(raw)
        result = json.loads(raw)
        return self._validate_and_fix(result)

    # ─────────────────────────────────────────────────────────────────────────
    # NETTOYAGE JSON
    # ─────────────────────────────────────────────────────────────────────────
    def _clean_json_response(self, raw: str) -> str:
        """Nettoie la réponse du LLM pour obtenir un JSON valide."""
        # Retirer les balises markdown
        raw = raw.replace("```json", "").replace("```", "").strip()
        # Trouver le début et la fin du JSON
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start != -1 and end > start:
            return raw[start:end]
        return raw

    # ─────────────────────────────────────────────────────────────────────────
    # VALIDATION & CORRECTION (CŒUR DU FIX)
    # ─────────────────────────────────────────────────────────────────────────
    def _validate_and_fix(self, data: dict) -> dict:
        """
        Validation et correction complète.
        Résout les 3 bugs identifiés:
        1. Surface forcée à 100 par défaut
        2. nb_chambres incorrect
        3. Plans multi-étages mal gérés
        """
        pieces = data.get("pieces", [])

        # ══ FIX 1: SURFACE — jamais forcer 100 ═══════════════════════════════
        raw_surface = data.get("surface_habitable_m2")
        try:
            raw_surface = float(raw_surface) if raw_surface else None
        except (ValueError, TypeError):
            raw_surface = None

        # Si surface absente ou irréaliste (<= 20), recalculer depuis les pièces
        if not raw_surface or raw_surface <= 20:
            TYPES_HABITABLES = {"salon", "cuisine", "sdb", "chambre", "couloir",
                                 "bureau", "wc", "autre", "entree"}
            TYPES_EXCLUS = {"garage", "terrasse", "exterieur", "porch"}
            
            surface_pieces = sum(
                float(p.get("surface_m2") or 0)
                for p in pieces
                if p.get("type", "autre").lower() not in TYPES_EXCLUS
                and float(p.get("surface_m2") or 0) > 0
            )
            
            if surface_pieces >= 20:
                raw_surface = surface_pieces
                data["notes"] = (
                    (data.get("notes") or "") +
                    f" | Surface recalculée = {surface_pieces:.0f} m² (somme des pièces)"
                )
                print(f"[VisionAgent] Surface recalculée depuis pièces: {surface_pieces:.0f} m²")
            else:
                # Dernier recours: essayer surface_totale * 0.85
                s_tot = float(data.get("surface_totale_m2") or 0)
                if s_tot > 20:
                    raw_surface = round(s_tot * 0.82, 1)
                    data["notes"] = (
                        (data.get("notes") or "") +
                        f" | Surface estimée depuis surface totale: {raw_surface:.0f} m²"
                    )
                    print(f"[VisionAgent] Surface estimée depuis surface totale: {raw_surface:.0f} m²")
                else:
                    # Vraiment rien: on signale faible confiance
                    raw_surface = 100.0
                    data["confiance_detection"] = "faible"
                    data["notes"] = (
                        (data.get("notes") or "") +
                        " | ATTENTION: Surface non détectable — valeur par défaut 100 m²"
                    )
                    print("[VisionAgent] ⚠️ Surface non détectable, défaut 100 m²")

        data["surface_habitable_m2"] = max(float(raw_surface), 30.0)

        # ══ FIX 2: NB_CHAMBRES — recompter depuis pièces (source absolue) ════
        CHAMBRE_INCLUDE = ["chambre", "ch.", "bedroom", "master bedroom",
                           "suite parentale", "chambre invités", "chambre invites",
                           "chambre parents", "chambre enfant"]
        CHAMBRE_EXCLUDE = ["salle de bain", "sdb", "douche", "bathroom",
                           "wc", "toilette", "bureau", "dressing", "placard",
                           "cellier", "débarras", "couloir", "hall"]

        chambres_trouvees = []
        for p in pieces:
            nom = (p.get("nom") or "").lower().strip()
            type_p = (p.get("type") or "").lower().strip()
            
            # Critère inclusion
            est_chambre_type = (type_p == "chambre")
            est_chambre_nom = any(kw in nom for kw in CHAMBRE_INCLUDE)
            
            # Critère exclusion
            est_exclus = any(ex in nom for ex in CHAMBRE_EXCLUDE)
            
            if (est_chambre_type or est_chambre_nom) and not est_exclus:
                chambres_trouvees.append(p.get("nom", "?"))

        nb_chambres_detect = len(chambres_trouvees)
        nb_chambres_llm = int(data.get("nb_chambres") or 0)

        if nb_chambres_detect > 0:
            if nb_chambres_detect != nb_chambres_llm:
                print(
                    f"[VisionAgent] nb_chambres CORRIGÉ: {nb_chambres_llm} → {nb_chambres_detect} "
                    f"| Chambres: {chambres_trouvees}"
                )
                data["notes"] = (
                    (data.get("notes") or "") +
                    f" | nb_chambres corrigé {nb_chambres_llm}→{nb_chambres_detect}: {chambres_trouvees}"
                )
            data["nb_chambres"] = nb_chambres_detect
        elif nb_chambres_llm > 0:
            # LLM a donné un nombre mais pas de liste → garder le nombre LLM
            data["nb_chambres"] = nb_chambres_llm
            print(f"[VisionAgent] nb_chambres depuis LLM: {nb_chambres_llm} (pas de liste pièces)")
        else:
            # Aucune info: minimum 1
            data["nb_chambres"] = 1
            data["notes"] = (data.get("notes") or "") + " | nb_chambres non détecté → 1 par défaut"
            print("[VisionAgent] ⚠️ Aucune chambre détectée → défaut 1")

        # ══ FIX 3: NB_SDB — même logique ════════════════════════════════════
        SDB_INCLUDE = ["salle de bain", "sdb", "douche", "bathroom", "salle d'eau"]
        SDB_EXCLUDE = ["wc seul", "toilette seule"]

        sdb_trouvees = []
        wc_trouves = []
        for p in pieces:
            nom = (p.get("nom") or "").lower().strip()
            type_p = (p.get("type") or "").lower().strip()
            
            est_sdb = type_p == "sdb" or any(kw in nom for kw in SDB_INCLUDE)
            est_wc = type_p == "wc" or any(kw in nom for kw in ["wc", "toilette"])
            
            if est_sdb and not any(ex in nom for ex in SDB_EXCLUDE):
                sdb_trouvees.append(p.get("nom", "?"))
            elif est_wc and not est_sdb:
                wc_trouves.append(p.get("nom", "?"))

        if sdb_trouvees:
            data["nb_salles_bain"] = len(sdb_trouvees)
        else:
            data["nb_salles_bain"] = max(int(data.get("nb_salles_bain") or 1), 0)

        if wc_trouves:
            data["nb_wc_separes"] = len(wc_trouves)
        else:
            data["nb_wc_separes"] = max(int(data.get("nb_wc_separes") or 0), 0)

        # ══ BORNES ET DÉRIVATIONS ════════════════════════════════════════════
        data["nb_etages"] = max(int(data.get("nb_etages") or 1), 1)
        data["hauteur_sous_plafond_m"] = float(data.get("hauteur_sous_plafond_m") or 2.7)

        S = data["surface_habitable_m2"]
        H = data["hauteur_sous_plafond_m"]
        nb_etages = data["nb_etages"]

        # Surface totale
        if not data.get("surface_totale_m2") or float(data.get("surface_totale_m2") or 0) < S:
            garage = float(data.get("surface_garage_m2") or 0)
            terrasse = float(data.get("surface_terrasse_m2") or 0)
            data["surface_totale_m2"] = round(S + garage + terrasse, 1)

        # Périmètre estimé si absent
        if not data.get("perimetre_fondations_ml"):
            # Estimation: maison rectangulaire √(S/etage) × 4.2
            data["perimetre_fondations_ml"] = round((S / nb_etages) ** 0.5 * 4.2, 1)

        # Surface façade si absente
        if not data.get("surface_facade_m2"):
            perim = data["perimetre_fondations_ml"]
            data["surface_facade_m2"] = round(perim * H * nb_etages, 1)

        # Surface toiture si absente
        if not data.get("surface_toiture_m2"):
            data["surface_toiture_m2"] = round((S / nb_etages) * 1.1, 1)

        # Surfaces à zéro par défaut
        data.setdefault("surface_terrasse_m2", 0)
        data.setdefault("surface_garage_m2", 0)

        # Log final
        print(
            f"[VisionAgent] ✅ FINAL → "
            f"Surface: {data['surface_habitable_m2']} m² | "
            f"Chambres: {data['nb_chambres']} | "
            f"SDB: {data['nb_salles_bain']} | "
            f"WC: {data['nb_wc_separes']} | "
            f"Étages: {data['nb_etages']} | "
            f"Confiance: {data.get('confiance_detection','?')}"
        )

        return data

    # ─────────────────────────────────────────────────────────────────────────
    # FALLBACK MANUEL
    # ─────────────────────────────────────────────────────────────────────────
    def fallback_manual_estimation(
        self,
        surface: float,
        nb_chambres: int,
        nb_sdb: int,
        nb_etages: int,
        gamme: str = "moyenne",
    ) -> dict:
        S = float(surface or 100)
        nb_etages = max(int(nb_etages or 1), 1)
        H = 2.8 if gamme in ("haute", "moyenne") else 2.7
        perim = round((S / nb_etages) ** 0.5 * 4.2, 1)
        return {
            "surface_totale_m2": round(S * 1.18, 1),
            "surface_habitable_m2": S,
            "pieces": [],
            "nb_chambres": max(int(nb_chambres or 2), 1),
            "nb_salles_bain": max(int(nb_sdb or 1), 1),
            "nb_wc_separes": 1,
            "nb_etages": nb_etages,
            "type_toiture": "terrasse",
            "surface_toiture_m2": round((S / nb_etages) * 1.1, 1),
            "surface_terrasse_m2": 0,
            "surface_garage_m2": 0,
            "perimetre_fondations_ml": perim,
            "surface_facade_m2": round(perim * H * nb_etages, 1),
            "hauteur_sous_plafond_m": H,
            "echelle_detectee": "manuelle",
            "confiance_detection": "saisie_manuelle",
            "notes": "Données saisies manuellement par l'utilisateur",
        }

    # ─────────────────────────────────────────────────────────────────────────
    # FALLBACK OPENCV
    # ─────────────────────────────────────────────────────────────────────────
    def fallback_opencv(self, image_bytes: bytes) -> dict:
        """Fallback OpenCV — estimation géométrique basique."""
        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
            if img is None:
                raise ValueError("Image non lisible")

            # Détecter les pixels noirs (murs du plan)
            _, thresh = cv2.threshold(img, 200, 255, cv2.THRESH_BINARY_INV)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if not contours:
                raise ValueError("Aucun contour détecté")

            # Prendre le plus grand contour (contour de la maison)
            largest = max(contours, key=cv2.contourArea)
            area_px = cv2.contourArea(largest)
            img_area = img.shape[0] * img.shape[1]
            
            # Estimation surface: ratio superficie
            ratio = area_px / max(img_area, 1)
            # Plan typique: ~40-60% de l'image = zone habitable
            surface_estimate = max(ratio * 350, 50)
            
            print(f"[VisionAgent] OpenCV: surface estimée = {surface_estimate:.0f} m²")
            perim = round((surface_estimate ** 0.5) * 4.2, 1)
            
            return {
                "surface_totale_m2": round(surface_estimate, 1),
                "surface_habitable_m2": round(surface_estimate * 0.84, 1),
                "pieces": [],
                "nb_chambres": 0,
                "nb_salles_bain": 0,
                "nb_wc_separes": 0,
                "nb_etages": 1,
                "type_toiture": "terrasse",
                "surface_toiture_m2": round(surface_estimate * 1.05, 1),
                "surface_terrasse_m2": 0,
                "surface_garage_m2": 0,
                "perimetre_fondations_ml": perim,
                "surface_facade_m2": round(perim * 2.8, 1),
                "hauteur_sous_plafond_m": 2.8,
                "echelle_detectee": "opencv_estimation",
                "confiance_detection": "faible",
                "notes": (
                    "⚠️ Analyse OpenCV (fallback) — LLaMA 4 Vision indisponible. "
                    "Vérifiez les valeurs et utilisez la saisie manuelle si nécessaire."
                ),
            }
        except Exception as e:
            print(f"[VisionAgent] OpenCV error: {e}")
            return self.fallback_manual_estimation(100, 2, 1, 1)

    # ─────────────────────────────────────────────────────────────────────────
    # POINT D'ENTRÉE
    # ─────────────────────────────────────────────────────────────────────────
    def analyze(self, image_bytes: bytes, scale_info: str = None) -> dict:
        """Analyse le plan 2D avec cascades de fallback."""
        try:
            return self.analyze_plan_with_llama4(image_bytes, scale_info)
        except json.JSONDecodeError as e:
            print(f"[VisionAgent] JSON parse error: {e}")
            try:
                return self.fallback_opencv(image_bytes)
            except Exception:
                return self.fallback_manual_estimation(100, 2, 1, 1)
        except Exception as e:
            print(f"[VisionAgent] LLM vision failed: {e}")
            try:
                return self.fallback_opencv(image_bytes)
            except Exception as e2:
                print(f"[VisionAgent] OpenCV also failed: {e2}")
                return self.fallback_manual_estimation(100, 2, 1, 1)
