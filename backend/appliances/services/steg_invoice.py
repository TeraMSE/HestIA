# steg_invoice_generator.py — Domus AI v3.0
# Consommation SAISONNIERE : profil mensuel réel par appareil
# Le trimestre facturé correspond aux mois réels (pas kwh_an / 4)

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer,
    Table, TableStyle, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from datetime import datetime
import io
import random

# ══════════════════════════════════════════
# TARIFS STEG 2024 — Basse Tension Domestique
# ══════════════════════════════════════════
TRANCHES_STEG = [
    (0,   50,   0.093),
    (51,  100,  0.140),
    (101, 200,  0.198),
    (201, 500,  0.282),
    (501, 9999, 0.388),
]

REDEVANCE_FIXE_TRIM = 2.500
TVA  = 0.19
TCL  = 0.02

# ══════════════════════════════════════════
# PROFILS SAISONNIERS — kWh par MOIS (index 0=Jan … 11=Dec)
# Source : estimations STEG + ANME Tunisie
# ══════════════════════════════════════════
PROFIL_MENSUEL = {
    # Climatiseur : quasi nul en hiver, pic juillet-août
    "climatiseur": [
          5,   5,  10,  30,  80,
        150, 200, 220, 120,  40,
         10,   5
    ],
    # Chauffe-eau électrique : pic hiver (eau froide + douches longues)
    "chauffe_eau": [
        200, 180, 150, 120, 100,
         80,  70,  70,  80, 110,
        160, 190
    ],
    # Réfrigérateur : légère hausse en été (compresseur travaille plus)
    "refrigerateur": [
         25,  25,  26,  28,  30,
         33,  36,  36,  33,  29,
         26,  25
    ],
    # Machine à laver : assez stable, légère baisse en été
    "machine_laver": [
         18,  18,  18,  17,  17,
         16,  15,  15,  16,  17,
         18,  18
    ],
    # Ampoule : plus utilisée en hiver (nuits plus longues)
    "ampoule": [
          2.0, 1.8, 1.5, 1.2, 1.0,
          0.9, 0.8, 0.8, 1.0, 1.3,
          1.7, 2.0
    ],
}

# Profil classe F : consommation d'un appareil très énergivore
# (pour calculer les économies vs remplacement)
PROFIL_CLASSE_F = {
    "climatiseur":   [m * 2.2 for m in PROFIL_MENSUEL["climatiseur"]],
    "chauffe_eau":   [m * 1.8 for m in PROFIL_MENSUEL["chauffe_eau"]],
    "refrigerateur": [m * 2.5 for m in PROFIL_MENSUEL["refrigerateur"]],
    "machine_laver": [m * 2.3 for m in PROFIL_MENSUEL["machine_laver"]],
    "ampoule":       [m * 6.0 for m in PROFIL_MENSUEL["ampoule"]],
}

# ══════════════════════════════════════════
# NOMS DES TRIMESTRES STEG (par mois de début)
# ══════════════════════════════════════════
def get_trimestre_info(mois_index):
    """
    mois_index : 0 = Janvier, 11 = Décembre
    Retourne : (label, [m0, m1, m2]) — 3 mois du trimestre
    """
    trimestres = [
        ("Jan–Mar",  [0, 1, 2]),
        ("Avr–Jun",  [3, 4, 5]),
        ("Jul–Sep",  [6, 7, 8]),
        ("Oct–Dec",  [9, 10, 11]),
    ]
    t_idx = mois_index // 3
    label, mois = trimestres[t_idx]
    return label, mois


def kwh_trimestre_saisonnier(category, kwh_an_user, mois_courant):
    """
    Calcule le kWh du trimestre courant en tenant compte
    de la saisonnalité.

    Si l'utilisateur a fourni kwh_an_user > 0 :
      → on recalibre le profil mensuel au prorata
         (la shape saisonnière est conservée, l'amplitude est ajustée)
    Sinon :
      → on utilise le profil de référence directement

    Retourne : (kwh_trim_actuel, kwh_trim_classe_f, label_trim, mois_list)
    """
    _, mois_list = get_trimestre_info(mois_courant)

    profil_ref = PROFIL_MENSUEL.get(category, [30] * 12)
    profil_f   = PROFIL_CLASSE_F.get(category, [m * 2 for m in profil_ref])

    if kwh_an_user > 0:
        # Recalibration : on garde la saisonnalité mais on ajuste
        # l'amplitude pour que la somme annuelle = kwh_an_user
        total_ref = sum(profil_ref)
        facteur   = kwh_an_user / total_ref if total_ref > 0 else 1.0
        profil_actif = [m * facteur for m in profil_ref]
    else:
        profil_actif = profil_ref

    kwh_trim = round(sum(profil_actif[m] for m in mois_list), 1)
    kwh_f    = round(sum(profil_f[m]     for m in mois_list), 1)

    # Label lisible des mois
    noms = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun",
            "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"]
    label_trim = f"{noms[mois_list[0]]}–{noms[mois_list[2]]}"

    return kwh_trim, kwh_f, label_trim, mois_list


def detail_mensuel(category, kwh_an_user, mois_courant):
    """
    Retourne le détail mois par mois du trimestre.
    Utile pour l'affichage dans la facture.
    [(nom_mois, kwh_mois), ...]
    """
    _, mois_list = get_trimestre_info(mois_courant)

    profil_ref = PROFIL_MENSUEL.get(category, [30] * 12)
    if kwh_an_user > 0:
        total_ref    = sum(profil_ref)
        facteur      = kwh_an_user / total_ref if total_ref > 0 else 1.0
        profil_actif = [m * facteur for m in profil_ref]
    else:
        profil_actif = profil_ref

    noms = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
            "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]

    return [(noms[m], round(profil_actif[m], 1)) for m in mois_list]


# ══════════════════════════════════════════
# CALCUL FACTURE STEG PAR TRANCHES
# ══════════════════════════════════════════
def calcul_facture_tranches(kwh_trim):
    lignes = []
    reste  = kwh_trim
    for i, (debut, fin, tarif) in enumerate(TRANCHES_STEG):
        if reste <= 0:
            break
        capacite = fin - debut + 1
        consomme = min(reste, capacite)
        montant  = round(consomme * tarif, 3)
        lignes.append((
            f"Tranche {i+1} ({debut}–{fin} kWh) à {tarif:.3f} DT/kWh",
            round(consomme, 1),
            tarif,
            montant
        ))
        reste -= consomme
    return lignes


def calcul_total(kwh_trim):
    tranches   = calcul_facture_tranches(kwh_trim)
    ht_energie = sum(t[3] for t in tranches)
    ht_total   = ht_energie + REDEVANCE_FIXE_TRIM
    tcl_m      = round(ht_total * TCL, 3)
    tva_m      = round(ht_total * TVA, 3)
    ttc        = round(ht_total + tcl_m + tva_m, 3)
    return {
        "tranches":       tranches,
        "ht_energie":     round(ht_energie, 3),
        "redevance_fixe": REDEVANCE_FIXE_TRIM,
        "ht_total":       round(ht_total, 3),
        "tcl":            tcl_m,
        "tva":            tva_m,
        "ttc":            ttc,
    }


# ══════════════════════════════════════════
# LABELS
# ══════════════════════════════════════════
LABELS_FR = {
    "refrigerateur": "Réfrigérateur",
    "climatiseur":   "Climatiseur",
    "chauffe_eau":   "Chauffe-eau électrique",
    "machine_laver": "Machine à laver",
    "ampoule":       "Ampoule",
}

C_STEG_BLEU   = colors.HexColor("#1a3a6b")
C_STEG_BLEU_L = colors.HexColor("#e8f0ff")
C_VERT        = colors.HexColor("#2e7d32")
C_VERT_L      = colors.HexColor("#e8f5e9")
C_ORANGE      = colors.HexColor("#e65100")
C_ORANGE_L    = colors.HexColor("#fff3e0")
C_ROUGE       = colors.HexColor("#c62828")
C_ROUGE_L     = colors.HexColor("#ffebee")
C_GRIS        = colors.HexColor("#757575")
C_GRIS_L      = colors.HexColor("#f5f5f5")
C_WHITE       = colors.white
C_TEXT        = colors.HexColor("#212121")
C_BORDER      = colors.HexColor("#e0e0e0")
C_SAISON_ETE  = colors.HexColor("#fff8e1")   # fond jaune doux pour été
C_SAISON_HIV  = colors.HexColor("#e3f2fd")   # fond bleu doux pour hiver


# ══════════════════════════════════════════
# GÉNÉRATION PDF
# ══════════════════════════════════════════
def generate_steg_invoice(data: dict) -> bytes:
    buffer   = io.BytesIO()
    category = data.get("detected_class", "refrigerateur")
    label    = LABELS_FR.get(category, category)
    grade    = data.get("grade", "?")
    score    = int(round(float(data.get("efficiency_score", 0))))
    brand    = data.get("brand", "?")
    energy_cls = data.get("energy_class", "?")
    etat     = data.get("etat_visuel", "normal")

    kwh_an_user = int(data.get("kwh_per_year", 0))

    now          = datetime.now()
    mois_courant = now.month - 1   # 0-indexed

    # ── Calcul saisonnier ──
    kwh_trim, kwh_f_trim, label_trim, mois_list = kwh_trimestre_saisonnier(
        category, kwh_an_user, mois_courant
    )
    detail_mois = detail_mensuel(category, kwh_an_user, mois_courant)

    # Consommation annuelle totale (recalibrée ou profil ref)
    profil_ref = PROFIL_MENSUEL.get(category, [30] * 12)
    if kwh_an_user > 0:
        kwh_an_display = kwh_an_user
    else:
        kwh_an_display = int(round(sum(profil_ref)))

    facture_actuelle = calcul_total(kwh_trim)
    facture_classe_f = calcul_total(kwh_f_trim)
    economies_trim   = round(facture_classe_f["ttc"] - facture_actuelle["ttc"], 3)
    economies_an     = round(economies_trim * 4, 2)

    # Saison dominante du trimestre
    mois_ete = {5, 6, 7, 8}    # juin, juillet, août, septembre
    mois_hiv = {11, 0, 1, 2}   # décembre, janvier, février, mars
    nb_ete = sum(1 for m in mois_list if m in mois_ete)
    nb_hiv = sum(1 for m in mois_list if m in mois_hiv)
    if nb_ete >= 2:
        saison = "été"
        bg_saison = C_SAISON_ETE
        c_saison  = colors.HexColor("#f57f17")
    elif nb_hiv >= 2:
        saison = "hiver"
        bg_saison = C_SAISON_HIV
        c_saison  = C_STEG_BLEU
    else:
        saison = "inter-saison"
        bg_saison = C_GRIS_L
        c_saison  = C_GRIS

    # Commentaire saisonnier par appareil
    commentaire_saison = {
        "climatiseur": {
            "été":           "Période de forte utilisation — consommation au pic annuel.",
            "hiver":         "Climatiseur peu utilisé — consommation minimale.",
            "inter-saison":  "Utilisation modérée du climatiseur.",
        },
        "chauffe_eau": {
            "été":           "Eau plus chaude en entrée — consommation réduite.",
            "hiver":         "Eau froide en entrée — chauffe-eau sollicité au maximum.",
            "inter-saison":  "Consommation intermédiaire du chauffe-eau.",
        },
    }.get(category, {
        "été":          "Consommation standard pour cet appareil.",
        "hiver":        "Consommation standard pour cet appareil.",
        "inter-saison": "Consommation standard pour cet appareil.",
    })
    note_saisonniere = commentaire_saison.get(saison, "")

    num_facture = f"SIM-{now.year}-{random.randint(10000,99999)}"
    periode     = f"{label_trim} {now.year}"
    date_str    = now.strftime("%d/%m/%Y")
    marque_cap  = brand.capitalize() if brand not in ("?", "inconnue") else ""
    appareil_str = f"{label} {marque_cap}".strip()

    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=1.8*cm, leftMargin=1.8*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
    )

    s_title   = ParagraphStyle("st", fontName="Helvetica-Bold",  fontSize=22, textColor=C_STEG_BLEU, leading=26)
    s_sub     = ParagraphStyle("ss", fontName="Helvetica",       fontSize=8,  textColor=C_GRIS, leading=12)
    s_section = ParagraphStyle("sec",fontName="Helvetica-Bold",  fontSize=7,  textColor=C_GRIS, letterSpacing=1.5, spaceBefore=12, spaceAfter=6)
    s_body    = ParagraphStyle("sb", fontName="Helvetica",       fontSize=9,  textColor=C_TEXT, leading=13)
    s_bold    = ParagraphStyle("sbo",fontName="Helvetica-Bold",  fontSize=9,  textColor=C_TEXT, leading=13)
    s_footer  = ParagraphStyle("sf", fontName="Helvetica",       fontSize=7,  textColor=C_GRIS, alignment=TA_CENTER)
    s_center  = ParagraphStyle("sc", fontName="Helvetica",       fontSize=9,  textColor=C_TEXT, alignment=TA_CENTER)
    s_saison  = ParagraphStyle("ss2",fontName="Helvetica-Bold",  fontSize=9,  textColor=c_saison, leading=13)

    story = []

    # ── En-tête ──
    steg_info = Table([[
        Paragraph("STEG", s_title),
        Table([
            [Paragraph("FACTURE SIMULATION",    ParagraphStyle("fs", fontName="Helvetica-Bold", fontSize=11, textColor=C_STEG_BLEU, alignment=TA_RIGHT))],
            [Paragraph(f"N° {num_facture}",     ParagraphStyle("fn", fontName="Helvetica",      fontSize=9,  textColor=C_GRIS, alignment=TA_RIGHT))],
            [Paragraph(f"Période : {periode}",  ParagraphStyle("fp", fontName="Helvetica",      fontSize=9,  textColor=C_GRIS, alignment=TA_RIGHT))],
            [Paragraph(f"Date : {date_str}",    ParagraphStyle("fd", fontName="Helvetica",      fontSize=9,  textColor=C_GRIS, alignment=TA_RIGHT))],
        ], colWidths=[8*cm])
    ]], colWidths=[8*cm, 8*cm])
    steg_info.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("PADDING",(0,0),(-1,-1),0)]))
    story.append(steg_info)
    story.append(Paragraph("Société Tunisienne de l'Electricité et du Gaz — 38 Rue Kemal Atatürk, 1080 Tunis", s_sub))
    story.append(HRFlowable(width="100%", thickness=2, color=C_STEG_BLEU, spaceAfter=10, spaceBefore=6))

    # ── Bandeau appareil ──
    app_tbl = Table([[
        Paragraph(f"Appareil analysé : {appareil_str}", ParagraphStyle("aa", fontName="Helvetica-Bold", fontSize=11, textColor=C_STEG_BLEU)),
        Paragraph(f"Score EPS : {score}/100  |  Note : {grade}  |  Classe EU : {energy_cls}  |  Etat : {etat}", ParagraphStyle("ai", fontName="Helvetica", fontSize=9, textColor=C_STEG_BLEU, alignment=TA_RIGHT)),
    ]], colWidths=[9*cm, 7*cm])
    app_tbl.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),C_STEG_BLEU_L),("PADDING",(0,0),(-1,-1),10),("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    story.append(app_tbl)
    story.append(Spacer(1, 8))

    # ── Bandeau saisonnier ──
    saison_tbl = Table([[
        Paragraph(f"Saison : {saison.upper()}  —  {note_saisonniere}", s_saison),
        Paragraph(f"Consommation annuelle totale : {kwh_an_display} kWh/an", ParagraphStyle("ka", fontName="Helvetica", fontSize=9, textColor=c_saison, alignment=TA_RIGHT)),
    ]], colWidths=[10*cm, 6*cm])
    saison_tbl.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg_saison),("PADDING",(0,0),(-1,-1),8),("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    story.append(saison_tbl)
    story.append(Spacer(1, 10))

    # ── Détail mensuel du trimestre ──
    story.append(Paragraph("DÉCOMPOSITION MENSUELLE DU TRIMESTRE", s_section))
    mois_rows = [[
        Paragraph(m, s_bold),
        Paragraph(f"{k} kWh", ParagraphStyle("mk", fontName="Helvetica-Bold", fontSize=9, textColor=C_TEXT, alignment=TA_CENTER)),
        Paragraph(
            f"{round(k / kwh_trim * 100) if kwh_trim > 0 else 0}% du trimestre",
            ParagraphStyle("mp", fontName="Helvetica", fontSize=9, textColor=C_GRIS, alignment=TA_RIGHT)
        ),
    ] for m, k in detail_mois]
    mois_rows.append([
        Paragraph("Total trimestre", ParagraphStyle("tt", fontName="Helvetica-Bold", fontSize=10, textColor=C_WHITE)),
        Paragraph(f"{kwh_trim} kWh", ParagraphStyle("tv", fontName="Helvetica-Bold", fontSize=10, textColor=C_WHITE, alignment=TA_CENTER)),
        Paragraph("100%", ParagraphStyle("tp", fontName="Helvetica-Bold", fontSize=10, textColor=C_WHITE, alignment=TA_RIGHT)),
    ])
    mois_tbl = Table(mois_rows, colWidths=[5*cm, 4*cm, 7*cm])
    mois_style = [
        ("PADDING",  (0,0),(-1,-1), 8),
        ("BOX",      (0,0),(-1,-1), 0.5, C_BORDER),
        ("LINEBELOW",(0,0),(-1,-2), 0.3, C_BORDER),
        ("BACKGROUND",(0,-1),(-1,-1), C_STEG_BLEU),
    ]
    for i in range(len(detail_mois)):
        mois_style.append(("BACKGROUND",(0,i),(-1,i), bg_saison if i % 2 == 0 else C_WHITE))
    mois_tbl.setStyle(TableStyle(mois_style))
    story.append(mois_tbl)
    story.append(Spacer(1, 10))

    # ── Détail tranches STEG ──
    story.append(Paragraph(f"CALCUL PAR TRANCHES STEG 2024 — {kwh_trim} kWh CE TRIMESTRE", s_section))

    hdr_cols = [
        Paragraph("Désignation",  ParagraphStyle("dh", fontName="Helvetica-Bold", fontSize=9, textColor=C_WHITE)),
        Paragraph("kWh",          ParagraphStyle("kh", fontName="Helvetica-Bold", fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
        Paragraph("Tarif DT/kWh", ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=9, textColor=C_WHITE, alignment=TA_RIGHT)),
        Paragraph("Montant DT",   ParagraphStyle("mh", fontName="Helvetica-Bold", fontSize=9, textColor=C_WHITE, alignment=TA_RIGHT)),
    ]
    rows = [hdr_cols]
    bg_colors = [C_STEG_BLEU]

    for i, (desc, kwh_t, tarif, montant) in enumerate(facture_actuelle["tranches"]):
        rows.append([
            Paragraph(desc,          s_body),
            Paragraph(str(kwh_t),    ParagraphStyle("kv", fontName="Helvetica", fontSize=9, textColor=C_TEXT, alignment=TA_CENTER)),
            Paragraph(f"{tarif:.3f}",ParagraphStyle("tv2",fontName="Helvetica", fontSize=9, textColor=C_TEXT, alignment=TA_RIGHT)),
            Paragraph(f"{montant:.3f}",ParagraphStyle("mv",fontName="Helvetica",fontSize=9, textColor=C_TEXT, alignment=TA_RIGHT)),
        ])
        bg_colors.append(C_GRIS_L if i % 2 == 0 else C_WHITE)

    rows.append([Paragraph("Redevance fixe abonnement (trim.)", s_body), Paragraph("—", s_center), Paragraph("—", ParagraphStyle("rv", fontName="Helvetica", fontSize=9, textColor=C_TEXT, alignment=TA_RIGHT)), Paragraph(f"{REDEVANCE_FIXE_TRIM:.3f}", ParagraphStyle("rm", fontName="Helvetica", fontSize=9, textColor=C_TEXT, alignment=TA_RIGHT))])
    bg_colors.append(C_GRIS_L)
    rows.append([Paragraph("Sous-total HT", s_bold), Paragraph("", s_body), Paragraph("", s_body), Paragraph(f"{facture_actuelle['ht_total']:.3f}", s_bold)])
    bg_colors.append(colors.HexColor("#e3eaf5"))
    rows.append([Paragraph("Taxe collectivités locales (TCL) 2%", s_body), Paragraph("", s_body), Paragraph("2%", ParagraphStyle("tclr", fontName="Helvetica", fontSize=9, textColor=C_TEXT, alignment=TA_RIGHT)), Paragraph(f"{facture_actuelle['tcl']:.3f}", s_body)])
    bg_colors.append(C_WHITE)
    rows.append([Paragraph("TVA 19%", s_body), Paragraph("", s_body), Paragraph("19%", ParagraphStyle("tvar", fontName="Helvetica", fontSize=9, textColor=C_TEXT, alignment=TA_RIGHT)), Paragraph(f"{facture_actuelle['tva']:.3f}", s_body)])
    bg_colors.append(C_GRIS_L)
    rows.append([
        Paragraph("<b>TOTAL A PAYER (TTC)</b>", ParagraphStyle("tp", fontName="Helvetica-Bold", fontSize=11, textColor=C_WHITE)),
        Paragraph("", s_body), Paragraph("", s_body),
        Paragraph(f"<b>{facture_actuelle['ttc']:.3f} DT</b>", ParagraphStyle("ttc", fontName="Helvetica-Bold", fontSize=13, textColor=C_WHITE, alignment=TA_RIGHT)),
    ])
    bg_colors.append(C_STEG_BLEU)

    det_tbl = Table(rows, colWidths=[8.5*cm, 2*cm, 3*cm, 2.5*cm])
    style_cmds = [("PADDING",(0,0),(-1,-1),7),("VALIGN",(0,0),(-1,-1),"MIDDLE"),("BOX",(0,0),(-1,-1),0.5,C_BORDER),("LINEBELOW",(0,0),(-1,-2),0.3,C_BORDER),("LINEABOVE",(0,-1),(-1,-1),1,C_STEG_BLEU)]
    for i, bg in enumerate(bg_colors):
        style_cmds.append(("BACKGROUND",(0,i),(-1,i), bg))
    det_tbl.setStyle(TableStyle(style_cmds))
    story.append(det_tbl)
    story.append(Spacer(1, 10))

    # ── Économies vs classe F ──
    story.append(Paragraph("ANALYSE ENERGETIQUE — ECONOMIES SAISONNIERES", s_section))
    eco_rows = [
        [Paragraph(f"Appareil classe F équivalent (ce trimestre)", ParagraphStyle("ef", fontName="Helvetica-Bold", fontSize=9, textColor=C_ROUGE)), Paragraph(f"{kwh_f_trim} kWh", s_body), Paragraph(f"{facture_classe_f['ttc']:.3f} DT", ParagraphStyle("ef2", fontName="Helvetica-Bold", fontSize=9, textColor=C_ROUGE, alignment=TA_RIGHT))],
        [Paragraph(f"Votre {label} (classe {energy_cls}) — {saison}", ParagraphStyle("ev", fontName="Helvetica-Bold", fontSize=9, textColor=C_VERT)), Paragraph(f"{kwh_trim} kWh", s_body), Paragraph(f"{facture_actuelle['ttc']:.3f} DT", ParagraphStyle("ev2", fontName="Helvetica-Bold", fontSize=9, textColor=C_VERT, alignment=TA_RIGHT))],
        [Paragraph("Economies ce trimestre", ParagraphStyle("ek", fontName="Helvetica-Bold", fontSize=10, textColor=C_VERT)), Paragraph("", s_body), Paragraph(f"{economies_trim:.3f} DT", ParagraphStyle("ek2", fontName="Helvetica-Bold", fontSize=12, textColor=C_VERT, alignment=TA_RIGHT))],
        [Paragraph("Economies annuelles estimées (x4 trimestres)", ParagraphStyle("ea", fontName="Helvetica-Bold", fontSize=10, textColor=C_VERT)), Paragraph("", s_body), Paragraph(f"{economies_an:.2f} DT/an", ParagraphStyle("ea2", fontName="Helvetica-Bold", fontSize=12, textColor=C_VERT, alignment=TA_RIGHT))],
    ]
    eco_tbl = Table(eco_rows, colWidths=[9*cm, 3*cm, 4*cm])
    eco_tbl.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,1),C_ROUGE_L),("BACKGROUND",(0,2),(-1,-1),C_VERT_L),("LINEABOVE",(0,2),(-1,2),1.5,C_VERT),("BOX",(0,0),(-1,-1),0.5,C_BORDER),("LINEBELOW",(0,0),(-1,-2),0.3,C_BORDER),("PADDING",(0,0),(-1,-1),9),("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    story.append(eco_tbl)
    story.append(Spacer(1, 10))

    # ── Footer ──
    story.append(HRFlowable(width="100%", thickness=0.5, color=C_BORDER, spaceBefore=6, spaceAfter=6))
    story.append(Paragraph(
        f"DOCUMENT DE SIMULATION — Domus AI · SynapNeuf 2026 · "
        f"Tarifs STEG 2024 (BT domestique) · Profil saisonnier Tunisie — Non officiel, à titre indicatif uniquement.",
        s_footer
    ))

    doc.build(story)
    return buffer.getvalue()