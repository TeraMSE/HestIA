# pdf_generator.py — Domus AI · Rapport EPS v4.0 FINAL
# Correction critique page 2 : rapport affiché ligne par ligne
# clean_text() ne supprime plus les chiffres ni les caractères du rapport
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer,
    Table, TableStyle, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.graphics.shapes import Drawing, Rect, String
from datetime import datetime
import io
import re


# ══════════════════════════════════════════
# PALETTES
# ══════════════════════════════════════════
GRADE_COLORS = {
    "A+++": colors.HexColor("#059669"),
    "A++":  colors.HexColor("#10b981"),
    "A+":   colors.HexColor("#22c55e"),
    "A":    colors.HexColor("#4ade80"),
    "B":    colors.HexColor("#a3e635"),
    "C":    colors.HexColor("#fbbf24"),
    "D":    colors.HexColor("#f97316"),
    "E":    colors.HexColor("#ef4444"),
    "F":    colors.HexColor("#dc2626"),
}

ETAT_COLORS = {
    "propre":    colors.HexColor("#34d399"),
    "normal":    colors.HexColor("#4f8ef7"),
    "endommagé": colors.HexColor("#fbbf24"),
    "rouillé":   colors.HexColor("#f87171"),
}

ETAT_LABELS = {
    "propre":    "Propre — Bien entretenu",
    "normal":    "Normal — Etat standard",
    "endommagé": "Endommagé — Vérification nécessaire",
    "rouillé":   "Rouillé — Remplacement urgent",
}

LABELS_FR = {
    "refrigerateur": "Réfrigérateur",
    "climatiseur":   "Climatiseur",
    "chauffe_eau":   "Chauffe-eau",
    "machine_laver": "Machine à laver",
    "ampoule":       "Ampoule",
}

C_DARK     = colors.HexColor("#0a0e1a")
C_ACCENT   = colors.HexColor("#4f8ef7")
C_MUTED    = colors.HexColor("#6b7a99")
C_TEXT     = colors.HexColor("#1e293b")
C_BORDER   = colors.HexColor("#e2e8f0")
C_BG_LIGHT = colors.HexColor("#f8fafc")
C_WHITE    = colors.white
C_GREEN    = colors.HexColor("#34d399")
C_RED      = colors.HexColor("#f87171")
C_ORANGE   = colors.HexColor("#fbbf24")


# ══════════════════════════════════════════
# HELPER : nettoyer UNIQUEMENT les emojis
# Garde tous les chiffres, +, -, /, =, etc.
# ══════════════════════════════════════════
def strip_emojis(text: str) -> str:
    """
    Supprime UNIQUEMENT les emojis qui cassent ReportLab.
    NE supprime PAS les chiffres, +, -, /, =, lettres, espaces.
    """
    # Emojis Unicode hors plan de base
    text = re.sub(r'[\U00010000-\U0010FFFF]', '', text)
    # Emojis symboles courants
    text = re.sub(r'[\u2600-\u27BF]', '', text)
    text = re.sub(r'[\u2B00-\u2BFF]', '', text)
    text = re.sub(r'[\u2300-\u23FF]', '', text)
    # Variation selectors et combining marks
    text = re.sub(r'[\uFE00-\uFE0F]', '', text)
    text = re.sub(r'[\u20D0-\u20FF]', '', text)
    # Remplacer ━ par - (garde lisibilité)
    text = text.replace("━", "-").replace("═", "=")
    return text


def score_bar(score: float, grade: str, width: float = 14*cm) -> Drawing:
    """Barre de score visuelle horizontale"""
    d = Drawing(width, 48)
    gc = GRADE_COLORS.get(grade, C_ACCENT)
    fw = (score / 100) * width
    d.add(Rect(0, 20, width, 12, fillColor=C_BORDER, strokeColor=None))
    d.add(Rect(0, 20, fw, 12, fillColor=gc, strokeColor=None, rx=4, ry=4))
    d.add(String(0,    6, "0",         fontName="Helvetica",      fontSize=8, fillColor=C_MUTED))
    d.add(String(width-20, 6, "100",   fontName="Helvetica",      fontSize=8, fillColor=C_MUTED))
    d.add(String(max(fw-10, 2), 36, str(int(score)),
                 fontName="Helvetica-Bold", fontSize=9, fillColor=gc))
    return d


# ══════════════════════════════════════════
# GÉNÉRATION PDF
# ══════════════════════════════════════════
def generate_pdf(data: dict) -> bytes:
    """
    Génère le PDF complet.
    data = dict retourné par /analyze (même structure que JSON API)
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=2.2*cm, leftMargin=2.2*cm,
        topMargin=2*cm, bottomMargin=2*cm,
        title="Rapport EPS — Domus AI",
        author="SynapNeuf · Domus AI",
    )

    # ── Styles ──
    styles = getSampleStyleSheet()

    s_title = ParagraphStyle("s_title",
        fontName="Helvetica-Bold", fontSize=26,
        textColor=C_WHITE, alignment=TA_CENTER,
        spaceAfter=2, leading=30)

    s_sub = ParagraphStyle("s_sub",
        fontName="Helvetica", fontSize=10,
        textColor=colors.HexColor("#94a3b8"),
        alignment=TA_CENTER, spaceAfter=4)

    s_section = ParagraphStyle("s_section",
        fontName="Helvetica-Bold", fontSize=8,
        textColor=C_MUTED, spaceBefore=18,
        spaceAfter=8, letterSpacing=2)

    s_body = ParagraphStyle("s_body",
        fontName="Helvetica", fontSize=9.5,
        textColor=C_TEXT, spaceAfter=5, leading=15)

    s_bold = ParagraphStyle("s_bold",
        fontName="Helvetica-Bold", fontSize=9.5,
        textColor=C_TEXT, spaceAfter=5, leading=15)

    s_mono = ParagraphStyle("s_mono",
        fontName="Courier", fontSize=9,
        textColor=C_TEXT, spaceAfter=2,
        leading=14, leftIndent=0)

    s_mono_title = ParagraphStyle("s_mono_title",
        fontName="Courier-Bold", fontSize=9,
        textColor=C_ACCENT, spaceAfter=2,
        leading=14)

    s_mono_sep = ParagraphStyle("s_mono_sep",
        fontName="Courier", fontSize=8,
        textColor=C_MUTED, spaceAfter=1,
        leading=12)

    s_footer = ParagraphStyle("s_footer",
        fontName="Helvetica", fontSize=7.5,
        textColor=C_MUTED, alignment=TA_CENTER,
        spaceBefore=6)

    s_label = ParagraphStyle("s_label",
        fontName="Helvetica", fontSize=8,
        textColor=C_MUTED, spaceAfter=2)

    # ── Extraction des données ──
    category   = data.get("detected_class", "inconnu")
    label      = LABELS_FR.get(category, category.replace("_", " ").capitalize())
    grade      = data.get("grade", "?")
    score      = float(data.get("efficiency_score", 0))
    score_int  = int(round(score))
    conf       = float(data.get("confidence", 0))
    etat       = data.get("etat_visuel", "normal")
    age        = data.get("age_years", "?")
    energy_cls = data.get("energy_class", "?")
    brand      = data.get("brand", "?")
    technology = data.get("technology", "?").replace("_", " ")
    kwh        = data.get("kwh_per_year", 0)
    interp     = data.get("interpretation", "")
    rec        = data.get("recommendation", "")
    sd         = data.get("score_details", {})

    gc         = GRADE_COLORS.get(grade, C_ACCENT)
    ec         = ETAT_COLORS.get(etat, C_MUTED)
    el         = ETAT_LABELS.get(etat, etat.capitalize())
    now        = datetime.now().strftime("%d/%m/%Y à %H:%M")

    story = []

    # ══════════════════════════════════════════
    # EN-TÊTE
    # ══════════════════════════════════════════
    hdr = Table([[Paragraph("Domus AI", s_title)]], colWidths=[16.6*cm])
    hdr.setStyle(TableStyle([
        ("BACKGROUND",     (0,0), (-1,-1), C_DARK),
        ("PADDING",        (0,0), (-1,-1), 20),
        ("ROUNDEDCORNERS", [8]),
    ]))
    story.append(hdr)
    story.append(Spacer(1, 6))
    story.append(Paragraph("Rapport de Performance Energétique", s_sub))
    story.append(Paragraph(f"Généré le {now} · ApplianceVisionAgent v2.0", s_sub))
    story.append(Spacer(1, 14))
    story.append(HRFlowable(width="100%", thickness=0.4, color=C_BORDER, spaceAfter=0))

    # ══════════════════════════════════════════
    # RÉSULTAT GLOBAL
    # ══════════════════════════════════════════
    story.append(Paragraph("RÉSULTAT GLOBAL", s_section))

    # Grade box
    gb_data = [[Paragraph(grade, ParagraphStyle("gb",
        fontName="Helvetica-Bold", fontSize=36,
        textColor=C_WHITE, alignment=TA_CENTER))]]
    gb = Table(gb_data, colWidths=[3.5*cm], rowHeights=[3.5*cm])
    gb.setStyle(TableStyle([
        ("BACKGROUND",     (0,0), (-1,-1), gc),
        ("VALIGN",         (0,0), (-1,-1), "MIDDLE"),
        ("ROUNDEDCORNERS", [12]),
    ]))

    # Score info
    si_data = [
        [Paragraph("Appareil détecté", s_label),
         Paragraph("Score EPS", s_label)],
        [Paragraph(f"<b>{label}</b>", s_bold),
         Paragraph(f"<b>{score_int}/100</b>", s_bold)],
        [Paragraph("Confiance CNN", s_label),
         Paragraph("Interprétation", s_label)],
        [Paragraph(f"<b>{conf:.1f}%</b>", s_bold),
         Paragraph(strip_emojis(interp), s_body)],
    ]
    si = Table(si_data, colWidths=[6*cm, 7.1*cm])
    si.setStyle(TableStyle([
        ("VALIGN",       (0,0), (-1,-1), "TOP"),
        ("PADDING",      (0,0), (-1,-1), 4),
        ("LINEBEFORE",   (1,0), (1,-1), 0.3, C_BORDER),
        ("LEFTPADDING",  (1,0), (1,-1), 12),
    ]))

    main = Table([[gb, si]], colWidths=[3.8*cm, 12.8*cm])
    main.setStyle(TableStyle([
        ("VALIGN",       (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING",  (1,0), (1,0),  16),
        ("BACKGROUND",   (0,0), (-1,-1), C_BG_LIGHT),
        ("PADDING",      (0,0), (-1,-1), 12),
        ("ROUNDEDCORNERS", [8]),
        ("BOX",          (0,0), (-1,-1), 0.3, C_BORDER),
    ]))
    story.append(main)
    story.append(Spacer(1, 10))
    story.append(score_bar(score, grade))
    story.append(Spacer(1, 14))

    # ══════════════════════════════════════════
    # INFORMATIONS APPAREIL
    # ══════════════════════════════════════════
    story.append(HRFlowable(width="100%", thickness=0.4, color=C_BORDER))
    story.append(Paragraph("INFORMATIONS APPAREIL", s_section))

    age_str = str(age) + (" an" if str(age) == "1" else " ans")

    info_data = [
        [Paragraph("Âge", s_label),
         Paragraph("Classe EU", s_label),
         Paragraph("Marque", s_label),
         Paragraph("Technologie", s_label)],
        [Paragraph(f"<b>{age_str}</b>", s_bold),
         Paragraph(f"<b>{energy_cls}</b>", s_bold),
         Paragraph(f"<b>{brand.capitalize()}</b>", s_bold),
         Paragraph(f"<b>{technology}</b>", s_bold)],
        [Paragraph("Consommation kWh/an", s_label),
         Paragraph("État visuel (IA)", s_label),
         Paragraph(""), Paragraph("")],
        [Paragraph(f"<b>{kwh} kWh</b>" if kwh else "<b>Non renseigné</b>", s_bold),
         Paragraph(f"<b>{el}</b>", ParagraphStyle("ev",
            fontName="Helvetica-Bold", fontSize=9.5,
            textColor=ec, spaceAfter=5)),
         Paragraph(""), Paragraph("")],
    ]
    it = Table(info_data, colWidths=[4.15*cm]*4)
    it.setStyle(TableStyle([
        ("VALIGN",         (0,0), (-1,-1), "TOP"),
        ("PADDING",        (0,0), (-1,-1), 8),
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [C_BG_LIGHT, C_WHITE, C_BG_LIGHT, C_WHITE]),
        ("BOX",            (0,0), (-1,-1), 0.3, C_BORDER),
        ("INNERGRID",      (0,0), (-1,-1), 0.2, C_BORDER),
    ]))
    story.append(it)
    story.append(Spacer(1, 14))

    # ══════════════════════════════════════════
    # DÉCOMPOSITION DU SCORE — 6 critères
    # ══════════════════════════════════════════
    story.append(HRFlowable(width="100%", thickness=0.4, color=C_BORDER))
    story.append(Paragraph("DÉCOMPOSITION DU SCORE EPS — 6 CRITÈRES", s_section))

    base_age     = int(sd.get("base_age",     0))
    bonus_classe = int(sd.get("bonus_classe", 0))
    bonus_marque = int(sd.get("bonus_marque", 0))
    bonus_tech   = int(sd.get("bonus_tech",   0))
    bonus_kwh    = int(sd.get("bonus_kwh",    0))
    bonus_etat   = int(sd.get("bonus_etat",   0))

    def fmt_b(v):
        return ("+" + str(v)) if v > 0 else str(v)

    def col_b(v):
        if v > 0:  return C_GREEN
        if v < 0:  return C_RED
        return C_MUTED

    bd_hdr = [
        Paragraph("CRITÈRE", ParagraphStyle("bh1",
            fontName="Helvetica-Bold", fontSize=8,
            textColor=C_WHITE, letterSpacing=1)),
        Paragraph("VALEUR", ParagraphStyle("bh2",
            fontName="Helvetica-Bold", fontSize=8,
            textColor=C_WHITE, letterSpacing=1,
            alignment=TA_CENTER)),
        Paragraph("IMPACT", ParagraphStyle("bh3",
            fontName="Helvetica-Bold", fontSize=8,
            textColor=C_WHITE, letterSpacing=1,
            alignment=TA_RIGHT)),
    ]

    def bd_row(lbl, val, bv):
        bc = col_b(bv) if bv is not None else C_MUTED
        return [
            Paragraph(lbl, s_body),
            Paragraph(str(val), ParagraphStyle("bv",
                fontName="Helvetica", fontSize=9.5,
                textColor=C_TEXT, alignment=TA_CENTER)),
            Paragraph(fmt_b(bv) if bv is not None else "—",
                ParagraphStyle("bb", fontName="Helvetica-Bold",
                fontSize=10, textColor=bc, alignment=TA_RIGHT)),
        ]

    bd_data = [
        bd_hdr,
        bd_row("Score de base (âge appareil)",       f"{base_age}/100",  None),
        bd_row("Classe énergétique EU",               energy_cls,         bonus_classe),
        bd_row("Marque",                              brand.capitalize(), bonus_marque),
        bd_row("Technologie",                         technology,         bonus_tech),
        bd_row("Consommation kWh/an",                 f"{kwh} kWh",       bonus_kwh),
        bd_row("État visuel (IA vision)",             etat.capitalize(),  bonus_etat),
        [
            Paragraph("<b>SCORE FINAL</b>", ParagraphStyle("tl",
                fontName="Helvetica-Bold", fontSize=10, textColor=C_WHITE)),
            Paragraph(f"<b>{score_int}/100</b>", ParagraphStyle("tv",
                fontName="Helvetica-Bold", fontSize=10, textColor=C_WHITE,
                alignment=TA_CENTER)),
            Paragraph(f"<b>{grade}</b>", ParagraphStyle("tg",
                fontName="Helvetica-Bold", fontSize=13, textColor=C_WHITE,
                alignment=TA_RIGHT)),
        ],
    ]

    bd_tbl = Table(bd_data, colWidths=[8.5*cm, 4*cm, 4.1*cm])
    bd_tbl.setStyle(TableStyle([
        ("BACKGROUND",     (0,0), (-1,0),   C_DARK),
        ("PADDING",        (0,0), (-1,-1),  10),
        ("VALIGN",         (0,0), (-1,-1),  "MIDDLE"),
        ("ROWBACKGROUNDS", (0,1), (-1,-2),
         [C_WHITE, C_BG_LIGHT, C_WHITE, C_BG_LIGHT, C_WHITE, C_BG_LIGHT]),
        ("LINEBELOW",      (0,0), (-1,-2),  0.3, C_BORDER),
        ("TEXTCOLOR",      (2,1), (2,1),    C_MUTED),
        ("BACKGROUND",     (0,-1), (-1,-1), gc),
        ("BOX",            (0,0), (-1,-1),  0.4, C_BORDER),
    ]))
    story.append(bd_tbl)
    story.append(Spacer(1, 14))

    # ══════════════════════════════════════════
    # RAPPORT TEXTE — ligne par ligne
    # ══════════════════════════════════════════
    if rec:
        story.append(HRFlowable(width="100%", thickness=0.4, color=C_BORDER))
        story.append(Paragraph("RAPPORT ÉNERGÉTIQUE INTELLIGENT", s_section))

        # Bandeau bleu header
        rh_data = [[Paragraph(
            "Analyse Domus AI — Llama4 Vision + Rule Engine",
            ParagraphStyle("rh", fontName="Helvetica-Bold",
                fontSize=8, textColor=C_WHITE, alignment=TA_CENTER))]]
        rh = Table(rh_data, colWidths=[16.6*cm])
        rh.setStyle(TableStyle([
            ("BACKGROUND",     (0,0), (-1,-1), C_ACCENT),
            ("PADDING",        (0,0), (-1,-1), 8),
            ("ROUNDEDCORNERS", [6]),
        ]))
        story.append(rh)
        story.append(Spacer(1, 10))

        # ── Traitement ligne par ligne du rapport texte ──
        raw = strip_emojis(rec)
        lines = raw.split("\n")

        for line in lines:
            # Ligne vide → espace
            if not line.strip():
                story.append(Spacer(1, 4))
                continue

            stripped = line.strip()

            # Séparateur "=====" ou "-----"
            if re.match(r'^[=\-]{10,}$', stripped):
                story.append(HRFlowable(
                    width="100%", thickness=0.3,
                    color=C_BORDER, spaceAfter=2, spaceBefore=2))
                continue

            # Titre de section (tout en majuscules et pas trop long)
            # Ex: "APPAREIL DETECTE", "SCORE EPS : 98/100 - Note A+++"
            is_section_title = (
                stripped.isupper() or
                stripped.startswith("RAPPORT") or
                stripped.startswith("APPAREIL") or
                stripped.startswith("SCORE EPS :") or
                stripped.startswith("SCORE FINAL") or
                stripped.startswith("EVALUATION") or
                stripped.startswith("DUREE") or
                stripped.startswith("ECONOMIES") or
                stripped.startswith("CONSEIL") or
                stripped.startswith("PROCHAIN")
            )

            if is_section_title:
                story.append(Paragraph(stripped, ParagraphStyle("sec",
                    fontName="Helvetica-Bold", fontSize=10,
                    textColor=C_ACCENT, spaceAfter=4,
                    spaceBefore=8, leading=14)))
                continue

            # Ligne de score/bonus (commence par espace ou "  ")
            # Ex: "  Base age (1 an)  : 85/100"
            # Ex: "  Classe EU A++ : +12 pts"
            if line.startswith("  ") or line.startswith("\t"):
                # Détecter si c'est la ligne SCORE FINAL
                if "SCORE FINAL" in stripped or "SCORE EPS FINAL" in stripped:
                    story.append(Paragraph(stripped, ParagraphStyle("sf",
                        fontName="Helvetica-Bold", fontSize=10,
                        textColor=gc, spaceAfter=4, leading=14)))
                    continue

                # Détecter bonus positif/négatif pour couleur
                if re.search(r'[+\-]\d+\s*pts', stripped):
                    if "+" in stripped and "pts" in stripped:
                        c = C_GREEN
                    elif re.search(r'-\d+\s*pts', stripped):
                        c = C_RED
                    else:
                        c = C_TEXT
                    story.append(Paragraph(stripped, ParagraphStyle("bon",
                        fontName="Courier", fontSize=9,
                        textColor=c, spaceAfter=2,
                        leading=13, leftIndent=12)))
                else:
                    # Ligne indentée normale
                    story.append(Paragraph(stripped, ParagraphStyle("ind",
                        fontName="Courier", fontSize=9,
                        textColor=C_TEXT, spaceAfter=2,
                        leading=13, leftIndent=12)))
                continue

            # Ligne normale
            story.append(Paragraph(stripped, ParagraphStyle("norm",
                fontName="Helvetica", fontSize=9.5,
                textColor=C_TEXT, spaceAfter=3, leading=14)))

    story.append(Spacer(1, 20))

    # ══════════════════════════════════════════
    # FOOTER
    # ══════════════════════════════════════════
    story.append(HRFlowable(width="100%", thickness=0.4, color=C_BORDER))
    story.append(Paragraph(
        f"Domus AI · ApplianceVisionAgent v2.0 · MobileNetV2 + Llama4 Vision · "
        f"SynapNeuf 2026 · {now}",
        s_footer))

    doc.build(story)
    return buffer.getvalue()