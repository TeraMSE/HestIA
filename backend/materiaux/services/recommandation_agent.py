import os
from core.services import call_tokenfactory


class RecommandationAgent:
    """
    Logique de recommandation selon budget vs coût réel.
    3 scénarios: OPTIMAL / INSUFFISANT / EXCÉDENT
    Recommandations personnalisées via LLaMA 4.
    """

    def __init__(self):
        pass

    def evaluer_budget(self, budget: float, cout_total: float, plan_data: dict, region: str) -> dict:
        ratio = budget / cout_total if cout_total > 0 else 1.0
        surface = plan_data.get("surface_habitable_m2", 100)

        if 0.95 <= ratio <= 1.20:
            statut = "OPTIMAL"
            emoji = "✅"
            couleur = "#10b981"
            message_court = "Budget parfaitement calibré — construction durable possible!"
        elif ratio < 0.95:
            deficit = cout_total - budget
            surface_possible = round(surface * (budget / cout_total) * 0.92)
            statut = "INSUFFISANT"
            emoji = "⚠️"
            couleur = "#f59e0b"
            message_court = (
                f"Déficit de {deficit:,.0f} TND. "
                f"Surface recommandée avec ce budget: ~{surface_possible} m²"
            )
        else:
            excedent = budget - cout_total
            statut = "EXCÉDENT"
            emoji = "🎉"
            couleur = "#3b82f6"
            message_court = (
                f"Excédent de {excedent:,.0f} TND — "
                f"Investir dans finitions premium et étanchéité renforcée"
            )

        return {
            "statut": statut,
            "emoji": emoji,
            "couleur": couleur,
            "ratio": round(ratio, 3),
            "pourcentage": round(ratio * 100, 1),
            "message_court": message_court,
            "cout_total": round(cout_total, 2),
            "budget": budget,
            "ecart": round(budget - cout_total, 2),
        }

    def recommandation_detaillee(self, eval_result: dict, plan_data: dict, region: str, climat: str) -> str:
        statut = eval_result["statut"]
        budget = eval_result["budget"]
        cout = eval_result["cout_total"]
        ecart = eval_result["ecart"]
        surface = plan_data.get("surface_habitable_m2", 100)
        nb_chambres = plan_data.get("nb_chambres", 3)

        scenarios = {
            "OPTIMAL": f"""Budget OPTIMAL (+/- 5-20%). Écart positif: {ecart:,.0f} TND.
Oriente vers: optimisation étanchéité, matériaux premium locaux, finitions qualité.
Mentionne: économies possibles chez fournisseurs tunisiens (SOMOCER, SOTACIB, El Fouladh).
Conseille sur: isolation thermique renforcée pour économies énergie long terme.""",

            "INSUFFISANT": f"""Budget INSUFFISANT. Déficit: {abs(ecart):,.0f} TND.
Options concrètes:
1. Réduire surface à ~{round(surface * budget/cout * 0.92)} m² et faire le reste en jardin ou extension future
2. Réaliser en 2 phases: gros oeuvre + étanchéité d'abord, finitions ensuite
3. Choisir carrelage SOMOCER entrée de gamme (25 TND/m²) au lieu premium
4. Prioriser étanchéité (non négociable) et réduire sur décoration
Nomme des alternatives précises avec prix tunisiens 2026.""",

            "EXCÉDENT": f"""Budget EXCÉDENT. Surplus: {ecart:,.0f} TND.
Recommandations investissement:
1. Étanchéité renforcée: membrane SBS 4mm + MAPELASTIC toutes zones humides
2. Marbre Maktar pour hall et escaliers (fournisseur: Marbrerie de Maktar)
3. Climatisation inverter A++ dans toutes les pièces
4. Pierre de taille calcaire Nabeul pour façade (standing premium)
5. Domotique: volets motorisés + éclairage LED basse consommation
6. Plan décoratif: revêtement Zellige de Nabeul, peinture Astral collection premium"""
        }

        prompt = f"""Tu es un conseiller en construction tunisienne expert, 2026.

CONTEXTE:
- Statut budget: {statut}
- Budget: {budget:,.0f} TND | Coût matériaux: {cout:,.0f} TND
- Écart: {ecart:+,.0f} TND ({eval_result['pourcentage']}%)
- Région: {region} (Climat: {climat})
- Surface: {surface} m² | Chambres: {nb_chambres}

SCÉNARIO À DÉVELOPPER:
{scenarios[statut]}

Rédige une recommandation professionnelle en 3 paragraphes structurés avec:
- Diagnostic clair et chiffré
- Actions concrètes prioritaires (nommées avec fournisseurs tunisiens réels)
- Conseil durabilité/étanchéité selon climat {climat} de {region}

Ton: professionnel, direct, orienté résultats. Max 350 mots. En français."""

        text = call_tokenfactory(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=800,
            temperature=0.35,
        )
        return text

    def conseil_decoration(self, excedent: float, region: str) -> str:
        """Conseil déco si budget excédentaire"""
        prompt = f"""Budget construction villa Tunisie avec excédent de {excedent:,.0f} TND.
Région: {region}.
Donne un plan décoratif concret en 5 points avec:
- Matériaux décoratifs tunisiens (Zellige Nabeul, marbre Maktar, ferronnerie Sfax...)
- Estimation coût par poste
- Où acheter en Tunisie (noms de marchés/fournisseurs)
- Priorité selon rapport qualité/prix
Max 250 mots, style liste structurée."""

        text = call_tokenfactory(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=600,
            temperature=0.4,
        )
        return text
