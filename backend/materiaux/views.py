"""materiaux/views.py — DRF views mirroring the original FastAPI routes."""

import json
import traceback
from pathlib import Path

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import MaterialEstimate
from .serializers import MaterialEstimateListSerializer, MaterialEstimateDetailSerializer

# ── Region → climat mapping (mirrors TacheMateriauxMaha/main.py) ─────────────
REGION_CLIMAT = {
    "tunis": "cote", "sfax": "cote", "sousse": "cote",
    "nabeul": "cote", "bizerte": "cote", "monastir": "cote",
    "hammamet": "cote", "mahdia": "cote", "la marsa": "cote",
    "kairouan": "interieur", "gafsa": "interieur",
    "sidi bouzid": "interieur", "kasserine": "interieur",
    "gabes": "sahel", "medenine": "sahel", "tataouine": "sahel",
    "jendouba": "nord", "beja": "nord", "kef": "nord", "siliana": "nord",
    "tozeur": "sahel", "kebili": "sahel",
}

COUT_CONSTRUCTION_REF = {
    "bas":     {"min_m2": 900,  "max_m2": 1200, "label": "Economy",   "description": "Standard construction, simple finishes, local materials"},
    "moyenne": {"min_m2": 1300, "max_m2": 1800, "label": "Mid-range", "description": "Quality construction, refined finishes, recognized brands"},
    "haute":   {"min_m2": 1900, "max_m2": 3000, "label": "Premium",   "description": "High-end construction, luxury finishes, imported materials"},
}


def get_climat(region: str) -> str:
    return REGION_CLIMAT.get(region.lower().strip(), "cote")


def _load_gamme_config():
    """Lazily import MateriauxAgent so sentence-transformers don't load on startup."""
    from .services.materiaux_agent import GAMME_CONFIG
    return GAMME_CONFIG


class RegionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"regions": [
            {"nom": "Tunis",    "climat": "cote"},
            {"nom": "La Marsa", "climat": "cote"},
            {"nom": "Sfax",     "climat": "cote"},
            {"nom": "Sousse",   "climat": "cote"},
            {"nom": "Nabeul",   "climat": "cote"},
            {"nom": "Bizerte",  "climat": "cote"},
            {"nom": "Monastir", "climat": "cote"},
            {"nom": "Hammamet", "climat": "cote"},
            {"nom": "Mahdia",   "climat": "cote"},
            {"nom": "Kairouan", "climat": "interieur"},
            {"nom": "Gafsa",    "climat": "interieur"},
            {"nom": "Kasserine","climat": "interieur"},
            {"nom": "Gabes",    "climat": "sahel"},
            {"nom": "Medenine", "climat": "sahel"},
            {"nom": "Tataouine","climat": "sahel"},
            {"nom": "Tozeur",   "climat": "sahel"},
            {"nom": "Jendouba", "climat": "nord"},
            {"nom": "Beja",     "climat": "nord"},
            {"nom": "Kef",      "climat": "nord"},
        ]})


class GammesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        GAMME_CONFIG = _load_gamme_config()
        return Response({"gammes": [
            {
                "id": k,
                "label": v["label"],
                "description": v["description"],
                "coeff_prix": v["coeff_prix"],
                "cout_ref": COUT_CONSTRUCTION_REF[k],
            }
            for k, v in GAMME_CONFIG.items()
        ]})


class CatalogueView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        catalog_path = settings.MATERIAUX_CATALOG_PATH
        with open(catalog_path, encoding="utf-8") as f:
            data = json.load(f)["catalogue"]
        categorie = request.query_params.get("categorie")
        etancheite = request.query_params.get("etancheite")
        if categorie:
            data = [m for m in data if categorie.lower() in m["categorie"].lower()]
        if etancheite is not None:
            val = etancheite.lower() in ("true", "1", "yes")
            data = [m for m in data if m.get("etancheite") == val]
        return Response({"catalogue": data, "total": len(data)})


class CatalogueCategoriesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        with open(settings.MATERIAUX_CATALOG_PATH, encoding="utf-8") as f:
            data = json.load(f)["catalogue"]
        categories = sorted({m["categorie"].split(" - ")[0] for m in data})
        return Response({"categories": categories})


class CoutReferenceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        surface = float(request.query_params.get("surface", 100))
        gamme = request.query_params.get("gamme", "moyenne").lower()
        if gamme not in COUT_CONSTRUCTION_REF:
            gamme = "moyenne"
        ref = COUT_CONSTRUCTION_REF[gamme]
        return Response({
            "surface_m2": surface,
            "gamme": gamme,
            "gamme_label": ref["label"],
            "cout_min_tnd": round(surface * ref["min_m2"]),
            "cout_max_tnd": round(surface * ref["max_m2"]),
            "cout_m2_min": ref["min_m2"],
            "cout_m2_max": ref["max_m2"],
            "description": ref["description"],
            "source": "BVQI Tunisie / CNPI / DTT 2025-2026",
        })


class AnalyserPlanView(APIView):
    """Main pipeline endpoint — mirrors POST /api/analyser-plan from FastAPI."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            # Lazy imports to avoid loading heavy models on Django startup
            from .services.vision_agent import VisionAgent
            from .services.materiaux_agent import MateriauxAgent, GAMME_CONFIG
            from .services.recommandation_agent import RecommandationAgent

            region = request.data.get("region", "Tunis")
            budget = float(request.data.get("budget", 0))
            gamme = request.data.get("gamme", "moyenne").lower().strip()
            if gamme not in ("bas", "moyenne", "haute"):
                gamme = "moyenne"
            scale_info = request.data.get("scale_info")
            surface_manuelle = request.data.get("surface_manuelle")
            nb_chambres = request.data.get("nb_chambres")
            nb_sdb = request.data.get("nb_sdb")
            nb_etages = request.data.get("nb_etages")
            property_id = request.query_params.get("property_id")

            if surface_manuelle:
                surface_manuelle = float(surface_manuelle)
            if nb_chambres:
                nb_chambres = int(nb_chambres)
            if nb_sdb:
                nb_sdb = int(nb_sdb)
            if nb_etages:
                nb_etages = int(nb_etages)

            climat = get_climat(region)
            vision_agent = VisionAgent()
            mat_agent = MateriauxAgent()
            reco_agent = RecommandationAgent()

            plan_file = request.FILES.get("plan")
            if plan_file:
                image_bytes = plan_file.read()
                plan_data = vision_agent.analyze(image_bytes, scale_info)
                if nb_chambres and nb_chambres > 0:
                    plan_data["nb_chambres"] = nb_chambres
                if nb_sdb and nb_sdb > 0:
                    plan_data["nb_salles_bain"] = nb_sdb
                if nb_etages and nb_etages > 0:
                    plan_data["nb_etages"] = nb_etages
            elif surface_manuelle and surface_manuelle > 0:
                plan_data = vision_agent.fallback_manual_estimation(
                    surface=surface_manuelle,
                    nb_chambres=nb_chambres or 3,
                    nb_sdb=nb_sdb or 1,
                    nb_etages=nb_etages or 1,
                    gamme=gamme,
                )
            else:
                return Response(
                    {"detail": "Please provide a 2D floor plan or a manual surface area"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            materiaux = mat_agent.calculer_quantites(plan_data, region, climat, gamme)
            cout_materiaux = sum(m["cout_total_tnd"] for m in materiaux)
            clim_pieces = mat_agent.calculer_climatisation_par_piece(plan_data, region, climat, gamme)
            nb_clims_total = sum(c["nb_unites"] for c in clim_pieces)
            main_oeuvre = mat_agent.calculer_main_oeuvre(plan_data, gamme, nb_clims_total)
            cout_mo = main_oeuvre["total_tnd"]
            cout_total_projet = cout_materiaux + cout_mo

            S = float(plan_data.get("surface_habitable_m2", 100))
            ref_gamme = COUT_CONSTRUCTION_REF[gamme]
            cout_ref_min = S * ref_gamme["min_m2"]
            cout_ref_max = S * ref_gamme["max_m2"]
            dans_fourchette = cout_ref_min <= cout_total_projet <= cout_ref_max * 1.1

            eval_budget = reco_agent.evaluer_budget(budget, cout_total_projet, plan_data, region)
            eval_budget["cout_materiaux"] = round(cout_materiaux, 2)
            eval_budget["cout_main_oeuvre"] = round(cout_mo, 2)
            eval_budget["cout_total_projet"] = round(cout_total_projet, 2)
            eval_budget["ref_marche"] = {
                "gamme": ref_gamme["label"],
                "fourchette_tnd": f"{cout_ref_min:,.0f} – {cout_ref_max:,.0f} TND",
                "cout_m2_ref": f"{ref_gamme['min_m2']} – {ref_gamme['max_m2']} TND/m²",
                "dans_fourchette": dans_fourchette,
                "source": "BVQI Tunisie / CNPI / DTT 2026",
            }

            analyse_materiaux = mat_agent.generer_analyse_llama(
                plan_data, region, climat, budget, materiaux, gamme, main_oeuvre, clim_pieces
            )
            recommandation = reco_agent.recommandation_detaillee(eval_budget, plan_data, region, climat)
            conseil_deco = None
            if eval_budget.get("statut") == "EXCÉDENT" and eval_budget.get("ecart", 0) > 8000:
                try:
                    conseil_deco = reco_agent.conseil_decoration(eval_budget["ecart"], region)
                except Exception:
                    pass

            # Persist to DB
            property_obj = None
            if property_id:
                try:
                    from core.models import Property
                    property_obj = Property.objects.get(pk=int(property_id))
                except Exception:
                    pass

            estimate = MaterialEstimate.objects.create(
                user=request.user,
                property=property_obj,
                plan_image=plan_file,
                region=region,
                gamme=gamme,
                budget_tnd=budget,
                surface_m2=plan_data.get("surface_habitable_m2"),
                nb_chambres=plan_data.get("nb_chambres"),
                nb_sdb=plan_data.get("nb_salles_bain"),
                nb_etages=plan_data.get("nb_etages"),
                plan_data=plan_data,
                materiaux=materiaux,
                main_oeuvre=main_oeuvre,
                clim_detail=clim_pieces,
                eval_budget=eval_budget,
                analyse_text=analyse_materiaux or "",
                recommandation_text=recommandation or "",
                conseil_deco_text=conseil_deco or "",
                cout_total_tnd=cout_total_projet,
            )

            categories_stats = {}
            for m in materiaux:
                cat = m["categorie"].split(" - ")[0]
                if cat not in categories_stats:
                    categories_stats[cat] = {"count": 0, "total_tnd": 0}
                categories_stats[cat]["count"] += 1
                categories_stats[cat]["total_tnd"] += m["cout_total_tnd"]

            return Response({
                "success": True,
                "estimate_id": estimate.pk,
                "plan_data": plan_data,
                "region": region,
                "climat": climat,
                "gamme": gamme,
                "gamme_label": GAMME_CONFIG[gamme]["label"],
                "budget": budget,
                "materiaux": materiaux,
                "cout_materiaux": round(cout_materiaux, 2),
                "cout_total": round(cout_total_projet, 2),
                "nb_materiaux": len(materiaux),
                "eval_budget": eval_budget,
                "main_oeuvre": main_oeuvre,
                "clim_detail": clim_pieces,
                "nb_clims_total": nb_clims_total,
                "analyse_materiaux": analyse_materiaux,
                "recommandation": recommandation,
                "conseil_deco": conseil_deco,
                "categories_stats": {
                    k: {"count": v["count"], "total_tnd": round(v["total_tnd"], 2)}
                    for k, v in sorted(categories_stats.items(), key=lambda x: -x[1]["total_tnd"])
                },
            })

        except Exception as exc:
            traceback.print_exc()
            return Response({"detail": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class EstimateListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = MaterialEstimate.objects.filter(user=request.user)
        return Response(MaterialEstimateListSerializer(qs, many=True).data)


class EstimateDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            obj = MaterialEstimate.objects.get(pk=pk, user=request.user)
        except MaterialEstimate.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(MaterialEstimateDetailSerializer(obj).data)
