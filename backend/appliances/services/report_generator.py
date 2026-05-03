# report_generator.py — Domus AI · Rapport EPS FINAL
# Architecture : calculs 100% Python + 1 seule phrase LLM qualitative
# Zéro dépendance au LLM pour les chiffres → aucun bug de troncature possible
from datetime import datetime
from core.services import call_tokenfactory


# ══════════════════════════════════════════
# CONSTANTES
# ══════════════════════════════════════════
LABELS = {
    "refrigerateur": "Refrigerateur",
    "climatiseur":   "Climatiseur",
    "chauffe_eau":   "Chauffe-eau",
    "machine_laver": "Machine a laver",
    "ampoule":       "Ampoule",
}

GRADE_DESC = {
    "A+++": "Performance maximale - classe elite europeenne",
    "A++":  "Excellente efficacite energetique",
    "A+":   "Tres haute efficacite energetique",
    "A":    "Bonne efficacite energetique",
    "B":    "Efficacite dans la moyenne",
    "C":    "En dessous des standards recents",
    "D":    "Faible efficacite",
    "E":    "Mauvaise efficacite",
    "F":    "Efficacite critique - remplacement urgent",
}

DUREE_STD = {
    "refrigerateur": 15,
    "climatiseur":   12,
    "chauffe_eau":   12,
    "machine_laver": 12,
    "ampoule":        5,
}

ECO_MIN = {
    "refrigerateur": 40, "climatiseur": 60,
    "chauffe_eau":   80, "machine_laver": 20, "ampoule": 5,
}
ECO_MAX = {
    "refrigerateur": 80,  "climatiseur": 150,
    "chauffe_eau":   200, "machine_laver": 50, "ampoule": 20,
}

GRADE_FACTEUR = {
    "A+++": 1.0, "A++": 0.9, "A+": 0.8, "A": 0.7,
    "B":    0.5, "C":   0.3, "D": 0.1,  "E": 0.0, "F": 0.0,
}

ENTRETIEN_STD = {
    "refrigerateur": "Nettoyer les joints de porte tous les 3 mois. Depoussierer le condenseur tous les 6 mois.",
    "climatiseur":   "Nettoyer les filtres tous les 2 mois. Faire reviser le circuit frigorifique chaque annee.",
    "chauffe_eau":   "Detartrer la resistance tous les 2 ans. Controler la soupape de securite chaque annee.",
    "machine_laver": "Nettoyer le filtre de vidange tous les 3 mois. Detartrage tous les 6 mois.",
    "ampoule":       "Depoussierer le luminaire. Verifier les connexions chaque annee.",
}


# ══════════════════════════════════════════
# HELPERS — AUCUN float, AUCUN format spécial
# ══════════════════════════════════════════
def to_age(n: int) -> str:
    """1 → '1 an'   5 → '5 ans'"""
    if n <= 1:
        return str(n) + " an"
    return str(n) + " ans"


def to_bonus(v: int) -> str:
    """12 → '+12'   -12 → '-12'   0 → '0'"""
    if v > 0:
        return "+" + str(v)
    return str(v)


def llm_phrase(label: str, marque: str, classe: str, etat: str) -> str:
    """1 seule phrase qualitative sans chiffres — fallback silencieux"""
    try:
        prompt = (
            "En une phrase courte en francais, sans aucun chiffre, "
            "decris la qualite energetique de cet appareil : "
            + label + " marque " + marque
            + " classe EU " + classe
            + " etat visuel " + etat + "."
        )
        phrase = call_tokenfactory(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=80,
            temperature=0.1,
        ).strip('"').strip("'")
        # Sécurité : si la phrase contient un chiffre, on la rejette
        if any(c.isdigit() for c in phrase):
            return label + " " + marque + " - qualite energetique " + etat + "."
        return phrase
    except Exception:
        return label + " " + marque + " - classe " + classe + " - etat " + etat + "."


# ══════════════════════════════════════════
# FONCTION PRINCIPALE
# ══════════════════════════════════════════
def generate_report(category: str, score: float, grade: str, details: dict) -> str:
    """
    Génère le rapport EPS complet.
    Tous les chiffres sont calculés en Python pur — le LLM
    ne produit qu'une phrase qualitative sans chiffres.
    Garantit : aucun chiffre tronqué, aucun bug d'affichage.
    """

    # ── 1. Conversion sécurisée de TOUTES les valeurs ──
    # Score en entier propre
    S_int  = int(round(float(score)))   # ex: 98   jamais 98.0
    S      = str(S_int)                 # ex: "98"
    G      = str(grade).strip()         # ex: "A+++"
    annee  = int(datetime.now().year)   # ex: 2026

    # Lecture details — tout converti en int immédiatement
    age_raw    = int(details.get("age",          1))
    marque_raw = str(details.get("marque",       "?"))
    etat_raw   = str(details.get("etat",         "normal"))
    classe_raw = str(details.get("classe",       "?"))
    techno_raw = str(details.get("technologie",  "inconnu"))

    base_val = int(details.get("base_age",     0))
    b_cls    = int(details.get("bonus_classe", 0))
    b_mrq    = int(details.get("bonus_marque", 0))
    b_tch    = int(details.get("bonus_tech",   0))
    b_kwh    = int(details.get("bonus_kwh",    0))
    b_eta    = int(details.get("bonus_etat",   0))

    # ── 2. Labels propres (sans caractères ambigus) ──
    label = LABELS.get(category, category)
    gdesc = GRADE_DESC.get(G, G)

    if marque_raw in ("?", "inconnue", "autre", ""):
        marque = "Non renseignee"
    else:
        marque = marque_raw.capitalize()

    if techno_raw in ("inconnu", "?", ""):
        techno = "Non renseignee"
    else:
        techno = techno_raw.replace("_", " ")

    if classe_raw == "?":
        classe = "Non renseignee"
    else:
        classe = classe_raw

    # ── 3. Calculs durée de vie ──
    AGE_STR  = to_age(age_raw)                    # "1 an" ou "5 ans"
    std      = DUREE_STD.get(category, 12)
    rest     = max(0, std - age_raw)
    STD_STR  = str(std) + " ans"                  # "15 ans"
    REST_STR = to_age(rest)                        # "14 ans"

    # ── 4. Calculs économies ──
    eco_min = ECO_MIN.get(category, 40)
    eco_max = ECO_MAX.get(category, 100)
    facteur = GRADE_FACTEUR.get(G, 0.5)
    eco_val = int(eco_min + facteur * (eco_max - eco_min))
    ECO_STR = str(eco_val) + " DT/an"            # "80 DT/an"

    # ── 5. Calcul année contrôle ──
    ctrl_val = annee + max(1, min(4, max(1, rest // 3)))
    CTRL_STR = str(ctrl_val)                      # "2030"

    # ── 6. Score de base ──
    BASE_STR = str(base_val) + "/100"             # "85/100"

    # ── 7. Conseil entretien ──
    if "rouill" in etat_raw.lower():
        entretien = "URGENT : Rouille detectee. Remplacement immediat necessaire."
    elif "endomm" in etat_raw.lower():
        entretien = "ATTENTION : Dommages detectes. Faire verifier par technicien."
    else:
        entretien = ENTRETIEN_STD.get(category, "Entretien annuel recommande.")

    # ── 8. Phrase qualitative LLM (sans chiffres) ──
    phrase = llm_phrase(label, marque, classe, etat_raw)

    # ── 9. Construction du rapport par concaténation simple ──
    # Séparateur court (30 chars max) pour éviter le débordement CSS
    SEP = "=" * 30

    lignes = [
        SEP,
        "RAPPORT ENERGETIQUE - Domus AI",
        SEP,
        "",
        "APPAREIL DETECTE",
        label + " | Marque : " + marque + " | Age : " + AGE_STR,
        "Etat visuel (IA vision) : " + etat_raw,
        "",
        SEP,
        "",
        "SCORE EPS : " + S + "/100 - Note " + G,
        "  Base age (" + AGE_STR + ")        : " + BASE_STR,
        "  Classe EU " + classe + "          : " + to_bonus(b_cls) + " pts",
        "  Marque " + marque + "             : " + to_bonus(b_mrq) + " pts",
        "  Technologie " + techno + "        : " + to_bonus(b_tch) + " pts",
        "  Consommation kWh             : " + to_bonus(b_kwh) + " pts",
        "  Etat visuel " + etat_raw + "      : " + to_bonus(b_eta) + " pts",
        "  " + "-" * 28,
        "  SCORE FINAL : " + S + "/100  Note : " + G,
        "",
        SEP,
        "",
        "EVALUATION ENERGETIQUE",
        "Note " + G + " - " + gdesc + ".",
        phrase,
        "",
        SEP,
        "",
        "DUREE DE VIE RESTANTE",
        "Duree standard " + label + " : " + STD_STR + ".",
        "Age actuel : " + AGE_STR + "  =>  Duree restante : " + REST_STR + ".",
        "",
        SEP,
        "",
        "ECONOMIES ESTIMEES",
        "Economies vs classe F : " + ECO_STR + ".",
        "Calcul base sur classe " + classe + " et marche tunisien.",
        "",
        SEP,
        "",
        "CONSEIL D ENTRETIEN",
        entretien,
        "",
        SEP,
        "",
        "PROCHAIN CONTROLE",
        "Prochain controle recommande : " + CTRL_STR + ".",
        "Base sur age " + AGE_STR + " et etat " + etat_raw + ".",
        "",
        SEP,
    ]

    return "\n".join(lignes)
