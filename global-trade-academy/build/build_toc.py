# -*- coding: utf-8 -*-
"""
GLOBAL TRADE ACADEMY — Table des matières détaillée (livrable autonome).

S'appuie sur `output/structure-pages.json`, produit par build_ebook.py :
il contient la liste ordonnée des sections du manuel et la page réelle où
chacune commence. Génère :

  * livrables/Table-des-matieres-detaillee.pdf   (mise en page navy / or)
  * livrables/Table-des-matieres-detaillee.md     (version texte)
"""
import json
import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, HRFlowable, KeepTogether)

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, ".."))
OUT = os.path.join(ROOT, "output")
LIV = os.path.join(ROOT, "livrables")
STRUCT = os.path.join(OUT, "structure-pages.json")

NAVY = HexColor("#0B1F3A")
NAVY2 = HexColor("#1B3A66")
GOLD = HexColor("#C9A227")
GREY = HexColor("#5A6B84")
LIGHT = HexColor("#F4F6FA")
GREY_L = HexColor("#E8EDF3")

PART_ORDER = [
    ("avant", "Avant-propos"),
    ("ch1", "CHAPITRE 1"), ("ch2", "CHAPITRE 2"), ("ch3", "CHAPITRE 3"),
    ("ch4", "CHAPITRE 4"), ("ch5", "CHAPITRE 5"), ("ch6", "CHAPITRE 6"),
    ("ch7", "CHAPITRE 7"), ("ch8", "CHAPITRE 8"), ("ch9", "CHAPITRE 9"),
    ("ch10", "CHAPITRE 10"), ("ch11", "CHAPITRE 11"), ("ch12", "CHAPITRE 12"),
    ("cas", "ÉTUDE DE CAS INTÉGRÉE"),
    ("b1", "BONUS 1"), ("b2", "BONUS 2"), ("b3", "BONUS 3"), ("b4", "BONUS 4"),
    ("b5", "BONUS 5"), ("b6", "BONUS 6"), ("b7", "BONUS 7"),
    ("biblio", "BIBLIOGRAPHIE"),
    ("annexe", "ANNEXE"),
]

PART_TITLES = {
    "avant": "Avant-propos — Pourquoi le commerce international ?",
    "cas": "Étude de cas intégrée — Une première importation de bout en bout",
    "b1": "BONUS 1 — 30 messages professionnels pour contacter les fournisseurs",
    "b2": "BONUS 2 — Check-list de vérification d'un fournisseur",
    "b3": "BONUS 3 — Modèle de calcul du prix de revient d'une importation",
    "b4": "BONUS 4 — Check-list des documents avant expédition",
    "b5": "BONUS 5 — Glossaire de 100 termes du commerce international",
    "b6": "BONUS 6 — Modèle de business plan pour une activité d'import-export",
    "b7": "BONUS 7 — Guide de préparation d'une première importation",
    "biblio": "Bibliographie et sources officielles",
    "annexe": "Annexe — Suivi de progression et journal de bord",
}

ST = {
    "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=22, leading=26,
                         textColor=NAVY, spaceAfter=4),
    "sub": ParagraphStyle("sub", fontName="Helvetica", fontSize=9.5, leading=13,
                          textColor=GREY, spaceAfter=2),
    "part": ParagraphStyle("part", fontName="Helvetica-Bold", fontSize=10.5, leading=14,
                           textColor=NAVY, alignment=TA_LEFT),
    "lvl2": ParagraphStyle("lvl2", fontName="Helvetica", fontSize=8.7, leading=12,
                           textColor=HexColor("#1A2B45"), alignment=TA_LEFT,
                           leftIndent=12),
    "pg": ParagraphStyle("pg", fontName="Helvetica", fontSize=8.7, leading=12,
                         textColor=GREY, alignment=TA_RIGHT),
    "pgr": ParagraphStyle("pgr", fontName="Helvetica-Bold", fontSize=9.5, leading=13,
                         textColor=NAVY2, alignment=TA_RIGHT),
    "note": ParagraphStyle("note", fontName="Helvetica", fontSize=8.5, leading=12,
                           textColor=GREY, spaceBefore=6),
}


def chapter_bookmarks(structure):
    """Ne garde que les entrées du sommaire d'ouverture (celles du guide)."""
    return structure


def group_sections(structure):
    marks = structure["marks"]
    heads = structure["headings"]
    chapters = structure.get("chapters", {})

    parts = []
    for key, label in PART_ORDER:
        if key in marks:
            parts.append((marks[key], key, label))
    parts.sort()

    grouped = []
    for idx, (start, key, label) in enumerate(parts):
        end = parts[idx + 1][0] if idx + 1 < len(parts) else 10 ** 6
        if key.startswith("ch") and key[2:].isdigit():
            title = f"CHAPITRE {key[2:]} — {chapters.get(key, label)}"
        else:
            title = PART_TITLES.get(key, label)
        # sections numérotées uniquement ; dédoublonnage par titre
        seen = set()
        sections = []
        for t, p in heads:
            if p is None or not (start <= p < end):
                continue
            if not (t[:2].strip().rstrip(".").isdigit() and t.split(".")[0].isdigit()):
                continue
            if t in seen:
                continue
            seen.add(t)
            sections.append((t, p))
        grouped.append((key, title, start, sections))
    return grouped


def build_md(grouped):
    lines = ["# GLOBAL TRADE ACADEMY — Table des matières détaillée", "",
             "**Le guide complet pour comprendre, démarrer et développer une activité d'import-export.**", "",
             "Édition 2026 — informations réglementaires vérifiées le 15 novembre 2026.", "",
             "Les numéros de page renvoient au fichier `Global-Trade-Academy-Ebook-Complet.pdf` (70 pages).", ""]
    for key, title, start, sections in grouped:
        lines.append(f"## {title} — p. {start}")
        for t, p in sections:
            lines.append(f"- {t} — p. {p}")
        lines.append("")
    path = os.path.join(LIV, "Table-des-matieres-detaillee.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return path


def build_pdf(grouped):
    path = os.path.join(LIV, "Table-des-matieres-detaillee.pdf")
    doc = SimpleDocTemplate(path, pagesize=A4,
                            leftMargin=2 * cm, rightMargin=2 * cm,
                            topMargin=1.7 * cm, bottomMargin=1.5 * cm,
                            title="Global Trade Academy — Table des matières détaillée",
                            author="Global Trade Academy")
    story = [Paragraph("GLOBAL TRADE ACADEMY", ST["h1"]),
             HRFlowable(width="100%", thickness=1, color=GOLD, spaceAfter=8),
             Paragraph("Table des matières détaillée", ST["part"]),
             Spacer(1, 2),
             Paragraph("Le guide complet pour comprendre, démarrer et développer une "
                       "activité d'import-export — 12 chapitres, 7 bonus, 70 pages. "
                       "Édition 2026.", ST["sub"]),
             Spacer(1, 8)]

    data, styles = [], []
    for key, title, start, sections in grouped:
        data.append([Paragraph(title, ST["part"]), Paragraph(f"p. {start}", ST["pgr"])])
        styles.append(("bg",))
        for t, p in sections:
            data.append([Paragraph(t, ST["lvl2"]), Paragraph(str(p), ST["pg"])])
            styles.append(("row",))
    t = Table(data, colWidths=[14.8 * cm, 2.2 * cm])
    ts = [("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("LEFTPADDING", (0, 0), (-1, -1), 5),
          ("RIGHTPADDING", (0, 0), (-1, -1), 5),
          ("TOPPADDING", (0, 0), (-1, -1), 2.5),
          ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
          ("LINEBELOW", (0, 0), (-1, -1), 0.25, GREY_L)]
    for i, s in enumerate(styles):
        if s == ("bg",):
            ts += [("BACKGROUND", (0, i), (-1, i), LIGHT),
                   ("LINEABOVE", (0, i), (-1, i), 0.7, GOLD),
                   ("TOPPADDING", (0, i), (-1, i), 7)]
    
    t.setStyle(TableStyle(ts))
    story.append(t)
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=0.5, color=GREY_L, spaceAfter=6))
    story.append(Paragraph(
        "Les sept bonus sont également fournis en fichiers PDF autonomes dans le dossier "
        "« bonus ». Les informations réglementaires ont été vérifiées le 15 novembre 2026 sur "
        "les sources officielles citées en bibliographie (OMC, OMD, CCI, Douane du Bénin, "
        "APIEx, Port autonome de Cotonou, CEDEAO, UEMOA, OHADA) ; vérifiez les mises à jour "
        "avant chaque opération. Ce document est pédagogique et ne constitue pas un conseil "
        "juridique, fiscal ou douanier personnalisé.", ST["note"]))
    doc.build(story)
    return path


def main():
    if not os.path.exists(STRUCT):
        raise SystemExit("structure-pages.json introuvable : lancez build_ebook.py d'abord.")
    os.makedirs(LIV, exist_ok=True)
    structure = json.load(open(STRUCT, encoding="utf-8"))
    grouped = group_sections(structure)
    md = build_md(grouped)
    pdf = build_pdf(grouped)
    print(f"{len(grouped)} sections principales")
    print("  ", os.path.basename(md))
    print("  ", os.path.basename(pdf))


if __name__ == "__main__":
    main()
