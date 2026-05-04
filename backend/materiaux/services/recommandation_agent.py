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
            message_court = "Budget perfectly calibrated — sustainable construction is achievable!"
        elif ratio < 0.95:
            deficit = cout_total - budget
            surface_possible = round(surface * (budget / cout_total) * 0.92)
            statut = "INSUFFICIENT"
            emoji = "⚠️"
            couleur = "#f59e0b"
            message_court = (
                f"Deficit of {deficit:,.0f} TND. "
                f"Recommended surface with this budget: ~{surface_possible} m²"
            )
        else:
            excedent = budget - cout_total
            statut = "SURPLUS"
            emoji = "🎉"
            couleur = "#3b82f6"
            message_court = (
                f"Surplus of {excedent:,.0f} TND — "
                f"Invest in premium finishes and reinforced waterproofing"
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
            "OPTIMAL": f"""Budget OPTIMAL (+/- 5-20%). Positive gap: {ecart:,.0f} TND.
Focus on: waterproofing optimisation, local premium materials, quality finishes.
Mention: possible savings with Tunisian suppliers (SOMOCER, SOTACIB, El Fouladh).
Advise on: enhanced thermal insulation for long-term energy savings.""",

            "INSUFFICIENT": f"""Budget INSUFFICIENT. Deficit: {abs(ecart):,.0f} TND.
Concrete options:
1. Reduce surface to ~{round(surface * budget/cout * 0.92)} m² and leave the rest as garden or future extension
2. Build in 2 phases: structural work + waterproofing first, finishes later
3. Choose entry-level SOMOCER tiles (25 TND/m²) instead of premium
4. Prioritise waterproofing (non-negotiable) and cut back on decoration
Name precise alternatives with 2026 Tunisian prices.""",

            "SURPLUS": f"""Budget SURPLUS. Surplus: {ecart:,.0f} TND.
Investment recommendations:
1. Enhanced waterproofing: 4mm SBS membrane + MAPELASTIC on all wet areas
2. Maktar marble for hall and staircases (supplier: Marbrerie de Maktar)
3. A++ inverter air conditioning in all rooms
4. Nabeul limestone cladding for facade (premium standing)
5. Smart home: motorised shutters + low-consumption LED lighting
6. Decorative plan: Nabeul Zellige tiling, Astral premium paint collection"""
        }

        prompt = f"""You are an expert Tunisian construction consultant, 2026.

CONTEXT:
- Budget status: {statut}
- Budget: {budget:,.0f} TND | Materials cost: {cout:,.0f} TND
- Gap: {ecart:+,.0f} TND ({eval_result['pourcentage']}%)
- Region: {region} (Climate: {climat})
- Surface: {surface} m² | Bedrooms: {nb_chambres}

SCENARIO TO DEVELOP:
{scenarios[statut]}

Write a professional recommendation in 3 structured paragraphs covering:
- Clear, quantified diagnosis
- Concrete priority actions (named with real Tunisian suppliers)
- Durability/waterproofing advice for the {climat} climate of {region}

Tone: professional, direct, results-oriented. Max 350 words."""

        text = call_tokenfactory(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=800,
            temperature=0.35,
        )
        return text

    def conseil_decoration(self, excedent: float, region: str) -> str:
        prompt = f"""Tunisian villa construction budget with a surplus of {excedent:,.0f} TND.
Region: {region}.
Provide a concrete decorative plan in 5 points covering:
- Tunisian decorative materials (Nabeul Zellige, Maktar marble, Sfax ironwork...)
- Cost estimate per item
- Where to buy in Tunisia (market/supplier names)
- Priority by value for money
Max 250 words, structured list style."""

        text = call_tokenfactory(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=600,
            temperature=0.4,
        )
        return text
