class ApplianceRuleEngine:
    """
    6-criterion scoring engine for household appliances.
    Criteria: Age + Energy class + Brand + Technology + kWh/year + Visual state.
    Calibrated for the EU standard and the Tunisian market.
    """

    AGE_TABLE = {
        "refrigerateur": {(0, 3): 85, (4, 7): 70, (8, 12): 55, (13, 99): 35},
        "climatiseur":   {(0, 3): 85, (4, 7): 70, (8, 12): 50, (13, 99): 30},
        "chauffe_eau":   {(0, 3): 80, (4, 7): 65, (8, 12): 45, (13, 99): 25},
        "machine_laver": {(0, 3): 85, (4, 7): 70, (8, 12): 50, (13, 99): 30},
        "ampoule":       {(0, 3): 80, (4, 7): 65, (8, 12): 45, (13, 99): 25},
    }

    ENERGY_CLASS_BONUS = {
        "A+++": 15, "A++": 12, "A+": 9, "A": 6,
        "B": 3, "C": 0, "D": -5, "E": -10, "F": -15, "G": -20, "?": 0,
    }

    TECHNOLOGY_BONUS = {
        "inverter": 10, "non_inverter": 0,
        "pompe_chaleur": 12, "solaire": 15, "thermodynamique": 10,
        "electrique": 0, "gaz": -3,
        "no_frost": 3, "frost": 0,
        "eco_bubble": 5, "vapeur": 4, "standard_wash": 0,
        "LED": 15, "LED_RGB": 14, "fluorescent": 3, "halogene": -5, "incandescent": -15,
        "smart": 3, "standard": 0, "inconnu": 0,
    }

    BRAND_BONUS = {
        "bosch": 8, "siemens": 8, "miele": 9, "liebherr": 7, "electrolux": 6,
        "samsung": 5, "lg": 5, "whirlpool": 4, "haier": 3, "hisense": 3,
        "daikin": 9, "mitsubishi": 8, "toshiba": 7, "hitachi": 7, "panasonic": 6,
        "midea": 4, "gree": 3,
        "ariston": 6, "chaffoteaux": 5, "atlantic": 6, "junkers": 7,
        "stiebel": 7, "vaillant": 7,
        "philips": 6, "osram": 6, "ledvance": 5, "ikea": 4,
        "iris": 3, "condor": 2, "brandt": 4, "candy": 3, "beko": 4,
        "autre": 0, "?": 0,
    }

    ETAT_BONUS = {
        "propre": 5, "normal": 0, "endommagé": -15, "rouillé": -20,
    }

    KWH_REFERENCE = {
        "refrigerateur": 150, "climatiseur": 900,
        "chauffe_eau": 1800, "machine_laver": 200, "ampoule": 20,
    }

    WEIGHTS = {
        "climatiseur": 0.30, "chauffe_eau": 0.30,
        "refrigerateur": 0.20, "machine_laver": 0.10, "ampoule": 0.10,
    }

    def get_kwh_bonus(self, category, kwh_per_year):
        if kwh_per_year <= 0:
            return 0
        ratio = kwh_per_year / self.KWH_REFERENCE.get(category, 500)
        if ratio <= 0.50: return 12
        if ratio <= 0.70: return 8
        if ratio <= 0.90: return 4
        if ratio <= 1.10: return 0
        if ratio <= 1.30: return -4
        if ratio <= 1.50: return -8
        return -12

    def get_age_score(self, category, age):
        for (min_age, max_age), score in self.AGE_TABLE.get(category, {}).items():
            if min_age <= int(age) <= max_age:
                return score
        return 50

    def calculate_score(self, detected_appliances):
        scores, details = {}, {}
        for ap in detected_appliances:
            category     = ap["category"]
            age          = int(ap.get("age", 7))
            confidence   = ap.get("confidence", 1.0)
            energy_class = ap.get("energy_class", "?").upper()
            brand        = ap.get("brand", "?").lower()
            technology   = ap.get("technology", "inconnu").lower()
            kwh_per_year = ap.get("kwh_per_year", 0)
            etat         = ap.get("etat", "normal").lower()

            base  = self.get_age_score(category, age)
            b_cls = self.ENERGY_CLASS_BONUS.get(energy_class, 0)
            b_brn = self.BRAND_BONUS.get(brand, 0)
            b_tec = self.TECHNOLOGY_BONUS.get(technology, 0)
            b_kwh = self.get_kwh_bonus(category, kwh_per_year)
            b_eta = self.ETAT_BONUS.get(etat, 0)

            raw = base + b_cls + b_brn + b_tec + b_kwh + b_eta
            if confidence < 0.70:
                raw = int(raw * 0.90)
            final = max(0, min(100, raw))

            scores[category] = final
            details[category] = {
                "score_final": final, "base_age": base,
                "bonus_classe": b_cls, "bonus_marque": b_brn,
                "bonus_tech": b_tec, "bonus_kwh": b_kwh, "bonus_etat": b_eta,
                "classe": energy_class, "marque": brand,
                "technologie": technology, "age": age, "etat": etat,
            }

        global_score, total_weight = 0.0, 0.0
        for cat, w in self.WEIGHTS.items():
            if cat in scores:
                global_score += scores[cat] * w
                total_weight += w
        if total_weight > 0:
            global_score /= total_weight

        return round(global_score, 1), scores, details

    def get_grade(self, score):
        if score >= 90: return "A+++"
        if score >= 80: return "A++"
        if score >= 70: return "A+"
        if score >= 60: return "A"
        if score >= 50: return "B"
        if score >= 40: return "C"
        if score >= 30: return "D"
        if score >= 20: return "E"
        return "F"

    def get_recommendation(self, category, score, details):
        d    = details.get(category, {})
        age  = d.get("age", 0)
        etat = d.get("etat", "normal")
        if etat == "rouillé":
            return "Rouille détectée — Remplacement immédiat nécessaire"
        if etat == "endommagé":
            return "Dommages visibles — Faire vérifier par un technicien"
        if score >= 80: return "Excellent — Conserver cet appareil"
        if score >= 60: return "Bon — Surveiller dans 2-3 ans"
        if score >= 40:
            suffix = "Planifier remplacement sous 2 ans" if age > 10 else "Vérifier entretien et réglages"
            return f"Moyen — {suffix}"
        return f"Critique — Remplacement urgent. Économies potentielles : {int((80 - score) * 15)} DT/an"
