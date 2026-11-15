# -*- coding: utf-8 -*-
"""
GLOBAL TRADE ACADEMY — Générateur de l'ebook PDF (ReportLab Platypus).
Produit : Global-Trade-Academy.pdf (~85 pages, A4, bleu nuit / or / blanc).
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, Image, PageBreak, KeepTogether,
                                HRFlowable, ListFlowable, ListItem, Flowable)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

BASE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(BASE, "..", "src", "images")
OUT = os.path.join(BASE, "..", "output")
os.makedirs(OUT, exist_ok=True)

# ------------------------------------------------------------------ palette
NAVY = HexColor("#0B1F3A")
NAVY2 = HexColor("#1B3A66")
NAVY3 = HexColor("#24497E")
GOLD = HexColor("#C9A227")
GOLD_L = HexColor("#E8C766")
GOLD_BG = HexColor("#FBF6E3")
LIGHT = HexColor("#F4F6FA")
GREY = HexColor("#5A6B84")
GREY_L = HexColor("#E8EDF3")
RED = HexColor("#B03A2E")
GREEN = HexColor("#1E7A4C")

PAGE_W, PAGE_H = A4

# ------------------------------------------------------------------ pagination
PAGE_MARKS = {}

class Mark(Flowable):
    """Marqueur invisible qui enregistre le numero de page courant (pour le sommaire)."""
    def __init__(self, key):
        Flowable.__init__(self)
        self.key = key
        self.width = 0
        self.height = 0

    def wrap(self, aw, ah):
        return (0, 0)

    def draw(self):
        PAGE_MARKS[self.key] = self.canv.getPageNumber()

class MarkParagraph(Paragraph):
    """Paragraphe qui enregistre son numero de page reel lors du dessin."""
    def __init__(self, key, text, style):
        Paragraph.__init__(self, text, style)
        self._key = key

    def draw(self):
        PAGE_MARKS[self._key] = self.canv.getPageNumber()
        Paragraph.draw(self)


H2_ORDER = []
CHAP_TITLES = {}


def H2(text):
    """Titre de niveau 2 qui mémorise son ordre, pour produire la table des matières."""
    H2_ORDER.append(text)
    return MarkParagraph(f"h{len(H2_ORDER)}", text, S["h2"])


# ------------------------------------------------------------------ styles
def st(name, **kw):
    base = dict(fontName="Helvetica", fontSize=10, leading=15,
                textColor=HexColor("#1A2B45"), alignment=TA_JUSTIFY,
                spaceAfter=6, spaceBefore=0)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
    "body": st("body"),
    "body_small": st("body_small", fontSize=9, leading=13.5),
    "h1": st("h1", fontName="Helvetica-Bold", fontSize=20, leading=24,
             textColor=NAVY, alignment=TA_LEFT, spaceBefore=14, spaceAfter=8),
    "h2": st("h2", fontName="Helvetica-Bold", fontSize=13, leading=17,
             textColor=NAVY2, alignment=TA_LEFT, spaceBefore=12, spaceAfter=6),
    "h3": st("h3", fontName="Helvetica-Bold", fontSize=11, leading=15,
             textColor=NAVY3, alignment=TA_LEFT, spaceBefore=10, spaceAfter=4),
    "bullet": st("bullet", alignment=TA_LEFT, leftIndent=14, bulletIndent=4,
                 spaceAfter=3),
    "caption": st("caption", fontSize=8, leading=11, textColor=GREY,
                  alignment=TA_CENTER, spaceBefore=3, spaceAfter=10),
    "toc1": st("toc1", fontName="Helvetica-Bold", fontSize=10.5, leading=16,
               textColor=NAVY, alignment=TA_LEFT, spaceAfter=2),
    "toc2": st("toc2", fontSize=9.5, leading=14, textColor=GREY,
               alignment=TA_LEFT, leftIndent=16, spaceAfter=1),
    "quote": st("quote", fontName="Helvetica-Oblique", fontSize=11, leading=16,
                textColor=NAVY2, alignment=TA_CENTER, spaceBefore=8, spaceAfter=8),
    "cell": st("cell", fontSize=8.5, leading=12, alignment=TA_LEFT, spaceAfter=0),
    "cell_b": st("cell_b", fontName="Helvetica-Bold", fontSize=8.5, leading=12,
                 alignment=TA_LEFT, spaceAfter=0),
    "cell_w": st("cell_w", fontName="Helvetica-Bold", fontSize=8.5, leading=12,
                 textColor=white, alignment=TA_LEFT, spaceAfter=0),
    "cell_c": st("cell_c", fontSize=8.5, leading=12, alignment=TA_CENTER, spaceAfter=0),
    "callout_t": st("callout_t", fontName="Helvetica-Bold", fontSize=9.5,
                    leading=13, textColor=NAVY, alignment=TA_LEFT, spaceAfter=3),
    "callout_b": st("callout_b", fontSize=9, leading=13.5, alignment=TA_LEFT,
                    spaceAfter=0),
    "cover_sub": st("cover_sub", fontName="Helvetica", fontSize=13, leading=18,
                    textColor=white, alignment=TA_CENTER),
    "cover_title": st("cover_title", fontName="Helvetica-Bold", fontSize=34,
                      leading=38, textColor=white, alignment=TA_CENTER),
    "cover_slogan": st("cover_slogan", fontName="Helvetica-Oblique", fontSize=11,
                       leading=15, textColor=GOLD_L, alignment=TA_CENTER),
}

# ------------------------------------------------------------------ helpers
def P(text, style="body"):
    return Paragraph(text, S[style])

def B(items, style="bullet"):
    return ListFlowable([ListItem(Paragraph(t, S[style]), leftIndent=14)
                         for t in items], bulletType="bullet", start="•",
                        leftIndent=14, bulletFontSize=8)

def NUM(items, style="bullet"):
    return ListFlowable([ListItem(Paragraph(t, S[style]), leftIndent=16)
                         for t in items], bulletType="1", leftIndent=16,
                        bulletFontSize=9)

def HR(color=GOLD, thickness=1.2, spaceAfter=8, spaceBefore=4):
    return HRFlowable(width="100%", thickness=thickness, color=color,
                      spaceAfter=spaceAfter, spaceBefore=spaceBefore)

def styled_table(header, rows, widths=None, align_center_cols=()):
    data = [[Paragraph(h, S["cell_w"]) for h in header]]
    for r in rows:
        row = []
        for j, c in enumerate(r):
            sty = "cell_c" if j in align_center_cols else "cell"
            row.append(Paragraph(str(c), S[sty]))
        data.append(row)
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, GREY_L),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, LIGHT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    t.setStyle(TableStyle(style))
    return t

def callout(title, body, bg=GOLD_BG, border=GOLD):
    inner = [[Paragraph(title, S["callout_t"])],
             [Paragraph(body, S["callout_b"])]]
    t = Table(inner, colWidths=[17 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.8, border),
        ("LINEBELOW", (0, 0), (-1, 0), 0.4, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t

def img(name, width_cm=16.5, caption=None):
    path = os.path.join(IMG, name)
    from PIL import Image as PILImage
    iw, ih = PILImage.open(path).size
    w = width_cm * cm
    h = w * ih / iw
    flows = [Image(path, width=w, height=h)]
    if caption:
        flows.append(Paragraph(caption, S["caption"]))
    return flows

def chapter_opener(num, title, subtitle, objectives):
    """Page d'ouverture de chapitre : bandeau navy + objectifs."""
    CHAP_TITLES[num] = title
    band_data = [[MarkParagraph(f"ch{num}", f"<font color='#E8C766' size=11>CHAPITRE {num}</font><br/>"
                            f"<font color='white' size=20><b>{title}</b></font><br/>"
                            f"<font color='#C9D6EA' size=10>{subtitle}</font>",
                            ParagraphStyle("band", fontName="Helvetica",
                                           leading=26, textColor=white))]]
    band = Table(band_data, colWidths=[17 * cm])
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 16),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ("TOPPADDING", (0, 0), (-1, -1), 16),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
        ("LINEBELOW", (0, 0), (-1, 0), 3, GOLD),
    ]))
    flows = [band, Spacer(1, 10)]
    flows.append(Paragraph("Objectifs pédagogiques — à la fin de ce chapitre, vous saurez :",
                           S["h3"]))
    flows.append(B(objectives))
    flows.append(Spacer(1, 4))
    return flows

def exercise_box(title, statement, correction):
    flows = [Paragraph(title, S["h3"])]
    flows.append(callout("Énoncé", statement, bg=LIGHT, border=NAVY3))
    flows.append(Spacer(1, 4))
    flows.append(callout("Correction détaillée", correction, bg=white, border=GREEN))
    return flows

# ------------------------------------------------------------------ page funcs
def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page == 1:
        canvas.restoreState()
        return
    # en-tête
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(0.8)
    canvas.line(2 * cm, PAGE_H - 1.4 * cm, PAGE_W - 2 * cm, PAGE_H - 1.4 * cm)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.setFillColor(NAVY)
    canvas.drawString(2 * cm, PAGE_H - 1.15 * cm, "GLOBAL TRADE ACADEMY")
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawRightString(PAGE_W - 2 * cm, PAGE_H - 1.15 * cm,
                           "Le guide complet de l'import-export")
    # pied de page
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(2 * cm, 1.2 * cm,
                      "Édition 2026 — Informations vérifiées le 15 novembre 2026")
    canvas.drawCentredString(PAGE_W / 2, 1.2 * cm, "")
    canvas.drawRightString(PAGE_W - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.restoreState()

def cover_page(canvas, doc):
    canvas.saveState()

    band_h = PAGE_H * 0.46

    # ---- fond : illustration au-dessus du bandeau ----
    img_path = os.path.join(IMG, "cover-art-a4.jpg")
    canvas.drawImage(img_path, 0, 0, width=PAGE_W, height=PAGE_H,
                     preserveAspectRatio=False, anchor="c", mask="auto")

    # ---- voile bleu nuit sur la moitié basse (lisibilité des textes) ----
    canvas.setFillColor(NAVY)
    try:
        canvas.setFillAlpha(0.93)
    except Exception:
        pass
    canvas.rect(0, 0, PAGE_W, band_h, stroke=0, fill=1)
    try:
        canvas.setFillAlpha(1)
    except Exception:
        pass

    # ---- dégradé simulé au-dessus du bandeau (transition douce) ----
    steps = 14
    grad_h = 2.2 * cm
    slice_h = grad_h / steps
    for i in range(steps):
        alpha = 0.93 * (1 - i / float(steps)) ** 1.8
        try:
            canvas.setFillAlpha(alpha)
        except Exception:
            pass
        canvas.setFillColor(NAVY)
        canvas.rect(0, band_h + i * slice_h, PAGE_W, slice_h + 1, stroke=0, fill=1)
    try:
        canvas.setFillAlpha(1)
    except Exception:
        pass

    # ---- liseré or de séparation ----
    canvas.setFillColor(GOLD)
    canvas.rect(0, band_h - 1.5, PAGE_W, 3, stroke=0, fill=1)

    cx = PAGE_W / 2

    # ---- sur-titre ----
    canvas.setFillColor(GOLD_L)
    canvas.setFont("Helvetica-Bold", 9.5)
    canvas.drawCentredString(cx, band_h - 1.35 * cm,
                             "GUIDE PROFESSIONNEL  •  IMPORT — EXPORT — LOGISTIQUE")

    # ---- titre ----
    canvas.setFillColor(white)
    canvas.setFont("Helvetica-Bold", 41)
    canvas.drawCentredString(cx, band_h - 2.75 * cm, "GLOBAL TRADE")
    canvas.drawCentredString(cx, band_h - 4.15 * cm, "ACADEMY")

    # ---- filet or sous le titre ----
    canvas.setFillColor(GOLD)
    canvas.rect(cx - 62, band_h - 4.75 * cm, 124, 2.5, stroke=0, fill=1)

    # ---- sous-titre ----
    canvas.setFillColor(white)
    canvas.setFont("Helvetica", 11.5)
    canvas.drawCentredString(cx, band_h - 5.55 * cm,
                             "Le guide complet pour comprendre, démarrer et développer")
    canvas.drawCentredString(cx, band_h - 6.15 * cm,
                             "une activité d'import-export.")

    # ---- slogan ----
    canvas.setFillColor(GOLD_L)
    canvas.setFont("Helvetica-Oblique", 9.5)
    canvas.drawCentredString(cx, band_h - 7.05 * cm,
                             "« Du premier fournisseur à la livraison finale,")
    canvas.drawCentredString(cx, band_h - 7.6 * cm,
                             "maîtrisez les étapes du commerce international. »")

    # ---- pastilles de contenu ----
    pills = ["12 CHAPITRES", "7 BONUS PRATIQUES", "EXERCICES CORRIGÉS", "MODÈLES DE DOCUMENTS"]
    total_w = 0
    widths = []
    canvas.setFont("Helvetica-Bold", 6.8)
    for t in pills:
        w = canvas.stringWidth(t, "Helvetica-Bold", 6.8) + 18
        widths.append(w)
        total_w += w
    gap = 6
    total_w += gap * (len(pills) - 1)
    x = cx - total_w / 2
    y = band_h - 8.75 * cm
    for t, w in zip(pills, widths):
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(0.6)
        try:
            canvas.roundRect(x, y, w, 0.52 * cm, 0.26 * cm, stroke=1, fill=0)
        except Exception:
            canvas.rect(x, y, w, 0.52 * cm, stroke=1, fill=0)
        canvas.setFillColor(GOLD_L)
        canvas.drawCentredString(x + w / 2, y + 0.18 * cm, t)
        x += w + gap

    # ---- bas de couverture ----
    canvas.setFillColor(white)
    canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(cx, 1.55 * cm,
                             "Édition 2026  •  Adapté au marché africain et au Bénin — utile partout dans le monde")
    canvas.setFillColor(GOLD)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.drawCentredString(cx, 1.05 * cm, "GLOBAL TRADE ACADEMY")

    canvas.restoreState()

# ------------------------------------------------------------------ build
def build():
    doc = SimpleDocTemplate(
        os.path.join(OUT, "Global-Trade-Academy.pdf"),
        pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2 * cm, bottomMargin=1.8 * cm,
        title="Global Trade Academy — Le guide complet de l'import-export",
        author="Global Trade Academy")
    H2_ORDER.clear()
    CHAP_TITLES.clear()
    # PAGE_MARKS n'est volontairement pas vidé : la 2e passe réutilise les pages
    # mesurées lors de la 1re passe pour afficher le sommaire paginé.
    story = []
    A = story.append

    # ================= COUVERTURE =================
    A(Spacer(1, 1))
    A(PageBreak())

    # ================= PAGE INTÉRIEURE / MENTIONS =================
    A(Paragraph("GLOBAL TRADE ACADEMY", S["h1"]))
    A(HR())
    A(P("<b>Sous-titre :</b> Le guide complet pour comprendre, démarrer et développer "
        "une activité d'import-export."))
    A(P("<b>Slogan :</b> <i>Du premier fournisseur à la livraison finale, maîtrisez les "
        "étapes du commerce international.</i>"))
    A(Spacer(1, 6))
    A(H2("Mentions et avertissement"))
    A(P("Ce guide est un <b>manuel de formation</b>. Il explique les concepts, les méthodes "
        "et les bonnes pratiques du commerce international. Il ne constitue <b>ni un conseil "
        "juridique, ni un conseil fiscal, ni un conseil douanier personnalisé</b>. Les règles "
        "douanières, fiscales et réglementaires évoluent fréquemment et diffèrent selon les pays "
        "et les produits. Avant chaque opération, vérifiez les informations en vigueur auprès des "
        "autorités compétentes (douanes, APIEx, chambres de commerce, transitaires agréés) et, si "
        "nécessaire, auprès d'un professionnel qualifié."))
    A(P("Les exemples chiffrés, les modèles de documents et les messages de négociation contenus "
        "dans ce guide sont <b>pédagogiques</b> : ils sont clairement identifiés comme exemples et "
        "ne doivent pas être présentés comme des documents officiels. Les montants utilisés dans "
        "les exercices sont fictifs et servent uniquement à illustrer les méthodes de calcul."))
    A(P("Les informations réglementaires ont été vérifiées le <b>15 novembre 2026</b> sur les "
        "sources officielles citées en bibliographie (OMC, OMD, CCI, Douane du Bénin, APIEx, "
        "Port autonome de Cotonou, CEDEAO, UEMOA, OHADA). Vérifiez systématiquement les mises à "
        "jour avant de vous engager."))
    A(Spacer(1, 6))
    A(H2("À qui s'adresse ce guide ?"))
    A(B(["Aux <b>débutants</b> qui veulent comprendre l'import-export de zéro.",
         "Aux <b>entrepreneurs et commerçants</b> qui veulent importer ou exporter.",
         "Aux <b>revendeurs et grossistes</b> qui veulent sécuriser leur chaîne d'approvisionnement.",
         "Aux <b>futurs importateurs et exportateurs</b> qui préparent leur première opération.",
         "Aux <b>PME</b> qui veulent développer une activité internationale durable."]))
    A(P("Le contenu est adapté au <b>marché africain, en particulier au Bénin</b>, tout en restant "
        "compréhensible et utile à un public international."))
    A(Spacer(1, 6))
    A(H2("Comment utiliser ce guide"))
    A(NUM(["<b>Lisez dans l'ordre</b> si vous débutez : chaque chapitre prépare le suivant.",
           "<b>Appliquez immédiatement</b> : chaque chapitre se termine par des exercices corrigés et une check-list.",
           "<b>Utilisez les bonus</b> comme outils de travail quotidiens (messages fournisseurs, calculs, documents).",
           "<b>Constituez votre dossier</b> au fil des chapitres : devis, échantillons, calculs, documents.",
           "<b>Vérifiez toujours</b> les informations réglementaires à la date de votre opération."]))
    A(PageBreak())

    # ================= SOMMAIRE =================
    A(Paragraph("Table des matières", S["h1"]))
    A(HR())
    toc = [
        ("Avant-propos — Pourquoi le commerce international ?", "avant"),
        ("CHAPITRE 1 — Comprendre le commerce international", "ch1"),
        ("CHAPITRE 2 — Choisir les bons produits", "ch2"),
        ("CHAPITRE 3 — Trouver des fournisseurs fiables", "ch3"),
        ("CHAPITRE 4 — Négocier avec les fournisseurs", "ch4"),
        ("CHAPITRE 5 — Acheter à l'international : Chine, Turquie, Europe, USA, Afrique", "ch5"),
        ("CHAPITRE 6 — Transport et logistique", "ch6"),
        ("CHAPITRE 7 — Maîtriser les Incoterms 2020", "ch7"),
        ("CHAPITRE 8 — Documents commerciaux et douaniers", "ch8"),
        ("CHAPITRE 9 — Douanes, taxes et réglementations (cas du Bénin)", "ch9"),
        ("CHAPITRE 10 — Calculer les coûts et les marges", "ch10"),
        ("CHAPITRE 11 — Sécuriser ses transactions", "ch11"),
        ("CHAPITRE 12 — Créer son entreprise d'import-export", "ch12"),
        ("Étude de cas intégrée — Une première importation de bout en bout", "cas"),
        ("BONUS 1 — 30 messages professionnels pour les fournisseurs", "b1"),
        ("BONUS 2 — Check-list de vérification d'un fournisseur", "b2"),
        ("BONUS 3 — Modèle de calcul du prix de revient", "b3"),
        ("BONUS 4 — Check-list des documents avant expédition", "b4"),
        ("BONUS 5 — Glossaire de 100 termes du commerce international", "b5"),
        ("BONUS 6 — Modèle de business plan import-export", "b6"),
        ("BONUS 7 — Guide de préparation d'une première importation", "b7"),
        ("Bibliographie et sources officielles", "biblio"),
        ("Annexe — Suivi de progression", "annexe"),
    ]
    for title, key in toc:
        pg = PAGE_MARKS.get(key)
        pg_txt = str(pg) if pg else "—"
        A(Paragraph(f"{title} <font color='#5A6B84'>— p. {pg_txt}</font>", S["toc2"]))
    A(Spacer(1, 8))
    A(callout("Convention de lecture",
              "Les encadrés <b>« À retenir »</b> résument l'essentiel. Les encadrés "
              "<b>« Exemple pratique »</b> montrent l'application concrète. Les encadrés "
              "<b>« Attention »</b> signalent les pièges. Les tableaux et infographies sont des "
              "outils de décision : apprenez à les lire avant chaque opération."))
    A(PageBreak())

    # ================= AVANT-PROPOS =================
    A(MarkParagraph("avant", "Avant-propos — Pourquoi le commerce international ?", S["h1"]))
    A(HR())
    A(P("Chaque jour, des milliards de dollars de marchandises traversent les frontières : des "
        "conteneurs quittent les usines de Chine et de Turquie, des avions-cargos décollent des "
        "hubs européens, des camions franchissent les corridors de l'Afrique de l'Ouest. Derrière "
        "chacun de ces flux se cache une chaîne d'acteurs — fournisseur, transitaire, transporteur, "
        "douanier, importateur — et une succession d'étapes qu'il faut maîtriser pour gagner de "
        "l'argent sans perdre sa marchandise ni son capital."))
    A(P("Le commerce international n'est pas réservé aux grandes multinationales. C'est un "
        "<b>terrain d'opportunité</b> pour les entrepreneurs, les commerçants et les PME, y compris "
        "en Afrique, où la demande de produits manufacturés, d'équipements, de textiles, d'électronique "
        "et de biens de consommation ne cesse de croître. Mais c'est aussi un terrain de <b>risques</b> : "
        "fournisseurs malhonnêtes, documents incomplets, coûts mal calculés, douanes bloquantes. La "
        "différence entre une première importation réussie et un échec coûteux tient presque toujours "
        "à la <b>méthode</b>."))
    A(P("<b>Global Trade Academy</b> est né de ce constat. Ce guide vous donne, étape par étape, "
        "tout ce qu'il faut savoir pour passer du premier fournisseur à la livraison finale : choisir "
        "un produit, trouver et vérifier un fournisseur, négocier, organiser le transport, maîtriser "
        "les Incoterms, préparer les documents, dédouaner, calculer vos marges, sécuriser vos paiements "
        "et, enfin, structurer votre entreprise."))
    for f in img("illustration-globe.jpg", 15,
                 "Figure 0 — Le commerce international connecte les marchés : chaque route commerciale suppose une chaîne logistique maîtrisée."):
        A(f)
    A(H2("Ce que ce guide n'est pas"))
    A(B(["Un résumé d'internet : chaque chapitre explique les concepts, donne des exemples réalistes, "
         "des tableaux, des schémas et des applications pratiques.",
         "Un recueil de taux douaniers : les taux changent et varient selon les produits et les pays. "
         "Vous apprendrez <b>comment les vérifier</b> sur les sources officielles.",
         "Un substitut de professionnel : pour vos opérations réelles, travaillez avec un transitaire "
         "agréé et, si besoin, un juriste ou un comptable."]))
    A(H2("La promesse de Global Trade Academy"))
    A(P("À la fin de ce guide, vous serez capable de préparer et de gérer une véritable opération "
        "commerciale internationale de bout en bout, avec des outils concrets : modèles de messages, "
        "check-lists, tableaux de calcul, modèles de documents et plan de lancement. C'est un manuel "
        "de formation autonome, progressif et extrêmement pratique."))
    A(callout("À retenir",
              "Le commerce international se maîtrise par la <b>méthode</b>, pas par la chance. "
              "Chaque chapitre de ce guide correspond à une étape réelle de votre première opération. "
              "Suivez-les dans l'ordre, appliquez les check-lists, et ne payez jamais avant d'avoir "
              "sécurisé l'étape précédente."))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 1
    # ================================================================
    for f in chapter_opener(1, "Comprendre le commerce international",
                            "Définitions, acteurs, chaîne commerciale, avantages, contraintes et risques",
                            ["Définir l'importation et l'exportation et les distinguer.",
                             "Identifier le rôle de chaque acteur : importateur, exportateur, grossiste, distributeur, transitaire.",
                             "Décrire la chaîne commerciale internationale de bout en bout.",
                             "Évaluer les avantages, contraintes et risques du commerce international."]):
        A(f)
    A(H2("1.1 Définitions fondamentales"))
    A(P("<b>L'importation</b> est l'entrée de marchandises sur le territoire d'un pays en provenance "
        "d'un autre pays, pour y être vendues, transformées ou réexportées. L'importateur est la "
        "personne (physique ou morale) qui fait entrer la marchandise et qui en est responsable "
        "vis-à-vis de la douane. <b>L'exportation</b> est la sortie de marchandises d'un pays vers "
        "un autre. L'exportateur est responsable de la conformité et des documents d'exportation."))
    A(P("On parle aussi de <b>commerce extérieur</b> pour l'ensemble des échanges d'un pays avec "
        "l'étranger, et de <b>balance commerciale</b> pour la différence entre exportations et "
        "importations. Un pays qui importe plus qu'il n'exporte a une balance déficitaire ; l'inverse "
        "est une balance excédentaire. Ces notions macroéconomiques ont une traduction très concrète "
        "pour vous : elles expliquent les politiques douanières, les accords commerciaux et les "
        "opportunités de marché."))
    A(styled_table(["Notion", "Définition", "Exemple"],
                   [["Importation", "Entrée de marchandises en provenance de l'étranger",
                     "Des textiles achetés en Turquie et dédouanés à Cotonou"],
                    ["Exportation", "Sortie de marchandises vers l'étranger",
                     "Du coton béninois expédié vers l'Europe"],
                    ["Réexportation", "Réexpédition vers un pays tiers après entrée temporaire",
                     "Des marchandises en transit via le port de Cotonou vers le Niger"],
                    ["Transit", "Passage de marchandises sous contrôle douanier sans mise à la consommation",
                     "Un conteneur traversant le Bénin vers le Burkina Faso"]],
                   widths=[3.2 * cm, 7 * cm, 6.8 * cm]))
    A(Spacer(1, 4))
    A(H2("1.2 Les acteurs du commerce international"))
    A(P("Confondre les rôles est la première erreur du débutant. Chaque acteur a une fonction "
        "précise, une responsabilité et une rémunération propres."))
    A(styled_table(["Acteur", "Rôle", "Ce qu'il fait concrètement"],
                   [["<b>Importateur</b>", "Achète à l'étranger pour vendre sur le marché national",
                     "Sélectionne le produit, négocie, paie, dédouane, stocke, vend"],
                    ["<b>Exportateur</b>", "Vend à l'étranger des produits nationaux ou réexportés",
                     "Prospecte, produit ou achète, documente, expédie, encaisse"],
                    ["<b>Grossiste</b>", "Achète en gros pour revendre aux détaillants",
                     "Constitue des stocks, fractionne les lots, accorde des délais de paiement"],
                    ["<b>Distributeur</b>", "Assure la distribution d'une marque sur un territoire",
                     "Développe le réseau de vente, gère la logistique locale, promeut la marque"],
                    ["<b>Transitaire</b>", "Intermédiaire qui organise les formalités et le transport",
                     "Dédouane, coordonne le transport, conseille sur les documents (agréé en douane)"],
                    ["<b>Transporteur</b>", "Achemine physiquement la marchandise",
                     "Exécute le transport maritime, aérien ou routier contre rémunération"],
                    ["<b>Commissionnaire</b>", "Agit pour le compte d'un client moyennant commission",
                     "Négocie, achète ou vend sans être propriétaire de la marchandise"]],
                   widths=[3.2 * cm, 6.5 * cm, 7.3 * cm]))
    A(Spacer(1, 4))
    A(P("Point crucial : le <b>transitaire</b> n'est ni un fournisseur ni un transporteur. Il est "
        "votre <b>facilitateur douanier et logistique</b>. Choisissez-le avec autant de soin que votre "
        "fournisseur : un bon transitaire vous fait gagner du temps et de l'argent ; un mauvais vous "
        "coûte des pénalités et des retards. Vérifiez son agrément et sa réputation (voir chapitre 6)."))
    A(H2("1.3 La chaîne commerciale internationale"))
    A(P("Une opération d'import-export est une <b>chaîne</b> : chaque maillon dépend du précédent. "
        "La rupture d'un seul maillon — un document manquant, un paiement mal sécurisé, un contrôle "
        "qualité bâclé — peut bloquer toute la chaîne."))
    for f in img("infographie-processus.png", 16.5,
                 "Figure 1 — Les huit étapes d'une importation réussie, du fournisseur à la vente."):
        A(f)
    A(NUM(["<b>Fournisseur</b> : fabrication ou mise à disposition de la marchandise.",
           "<b>Négociation et devis</b> : prix, quantités, délais, qualité, Incoterm.",
           "<b>Commande et paiement</b> : contrat, acompte sécurisé, production.",
           "<b>Contrôle qualité</b> : vérification avant expédition (échantillon, inspection).",
           "<b>Expédition et transport</b> : choix du mode, réservation, assurance, suivi.",
           "<b>Dédouanement</b> : déclaration, liquidation des droits et taxes, contrôle.",
           "<b>Livraison et réception</b> : enlèvement, transport intérieur, vérification à l'arrivée.",
           "<b>Vente et marge</b> : fixation du prix de vente, encaissement, réinvestissement."]))
    A(H2("1.4 Les grandes routes commerciales et la place de l'Afrique"))
    A(P("Le commerce international s'organise autour de <b>grandes routes</b> : routes maritimes "
        "Asie–Europe–Afrique, routes transatlantiques, corridors régionaux africains. Pour "
        "l'importateur ouest-africain, les corridors les plus pertinents sont :"))
    A(styled_table(["Corridor", "Origines principales", "Mode dominant", "Port / point d'entrée"],
                   [["Asie → Afrique de l'Ouest", "Chine, Inde, Asie du Sud-Est", "Maritime (conteneurs)",
                     "Cotonou, Lomé, Tema, Abidjan"],
                    ["Europe → Afrique de l'Ouest", "France, Belgique, Espagne, Pays-Bas", "Maritime + aérien",
                     "Cotonou, Abidjan, Dakar"],
                    ["Turquie → Afrique de l'Ouest", "Istanbul, Mersin", "Maritime + aérien",
                     "Cotonou, Tema, Abidjan"],
                    ["Afrique → Afrique (intra-africain)", "Nigeria, Ghana, Côte d'Ivoire, Maroc", "Routier + maritime",
                     "Corridors CEDEAO, ZLECAf"],
                    ["Amériques → Afrique", "USA, Brésil", "Maritime + aérien",
                     "Cotonou, Abidjan"]],
                   widths=[4.5 * cm, 4.5 * cm, 3.5 * cm, 4.5 * cm]))
    A(Spacer(1, 4))
    A(P("Le <b>Port autonome de Cotonou (PAC)</b> est le principal port du Bénin et un hub pour les "
        "pays enclavés voisins. Sa position sur la côte du golfe de Guinée, reliée par des corridors "
        "routiers vers le Niger, le Burkina Faso, le Mali et le Tchad, en fait un point d'entrée "
        "stratégique pour les importations destinées à toute la sous-région. Comprendre ces routes, "
        "c'est comprendre les délais, les coûts et les opportunités de votre future activité."))
    A(H2("1.5 Avantages, contraintes et risques"))
    A(styled_table(["Dimension", "Avantages", "Contraintes / risques"],
                   [["<b>Commercial</b>", "Accès à des produits indisponibles localement ; prix d'achat souvent plus bas ; diversité de l'offre",
                     "Concurrence internationale ; volatilité des prix ; dépendance aux fournisseurs étrangers"],
                    ["<b>Financier</b>", "Marges potentiellement élevées ; effet de volume ; accès à de nouveaux marchés",
                     "Avances de trésorerie ; taux de change ; délais de paiement ; risque d'arnaque"],
                    ["<b>Logistique</b>", "Chaînes éprouvées (ports, compagnies maritimes, transitaires)",
                     "Délais longs en maritime ; risques de casse, vol, retard ; coûts de stockage"],
                    ["<b>Réglementaire</b>", "Accords commerciaux et zones de libre-échange (CEDEAO, ZLECAf)",
                     "Douanes, normes, autorisations ; changements fréquents de règles ; sanctions en cas de non-conformité"]],
                   widths=[2.8 * cm, 7.1 * cm, 7.1 * cm]))
    A(Spacer(1, 4))
    A(H2("1.6 Les erreurs les plus fréquentes des débutants"))
    A(styled_table(["Erreur", "Conséquence", "Correctif (chapitre)"],
                   [["Choisir un produit sans étudier la demande", "Stock invendu, capital immobilisé", "Chap. 2 : étude de demande"],
                    ["Payer un fournisseur non vérifié", "Arnaque, non-livraison", "Chap. 3 et 11 : vérifications"],
                    ["Négocier avant de comparer", "Prix surpayé, marge réduite", "Chap. 4 : comparer puis négocier"],
                    ["Oublier des coûts dans le prix de revient", "Marge négative surprise", "Chap. 10 : calcul complet"],
                    ["Dossier documentaire incomplet", "Blocage en douane, surestaries", "Chap. 8 : check-list Bonus 4"],
                    ["Choisir le mauvais Incoterm", "Risque et coûts mal répartis", "Chap. 7 : Incoterms 2020"],
                    ["Commander sans échantillon", "Qualité non conforme à l'arrivée", "Chap. 3 : échantillon obligatoire"]],
                   widths=[5.5 * cm, 5.5 * cm, 6 * cm]))
    A(Spacer(1, 4))
    A(callout("Attention — les trois risques majeurs du débutant",
              "<b>1. Le risque fournisseur</b> (arnaque, non-livraison, mauvaise qualité). "
              "<b>2. Le risque documentaire</b> (dossier incomplet, incohérences, blocage en douane). "
              "<b>3. Le risque de calcul</b> (prix de revient sous-estimé, marge négative). "
              "Les chapitres 3, 8 et 10 sont entièrement consacrés à ces trois risques."))
    for f in exercise_box("Exercice 1.1 — Identifier les acteurs",
            "Vous achetez des chaussures à un fabricant chinois, un transitaire les dédouane à "
            "Cotonou, vous les vendez à des boutiques de détail. Qui est l'importateur ? Qui est le "
            "grossiste ? Quel est le rôle du transitaire ?",
            "Vous êtes l'<b>importateur</b> (vous faites entrer la marchandise et la vendez sur le "
            "marché national). Vous agissez aussi comme <b>grossiste</b> si vous vendez en gros aux "
            "boutiques. Le <b>transitaire</b> organise le dédouanement et coordonne le transport pour "
            "votre compte : il ne devient pas propriétaire de la marchandise."):
        A(f)
    A(Paragraph("Ce qu'il faut retenir du chapitre 1", S["h3"]))
    A(B(["L'importation fait entrer des marchandises, l'exportation les fait sortir : deux fonctions, deux logiques de rentabilité.", 'Cinq acteurs à distinguer : importateur, exportateur, grossiste, distributeur, transitaire.', 'La chaîne commerciale se maîtrise étape par étape : produit, fournisseur, transport, douane, livraison.', 'Les avantages (marge, offre élargie) viennent toujours avec des contraintes (trésorerie, délais) et des risques (arnaque, douane, logistique).']))
    A(Paragraph("Check-list du chapitre 1", S["h3"]))
    A(B(["Je sais définir importation, exportation, réexportation et transit.",
         "Je distingue importateur, exportateur, grossiste, distributeur, transitaire, transporteur.",
         "Je peux décrire les 8 étapes d'une importation dans l'ordre.",
         "Je connais les 3 risques majeurs et les chapitres qui les traitent."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 2
    # ================================================================
    for f in chapter_opener(2, "Choisir les bons produits",
                            "Étude de la demande, concurrence, marges, restrictions et budgets",
                            ["Étudier la demande avant de choisir un produit.",
                             "Identifier les produits recherchés sur un marché donné.",
                             "Analyser la concurrence et évaluer les marges potentielles.",
                             "Connaître les restrictions applicables aux marchandises.",
                             "Adapter son choix à différents budgets de démarrage."]):
        A(f)
    A(H2("2.1 La règle d'or : on ne choisit pas un produit, on choisit un marché"))
    A(P("Le débutant commence par le produit (« je vais importer des montres »). Le professionnel "
        "commence par le <b>marché</b> (« qui achète quoi, à quel prix, en quelle quantité, et avec "
        "quelle concurrence ? »). Un bon produit est un produit pour lequel il existe une <b>demande "
        "prouvée, une marge suffisante et une réglementation maîtrisable</b>. Tout le reste est secondaire."))
    A(H2("2.2 Étudier la demande"))
    A(P("La demande s'étudie sur le terrain, pas seulement sur internet. Combinez quatre sources :"))
    A(NUM(["<b>Observation directe</b> : visitez les marchés, les boutiques, les supermarchés. "
           "Qu'est-ce qui se vend ? Qu'est-ce qui manque ? Quels sont les prix pratiqués ?",
           "<b>Enquêtes clients</b> : interrogez 20 à 30 acheteurs potentiels. Que recherchent-ils ? "
           "À quel prix achèteraient-ils ? Quelle qualité attendent-ils ?",
           "<b>Analyse des ventes existantes</b> : identifiez les produits qui tournent vite chez les "
           "commerçants établis. La rotation rapide signale une demande réelle.",
           "<b>Sources statistiques</b> : statistiques douanières, rapports de la chambre de commerce, "
           "études de l'APIEx, données de l'OMC. Elles donnent les grandes tendances, pas les prix de détail."]))
    A(callout("Exemple pratique — étude de demande express",
              "Avant d'importer des ustensiles de cuisine, visitez 10 boutiques à Cotonou : notez les "
              "prix, les marques, les ruptures de stock. Interrogez 15 clients. Si 12 sur 15 achètent "
              "déjà ces produits et se plaignent des prix ou de la qualité, la demande est prouvée. "
              "Si personne ne connaît le produit, il faudra créer la demande — beaucoup plus coûteux."))
    A(H2("2.3 Identifier les produits recherchés"))
    A(P("Les produits recherchés partagent généralement quatre caractéristiques : <b>utilité "
        "quotidienne</b> (consommation répétée), <b>rapport qualité-prix perçu</b> favorable, "
        "<b>disponibilité insuffisante en local</b> (d'où l'intérêt de l'import) et <b>facilité "
        "logistique</b> (léger, non fragile, non périssable pour débuter). À l'inverse, évitez pour "
        "votre première importation les produits périssables, fragiles, volumineux ou réglementés "
        "sans autorisation."))
    A(styled_table(["Catégorie", "Exemples de produits recherchés", "Points de vigilance"],
                   [["Électronique & accessoires", "Chargeurs, écouteurs, câbles, petits appareils",
                     "Normes électriques, contrefaçon, garantie"],
                    ["Textile & habillement", "Vêtements, chaussures, sacs, accessoires",
                     "Tailles, saisonnalité, qualité des finitions"],
                    ["Maison & cuisine", "Ustensiles, petit électroménager, décoration",
                     "Fragilité, normes alimentaires pour le contact"],
                    ["Beauté & soins", "Cosmétiques, parfums, soins capillaires",
                     "Réglementation sanitaire, étiquetage, contrefaçon"],
                    ["Équipement & outillage", "Outils, quincaillerie, pièces détachées",
                     "Poids, normes de sécurité, service après-vente"]],
                   widths=[4 * cm, 6.5 * cm, 6.5 * cm]))
    A(Spacer(1, 4))
    A(P("Ces exemples sont <b>illustratifs</b>. La pertinence d'un produit dépend de votre marché "
        "local, de votre budget et de vos fournisseurs. Ne copiez pas une liste : construisez la "
        "vôtre à partir de votre étude de demande."))
    A(H2("2.4 Analyser la concurrence"))
    A(P("Pour chaque produit envisagé, dressez une <b>fiche concurrentielle</b> : qui vend déjà ce "
        "produit ? À quel prix ? Quelle qualité ? Quelle origine ? Quels sont leurs points faibles "
        "(prix élevés, qualité irrégulière, ruptures de stock) ? Votre opportunité se situe dans "
        "l'écart entre le prix du marché et votre prix de revient complet (chapitre 10)."))
    A(styled_table(["Critère", "Concurrent A", "Concurrent B", "Votre projet"],
                   [["Prix de vente moyen", "À relever sur le terrain", "À relever sur le terrain", "À calculer (chap. 10)"],
                    ["Origine / qualité perçue", "À noter", "À noter", "À définir (échantillon)"],
                    ["Disponibilité", "Ruptures fréquentes ?", "Stable ?", "Objectif : stable"],
                    ["Point faible exploitable", "Prix élevé", "Qualité moyenne", "Votre positionnement"]],
                   widths=[4.5 * cm, 4.2 * cm, 4.2 * cm, 4.1 * cm]))
    A(Spacer(1, 4))
    A(H2("2.5 Évaluer les marges potentielles"))
    A(P("La marge potentielle se calcule <b>avant</b> de contacter le fournisseur : prix de vente "
        "observé sur le marché moins estimation du prix de revient complet. Si l'écart est inférieur "
        "à 25-30 % du prix de vente, le produit est probablement trop risqué pour débuter (les "
        "imprévus logistiques et douaniers absorberont la marge). Le calcul détaillé est développé "
        "au chapitre 10 ; ici, retenez la méthode : <b>ne jamais choisir un produit sans une "
        "estimation chiffrée de sa marge</b>."))
    A(H2("2.6 Restrictions et autorisations"))
    A(P("Certaines marchandises sont <b>interdites, restreintes ou soumises à autorisation</b> : "
        "armes, stupéfiants, espèces protégées, médicaments, produits alimentaires, cosmétiques, "
        "produits chimiques, contrefaçons, etc. Les règles varient selon les pays et évoluent. Avant "
        "de choisir un produit, vérifiez : (1) s'il est autorisé à l'importation dans votre pays, "
        "(2) s'il requiert une autorisation, un certificat ou une norme, (3) s'il est soumis à des "
        "droits élevés. Les sources : douane nationale, APIEx, ministères sectoriels, OMD. "
        "<b>En cas de doute, demandez une attestation écrite à votre transitaire avant de commander.</b>"))
    A(H2("2.7 Matrice de sélection des produits"))
    A(P("Pour comparer objectivement plusieurs produits, notez chacun sur 5 critères (de 1 à 5) et "
        "additionnez. Le produit au score le plus élevé est votre meilleur candidat de départ."))
    A(styled_table(["Critère (1 à 5)", "Question à se poser", "Poids"],
                   [["Demande prouvée", "Le produit se vend-il déjà sur mon marché ?", "× 3"],
                    ["Marge potentielle", "L'écart prix de vente / prix de revient est-il suffisant ?", "× 3"],
                    ["Concurrence battable", "Puis-je me différencier (prix, qualité, disponibilité) ?", "× 2"],
                    ["Simplicité logistique", "Produit léger, non fragile, non périssable ?", "× 2"],
                    ["Réglementation maîtrisable", "Pas d'autorisation complexe requise ?", "× 2"],
                    ["<b>Total pondéré</b>", "<b>Score = somme (note × poids). Retenez le produit le plus élevé.</b>", ""]],
                   widths=[4.5 * cm, 9 * cm, 3.5 * cm]))
    A(Spacer(1, 4))
    A(callout("Exemple pratique — matrice remplie (pédagogique)",
              "Produit A (accessoires téléphone) : demande 5, marge 4, concurrence 3, logistique 5, "
              "réglementation 5 → score = 15+12+6+10+10 = <b>53</b>. Produit B (cosmétiques) : "
              "demande 4, marge 4, concurrence 3, logistique 3, réglementation 2 → score = "
              "12+12+6+6+4 = <b>40</b>. Le produit A est le meilleur choix de départ : demande "
              "forte, logistique simple, réglementation légère."))
    A(H2("2.8 Choisir selon son budget"))
    A(styled_table(["Budget de démarrage", "Stratégie recommandée", "Produits adaptés"],
                   [["Faible (test)", "Petits lots, aérien ou groupage, 1 seul produit",
                     "Accessoires légers, petits articles à forte rotation"],
                    ["Moyen", "1 conteneur partagé ou groupage maritime, 2-3 produits",
                     "Textile, maison, électronique grand public"],
                    ["Élevé", "Conteneur complet, gamme structurée, stock de sécurité",
                     "Gammes complètes, marques propres, distribution"]],
                   widths=[3.5 * cm, 6.5 * cm, 7 * cm]))
    A(Spacer(1, 4))
    A(P("Dans tous les cas, conservez une <b>réserve de trésorerie</b> pour les frais imprévus "
        "(stockage, contrôles, transport intérieur) : 15 à 20 % du budget total est une règle de "
        "prudence pour une première importation."))
    for f in exercise_box("Exercice 2.1 — Choisir un produit",
            "Vous disposez d'un budget moyen. Listez 3 produits potentiels, puis pour chacun : "
            "(a) demande observée, (b) prix de vente moyen relevé, (c) concurrence, (d) restrictions "
            "connues, (e) marge potentielle estimée. Classez-les et justifiez votre premier choix.",
            "Méthode attendue : pour chaque produit, remplissez la fiche concurrentielle (2.4) et "
            "une estimation de marge (2.5). Écartez tout produit réglementé sans autorisation, tout "
            "produit fragile/périssable pour une première fois, et tout produit dont la marge "
            "estimée est inférieure à 25 %. Le produit retenu doit combiner demande prouvée, "
            "concurrence battable et logistique simple."):
        A(f)
    for f in exercise_box("Exercice 2.2 — Estimer la demande sans budget",
            "Vous voulez vendre des ventilateurs rechargeables. Proposez un test de demande "
            "réalisable en 3 semaines avec moins de 100 000 FCFA, et indiquez les 3 résultats "
            "qui vous feraient renoncer au produit.",
            "Piste attendue : achat d'un lot de test (10 à 20 unités) auprès d'un revendeur local "
            "ou en groupage, vente sur 2 à 3 semaines à votre prix cible, mesure du délai "
            "d'écoulement et du taux de refus. Signaux d'abandon : plus de 50 % du lot invendu à "
            "3 semaines, refus répétés sur le prix, saisonnalité défavorable (saison des pluies "
            "pour un ventilateur), ou absence de fournisseur capable de réassort régulier."):
        A(f)
    A(H2("2.9 Les sources d'information à surveiller"))
    A(styled_table(["Source", "Ce qu'on y trouve", "Fréquence utile"],
                   [["Points de vente et marchés", "Prix réels, ruptures, produits demandés", "Mensuelle"],
                    ["Groupes et réseaux sociaux professionnels", "Tendances, plaintes clients, produits émergents", "Hebdomadaire"],
                    ["Plateformes B2B (catalogues et best-sellers)", "Nouveautés, prix de gros, MOQ", "Mensuelle"],
                    ["Chambres de commerce et organismes de promotion", "Salons, missions, informations réglementaires", "Trimestrielle"],
                    ["Sources officielles (douane, normes)", "Restrictions, certificats, évolutions tarifaires", "Avant chaque opération"]],
                   widths=[5.5 * cm, 7.5 * cm, 4 * cm]))
    A(Spacer(1, 4))
    A(Paragraph("Ce qu'il faut retenir du chapitre 2", S["h3"]))
    A(B(['On ne choisit pas un produit par intuition : on le choisit par preuve de demande.', 'La marge potentielle se calcule avant le premier contact fournisseur.', 'Les restrictions (normes, autorisations) éliminent certains produits dès le départ.', 'La matrice pondérée (demande, marge, concurrence, logistique, réglementation) rend le choix objectif.']))
    A(Paragraph("Check-list du chapitre 2", S["h3"]))
    A(B(["J'ai étudié la demande sur le terrain (observation + entretiens).",
         "J'ai relevé les prix de vente et dressé une fiche concurrentielle.",
         "J'ai estimé la marge potentielle avant tout contact fournisseur.",
         "J'ai vérifié les restrictions et autorisations du produit choisi.",
         "Mon choix est adapté à mon budget, avec une réserve de 15-20 %."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 3
    # ================================================================
    for f in chapter_opener(3, "Trouver des fournisseurs fiables",
                            "Plateformes, vérification, échantillons, comparaison et signaux d'arnaque",
                            ["Rechercher des fabricants et grossistes sur les bonnes plateformes.",
                             "Contacter directement les fournisseurs de manière professionnelle.",
                             "Vérifier leur identité et leur réputation avant tout paiement.",
                             "Demander et évaluer des échantillons.",
                             "Comparer plusieurs offres et reconnaître les signaux d'arnaque."]):
        A(f)
    A(H2("3.1 Où chercher ? Les plateformes de mise en relation"))
    A(P("Les plateformes B2B (business to business) permettent de trouver des fabricants et des "
        "grossistes dans le monde entier. Les plus utilisées par les importateurs africains sont :"))
    A(styled_table(["Plateforme", "Spécialité", "Points forts / vigilance"],
                   [["<b>Alibaba.com</b>", "Généraliste, très vaste offre chinoise",
                     "Volume énorme ; vigilance sur les faux fournisseurs et les intermédiaires"],
                    ["<b>Made-in-China.com</b>", "Produits industriels et manufacturés chinois",
                     "Fournisseurs vérifiés possibles ; comparer les devis"],
                    ["<b>Global Sources</b>", "Électronique, textile, biens de consommation",
                     "Sélection plus qualitative ; salons physiques associés"],
                    ["<b>DHgate / AliExpress (gros)</b>", "Petits lots, échantillons",
                     "Utile pour tester ; coûts unitaires plus élevés"],
                    ["<b>Annuaire officiel / chambres</b>", "Fabricants vérifiés par pays",
                     "Sources plus fiables ; moins de choix"],
                    ["<b>Réseaux et salons</b>", "Rencontres physiques (Canton Fair, etc.)",
                     "Vérification directe ; coût de déplacement"]],
                   widths=[4 * cm, 5.5 * cm, 7.5 * cm]))
    A(Spacer(1, 4))
    A(P("Règle d'or : <b>ne travaillez jamais avec un seul fournisseur</b>. Prospectez au moins "
        "5 à 10 fournisseurs, demandez des devis à 3 à 5 d'entre eux, et comparez. La comparaison "
        "est votre meilleur outil de négociation et de détection d'arnaque."))
    A(H2("3.2 Contacter directement les fournisseurs"))
    A(P("Le premier message doit être <b>professionnel, précis et en anglais</b> (langue du commerce "
        "international). Indiquez : le produit exact (avec références/photos), la quantité visée, "
        "le port de destination, et demandez un devis complet. Les modèles de messages sont fournis "
        "au chapitre 4 et dans le Bonus 1."))
    A(P("Méfiez-vous des <b>intermédiaires</b> qui se présentent comme fabricants : ils ajoutent "
        "une marge sans valeur ajoutée et compliquent le suivi qualité. Demandez systématiquement : "
        "licence commerciale, adresse d'usine, nombre d'employés, certifications, références clients. "
        "Un vrai fabricant répond sans difficulté ; un intermédiaire esquive."))
    A(H2("3.3 Vérifier l'identité et la réputation"))
    A(P("Avant tout paiement, vérifiez :"))
    A(B(["<b>Identité</b> : raison sociale, licence commerciale, adresse, site web, ancienneté.",
         "<b>Réputation</b> : avis vérifiés, années d'activité sur la plateforme, badges « verified ».",
         "<b>Cohérence</b> : le compte bancaire est-il au nom de l'entreprise ? Les coordonnées "
         "correspondent-elles aux documents ?",
         "<b>Références</b> : demandez des références clients et, si possible, contactez-les.",
         "<b>Visite / inspection</b> : pour les gros volumes, envisagez une inspection tierce "
         "(sociétés d'inspection internationales) avant expédition."]))
    A(P("Le Bonus 2 fournit une <b>check-list de vérification en 20 points</b> à appliquer à chaque "
        "nouveau fournisseur, sans exception."))
    A(H2("3.4 Demander des échantillons"))
    A(P("L'échantillon est <b>non négociable</b> : ne commandez jamais en gros sans avoir reçu, "
        "examiné et testé un échantillon. Payez les frais d'envoi de l'échantillon (souvent par "
        "courier express), vérifiez : conformité au produit commandé, qualité des finitions, "
        "emballage, étiquetage, poids et dimensions réels. Photographiez tout et comparez avec le "
        "devis. Si l'échantillon ne correspond pas, ne commandez pas — ou exigez une correction "
        "écrite avant production."))
    A(callout("Exemple pratique — fiche d'évaluation d'échantillon",
              "Notez sur 10 : conformité au cahier des charges, finitions, emballage, étiquetage, "
              "rapport qualité-prix. En dessous de 7/10, changez de fournisseur ou négociez une "
              "amélioration écrite. Conservez l'échantillon comme <b>référence qualité</b> pour "
              "contrôler la production finale."))
    A(H2("3.5 Comparer plusieurs offres"))
    A(P("Comparez les offres sur une <b>grille identique</b> : prix unitaire à quantité égale, "
        "MOQ (quantité minimale), délai de production, délai d'expédition, emballage, Incoterm "
        "proposé, conditions de paiement, garantie. Un prix anormalement bas est un signal d'alerte, "
        "pas une opportunité : il cache souvent une qualité inférieure, des frais cachés ou une arnaque."))
    A(H2("3.6 Fiche de comparaison des offres"))
    A(P("Remplissez une fiche identique pour chaque fournisseur. C'est elle qui rend les offres "
        "comparables et la négociation efficace."))
    A(styled_table(["Critère", "Fournisseur 1", "Fournisseur 2", "Fournisseur 3"],
                   [["Prix unitaire (à quantité égale)", "", "", ""],
                    ["MOQ", "", "", ""],
                    ["Délai de production", "", "", ""],
                    ["Emballage / poids / dimensions", "", "", ""],
                    ["Incoterm proposé", "", "", ""],
                    ["Conditions de paiement", "", "", ""],
                    ["Échantillon (note /10)", "", "", ""],
                    ["Réputation / ancienneté", "", "", ""],
                    ["<b>Décision</b>", "", "", ""]],
                   widths=[5.5 * cm, 3.8 * cm, 3.8 * cm, 3.9 * cm]))
    A(Spacer(1, 4))
    A(H2("3.7 Identifier les signaux d'arnaque"))
    A(styled_table(["Signal d'alerte", "Pourquoi c'est suspect", "Que faire"],
                   [["Prix 30-50 % inférieur au marché", "Qualité dégradée ou non-livraison",
                     "Exiger échantillon + vérification renforcée"],
                    ["Pression pour payer vite (100 % d'avance)", "Tentative d'escroquerie",
                     "Refuser ; proposer acompte + paiement sécurisé"],
                    ["Coordonnées bancaires personnelles", "Incohérence avec l'entreprise",
                     "Exiger un compte au nom de la société"],
                    ["Refus d'envoyer la licence / l'adresse", "Identité invérifiable",
                     "Abandonner le fournisseur"],
                    ["Communication uniquement par messagerie non pro",
                     "Traçabilité faible", "Exiger e-mails professionnels et documents"],
                    ["Offre « trop belle » sans échantillon", "Arnaque classique",
                     "Ne jamais payer sans échantillon testé"]],
                   widths=[5 * cm, 5.5 * cm, 6.5 * cm]))
    A(Spacer(1, 4))
    A(callout("Attention — la règle des trois vérifications",
              "Ne payez que si <b>trois vérifications</b> sont réussies : (1) identité et réputation "
              "vérifiées, (2) échantillon reçu et conforme, (3) devis écrit comparé à au moins deux "
              "autres offres. Si l'une manque, <b>ne payez pas</b>."))
    for f in exercise_box("Exercice 3.1 — Évaluer un fournisseur",
            "Un fournisseur vous propose un prix 40 % inférieur aux autres, exige 100 % d'avance par "
            "transfert et refuse l'envoi de sa licence. Décidez : commandez-vous ? Justifiez en "
            "citant les signaux d'arnaque.",
            "Non. Quatre signaux d'alerte cumulés : prix anormalement bas, paiement intégral "
            "d'avance, coordonnées à vérifier, refus de licence. Appliquez la règle des trois "
            "vérifications : aucune n'est satisfaite. Abandonnez et poursuivez la prospection."):
        A(f)
    A(H2("3.8 Évaluer un échantillon : la grille de notation"))
    A(P("Un échantillon ne se juge pas « au feeling ». Notez chaque critère de 1 à 5 et comparez "
        "les fournisseurs sur la même base. Un échantillon médiocre annonce une production "
        "médiocre : c'est le moment le moins coûteux pour changer de fournisseur."))
    A(styled_table(["Critère (1 à 5)", "Ce que vous vérifiez concrètement"],
                   [["Conformité au cahier des charges", "Couleur, dimension, poids, matière, finitions, référence"],
                    ["Qualité de fabrication", "Assemblages, soudures, coutures, jeux, odeurs, défauts visibles"],
                    ["Fonctionnement / durabilité", "Test d'usage réel pendant plusieurs jours, résistance"],
                    ["Emballage", "Protection, marquage, résistance au transport, lisibilité"],
                    ["Documentation", "Fiche technique, certificats, notices, étiquetage"],
                    ["Réactivité commerciale", "Délai de réponse, précision, capacité à documenter"]],
                   widths=[5.5 * cm, 11.5 * cm]))
    A(Spacer(1, 4))
    A(callout("Méthode — l'échantillon de production",
              "L'échantillon de vente (souvent offert) n'est pas l'échantillon de production. "
              "Exigez un <b>échantillon issu de la production réelle</b>, prélevé sur le lot ou "
              "fabriqué avec les mêmes réglages, et validez-le par écrit avant l'expédition. "
              "Conservez-le : il devient votre référence contractuelle en cas de litige sur la "
              "qualité (chapitre 11)."))
    A(Paragraph("Ce qu'il faut retenir du chapitre 3", S["h3"]))
    A(B(["Une plateforme B2B n'est pas une garantie : elle met en relation, elle ne certifie pas la qualité.", "L'identité du fournisseur se vérifie (licence, ancienneté, références) avant tout paiement.", "L'échantillon est obligatoire, surtout pour une première commande.", 'La fiche de comparaison transforme plusieurs devis en une décision argumentée.']))
    A(Paragraph("Check-list du chapitre 3", S["h3"]))
    A(B(["J'ai prospecté au moins 5 fournisseurs et demandé 3 devis comparables.",
         "J'ai vérifié identité, licence, réputation et coordonnées bancaires.",
         "J'ai reçu et testé un échantillon conforme.",
         "J'ai comparé les offres sur une grille identique.",
         "Aucun signal d'arnaque n'est présent (ou il a été levé par écrit)."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 4
    # ================================================================
    for f in chapter_opener(4, "Négocier avec les fournisseurs",
                            "Devis, prix, MOQ, délais, qualité et commande professionnelle",
                            ["Demander un devis complet et comparable.",
                             "Négocier les prix, les quantités minimales et les délais.",
                             "Vérifier la qualité par écrit avant production.",
                             "Préparer une commande professionnelle et sécurisée.",
                             "Utiliser des modèles de messages en français et en anglais."]):
        A(f)
    A(H2("4.1 Demander un devis : la précision avant tout"))
    A(P("Un devis ne vaut que par sa <b>précision</b>. Demandez toujours par écrit : prix unitaire "
        "à plusieurs niveaux de quantité, MOQ, délai de production, emballage, poids et dimensions, "
        "Incoterm proposé, conditions de paiement, garantie. Un devis vague (« prix à discuter ») "
        "est inutilisable pour calculer votre marge."))
    A(H2("4.2 Négocier les prix"))
    A(P("La négociation se fait <b>après</b> la comparaison (chapitre 3), jamais avant. Techniques "
        "éprouvées :"))
    A(B(["<b>Ancrez sur le marché</b> : « Deux autres fournisseurs proposent X. Pouvez-vous vous aligner ? »",
         "<b>Négociez le volume</b> : un prix dégressif par palier de quantité motive le fournisseur.",
         "<b>Négociez les conditions</b> : emballage renforcé, étiquetage personnalisé, délai raccourci.",
         "<b>Ne négociez jamais la qualité</b> : un prix obtenu au prix d'une qualité dégradée coûte plus cher à l'arrivée.",
         "<b>Formalisez tout par écrit</b> : un accord oral ne vaut rien en cas de litige."]))
    A(H2("4.3 Quantités minimales (MOQ) et délais"))
    A(P("La <b>MOQ</b> (Minimum Order Quantity) est la quantité minimale acceptée par le fournisseur. "
        "Elle dépend du produit et du fabricant. Négociez-la si votre budget est limité, mais "
        "n'acceptez jamais une MOQ qui dépasse votre capacité de vente : un stock invendu est un "
        "capital immobilisé. Les <b>délais</b> se négocient aussi : délai de production, délai "
        "d'expédition, pénalités de retard éventuelles. Tout doit être écrit dans le devis."))
    A(H2("4.4 Vérifier la qualité par écrit"))
    A(P("Définissez un <b>cahier des charges</b> : matière, dimensions, poids, finitions, emballage, "
        "étiquetage, normes. Joignez photos et échantillon de référence. Exigez un <b>rapport "
        "d'inspection</b> avant expédition pour les commandes importantes. La qualité se contrôle "
        "<b>avant</b> le chargement, pas à l'arrivée."))
    A(H2("4.5 Préparer une commande professionnelle"))
    A(P("La commande (purchase order) reprend : références exactes, quantités, prix unitaires et "
        "totaux, Incoterm, port de destination, délai, conditions de paiement, exigences qualité et "
        "emballage. Elle est signée ou confirmée par e-mail par les deux parties. C'est votre "
        "<b>preuve contractuelle</b> en cas de litige."))
    A(H2("4.6 Cas de négociation complet (dialogue pédagogique)"))
    A(P("Voici comment se déroule une négociation professionnelle, du premier devis à l'accord."))
    A(callout("Dialogue — négociation d'une commande de 2 000 unités",
              "<b>Vous :</b> « Merci pour votre devis à 4,80 $/pièce. Deux concurrents proposent "
              "4,20 $ et 4,35 $. Pour une commande d'essai de 2 000 pièces avec réassorts réguliers, "
              "pouvez-vous vous aligner à 4,00 $ ? »<br/>"
              "<b>Fournisseur :</b> « Nous pouvons faire 4,40 $ pour 2 000 pièces. »<br/>"
              "<b>Vous :</b> « 4,40 $ reste au-dessus de notre budget. Nous visons 4,10 $ avec un "
              "engagement de réassort mensuel. Pouvez-vous confirmer 4,10 $, délai de production "
              "25 jours et emballage renforcé ? »<br/>"
              "<b>Fournisseur :</b> « Accord pour 4,10 $, 25 jours, emballage renforcé. Je vous envoie "
              "la facture pro forma. »<br/>"
              "<b>Vous :</b> « Merci. Avant production, merci de nous envoyer un échantillon de "
              "production pour validation. »<br/>"
              "<i>Leçons : ancrer sur le marché, proposer un volume et une perspective de réassort, "
              "obtenir un accord écrit complet, valider l'échantillon de production avant le gros "
              "de la commande.</i>"))
    A(H2("4.7 Les pièges de la négociation"))
    A(styled_table(["Piège", "Comment il fonctionne", "Comment l'éviter"],
                   [["Le prix « d'appel »", "Prix bas annoncé, frais cachés ajoutés ensuite",
                     "Exiger un devis complet et ferme, tout compris"],
                    ["La remise « immédiate »", "Pression pour décider vite avant réflexion",
                     "Ne jamais décider sous pression ; comparer d'abord"],
                    ["La qualité sacrifiée", "Prix obtenu en dégradant la qualité",
                     "Ne jamais négocier la qualité ; cahier des charges écrit"],
                    ["L'accord oral", "Promesses non écrites, contestées ensuite",
                     "Tout formaliser par écrit (devis, commande, e-mails)"],
                    ["Le fournisseur unique", "Dépendance totale, aucun levier de négociation",
                     "Toujours comparer au moins 3 offres"]],
                   widths=[4 * cm, 6.5 * cm, 6.5 * cm]))
    A(Spacer(1, 4))
    A(H2("4.8 Modèles de messages (français / anglais)"))
    A(P("Les messages ci-dessous sont des <b>modèles pédagogiques</b> à adapter. Le Bonus 1 contient "
        "30 messages complets."))
    A(callout("Modèle 1 — Demande de devis (anglais)",
              "<i>Dear Supplier, I am an importer based in Benin. I am interested in [product, "
              "reference]. Please send your quotation including: unit price for [qty] units, MOQ, "
              "production time, packaging, weight and dimensions, Incoterm (FOB/CIF), payment terms "
              "and warranty. Destination port: Cotonou. Thank you.</i>"))
    A(Spacer(1, 4))
    A(callout("Modèle 2 — Négociation de prix (anglais)",
              "<i>Thank you for your quotation. Your price is above our target budget. Two other "
              "suppliers offered [price]. Could you align on [target price] for an order of [qty] "
              "units, with a first trial order and larger volumes to follow? Please confirm your best "
              "price in writing.</i>"))
    A(Spacer(1, 4))
    A(callout("Modèle 3 — Demande d'échantillon (français)",
              "<i>Bonjour, je suis importateur au Bénin. Avant toute commande en gros, je souhaite "
              "recevoir un échantillon de [produit, référence]. Merci de me confirmer le coût de "
              "l'échantillon, les frais d'envoi vers Cotonou et le délai. Je paierai les frais "
              "d'envoi par le moyen convenu.</i>"))
    A(Spacer(1, 4))
    A(callout("Modèle 4 — Confirmation de commande (anglais)",
              "<i>Dear [Supplier], we confirm our order: [product, ref], quantity [qty], unit price "
              "[price], total [total], Incoterm [FOB/CIF] Cotonou, production time [days], payment "
              "terms [terms]. Please confirm in writing that you accept these conditions and send the "
              "pro forma invoice.</i>"))
    for f in exercise_box("Exercice 4.1 — Négocier un devis",
            "Un fournisseur propose 5,00 $/pièce pour 1 000 pièces (MOQ 1 000). Deux concurrents "
            "proposent 4,20 $ et 4,50 $. Rédigez un message de négociation en anglais visant 4,00 $ "
            "avec une commande d'essai de 1 000 pièces.",
            "Message attendu : remercier, citer les prix concurrents, proposer 4,00 $ pour 1 000 "
            "pièces en commande d'essai avec volumes croissants, demander confirmation écrite du "
            "prix, du délai et de l'emballage. Ne pas accepter de compromis sur la qualité."):
        A(f)
    A(Paragraph("Ce qu'il faut retenir du chapitre 4", S["h3"]))
    A(B(["On compare d'abord, on négocie ensuite : sans point de comparaison, il n'y a pas de levier.", 'La négociation porte sur un ensemble : prix, MOQ, délais, qualité, emballage, paiement.', 'Tout accord se formalise par écrit (devis, pro forma, commande).', 'La qualité ne se négocie jamais : elle se spécifie.']))
    A(Paragraph("Check-list du chapitre 4", S["h3"]))
    A(B(["J'ai obtenu un devis écrit, précis et comparable.",
         "J'ai négocié prix, MOQ et délais après comparaison.",
         "Le cahier des charges qualité est défini par écrit.",
         "La commande reprend toutes les conditions et est confirmée par écrit."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 5
    # ================================================================
    for f in chapter_opener(5, "Acheter à l'international",
                            "Chine, Turquie, France, Europe, États-Unis, Afrique : avantages, contraintes, précautions",
                            ["Comparer les avantages et contraintes de chaque marché fournisseur.",
                             "Identifier les précautions propres à chaque origine.",
                             "Choisir un marché adapté à son produit et à son budget.",
                             "Anticiper les spécificités logistiques et réglementaires."]):
        A(f)
    A(H2("5.1 La Chine : le premier fournisseur mondial"))
    A(P("La Chine est le <b>premier exportateur mondial</b> et la source d'approvisionnement de la "
        "plupart des importateurs africains. Avantages : offre immense, prix compétitifs, MOQ "
        "flexibles, expérience du commerce avec l'Afrique, liaisons maritimes directes vers les "
        "ports ouest-africains. Contraintes : distance et délais longs, barrière linguistique, "
        "risque de contrefaçon, qualité variable, arnaques sur les plateformes. Précautions : "
        "échantillons systématiques, vérification renforcée (chapitre 3), inspection avant "
        "expédition pour les gros volumes, paiement sécurisé (chapitre 11)."))
    A(H2("5.2 La Turquie : qualité et proximité croissantes"))
    A(P("La Turquie est devenue un fournisseur majeur pour l'Afrique : textile, meubles, "
        "électroménager, matériaux de construction, produits alimentaires. Avantages : qualité "
        "souvent supérieure à l'entrée de gamme chinoise, délais plus courts, relations commerciales "
        "développées avec l'Afrique de l'Ouest, présence de communautés commerçantes. Contraintes : "
        "prix généralement plus élevés que la Chine, MOQ parfois plus importantes. Précautions : "
        "vérifier les normes et certificats (notamment pour l'alimentaire et les cosmétiques), "
        "négocier les volumes, prévoir le fret aérien pour les petits lots."))
    A(H2("5.3 La France et l'Europe : qualité, normes, coûts"))
    A(P("L'Europe (France, Belgique, Espagne, Italie, Pays-Bas, Allemagne) offre une <b>qualité "
        "élevée, des marques reconnues et une conformité stricte aux normes</b>. Avantages : "
        "fiabilité, traçabilité, garanties, délais courts pour l'aérien. Contraintes : prix élevés, "
        "MOQ importantes, marges plus faibles pour les produits grand public, réglementation "
        "exigeante (normes CE, étiquetage). L'Europe est pertinente pour les produits à forte valeur "
        "ajoutée, les marques, ou lorsque la qualité est l'argument de vente principal."))
    A(H2("5.4 Les États-Unis : marques et niches"))
    A(P("Les États-Unis sont pertinents pour les <b>marques, les produits technologiques, les "
        "compléments alimentaires et les niches spécialisées</b>. Avantages : produits authentiques, "
        "innovation, marques fortes. Contraintes : coûts élevés, fret aérien souvent nécessaire, "
        "normes spécifiques (FDA, UL), délais et formalités. Réservez ce marché aux produits à "
        "marge élevée ou aux marques demandées par une clientèle spécifique."))
    A(H2("5.5 Les pays africains : le commerce intra-africain"))
    A(P("Le commerce <b>intra-africain</b> est en pleine croissance, porté par la <b>ZLECAf</b> "
        "(Zone de libre-échange continentale africaine) et par les communautés économiques "
        "régionales (CEDEAO, UEMOA). Acheter en Afrique (Nigeria, Ghana, Côte d'Ivoire, Maroc, "
        "Afrique du Sud, etc.) présente des avantages : proximité, délais courts, connaissance des "
        "marchés locaux, coûts de transport réduits, paiements simplifiés. Contraintes : offre "
        "manufacturière encore limitée dans certains secteurs, infrastructures variables, formalités "
        "régionales à maîtriser (certificats d'origine CEDEAO, règles d'origine). C'est une piste "
        "stratégique à explorer en complément des sources asiatiques et européennes."))
    A(H2("5.6 Fiches pratiques par marché"))
    A(styled_table(["Marché", "Comment y acheter", "Langue / communication", "Conseil clé"],
                   [["Chine", "Plateformes B2B, salons, agents de sourcing",
                     "Anglais (souvent via traducteur) ; e-mails et messageries",
                     "Échantillon + inspection systématiques"],
                    ["Turquie", "Plateformes, salons, réseaux de commerçants",
                     "Anglais, parfois français ; relations de confiance",
                     "Vérifier les certificats sanitaires"],
                    ["Europe", "Distributeurs, marques, plateformes européennes",
                     "Français / anglais ; conformité stricte",
                     "Exiger les certificats CE et l'étiquetage"],
                    ["USA", "Marques, distributeurs, plateformes",
                     "Anglais ; normes spécifiques",
                     "Vérifier FDA / UL selon le produit"],
                    ["Afrique", "Commerçants, salons régionaux, réseaux CEDEAO",
                     "Français / anglais / langues locales",
                     "Certificats d'origine régionaux"]],
                   widths=[2.2 * cm, 5 * cm, 4.8 * cm, 5 * cm]))
    A(Spacer(1, 4))
    A(H2("5.7 Les corridors vers Cotonou : délais et points de vigilance"))
    A(styled_table(["Corridor", "Délai indicatif (à vérifier)", "Points de vigilance"],
                   [["Chine → Cotonou (maritime)", "30 à 45 jours porte à porte",
                     "Transbordement possible ; congestion ; saisonnalité des frets"],
                    ["Turquie → Cotonou (maritime / aérien)", "15 à 30 jours (maritime) ; 5 à 10 jours (aérien)",
                     "Certificats sanitaires pour l'alimentaire ; saisonnalité textile"],
                    ["Europe → Cotonou (maritime / aérien)", "15 à 25 jours (maritime) ; 3 à 7 jours (aérien)",
                     "Normes CE ; étiquetage ; coûts élevés"],
                    ["Afrique de l'Ouest → Bénin (routier)", "3 à 10 jours selon l'origine",
                     "Formalités régionales ; certificats d'origine CEDEAO"]],
                   widths=[5 * cm, 5.5 * cm, 6.5 * cm]))
    A(Spacer(1, 4))
    A(P("Ces délais sont <b>indicatifs et pédagogiques</b> : ils varient selon les compagnies, les "
        "saisons et la congestion portuaire. Demandez toujours à votre transitaire le délai "
        "actualisé pour votre corridor et votre période d'expédition, et prévoyez une marge de "
        "sécurité dans votre planning commercial."))
    A(styled_table(["Marché", "Avantages principaux", "Contraintes principales", "Idéal pour"],
                   [["Chine", "Prix, choix, MOQ flexibles", "Délais, qualité variable, arnaques",
                     "Produits grand public, gros volumes"],
                    ["Turquie", "Qualité, délais moyens, réseau Afrique", "Prix intermédiaires",
                     "Textile, meubles, équipement"],
                    ["Europe", "Qualité, marques, conformité", "Prix élevés, MOQ",
                     "Produits premium, marques"],
                    ["USA", "Authenticité, innovation", "Coûts, normes spécifiques",
                     "Nichés, marques demandées"],
                    ["Afrique", "Proximité, délais courts, ZLECAf", "Offre limitée, formalités régionales",
                     "Complément de gamme, régional"]],
                   widths=[2.2 * cm, 4.8 * cm, 5.2 * cm, 4.8 * cm]))
    A(Spacer(1, 4))
    for f in img("illustration-port.jpg", 15,
                 "Figure 2 — Les grandes routes maritimes relient les zones de production aux ports africains, dont Cotonou."):
        A(f)
    A(H2("5.8 Les erreurs à éviter selon le marché"))
    A(B(["<b>Chine</b> : payer sans échantillon, travailler avec un seul fournisseur, négliger l'inspection sur les gros volumes.",
         "<b>Turquie</b> : oublier les certificats sanitaires pour l'alimentaire, sous-estimer les MOQ.",
         "<b>Europe</b> : négliger les normes CE et l'étiquetage, viser des marges irréalistes sur le premium.",
         "<b>USA</b> : ignorer les normes FDA/UL, sous-estimer le coût du fret aérien.",
         "<b>Afrique</b> : négliger les certificats d'origine régionaux et les formalités CEDEAO."]))
    A(callout("Conseil stratégique",
              "Ne dépendez pas d'un seul marché fournisseur. Une <b>double source</b> (par exemple "
              "Chine + Turquie, ou Chine + Afrique) sécurise votre approvisionnement en cas de "
              "rupture, de hausse de fret ou de changement réglementaire."))
    for f in exercise_box("Exercice 5.1 — Choisir un marché",
            "Vous vendez des vêtements grand public avec un budget moyen. Comparez Chine, Turquie "
            "et Europe sur : prix, qualité, délais, MOQ, risques. Recommandez une source principale "
            "et une source de secours.",
            "Recommandation type : source principale en Chine (prix, choix) avec échantillons et "
            "inspection ; source de secours en Turquie (qualité, délais) pour les articles sensibles "
            "ou les réassorts rapides. L'Europe serait réservée à une gamme premium ultérieure."):
        A(f)
    A(H2("5.9 Choisir son marché fournisseur : la démarche en 4 questions"))
    A(NUM(["<b>Quel produit ?</b> Un produit technique ou normé (électronique, médical, alimentaire) impose souvent une origine capable de fournir les certificats exigés.",
           "<b>Quel budget et quel volume ?</b> Un petit budget supporte difficilement un conteneur complet : le groupage et les marchés de proximité sont plus adaptés au démarrage.",
           "<b>Quel délai acceptable ?</b> Un besoin urgent oriente vers l'aérien ou la région ; un réassort planifié permet le maritime.",
           "<b>Quelles compétences ?</b> L'anglais commercial, la vérification documentaire et la négociation à distance sont plus faciles sur certains marchés que sur d'autres."]))
    A(P("Ces quatre réponses déterminent le marché, l'Incoterm et le mode de transport. Elles "
        "doivent être écrites avant le premier contact : c'est ce document qui évite de "
        "collectionner des devis incomparables."))
    A(Paragraph("Ce qu'il faut retenir du chapitre 5", S["h3"]))
    A(B(['Chaque marché fournisseur a sa logique de coût, de délai et de risque.', 'Chine : prix et volume ; Europe : conformité et qualité ; Turquie : proximité et textile ; Afrique : réactivité régionale.', 'Le choix du marché dépend du produit, du budget, du délai acceptable et des compétences disponibles.', 'Toujours prévoir une source de secours.']))
    A(Paragraph("Check-list du chapitre 5", S["h3"]))
    A(B(["J'ai comparé au moins deux marchés fournisseurs pour mon produit.",
         "Je connais les précautions propres à chaque origine.",
         "J'ai identifié une source principale et une source de secours."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 6
    # ================================================================
    for f in chapter_opener(6, "Transport et logistique",
                            "Maritime, aérien, terrestre, multimodal, conteneurs, transitaires, assurance, suivi",
                            ["Choisir le mode de transport adapté (coût, délai, nature de la marchandise).",
                             "Comprendre conteneurs, groupage et transitaires.",
                             "Assurer et suivre ses marchandises.",
                             "Anticiper les délais et risques logistiques."]):
        A(f)
    A(H2("6.1 Les quatre modes de transport"))
    A(styled_table(["Mode", "Avantages", "Limites", "Idéal pour"],
                   [["<b>Maritime</b>", "Coût unitaire le plus bas ; gros volumes",
                     "Délais longs (30-45 j) ; risques portuaires",
                     "Conteneurs, gros volumes non urgents"],
                    ["<b>Aérien</b>", "Rapidité (3-7 j) ; fiabilité ; suivi précis",
                     "Coût élevé ; restrictions (poids, matières dangereuses)",
                     "Petits lots urgents, produits à forte valeur"],
                    ["<b>Terrestre</b>", "Flexibilité ; porte-à-porte ; corridors régionaux",
                     "Coût intermédiaire ; délais variables ; sécurité",
                     "Afrique de l'Ouest, livraisons intérieures"],
                    ["<b>Multimodal</b>", "Combine les avantages (ex. maritime + routier)",
                     "Coordination complexe ; ruptures de charge",
                     "Grandes distances, enclavement"]],
                   widths=[2.6 * cm, 5 * cm, 5 * cm, 4.4 * cm]))
    A(Spacer(1, 4))
    for f in img("infographie-transport.png", 16,
                 "Figure 3 — Coût relatif et délai indicatif des modes de transport (indices pédagogiques)."):
        A(f)
    A(H2("6.2 Conteneurs et groupage"))
    A(P("Le <b>conteneur complet (FCL — Full Container Load)</b> est réservé à un seul chargeur : "
        "vous louez tout le conteneur (20 ou 40 pieds). Le <b>groupage (LCL — Less than Container "
        "Load)</b> mutualise un conteneur entre plusieurs chargeurs : idéal pour les petits volumes, "
        "mais avec des délais de consolidation et des risques de mélange. Le choix dépend du volume : "
        "en règle générale, le groupage convient aux petits volumes et le conteneur complet devient "
        "intéressant dès que votre marchandise remplit une part significative du conteneur. "
        "Demandez toujours à votre transitaire une <b>comparaison chiffrée FCL / LCL</b>."))
    A(H2("6.3 Types de conteneurs et choix du conditionnement"))
    A(styled_table(["Type", "Caractéristiques", "Usage"],
                   [["20 pieds (20' DV)", "≈ 33 m³, charge utile ≈ 28 t",
                     "Petits et moyens volumes ; charge lourde"],
                    ["40 pieds (40' DV)", "≈ 67 m³, charge utile ≈ 26 t",
                     "Gros volumes ; marchandises légères et volumineuses"],
                    ["40 pieds HC", "≈ 76 m³, hauteur majorée",
                     "Marchandises hautes ou volumineuses"],
                    ["Frigorifique (reefer)", "Température contrôlée",
                     "Produits périssables, pharmaceutiques"],
                    ["Open top / flat rack", "Ouverture par le haut ou plate-forme",
                     "Charges hors gabarit, machines"]],
                   widths=[4 * cm, 6.5 * cm, 6.5 * cm]))
    A(Spacer(1, 4))
    A(P("Le choix du conteneur dépend du <b>volume, du poids et de la nature</b> de la marchandise. "
        "Un mauvais choix (conteneur trop petit, emballage inadapté) génère des coûts supplémentaires "
        "ou des avaries. Demandez au fournisseur les <b>dimensions et poids exacts</b> et faites "
        "valider le conditionnement par votre transitaire avant le chargement."))
    A(H2("6.4 Le processus portuaire étape par étape"))
    A(NUM(["<b>Arrivée du navire</b> : le conteneur est déchargé et stocké sur le parc portuaire.",
           "<b>Manutention et stockage</b> : les frais courent dès l'arrivée (délai gratuit limité).",
           "<b>Dédouanement</b> : déclaration, liquidation, paiement des droits et taxes, contrôle éventuel.",
           "<b>Autorisation d'enlèvement</b> : le bon de sortie est délivré après acquittement.",
           "<b>Enlèvement et transport intérieur</b> : le conteneur quitte le port vers l'entrepôt.",
           "<b>Retour du conteneur</b> : respectez le délai gratuit de détention, sinon surestaries."]))
    A(H2("6.5 Les coûts du fret : ce qui les fait varier"))
    A(B(["<b>Volume et poids</b> : le fret se calcule au volume (maritime) ou au poids volumétrique (aérien). Optimisez le conditionnement.",
         "<b>Saisonnalité</b> : les frets augmentent en haute saison (préparation des fêtes, rentrée). Expédiez hors pointe si possible.",
         "<b>Port de départ et de destination</b> : les ports majeurs sont mieux desservis et souvent moins chers.",
         "<b>Type de marchandise</b> : les marchandises dangereuses, fragiles ou hors gabarit coûtent plus cher.",
         "<b>Mode et service</b> : direct ou avec transbordement, port à port ou porte à porte — chaque option a un prix."]))
    A(P("Demandez toujours <b>plusieurs devis de fret</b> (transitaire + compagnies) et comparez le "
        "<b>coût total rendu</b>, pas seulement le fret de base. Un fret bas avec des frais de "
        "manutention élevés peut coûter plus cher qu'un fret moyen tout compris."))
    A(H2("6.6 Les transitaires : vos partenaires logistiques"))
    A(P("Le transitaire (ou commissionnaire en douane agréé) est l'intermédiaire qui <b>organise le "
        "transport et accomplit les formalités douanières</b> pour votre compte. Ses missions : "
        "réservation de fret, établissement des documents, déclaration en douane, suivi, coordination "
        "des enlèvements. Choisissez-le sur : agrément officiel, expérience sur votre corridor "
        "(ex. Chine–Cotonou), transparence des frais, réactivité. Demandez un <b>devis détaillé et "
        "écrit</b> : fret, manutention, stockage, dédouanement, livraison. Méfiez-vous des prix "
        "« tout compris » sans détail : ils cachent souvent des frais supplémentaires."))
    A(H2("6.7 L'assurance transport"))
    A(P("L'assurance transport couvre les <b>risques de perte, de vol, de casse ou d'avarie</b> "
        "pendant le transport. Elle est distincte de la responsabilité du transporteur (limitée par "
        "les conventions internationales). Pour une première importation, l'assurance est une "
        "<b>dépense de protection</b>, pas un coût superflu : un sinistre non assuré peut anéantir "
        "votre marge et votre capital. Vérifiez : couverture (tous risques recommandée), montant "
        "assuré (valeur de la marchandise + fret + marge), franchise, procédure de déclaration de "
        "sinistre. L'Incoterm détermine qui doit assurer (chapitre 7)."))
    A(H2("6.8 Suivi des marchandises"))
    A(P("Exigez un <b>numéro de suivi</b> (tracking) : numéro de conteneur, numéro de connaissement "
        "(B/L) ou de lettre de transport aérien (AWB). Suivez chaque étape : chargement, départ, "
        "transbordement, arrivée, dédouanement, enlèvement. Un transitaire sérieux vous envoie des "
        "points de situation réguliers. Anticipez les <b>délais de dédouanement et d'enlèvement</b> : "
        "une marchandise qui arrive sans dossier prêt génère des frais de stockage et de surestaries."))
    A(H2("6.9 Délais et risques logistiques"))
    A(styled_table(["Risque", "Conséquence", "Prévention"],
                   [["Retard de production / de navire", "Rupture de stock, pénalités",
                     "Marge de délai, stock de sécurité, suivi"],
                    ["Congestion portuaire", "Surestaries, stockage",
                     "Dossier prêt avant l'arrivée, transitaire réactif"],
                    ["Casse / avarie / vol", "Perte financière",
                     "Emballage renforcé, assurance tous risques"],
                    ["Erreur de documents", "Blocage en douane",
                     "Check-list Bonus 4, vérification croisée"],
                    ["Fluctuation des frets", "Coût imprévu",
                     "Devis ferme, réserve de trésorerie"]],
                   widths=[4.5 * cm, 5.5 * cm, 7 * cm]))
    A(Spacer(1, 4))
    for f in img("illustration-warehouse.jpg", 15,
                 "Figure 4 — Entrepôt et préparation : l'emballage et le conditionnement conditionnent l'arrivée en bon état."):
        A(f)
    for f in exercise_box("Exercice 6.1 — Choisir un mode de transport",
            "Vous importez 2 m³ de textiles non urgents depuis la Chine vers Cotonou. Comparez "
            "maritime groupé, maritime conteneur complet et aérien sur coût, délai et risques. "
            "Recommandez un mode.",
            "Recommandation type : maritime groupé (LCL) pour un petit volume non urgent — coût "
            "modéré, délai acceptable. Le conteneur complet serait surdimensionné ; l'aérien trop "
            "cher pour du textile non urgent. Prévoir assurance et dossier douanier prêt."):
        A(f)
    A(Paragraph("Ce qu'il faut retenir du chapitre 6", S["h3"]))
    A(B(['Quatre modes : maritime, aérien, terrestre, multimodal — chacun un compromis coût/délai/risque.', 'FCL pour le volume, LCL (groupage) pour débuter avec un petit volume.', "Le transitaire agréé coordonne transport et dédouanement : il se choisit avant l'arrivée.", "L'assurance transport et le suivi (tracking) ne sont pas optionnels."]))
    A(Paragraph("Check-list du chapitre 6", S["h3"]))
    A(B(["J'ai comparé les modes de transport sur coût, délai et risques.",
         "J'ai choisi FCL ou LCL après comparaison chiffrée.",
         "Mon transitaire est agréé et son devis est détaillé par écrit.",
         "L'assurance tous risques est souscrite.",
         "Le suivi (B/L, AWB, conteneur) est organisé."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 7
    # ================================================================
    for f in chapter_opener(7, "Maîtriser les Incoterms 2020",
                            "Les 11 Incoterms : responsabilités, risques, coûts, exemples et tableaux comparatifs",
                            ["Définir le rôle des Incoterms 2020 (CCI).",
                             "Expliquer chaque Incoterm : obligations du vendeur et de l'acheteur, transfert du risque, coûts.",
                             "Choisir l'Incoterm adapté à son opération.",
                             "Éviter les erreurs classiques d'utilisation."]):
        A(f)
    A(H2("7.1 À quoi servent les Incoterms ?"))
    A(P("Les <b>Incoterms</b> (International Commercial Terms), publiés par la <b>Chambre de commerce "
        "internationale (CCI)</b>, définissent les <b>obligations respectives du vendeur et de "
        "l'acheteur</b> dans un contrat de vente internationale : qui paie le transport ? Qui assure ? "
        "Qui dédouane ? À quel moment le risque de perte ou de dommage passe-t-il du vendeur à "
        "l'acheteur ? La version en vigueur est celle de <b>2020</b> (Incoterms® 2020). Ils ne "
        "règlent ni le transfert de propriété, ni le paiement : ils doivent être combinés à des "
        "conditions de paiement et à une clause de transfert de propriété."))
    for f in img("infographie-incoterms.png", 16,
                 "Figure 5 — Le point de transfert du risque varie selon l'Incoterm : c'est le cœur de la négociation."):
        A(f)
    A(H2("7.2 Les 11 Incoterms 2020 en détail"))
    A(P("Les Incoterms sont regroupés en deux familles : ceux applicables à <b>tout mode de "
        "transport</b> (EXW, FCA, CPT, CIP, DAP, DPU, DDP) et ceux applicables au <b>transport "
        "maritime et fluvial</b> (FAS, FOB, CFR, CIF). Pour chaque terme, le tableau précise : "
        "lieu de livraison, qui paie le transport principal, qui assure, qui dédouane à l'import, "
        "et quand le risque bascule."))
    incoterms_rows = [
        ["<b>EXW</b><br/>Ex Works<br/>(à l'usine)", "Vendeur met la marchandise à disposition dans ses locaux",
         "Acheteur", "Acheteur", "Acheteur", "Dès la mise à disposition"],
        ["<b>FCA</b><br/>Free Carrier<br/>(livré au transporteur)", "Vendeur livre au transporteur désigné par l'acheteur",
         "Acheteur", "Acheteur", "Acheteur", "À la livraison au transporteur"],
        ["<b>FAS</b><br/>Free Alongside Ship<br/>(le long du navire)", "Vendeur livre le long du navire au port de départ",
         "Acheteur", "Acheteur", "Acheteur", "Quand la marchandise est le long du navire"],
        ["<b>FOB</b><br/>Free On Board<br/>(à bord)", "Vendeur charge la marchandise à bord du navire",
         "Acheteur", "Acheteur", "Acheteur", "Quand la marchandise est à bord"],
        ["<b>CFR</b><br/>Cost and Freight<br/>(coût et fret)", "Vendeur paie le fret jusqu'au port de destination",
         "Vendeur", "Acheteur (optionnel)", "Acheteur", "À bord au port de départ"],
        ["<b>CIF</b><br/>Cost, Insurance and Freight<br/>(coût, assurance, fret)", "Vendeur paie fret + assurance jusqu'au port de destination",
         "Vendeur", "Vendeur", "Acheteur", "À bord au port de départ"],
        ["<b>CPT</b><br/>Carriage Paid To<br/>(port payé jusqu'à)", "Vendeur paie le transport jusqu'au lieu de destination",
         "Vendeur", "Acheteur (optionnel)", "Acheteur", "À la remise au 1er transporteur"],
        ["<b>CIP</b><br/>Carriage and Insurance Paid To<br/>(port et assurance payés jusqu'à)", "Vendeur paie transport + assurance jusqu'au lieu de destination",
         "Vendeur", "Vendeur", "Acheteur", "À la remise au 1er transporteur"],
        ["<b>DAP</b><br/>Delivered At Place<br/>(livré au lieu)", "Vendeur livre au lieu de destination, prêt à décharger",
         "Vendeur", "Vendeur", "Acheteur", "À l'arrivée au lieu, avant déchargement"],
        ["<b>DPU</b><br/>Delivered at Place Unloaded<br/>(livré déchargé)", "Vendeur livre et décharge au lieu de destination",
         "Vendeur", "Vendeur", "Acheteur", "Après déchargement au lieu"],
        ["<b>DDP</b><br/>Delivered Duty Paid<br/>(livré droits acquittés)", "Vendeur livre, dédouané et droits payés à destination",
         "Vendeur", "Vendeur", "Vendeur", "À l'arrivée, droits acquittés"],
    ]
    A(styled_table(["Incoterm", "Obligation du vendeur (livraison)", "Transport principal payé par",
                    "Assurance payée par", "Dédouanement import par", "Transfert du risque"],
                   incoterms_rows,
                   widths=[2.6 * cm, 4.2 * cm, 2.6 * cm, 2.4 * cm, 2.6 * cm, 2.6 * cm]))
    A(Spacer(1, 4))
    A(Paragraph("Lecture du tableau", S["h3"]))
    A(B(["<b>EXW</b> : obligation minimale du vendeur. L'acheteur organise et paie tout à partir de l'usine. Réservé aux acheteurs expérimentés.",
         "<b>FOB / FCA</b> : l'acheteur organise le transport principal. Idéal si vous avez un transitaire de confiance.",
         "<b>CFR / CPT</b> : le vendeur paie le transport, mais le risque bascule dès le départ. L'acheteur doit assurer.",
         "<b>CIF / CIP</b> : le vendeur paie transport + assurance. Attention : la couverture minimale peut être insuffisante.",
         "<b>DAP / DPU</b> : le vendeur livre jusqu'à destination (hors dédouanement import). L'acheteur dédouane.",
         "<b>DDP</b> : obligation maximale du vendeur, y compris dédouanement import. Pratique mais souvent plus cher et moins transparent."]))
    A(H2("7.3 Les 11 Incoterms en détail : obligations, risques et coûts"))
    A(P("Le tableau ci-dessus donne la synthèse. Voici le détail de chaque terme, dans l'ordre de "
        "la <b>croissance des obligations du vendeur</b> (d'EXW, minimal, à DDP, maximal)."))
    incoterm_details = [
        ("EXW — Ex Works (à l'usine)", "Le vendeur met simplement la marchandise à disposition dans ses locaux. <b>L'acheteur</b> organise et paie tout : enlèvement, transport, assurance, dédouanement. Le risque bascule dès la mise à disposition. Réservé aux acheteurs expérimentés disposant d'un transitaire au départ."),
        ("FCA — Free Carrier (livré au transporteur)", "Le vendeur livre la marchandise au transporteur désigné par l'acheteur, au lieu convenu. L'acheteur organise le transport principal et l'assurance. Le risque bascule à la livraison au transporteur. Alternative moderne à FOB pour tous modes de transport."),
        ("FAS — Free Alongside Ship (le long du navire)", "Incoterm maritime : le vendeur livre la marchandise le long du navire au port de départ. L'acheteur paie le chargement à bord, le fret et l'assurance. Le risque bascule quand la marchandise est le long du navire. Utilisé pour les marchandises en vrac."),
        ("FOB — Free On Board (à bord)", "Incoterm maritime de référence : le vendeur charge la marchandise à bord du navire au port de départ et remet le connaissement. L'acheteur paie le fret, l'assurance et le dédouanement. Le risque bascule à bord. C'est le choix le plus courant des importateurs avec transitaire."),
        ("CFR — Cost and Freight (coût et fret)", "Le vendeur paie le fret jusqu'au port de destination, mais le risque bascule à bord au départ. L'acheteur doit donc assurer. Attention : le vendeur paie le transport sans en porter le risque — piège classique du débutant."),
        ("CIF — Cost, Insurance and Freight (coût, assurance, fret)", "Comme CFR, plus une assurance minimale souscrite par le vendeur jusqu'au port de destination. Le risque bascule à bord au départ. Vérifiez la couverture réelle de l'assurance (souvent limitée) et complétez si nécessaire."),
        ("CPT — Carriage Paid To (port payé jusqu'à)", "Équivalent terrestre/multimodal de CFR : le vendeur paie le transport jusqu'au lieu de destination, le risque bascule à la remise au premier transporteur. L'acheteur assure."),
        ("CIP — Carriage and Insurance Paid To (port et assurance payés jusqu'à)", "Équivalent de CIF pour tous modes : transport et assurance payés par le vendeur, risque à la remise au premier transporteur. Vérifiez la couverture d'assurance."),
        ("DAP — Delivered At Place (livré au lieu)", "Le vendeur livre la marchandise au lieu de destination, prête à décharger. Il paie le transport et l'assurance jusqu'à destination. L'acheteur décharge et dédouane (droits et taxes à sa charge). Le risque bascule à l'arrivée, avant déchargement."),
        ("DPU — Delivered at Place Unloaded (livré déchargé)", "Comme DAP, mais le vendeur décharge en plus au lieu de destination. L'acheteur dédouane. Le risque bascule après déchargement. Utile lorsque l'acheteur ne dispose pas de moyens de déchargement."),
        ("DDP — Delivered Duty Paid (livré droits acquittés)", "Obligation maximale du vendeur : il livre la marchandise dédouanée, droits et taxes payés, au lieu de destination. L'acheteur n'a plus qu'à réceptionner. Pratique mais souvent plus cher et moins transparent — comparez toujours avec DAP."),
    ]
    for title, body in incoterm_details:
        A(Paragraph(title, S["h3"]))
        A(P(body))
    A(H2("7.4 Exemples pratiques"))
    A(callout("Exemple 1 — FOB Guangzhou",
              "Vous achetez en <b>FOB</b> : le fournisseur charge la marchandise à bord à Guangzhou "
              "et vous remet le connaissement. Le risque de perte bascule <b>à bord</b>. Vous "
              "organisez le fret, l'assurance et le dédouanement à Cotonou. Avantage : contrôle "
              "total et transparence des coûts."))
    A(Spacer(1, 4))
    A(callout("Exemple 2 — CIF Cotonou",
              "Vous achetez en <b>CIF</b> : le fournisseur paie le fret et une assurance minimale "
              "jusqu'à Cotonou. Le risque bascule <b>à bord au départ</b> : en cas de sinistre en "
              "mer, c'est à vous d'agir auprès de l'assureur. Vérifiez la couverture réelle (souvent "
              "limitée) et souscrivez si besoin une assurance complémentaire."))
    A(Spacer(1, 4))
    A(callout("Exemple 3 — DAP entrepôt Cotonou",
              "Vous achetez en <b>DAP</b> : le fournisseur livre à votre entrepôt à Cotonou, prêt à "
              "décharger. Vous déchargez et vous dédouanez (droits et taxes à votre charge). "
              "Avantage : simplicité logistique. Inconvénient : le prix inclut le transport, "
              "souvent moins transparent."))
    A(H2("7.5 Incoterms et assurance : qui assure quoi ?"))
    A(styled_table(["Incoterm", "Qui doit assurer ?", "Conseil"],
                   [["EXW, FCA, FAS, FOB", "L'acheteur (dès le départ)",
                     "Souscrivez une assurance tous risques dès le chargement"],
                    ["CFR, CPT", "L'acheteur (le vendeur ne couvre pas le risque)",
                     "Ne jamais partir sans assurance : le risque est à votre charge"],
                    ["CIF, CIP", "Le vendeur (couverture minimale incluse)",
                     "Vérifiez la couverture ; complétez si insuffisante"],
                    ["DAP, DPU, DDP", "Le vendeur (jusqu'à destination)",
                     "Vérifiez la couverture ; le risque reste vendeur jusqu'à la livraison"]],
                   widths=[4 * cm, 5.5 * cm, 7.5 * cm]))
    A(Spacer(1, 4))
    A(H2("7.6 Tableau comparatif de décision"))
    A(styled_table(["Votre situation", "Incoterm recommandé", "Pourquoi"],
                   [["Débutant avec transitaire de confiance", "FOB ou FCA",
                     "Contrôle des coûts, transparence, transitaire gère le reste"],
                    ["Petit volume, pas de transitaire", "CIF ou CIP",
                     "Le vendeur organise le transport ; vérifiez l'assurance"],
                    ["Livraison directe à l'entrepôt souhaitée", "DAP",
                     "Simplicité ; vous dédouanez à l'arrivée"],
                    ["Aucune formalité à l'arrivée", "DDP",
                     "Le vendeur dédouane ; prix plus élevé, à comparer"],
                    ["Acheteur expérimenté, gros volumes", "EXW ou FCA",
                     "Optimisation maximale des coûts logistiques"]],
                   widths=[5.5 * cm, 4 * cm, 7.5 * cm]))
    A(Spacer(1, 4))
    A(callout("Attention — les erreurs classiques",
              "<b>1.</b> Confondre transfert du risque et transfert de propriété. "
              "<b>2.</b> Choisir CIF/CFR sans assurer (le risque est à votre charge dès le départ). "
              "<b>3.</b> Oublier de préciser le lieu exact (« FOB port de départ » + port nommé). "
              "<b>4.</b> Utiliser FOB/CIF pour du transport aérien (préférez FCA/CIP). "
              "<b>5.</b> Ne pas écrire l'Incoterm dans le contrat et la facture."))
    for f in exercise_box("Exercice 7.1 — Choisir un Incoterm",
            "Vous importez par voie maritime avec un transitaire à Cotonou. Vous voulez contrôler "
            "le fret et l'assurance. Quel Incoterm choisissez-vous ? Qui paie quoi ? Quand le "
            "risque bascule-t-il ?",
            "Choix : <b>FOB</b> (port de départ nommé). Le vendeur charge à bord ; vous payez fret, "
            "assurance et dédouanement. Le risque bascule <b>à bord au port de départ</b>. Vous "
            "souscrivez une assurance tous risques dès le chargement."):
        A(f)
    A(Paragraph("Ce qu'il faut retenir du chapitre 7", S["h3"]))
    A(B(['Les Incoterms 2020 répartissent coûts, risques et obligations entre vendeur et acheteur.', 'Onze termes, de EXW (vendeur minimal) à DDP (vendeur maximal).', 'Quatre termes sont maritimes (FAS, FOB, CFR, CIF) ; les autres sont multimodaux.', "Le transfert de risque n'est pas toujours au même endroit que le transfert de coût (CFR, CIF, CPT, CIP)."]))
    A(Paragraph("Check-list du chapitre 7", S["h3"]))
    A(B(["Je sais expliquer les 11 Incoterms 2020 et leurs obligations.",
         "Je choisis l'Incoterm selon ma situation (transitaire, volume, contrôle des coûts).",
         "L'Incoterm et le lieu exact sont écrits dans le contrat et la facture.",
         "L'assurance correspond au transfert du risque."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 8
    # ================================================================
    for f in chapter_opener(8, "Documents commerciaux et douaniers",
                            "Factures, colisage, connaissement, LTA, origine, conformité, déclaration, assurance",
                            ["Identifier chaque document et sa fonction.",
                             "Préparer un dossier documentaire complet et cohérent.",
                             "Utiliser les modèles pédagogiques sans les confondre avec des documents officiels.",
                             "Anticiper les contrôles et les blocages en douane."]):
        A(f)
    A(H2("8.1 Le principe : un dossier complet, cohérent et vérifiable"))
    A(P("En douane, la <b>cohérence</b> prime : les quantités, les valeurs, les poids et les "
        "références doivent être <b>identiques</b> sur tous les documents. Une incohérence (poids "
        "différent entre facture et colisage, valeur différente entre facture et déclaration) est "
        "la première cause de contrôle approfondi, de redressement ou de blocage. Avant l'envoi du "
        "dossier à votre transitaire, relisez-le comme un douanier : tout doit concorder."))
    for f in img("infographie-documents.png", 16,
                 "Figure 6 — Le circuit documentaire : chaque document prépare le suivant, jusqu'à la déclaration en douane."):
        A(f)
    A(H2("8.2 Les documents un par un"))
    A(styled_table(["Document", "Fonction", "Qui l'émet / qui le fournit"],
                   [["<b>Facture pro forma</b>", "Offre chiffrée avant commande ; base de la négociation",
                     "Fournisseur"],
                    ["<b>Facture commerciale</b>", "Document de vente définitif ; base de la valeur en douane",
                     "Fournisseur (vendeur)"],
                    ["<b>Liste de colisage</b> (packing list)", "Détail des colis : contenu, poids, dimensions",
                     "Fournisseur / chargeur"],
                    ["<b>Connaissement maritime</b> (B/L)", "Contrat de transport maritime ; titre de propriété",
                     "Compagnie maritime / transitaire"],
                    ["<b>Lettre de transport aérien</b> (LTA / AWB)", "Contrat de transport aérien ; suivi",
                     "Compagnie aérienne / transitaire"],
                    ["<b>Certificat d'origine</b>", "Atteste le pays d'origine ; conditionne les préférences tarifaires",
                     "Autorité compétente / chambre de commerce"],
                    ["<b>Certificats de conformité</b>", "Attestent le respect des normes (sécurité, sanitaire, etc.)",
                     "Organisme de certification / fabricant"],
                    ["<b>Déclaration en douane</b>", "Déclaration de la marchandise ; liquidation des droits et taxes",
                     "Transitaire agréé pour votre compte"],
                    ["<b>Documents d'assurance</b>", "Preuve de la couverture ; base des réclamations en cas de sinistre",
                     "Assureur"]],
                   widths=[4.2 * cm, 7 * cm, 5.8 * cm]))
    A(Spacer(1, 4))
    A(H2("8.3 Points de vigilance par document"))
    A(B(["<b>Facture commerciale</b> : numéro, date, en-tête officiel, Incoterm + lieu, détail des lignes, total, monnaie, origine. Toute rature ou incohérence avec le devis doit être justifiée.",
         "<b>Liste de colisage</b> : nombre de colis, poids brut/net, dimensions, marques. Elle doit correspondre exactement à la marchandise chargée.",
         "<b>Connaissement (B/L)</b> : vérifiez chargeur, destinataire (souvent « à l'ordre »), port de chargement et de déchargement, description, poids, marques. C'est un titre de propriété : ne le perdez pas.",
         "<b>Lettre de transport aérien (AWB)</b> : numéro de suivi, poids, description, vol et date. Conservez-le pour le suivi et l'enlèvement.",
         "<b>Certificat d'origine</b> : pays d'origine exact, signature et cachet de l'autorité compétente. Une origine erronée annule les préférences tarifaires.",
         "<b>Certificats de conformité</b> : normes applicables au produit, organisme certificateur, validité. Vérifiez qu'ils couvrent votre produit et votre destination.",
         "<b>Déclaration en douane</b> : code SH, valeur, origine, régime. Elle est établie par le transitaire agréé à partir de votre dossier — d'où l'importance d'un dossier exact.",
         "<b>Documents d'assurance</b> : couverture, montant assuré, franchise, procédure de sinistre. Conservez-les jusqu'à la réception définitive."]))
    A(H2("8.4 Modèles pédagogiques (exemples — ne pas utiliser comme documents officiels)"))
    A(P("Les modèles ci-dessous sont <b>strictement pédagogiques</b>. Ils montrent la structure et "
        "les informations attendues. Vos documents réels doivent être établis par votre fournisseur, "
        "votre transporteur et votre transitaire sur leurs formulaires officiels."))
    A(callout("Modèle pédagogique — Facture commerciale (extrait)",
              "<i>FACTURE COMMERCIALE — Exemple pédagogique</i><br/>"
              "Vendeur : [Raison sociale, adresse, licence] — Acheteur : [Raison sociale, adresse]<br/>"
              "Référence : [N° facture] — Date : [date] — Incoterm : [FOB/CIF…] [lieu]<br/>"
              "Lignes : [référence produit | quantité | prix unitaire | montant]<br/>"
              "Total : [montant] — Monnaie : [devise] — Origine : [pays] — Port de destination : [port]<br/>"
              "<i>Ce modèle est un exemple de formation. Il ne remplace pas une facture officielle.</i>"))
    A(Spacer(1, 4))
    A(callout("Modèle pédagogique — Liste de colisage (extrait)",
              "<i>LISTE DE COLISAGE — Exemple pédagogique</i><br/>"
              "Référence d'expédition : [N°] — Nombre de colis : [n] — Poids brut total : [kg]<br/>"
              "Détail par colis : [N° colis | contenu | poids net/brut | dimensions]<br/>"
              "Marques et numéros : [à reproduire sur les colis]<br/>"
              "<i>Exemple de formation uniquement.</i>"))
    A(Spacer(1, 4))
    A(callout("Modèle pédagogique — Déclaration en douane (informations à fournir au transitaire)",
              "<i>INFORMATIONS POUR LA DÉCLARATION — Exemple pédagogique</i><br/>"
              "Code SH envisagé : [à déterminer avec le transitaire] — Valeur en douane : [montant]<br/>"
              "Origine : [pays] — Régime : [mise à la consommation / transit / export]<br/>"
              "Documents joints : facture, colisage, B/L ou AWB, certificat d'origine, certificats "
              "de conformité, police d'assurance.<br/>"
              "<i>La classification et la liquidation sont effectuées par le transitaire agréé selon "
              "la réglementation en vigueur.</i>"))
    A(callout("Modèle pédagogique — Connaissement maritime (B/L) : mentions clés",
              "<i>BILL OF LADING — Exemple pédagogique</i><br/>"
              "Chargeur (shipper) : [nom, adresse] — Destinataire (consignee) : [nom] ou « to order »<br/>"
              "Notifier : [partie à prévenir] — Port de chargement : [port] — Port de déchargement : [port]<br/>"
              "Navire / voyage : [nom / n°] — N° de conteneur et plombs : [références]<br/>"
              "Description de la marchandise : [désignation précise], [nombre de colis], [poids], [volume]<br/>"
              "Fret : [prépayé / à destination] — Nombre d'originaux : [3] — Lieu et date d'émission : [ ]<br/>"
              "<i>Document de formation : un B/L réel est émis par le transporteur maritime et vaut "
              "titre de propriété de la marchandise.</i>"))
    A(Spacer(1, 4))
    A(callout("Modèle pédagogique — Lettre de transport aérien (AWB) : mentions clés",
              "<i>AIR WAYBILL — Exemple pédagogique</i><br/>"
              "Expéditeur : [nom, adresse] — Destinataire : [nom, adresse] — Agent IATA : [ ]<br/>"
              "Aéroport de départ : [code] — Aéroport de destination : [code] — Vol / date : [ ]<br/>"
              "Nature de la marchandise : [désignation] — Nombre de colis — Poids brut — Poids taxable<br/>"
              "Valeur déclarée pour le transport : [ ] — Fret : [prépayé / à destination]<br/>"
              "<i>Contrairement au B/L, l'AWB n'est pas un titre de propriété : c'est une preuve de "
              "contrat et une lettre de voiture.</i>"))
    A(Spacer(1, 4))
    A(callout("Modèle pédagogique — Certificat d'origine (structure)",
              "<i>CERTIFICATE OF ORIGIN — Exemple pédagogique</i><br/>"
              "Exportateur : [nom, adresse, pays] — Destinataire : [nom, adresse, pays]<br/>"
              "Moyen de transport et itinéraire : [ ] — Pays d'origine : [ ] — Pays de destination : [ ]<br/>"
              "Description des marchandises : [désignation, nombre de colis, poids]<br/>"
              "Visa de l'autorité compétente (chambre de commerce ou organisme désigné) : [date, "
              "cachet, signature]<br/>"
              "<i>Le certificat doit être délivré et visé par l'autorité compétente du pays "
              "d'exportation : c'est lui qui ouvre droit, le cas échéant, aux préférences tarifaires.</i>"))
    A(Spacer(1, 4))
    A(callout("Modèle pédagogique — Attestation d'assurance transport",
              "<i>CERTIFICATE OF INSURANCE — Exemple pédagogique</i><br/>"
              "Assuré : [nom] — Assureur : [nom] — Police n° : [ ] — Expédition couverte : [référence]<br/>"
              "Marchandise assurée : [désignation] — Montant assuré : [valeur + fret + marge] — "
              "Devise : [ ]<br/>"
              "Étendue de la garantie : [tous risques / FPA…] — Franchise : [ ] — Territoire et "
              "durée de la couverture : [ ]<br/>"
              "<i>Vérifiez l'étendue réelle de la garantie : une couverture minimale (Incoterms CIF/CIP) "
              "peut ne pas suffire à votre risque commercial.</i>"))
    A(H2("8.5 Les erreurs documentaires les plus fréquentes"))
    A(styled_table(["Erreur", "Conséquence", "Prévention"],
                   [["Poids ou quantités incohérents entre documents", "Contrôle approfondi, redressement",
                     "Rapprochement systématique avant envoi"],
                    ["Facture sans Incoterm ni lieu", "Litige sur les coûts et les risques",
                     "Incoterm + lieu obligatoires sur la facture"],
                    ["Certificat d'origine absent ou erroné", "Perte des préférences tarifaires",
                     "Exiger le certificat avant expédition"],
                    ["Description vague (« marchandises diverses »)", "Classification impossible, blocage",
                     "Descriptions précises et références exactes"],
                    ["Documents transmis après l'arrivée", "Surestaries et stockage",
                     "Dossier au transitaire avant l'arrivée"]],
                   widths=[5.5 * cm, 5.5 * cm, 6 * cm]))
    A(Spacer(1, 4))
    A(H2("8.6 Le circuit des documents"))
    A(NUM(["Le <b>fournisseur</b> émet la facture pro forma, puis la facture commerciale et la liste de colisage.",
           "Le <b>transporteur / transitaire</b> émet le connaissement ou la LTA.",
           "Le <b>fournisseur / autorité</b> fournit le certificat d'origine et les certificats de conformité.",
           "L'<b>assureur</b> émet la police ou le certificat d'assurance.",
           "Le <b>transitaire</b> constitue le dossier et dépose la déclaration en douane.",
           "La <b>douane</b> contrôle, liquide les droits et taxes, puis autorise l'enlèvement."]))
    A(callout("Attention — documents falsifiés",
              "Ne jamais utiliser de faux documents (fausse facture, faux certificat). Les sanctions "
              "sont lourdes : pénalités, confiscation, poursuites. En cas de document manquant, "
              "demandez-le à la source légitime (fournisseur, autorité) — jamais de « solution de "
              "rechange » informelle."))
    for f in exercise_box("Exercice 8.1 — Contrôler un dossier",
            "Votre facture indique 500 colis et 2 000 kg, mais la liste de colisage indique 480 "
            "colis et 1 950 kg. Que faites-vous avant de transmettre le dossier au transitaire ?",
            "Vous <b>bloquez l'envoi</b> et demandez au fournisseur une correction écrite et "
            "cohérente. Une incohérence de quantités et de poids déclenche un contrôle approfondi "
            "et peut entraîner un redressement. Le dossier ne part que lorsque tous les documents "
            "concordent."):
        A(f)
    A(H2("8.7 Conserver et archiver son dossier"))
    A(P("Un dossier documentaire complet ne sert pas seulement à dédouaner : il protège vos "
        "droits en cas de litige, de contrôle fiscal ou de demande d'indemnisation par "
        "l'assureur. Classez les pièces dès la fin de l'opération, en version numérique et "
        "papier, et conservez-les selon les durées légales applicables dans votre pays."))
    A(B(["<b>Un dossier par opération</b> : référence de commande, fournisseur, dates, montants.",
         "<b>Toutes les pièces</b> : pro forma, facture définitive, colisage, B/L ou AWB, certificats, attestation d'assurance, déclaration et quittance de droits.",
         "<b>Les preuves de paiement</b> : ordres de virement, relevés, confirmations bancaires.",
         "<b>Les preuves de réception</b> : photos, procès-verbal de réception, réserves éventuelles.",
         "<b>Les correspondances</b> : devis, négociations, validations d'échantillon, réclamations."]))
    A(P("Ce dossier est aussi votre <b>base de connaissance</b> : d'une opération à l'autre, il vous "
        "donne les coûts réels, les délais réels et les documents types qui rendent la deuxième "
        "importation plus rapide et plus rentable que la première."))
    A(Paragraph("Ce qu'il faut retenir du chapitre 8", S["h3"]))
    A(B(["Huit documents forment le dossier standard d'une importation.", 'La cohérence entre documents compte autant que leur présence.', "Le B/L est un titre de propriété ; l'AWB non.", "Un dossier vérifié avant expédition évite un blocage à l'arrivée."]))
    A(Paragraph("Check-list du chapitre 8", S["h3"]))
    A(B(["Facture commerciale, colisage, B/L ou AWB, origine, conformité, assurance : dossier complet.",
         "Quantités, valeurs, poids et références identiques sur tous les documents.",
         "Modèles pédagogiques utilisés comme guides, jamais comme documents officiels.",
         "Dossier transmis au transitaire avant l'arrivée de la marchandise."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 9
    # ================================================================
    for f in chapter_opener(9, "Douanes, taxes et réglementations",
                            "Fonctionnement douanier, codes SH, droits, TVA, contrôles, formalités — cas pratique du Bénin",
                            ["Expliquer le fonctionnement des douanes et le rôle du code SH.",
                             "Distinguer droits de douane, TVA à l'importation et autres taxes.",
                             "Anticiper contrôles, inspections et formalités d'import/export.",
                             "Appliquer la méthode au cas du Bénin en vérifiant les sources officielles."]):
        A(f)
    A(callout("Avertissement réglementaire — à lire avant tout",
              "Ce chapitre explique les <b>mécanismes</b> et la <b>méthode de vérification</b>. Il "
              "ne donne <b>aucun taux ni tarif applicable à un produit précis</b>, car ils varient "
              "selon la classification, l'origine et la réglementation en vigueur. Toutes les "
              "informations réglementaires doivent être vérifiées sur les <b>sources officielles</b> "
              "(Douane du Bénin, APIEx, CEDEAO, UEMOA) à la date de votre opération. "
              "Date de vérification de ce chapitre : <b>15 novembre 2026</b>."))
    A(H2("9.1 Le fonctionnement des douanes"))
    A(P("La douane est l'administration chargée de <b>contrôler les marchandises qui franchissent "
        "les frontières</b>, de <b>percevoir les droits et taxes</b> et de <b>faire respecter les "
        "interdictions et restrictions</b>. Elle exerce trois missions : fiscale (percevoir les "
        "droits), économique (protéger et réguler les échanges) et de sécurité (lutter contre la "
        "fraude, les contrefaçons et les trafics). L'importateur (ou son transitaire agréé) doit "
        "<b>déclarer</b> la marchandise, <b>fournir les documents</b> et <b>acquitter les droits et "
        "taxes</b> avant l'enlèvement."))
    A(H2("9.2 Classification tarifaire et codes SH"))
    A(P("Chaque marchandise est classée dans le <b>Système harmonisé (SH)</b> de l'<b>Organisation "
        "mondiale des douanes (OMD)</b> : un code à 6 chiffres qui identifie le produit dans le "
        "monde entier. À partir de ce code, chaque pays détermine ses <b>droits applicables</b> "
        "(tarif national, accords préférentiels, mesures de sauvegarde). La classification est "
        "déterminante : un même produit mal classé peut être surtaxé ou sous-taxé — avec redressement "
        "en cas d'erreur. La classification se fait avec votre transitaire, à partir des descriptions "
        "techniques du produit."))
    A(H2("9.3 Droits de douane, TVA et autres taxes"))
    A(styled_table(["Prélèvement", "Assiette (base de calcul)", "Principe"],
                   [["<b>Droits de douane</b>", "Valeur en douane (généralement valeur transactionnelle + frais selon l'Incoterm)",
                     "Taux fixé par le tarif applicable (national, régional, préférentiel) selon le code SH et l'origine"],
                    ["<b>TVA à l'importation</b>", "Valeur en douane + droits de douane (+ autres taxes selon la réglementation)",
                     "Taux en vigueur dans le pays d'importation ; récupérable selon le régime fiscal de l'importateur"],
                    ["<b>Autres taxes / redevances</b>", "Selon la nature (accises, redevances statistiques, etc.)",
                     "À vérifier produit par produit sur les sources officielles"]],
                   widths=[4 * cm, 6.5 * cm, 6.5 * cm]))
    A(Spacer(1, 4))
    A(P("Méthode de calcul (sans taux inventé) : <b>droits = valeur en douane × taux applicable au "
        "code SH et à l'origine</b> ; <b>TVA = (valeur en douane + droits) × taux de TVA en "
        "vigueur</b>. Les taux se vérifient sur le tarif douanier officiel et les textes en vigueur "
        "à la date de l'opération. Le chapitre 10 montre comment intégrer ces montants dans le prix "
        "de revient avec des exemples pédagogiques chiffrés."))
    A(H2("9.4 Contrôles et inspections"))
    A(P("La douane peut procéder à des <b>contrôles documentaires</b> (vérification du dossier), à "
        "des <b>contrôles physiques</b> (examen de la marchandise, scan, ouverture des colis) et à "
        "des <b>contrôles ciblés</b> (risque, renseignement, aléatoire). Un dossier complet et "
        "cohérent facilite les contrôles ; un dossier incomplet les prolonge. En cas de contrôle, "
        "collaborez, fournissez les justificatifs et faites appel à votre transitaire. Les délais de "
        "contrôle génèrent des frais de stockage : anticipez-les dans votre trésorerie."))
    A(H2("9.5 Les régimes douaniers : panorama"))
    A(styled_table(["Régime", "Principe", "Usage"],
                   [["<b>Mise à la consommation</b>", "La marchandise entre sur le marché national après paiement des droits et taxes",
                     "Importation classique pour la vente locale"],
                    ["<b>Transit</b>", "La marchandise traverse sous contrôle douanier, sans paiement immédiat",
                     "Pays enclavés via Cotonou (Niger, Burkina Faso…)"],
                    ["<b>Entrepôt douanier</b>", "Stockage sous contrôle sans paiement immédiat des droits",
                     "Stockage avant mise sur le marché"],
                    ["<b>Admission temporaire</b>", "Entrée temporaire pour transformation ou réexportation",
                     "Produits destinés à être réexportés"],
                    ["<b>Exportation</b>", "Sortie définitive du territoire après déclaration",
                     "Vente vers l'étranger"]],
                   widths=[4 * cm, 7 * cm, 6 * cm]))
    A(Spacer(1, 4))
    A(H2("9.6 Formalités d'importation et d'exportation"))
    A(NUM(["<b>Importation</b> : immatriculation / identification de l'importateur, déclaration en "
           "douane (électronique), liquidation et paiement des droits et taxes, contrôle éventuel, "
           "enlèvement de la marchandise.",
           "<b>Exportation</b> : déclaration d'exportation, contrôle éventuel, apposition des scellés, "
           "expédition. Certains produits exigent des autorisations préalables (sanitaires, "
           "phytosanitaires, etc.).",
           "<b>Transit</b> : sous contrôle douanier, avec garantie, vers un pays de destination."]))
    A(H2("9.7 Restrictions et autorisations"))
    A(P("Certaines marchandises sont <b>prohibées</b> (ex. stupéfiants, contrefaçons, espèces "
        "protégées sans autorisation) ou <b>restreintes</b> (autorisation préalable, certificat, "
        "quota, norme obligatoire). Les listes varient selon les pays et évoluent. Avant de commander, "
        "vérifiez auprès de la douane et des ministères sectoriels. <b>Ne jamais importer un produit "
        "réglementé sans autorisation écrite préalable.</b>"))
    A(H2("9.8 Cas pratique : le Bénin"))
    A(P("Le Bénin est un <b>État membre de la CEDEAO, de l'UEMOA et de l'OHADA</b>, ainsi que de "
        "l'<b>OMC</b>. Son principal point d'entrée maritime est le <b>Port autonome de Cotonou "
        "(PAC)</b>, hub logistique pour le Bénin et pour les pays enclavés voisins (Niger, Burkina "
        "Faso, Mali, Tchad) via les corridors de transit. Les acteurs clés sont :"))
    A(styled_table(["Acteur", "Rôle", "Source officielle (à consulter)"],
                   [["<b>Direction générale des douanes</b>", "Déclarations, liquidation, contrôles, tarif douanier",
                     "Site officiel de la douane du Bénin"],
                    ["<b>APIEx</b> (Agence de promotion des investissements et des exportations)",
                     "Accompagnement des importateurs/exportateurs, formalités, promotion des exportations",
                     "Site officiel de l'APIEx"],
                    ["<b>Port autonome de Cotonou (PAC)</b>", "Manutention, stockage, enlèvement des conteneurs",
                     "Site officiel du PAC"],
                    ["<b>CEDEAO / UEMOA</b>", "Tarif extérieur commun (TEC), règles d'origine, libre circulation régionale",
                     "Sites officiels CEDEAO / UEMOA"],
                    ["<b>OHADA</b>", "Droit des affaires applicable (sociétés, recouvrement, arbitrage)",
                     "Site officiel de l'OHADA"]],
                   widths=[4.5 * cm, 6.5 * cm, 6 * cm]))
    A(Spacer(1, 4))
    A(P("Points pratiques pour importer au Bénin (à vérifier à la date de l'opération) :"))
    A(B(["<b>Déclaration électronique</b> via le système douanier en vigueur (guichet unique du "
         "commerce extérieur) : préparez votre dossier avant l'arrivée du navire.",
         "<b>Classification SH</b> : faites-la déterminer par votre transitaire agréé ; elle "
         "conditionne les droits applicables au titre du TEC et des accords en vigueur.",
         "<b>Origine</b> : un certificat d'origine conforme peut ouvrir droit à des préférences "
         "(CEDEAO, ZLECAf) — vérifiez les règles d'origine applicables.",
         "<b>Produits réglementés</b> : alimentaires, cosmétiques, médicaments, produits chimiques "
         "exigent des autorisations et certificats sectoriels — anticipez-les.",
         "<b>Enlèvement</b> : prévoyez les frais portuaires, de manutention et de transport "
         "intérieur dans votre prix de revient (chapitre 10)."]))
    A(H2("9.9 Le parcours type d'un conteneur au port de Cotonou"))
    A(NUM(["<b>Avant l'arrivée</b> : le transitaire prépare la déclaration à partir de votre dossier (facture, colisage, B/L, origine, conformité).",
           "<b>Arrivée et déchargement</b> : le conteneur est déchargé et stocké sur le parc du PAC. Les frais de stockage courent après le délai gratuit.",
           "<b>Déclaration et liquidation</b> : la douane contrôle le dossier, liquide les droits et taxes selon le code SH et l'origine.",
           "<b>Paiement</b> : vous acquittez les droits, taxes et frais portuaires.",
           "<b>Contrôle éventuel</b> : en cas de contrôle physique, la marchandise est examinée avant libération.",
           "<b>Autorisation d'enlèvement</b> : le bon de sortie est délivré.",
           "<b>Enlèvement et livraison</b> : transport intérieur vers votre entrepôt, réception contrôlée, retour du conteneur dans les délais."]))
    A(P("Chaque étape suppose des documents prêts et une trésorerie disponible. Le rôle du transitaire "
        "est de coordonner l'ensemble : choisissez-le avant l'arrivée du navire, pas après."))
    A(callout("Exemple pratique — démarche type d'une première importation au Bénin (méthode)",
              "<b>1.</b> Vérifiez que le produit est autorisé (douane + ministère sectoriel). "
              "<b>2.</b> Faites classer le produit (code SH) par votre transitaire. "
              "<b>3.</b> Obtenez le tarif applicable et les taxes en vigueur sur les sources "
              "officielles. <b>4.</b> Constituez le dossier documentaire (chapitre 8). "
              "<b>5.</b> Déposez la déclaration avant l'arrivée, acquittez les droits et taxes, "
              "procédez à l'enlèvement. Chaque étape se vérifie sur les sites officiels cités "
              "ci-dessus à la date de l'opération."))
    for f in exercise_box("Exercice 9.1 — Méthode de vérification",
            "Vous voulez importer un produit au Bénin. Listez les 5 vérifications officielles à "
            "effectuer avant de commander, avec la source de chacune.",
            "1) Autorisation du produit (douane + ministère sectoriel). 2) Code SH et tarif "
            "applicable (douane / TEC CEDEAO). 3) Taux de TVA et autres taxes en vigueur (douane / "
            "DGI). 4) Certificats requis (autorités sectorielles). 5) Formalités et délais "
            "(APIEx / guichet unique / PAC). Toutes les vérifications se font sur les sources "
            "officielles à la date de l'opération."):
        A(f)
    A(Paragraph("Ce qu'il faut retenir du chapitre 9", S["h3"]))
    A(B(['Le code SH détermine les droits, les taxes et les contrôles applicables.', 'Les règles internationales (OMC, OMD, CCI) fixent le cadre ; les règles nationales fixent les taux et formalités.', "Aucun taux ne se devine : il se vérifie sur les sources officielles, à la date de l'opération.", "Au Bénin : douane, APIEx, PAC et cadre CEDEAO/UEMOA/OHADA structurent l'opération."]))
    A(Paragraph("Check-list du chapitre 9", S["h3"]))
    A(B(["Je sais expliquer le rôle de la douane et du code SH.",
         "Je distingue droits de douane, TVA et autres taxes, et je sais où vérifier leurs taux.",
         "Je connais les formalités d'import/export et les contrôles possibles.",
         "Pour le Bénin, je sais qui contacter (douane, APIEx, PAC) et quelles sources consulter."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 10
    # ================================================================
    for f in chapter_opener(10, "Calculer les coûts et les marges",
                            "Prix de revient complet, prix de vente, marge commerciale — exercices chiffrés corrigés",
                            ["Lister tous les coûts d'une importation, sans en oublier.",
                             "Calculer le prix de revient complet (coût rendu entrepôt).",
                             "Fixer un prix de vente garantissant une marge suffisante.",
                             "Utiliser le modèle de calcul du Bonus 3 pour chaque opération."]):
        A(f)
    A(H2("10.1 Le prix de revient : tous les coûts, rien que les coûts"))
    A(P("Le <b>prix de revient</b> est le coût total pour mettre une unité de produit dans votre "
        "entrepôt, prête à être vendue. Il comprend : prix d'achat, transport international, "
        "assurance, frais de transit (manutention, dédouanement), droits de douane, taxes, frais de "
        "stockage, transport intérieur et livraison. <b>Oublier un seul coût fausse la marge</b> — "
        "c'est l'erreur la plus fréquente et la plus coûteuse du débutant."))
    for f in img("infographie-couts.png", 16,
                 "Figure 7 — Exemple pédagogique de structure du prix de revient (montants fictifs, méthode réelle)."):
        A(f)
    A(styled_table(["Coût", "Contenu", "Où le trouver"],
                   [["Prix d'achat", "Prix fournisseur × quantité + emballage",
                     "Devis / facture fournisseur"],
                    ["Transport international", "Fret maritime ou aérien jusqu'au port de destination",
                     "Devis transitaire / compagnie"],
                    ["Assurance", "Prime d'assurance transport (tous risques recommandée)",
                     "Devis assureur"],
                    ["Frais de transit", "Manutention, dédouanement, honoraires du transitaire",
                     "Devis transitaire détaillé"],
                    ["Droits de douane", "Valeur en douane × taux applicable (code SH + origine)",
                     "Sources officielles (chap. 9)"],
                    ["Taxes (dont TVA import)", "Assiette définie par la réglementation × taux en vigueur",
                     "Sources officielles (chap. 9)"],
                    ["Stockage", "Entrepôt portuaire et entrepôt propre (durée × tarif)",
                     "Tarifs PAC / entrepôt"],
                    ["Livraison", "Transport intérieur jusqu'à l'entrepôt / client",
                     "Devis transporteur local"]],
                   widths=[3.5 * cm, 7 * cm, 6.5 * cm]))
    A(Spacer(1, 4))
    A(H2("10.2 De la marge au prix de vente"))
    A(P("La <b>marge commerciale</b> est la différence entre le prix de vente et le prix de revient. "
        "Elle peut s'exprimer en <b>montant</b> (prix de vente − prix de revient) ou en "
        "<b>pourcentage</b> (marge ÷ prix de vente). Pour débuter, visez une marge d'au moins "
        "<b>25 à 30 % du prix de vente</b> pour absorber les imprévus, les invendus et les frais "
        "commerciaux. Le prix de vente se fixe ensuite par rapport au marché (prix concurrents "
        "relevés au chapitre 2) : il doit être <b>à la fois</b> supérieur au prix de revient majoré "
        "de la marge visée <b>et</b> compétitif sur le marché."))
    A(H2("10.3 Exercices chiffrés (exemples pédagogiques — montants fictifs)"))
    A(P("Les exercices ci-dessous utilisent des <b>montants fictifs</b> pour illustrer la méthode. "
        "Remplacez-les par vos devis réels et les taux officiels en vigueur."))
    for f in exercise_box("Exercice 10.1 — Prix de revient unitaire",
            "Importation pédagogique : 1 000 unités. Prix d'achat : 5 500. Fret : 1 800. Assurance : "
            "200. Frais de transit : 500. Droits de douane (exemple) : 2 000. Taxes (exemple) : 500. "
            "Stockage + livraison : 500. Calculez le prix de revient total et unitaire.",
            "Total = 5 500 + 1 800 + 200 + 500 + 2 000 + 500 + 500 = <b>11 000</b>. "
            "Prix de revient unitaire = 11 000 ÷ 1 000 = <b>11,00 par unité</b>. "
            "Tout prix de vente inférieur à 11,00 est déficitaire."):
        A(f)
    for f in exercise_box("Exercice 10.2 — Prix de vente et marge",
            "Avec un prix de revient unitaire de 11,00, quel prix de vente pour une marge de 30 % du "
            "prix de vente ? Quelle marge en montant pour 1 000 unités ?",
            "Formule : prix de vente = prix de revient ÷ (1 − marge %). "
            "Prix de vente = 11,00 ÷ 0,70 = <b>15,71</b>. Marge unitaire = 15,71 − 11,00 = "
            "<b>4,71</b>. Marge totale = 4,71 × 1 000 = <b>4 710</b> (avant frais commerciaux et "
            "charges). Vérifiez que 15,71 est compétitif sur le marché (chapitre 2)."):
        A(f)
    for f in exercise_box("Exercice 10.3 — Point mort et sensibilité",
            "Si le fret augmente de 20 % (1 800 → 2 160) et les droits de 10 % (2 000 → 2 200), "
            "quel est le nouveau prix de revient unitaire ? Quel prix de vente pour 30 % de marge ?",
            "Nouveau total = 5 500 + 2 160 + 200 + 500 + 2 200 + 500 + 500 = <b>11 560</b>. "
            "Unitaire = <b>11,56</b>. Prix de vente à 30 % = 11,56 ÷ 0,70 = <b>16,51</b>. "
            "Leçon : une hausse de fret et de droits de 360 au total augmente le prix de vente "
            "requis de 0,80 par unité. D'où l'importance d'une réserve de trésorerie."):
        A(f)
    A(H2("10.4 Le besoin en fonds de roulement (BFR)"))
    A(P("Le prix de revient ne suffit pas : il faut aussi financer le <b>fonds de roulement</b>, "
        "c'est-à-dire l'argent immobilisé entre le paiement au fournisseur et l'encaissement chez vos "
        "clients. Le BFR comprend : le stock (marchandise en transit + stock en entrepôt), les "
        "créances clients (délais de paiement accordés) et les dettes fournisseurs (délais obtenus). "
        "Formule simplifiée : <b>BFR = stock + créances clients − dettes fournisseurs</b>. Pour une "
        "première importation, estimez le BFR sur la durée complète du cycle (production + transport "
        "+ dédouanement + stockage + vente + encaissement) et assurez-vous de pouvoir le financer "
        "sans rupture de trésorerie."))
    A(H2("10.5 Analyse de sensibilité : tester la solidité de la marge"))
    A(P("Une marge calculée sur des hypothèses fragiles est une marge fictive. Testez systématiquement "
        "trois scénarios : <b>optimiste</b> (fret et droits au plus bas), <b>central</b> (hypothèses "
        "les plus probables) et <b>pessimiste</b> (fret +20 %, droits +10 %, stockage prolongé). "
        "Si la marge reste positive en scénario pessimiste, votre opération est solide. Sinon, "
        "renégociez, changez de fournisseur ou augmentez le prix de vente avant de commander."))
    for f in exercise_box("Exercice 10.4 — Scénario pessimiste",
            "Reprenez l'exercice 10.1. Ajoutez : fret +20 %, droits +10 %, stockage prolongé +300. "
            "Calculez le nouveau prix de revient unitaire et le prix de vente à 30 % de marge. "
            "L'opération reste-t-elle rentable si le marché n'accepte qu'un prix de 16,00 ?",
            "Nouveau total = 5 500 + 2 160 + 200 + 500 + 2 200 + 500 + 800 = <b>11 860</b>. "
            "Unitaire = <b>11,86</b>. Prix de vente à 30 % = 11,86 ÷ 0,70 = <b>16,94</b>. "
            "À 16,00, la marge réelle = (16,00 − 11,86) ÷ 16,00 = <b>25,9 %</b> : l'opération reste "
            "rentable mais avec une marge réduite. Décision : acceptable, mais sans marge de manœuvre "
            "pour de nouveaux imprévus."):
        A(f)
    for f in exercise_box("Exercice 10.5 — Seuil de rentabilité",
            "Avec un prix de revient unitaire de 11,00 et des charges fixes mensuelles de 2 200 "
            "(loyer, transport, communications), combien d'unités faut-il vendre par mois pour "
            "couvrir les charges fixes si la marge unitaire est de 4,71 ?",
            "Seuil = charges fixes ÷ marge unitaire = 2 200 ÷ 4,71 ≈ <b>467 unités par mois</b>. "
            "En dessous, l'activité est déficitaire. Ce calcul, intégré au business plan (Bonus 6), "
            "détermine le volume minimal à vendre."):
        A(f)
    A(callout("À retenir",
              "Le prix de revient se calcule <b>avant</b> de commander, à partir de devis réels. "
              "Le Bonus 3 fournit le modèle de calcul à remplir pour chaque opération. "
              "Sans calcul, il n'y a pas de marge — et sans marge, il n'y a pas d'entreprise."))
    A(Paragraph("Ce qu'il faut retenir du chapitre 10", S["h3"]))
    A(B(["Le prix de revient intègre tous les coûts, y compris ceux qu'on oublie (transit, stockage, livraison).", 'Marge et taux de marque sont deux calculs différents : maîtrisez les deux formules.', "Le besoin en fonds de roulement se finance : il fait partie du calcul, pas de l'improvisation.", 'Testez toujours un scénario pessimiste avant de commander.']))
    A(Paragraph("Check-list du chapitre 10", S["h3"]))
    A(B(["Tous les coûts sont listés (achat, fret, assurance, transit, douane, taxes, stockage, livraison).",
         "Le prix de revient unitaire est calculé à partir de devis réels.",
         "Le prix de vente garantit 25-30 % de marge et reste compétitif.",
         "Une réserve de 15-20 % couvre les imprévus."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 11
    # ================================================================
    for f in chapter_opener(11, "Sécuriser ses transactions",
                            "Vérification, fausses factures, faux intermédiaires, paiements, litiges, protection",
                            ["Vérifier les fournisseurs et les documents avant de payer.",
                             "Reconnaître les fausses factures et les faux intermédiaires.",
                             "Vérifier les coordonnées bancaires et sécuriser les paiements.",
                             "Comprendre les moyens de paiement internationaux.",
                             "Gérer les litiges et protéger ses marchandises."]):
        A(f)
    A(H2("11.1 Vérifier avant de payer : le réflexe de sécurité"))
    A(P("La sécurité des transactions repose sur un principe simple : <b>ne jamais payer avant "
        "d'avoir vérifié</b>. Les vérifications du chapitre 3 (identité, réputation, échantillon) "
        "sont complétées ici par la vérification des <b>documents</b> (factures, certificats) et des "
        "<b>coordonnées bancaires</b>. Chaque paiement doit correspondre à une facture, à une "
        "commande confirmée et à un compte au nom de l'entreprise fournisseur."))
    A(H2("11.2 Éviter les fausses factures"))
    A(P("Une fausse facture peut servir à gonfler une valeur, à dissimuler une origine ou à justifier "
        "un paiement frauduleux. Signes d'alerte : facture sans en-tête officiel, sans numéro, sans "
        "coordonnées vérifiables, montants incohérents avec le devis, demande de paiement vers un "
        "compte différent de celui de la facture. Prévention : exigez des factures numérotées sur "
        "papier à en-tête, rapprochez chaque facture du devis et de la commande, et refusez tout "
        "paiement qui ne correspond pas exactement à un document vérifié."))
    A(H2("11.3 Reconnaître les faux intermédiaires"))
    A(P("Le faux intermédiaire se présente comme fabricant ou représentant officiel, encaisse les "
        "acomptes et disparaît — ou livre une marchandise sans rapport avec la commande. Signes "
        "d'alerte : refus de fournir la licence et l'adresse d'usine, communication uniquement par "
        "messagerie instantanée, pression pour payer vite, prix irréalistes, coordonnées bancaires "
        "personnelles. Prévention : vérification d'identité (chapitre 3), échantillon, paiement "
        "sécurisé et progressif, inspection tierce pour les gros volumes."))
    A(H2("11.4 Vérifier les coordonnées bancaires"))
    A(B(["Le compte destinataire doit être <b>au nom de l'entreprise fournisseur</b> (raison sociale identique à la facture).",
         "L'<b>IBAN / SWIFT</b> doit correspondre au pays de l'entreprise.",
         "Tout <b>changement de coordonnées</b> en cours d'opération doit être confirmé par un appel téléphonique au numéro officiel connu.",
         "Conservez les <b>preuves de paiement</b> et les références de virement."]))
    A(H2("11.5 Les moyens de paiement internationaux"))
    A(styled_table(["Moyen", "Fonctionnement", "Sécurité / usage"],
                   [["<b>Virement (T/T)</b>", "Transfert direct vers le compte du fournisseur",
                     "Rapide mais irréversible ; acompte + solde contre documents"],
                    ["<b>Crédit documentaire (L/C)</b>", "La banque du fournisseur paie contre documents conformes",
                     "Sécurité maximale pour gros volumes ; coûts et formalités"],
                    ["<b>Remise documentaire (D/P, D/A)</b>", "Documents contre paiement (D/P) ou acceptation (D/A)",
                     "Intermédiaire ; dépend de la fiabilité des banques"],
                    ["<b>Escrow / séquestre</b>", "Un tiers retient les fonds jusqu'à livraison conforme",
                     "Sécurise les premières commandes ; frais à prévoir"],
                    ["<b>Cartes / plateformes</b>", "Paiement via plateformes de commerce en ligne",
                     "Petits montants et échantillons ; limites de montant"]],
                   widths=[3.5 * cm, 6.5 * cm, 7 * cm]))
    A(Spacer(1, 4))
    A(P("Règle de prudence pour débuter : <b>acompte modéré</b> (souvent 30 % à la commande), "
        "<b>solde contre documents d'expédition</b> (connaissement, facture, colisage), jamais 100 % "
        "d'avance à un nouveau fournisseur. Pour les gros volumes, le crédit documentaire ou l'escrow "
        "sont les options les plus sûres."))
    A(H2("11.6 Arbre de décision : quel moyen de paiement choisir ?"))
    A(styled_table(["Votre situation", "Moyen recommandé", "Pourquoi"],
                   [["Premier achat, petit montant, fournisseur nouveau", "Escrow ou acompte faible + solde contre documents",
                     "Limite l'exposition en cas d'arnaque"],
                    ["Commande moyenne, fournisseur vérifié", "Virement : acompte 30 % + solde contre B/L",
                     "Équilibre entre confiance et sécurité"],
                    ["Gros volume, nouveau fournisseur", "Crédit documentaire (L/C)",
                     "La banque paie contre documents conformes"],
                    ["Fournisseur de confiance, réassorts réguliers", "Virement avec délais négociés",
                     "Simplicité et relation commerciale"],
                    ["Échantillons et petits montants", "Plateformes / cartes",
                     "Rapidité pour les tests"]],
                   widths=[5.5 * cm, 5.5 * cm, 6 * cm]))
    A(Spacer(1, 4))
    A(H2("11.7 Gérer les litiges"))
    A(NUM(["<b>Prévention</b> : contrat écrit, cahier des charges, échantillon de référence, inspection.",
           "<b>Constat</b> : photographiez, conservez les emballages, dressez un procès-verbal de réception.",
           "<b>Réclamation</b> : notifiez le fournisseur par écrit avec preuves, dans les délais contractuels.",
           "<b>Recours</b> : négociation, médiation (chambre de commerce), arbitrage (OHADA / CCI), "
           "procédures judiciaires en dernier ressort."]))
    A(H2("11.8 Étude de cas : gérer un litige fournisseur"))
    A(callout("Cas pédagogique — livraison non conforme",
              "Vous réceptionnez 1 000 unités dont 150 présentent un défaut de finition. "
              "<b>1. Constat :</b> photographiez les défauts, conservez les emballages, dressez un "
              "procès-verbal de réception chiffré (150/1 000). <b>2. Notification :</b> écrivez au "
              "fournisseur sous 7 jours avec photos et références de commande, en demandant "
              "remplacement ou crédit. <b>3. Négociation :</b> proposez une solution (remplacement "
              "des 150 unités, crédit sur la prochaine commande, ou remise). <b>4. À défaut "
              "d'accord :</b> saisissez la médiation (chambre de commerce), puis l'arbitrage "
              "(OHADA/CCI) avec votre dossier complet (contrat, échantillon de référence, photos, "
              "correspondances). <i>Leçon : un dossier écrit et des preuves dès la réception "
              "rendent le litige gérable ; sans preuves, il est perdu d'avance.</i>"))
    A(H2("11.9 Protéger ses marchandises"))
    A(P("La protection commence à l'<b>emballage</b> (renforcé, adapté au transport), se poursuit "
        "par l'<b>assurance tous risques</b> (chapitre 6) et se termine par une <b>réception "
        "contrôlée</b> : vérifiez quantités, références et état à l'arrivée, et signalez toute "
        "réserve immédiatement au transporteur et à l'assureur."))
    for f in exercise_box("Exercice 11.1 — Détecter une fraude",
            "Un « fournisseur » vous demande de virer 100 % d'avance vers un compte personnel, "
            "refuse l'échantillon et vous presse de payer aujourd'hui. Décidez et justifiez.",
            "Refus immédiat : 100 % d'avance, compte personnel, refus d'échantillon et pression "
            "temporelle sont quatre signaux d'arnaque majeurs. Appliquez la règle des trois "
            "vérifications (chapitre 3) et les règles de paiement progressif (11.5)."):
        A(f)
    A(Paragraph("Ce qu'il faut retenir du chapitre 11", S["h3"]))
    A(B(['Vérifier avant de payer : identité, coordonnées bancaires, cohérence documentaire.', 'Aucun paiement intégral à un fournisseur non vérifié, surtout pour une première commande.', 'Les moyens de paiement se choisissent selon le montant et le niveau de confiance.', 'Un litige se gagne avec des preuves écrites, collectées dès la réception.']))
    A(Paragraph("Check-list du chapitre 11", S["h3"]))
    A(B(["Identité, documents et coordonnées bancaires vérifiés avant paiement.",
         "Paiement progressif et sécurisé (acompte + solde contre documents).",
         "Assurance tous risques et réception contrôlée organisées.",
         "Preuves conservées (contrat, factures, virements, photos)."]))
    A(PageBreak())

    # ================================================================
    # CHAPITRE 12
    # ================================================================
    for f in chapter_opener(12, "Créer son entreprise d'import-export",
                            "Étude de marché, statut, formalités, business plan, financement, organisation, clients, développement",
                            ["Réaliser une étude de marché et un business plan.",
                             "Choisir un statut juridique et accomplir les formalités.",
                             "Rechercher un financement adapté.",
                             "Organiser ses opérations et trouver ses clients.",
                             "Construire une stratégie de développement international."]):
        A(f)
    A(H2("12.1 L'étude de marché"))
    A(P("L'étude de marché prolonge le chapitre 2 à l'échelle de l'entreprise : taille du marché, "
        "segments de clientèle, concurrents, prix, canaux de distribution, tendances. Elle se "
        "conclut par un <b>positionnement</b> : quels produits, pour quels clients, à quels prix, "
        "par quels canaux. Sans étude de marché, le business plan n'est qu'une liste de souhaits."))
    A(H2("12.2 Le choix du statut juridique"))
    A(P("Le choix du statut dépend de votre activité, de vos associés, de votre responsabilité et de "
        "vos obligations fiscales. Dans l'espace OHADA (dont le Bénin), les formes courantes sont "
        "l'<b>entreprise individuelle</b>, la <b>SARL</b> (société à responsabilité limitée) et la "
        "<b>SA</b> (société anonyme). Chaque forme a ses avantages et ses formalités : faites-vous "
        "conseiller par un juriste ou un centre de formalités (APIEx / guichet unique) avant de "
        "choisir. Ce guide ne remplace pas un conseil juridique personnalisé."))
    A(H2("12.3 Les formalités de création"))
    A(NUM(["<b>Choix du statut</b> et rédaction des statuts (si société).",
           "<b>Immatriculation</b> au registre du commerce (RCCM) et identification fiscale.",
           "<b>Ouverture d'un compte bancaire professionnel</b> au nom de l'entreprise.",
           "<b>Autorisations sectorielles</b> éventuelles (selon les produits).",
           "<b>Identification douanière</b> : code importateur/exportateur et relations avec un transitaire agréé."]))
    A(P("Les formalités exactes et les pièces à fournir se vérifient sur les sites officiels "
        "(APIEx, guichet unique, RCCM) à la date de votre création."))
    A(H2("12.4 Le business plan"))
    A(P("Le business plan structure votre projet : présentation, produits, marché, stratégie "
        "commerciale, organisation, prévisions financières (chiffre d'affaires, coûts, trésorerie, "
        "seuil de rentabilité) et besoins de financement. Le Bonus 6 fournit un <b>modèle complet "
        "et commenté</b> de business plan pour une activité d'import-export."))
    A(H2("12.5 La recherche de financement"))
    A(B(["<b>Fonds propres</b> : apport personnel et réinvestissement des marges.",
         "<b>Crédit bancaire</b> : business plan, garanties, historique — les banques financent les projets chiffrés.",
         "<b>Microfinance / dispositifs d'appui</b> : selon les montants et les profils (à vérifier auprès des institutions locales).",
         "<b>Associés / investisseurs</b> : pacte d'associés clair dès le départ."]))
    A(P("Dans tous les cas, dimensionnez le financement sur le <b>besoin réel</b> (prix de revient "
        "complet + trésorerie + réserve), pas sur le seul prix d'achat."))
    A(H2("12.6 L'organisation des opérations"))
    A(P("Structurez vos opérations comme une chaîne (chapitre 1) : achats, logistique, douane, "
        "stockage, ventes, comptabilité. Définissez des <b>procédures écrites</b> (check-lists des "
        "bonus), des <b>responsabilités</b> et un <b>tableau de bord</b> (marges par produit, délais, "
        "ruptures, trésorerie). Même seul, un entrepreneur doit s'imposer des procédures : c'est ce "
        "qui distingue une entreprise d'une succession d'opérations."))
    A(H2("12.7 La recherche de clients et la stratégie commerciale"))
    A(P("Pour l'importateur : boutiques, marchés, grossistes, revendeurs, e-commerce, réseaux "
        "sociaux. Pour l'exportateur : acheteurs étrangers, plateformes B2B, salons, réseaux "
        "diplomatiques et chambres de commerce. La stratégie commerciale combine <b>prix "
        "compétitifs, disponibilité régulière, qualité constante et service client</b>. La "
        "fidélisation (délais tenus, réassorts rapides, conditions de paiement adaptées) vaut plus "
        "que la prospection permanente."))
    A(H2("12.8 Exemple de prévisions financières (pédagogique)"))
    A(P("Le tableau ci-dessous illustre la structure d'un prévisionnel sur 12 mois. Remplacez les "
        "montants fictifs par vos hypothèses réelles (chapitres 2 et 10)."))
    A(styled_table(["Mois", "Unités vendues", "CA (exemple)", "Coûts variables", "Marge brute", "Charges fixes", "Résultat"],
                   [["M1", "200", "3 142", "2 200", "942", "2 200", "−1 258"],
                    ["M3", "350", "5 499", "3 850", "1 649", "2 200", "−551"],
                    ["M6", "467", "7 336", "5 137", "2 199", "2 200", "−1"],
                    ["M9", "600", "9 426", "6 600", "2 826", "2 200", "626"],
                    ["M12", "750", "11 783", "8 250", "3 533", "2 200", "1 333"]],
                   widths=[1.8 * cm, 2.8 * cm, 2.6 * cm, 2.8 * cm, 2.4 * cm, 2.4 * cm, 2.2 * cm]))
    A(Spacer(1, 4))
    A(P("Lecture : le seuil de rentabilité (≈ 467 unités, exercice 10.5) est atteint vers le 6e mois. "
        "Avant, l'activité est déficitaire : le financement doit couvrir ce déficit de démarrage "
        "ainsi que le besoin en fonds de roulement (stock + délais clients). C'est exactement ce que "
        "le business plan (Bonus 6) doit démontrer aux financeurs."))
    A(H2("12.9 Organisation type d'une PME d'import-export"))
    A(styled_table(["Fonction", "Responsabilités", "Outils"],
                   [["Achats", "Prospection fournisseurs, négociation, commandes, suivi qualité",
                     "Fiches fournisseurs, check-list Bonus 2, modèles Bonus 1"],
                    ["Logistique & douane", "Transport, assurance, documents, dédouanement, enlèvement",
                     "Devis transitaires, check-list Bonus 4, tracking"],
                    ["Stock & ventes", "Réception, stockage, pricing, prospection clients, encaissement",
                     "Modèle de calcul Bonus 3, tableau de bord des marges"],
                    ["Comptabilité & trésorerie", "Facturation, BFR, prévisions, financement",
                     "Business plan Bonus 6, prévisionnels mensuels"],
                    ["Direction", "Stratégie, décisions, développement",
                     "Revue mensuelle des indicateurs"]],
                   widths=[4 * cm, 7 * cm, 6 * cm]))
    A(Spacer(1, 4))
    A(P("Même en démarrant seul, attribuez-vous ces fonctions par écrit et suivez un tableau de bord "
        "mensuel : marges par produit, délais fournisseurs, ruptures de stock, trésorerie. "
        "L'organisation écrite est le premier facteur de pérennité d'une entreprise d'import-export."))
    A(H2("12.10 Le développement international"))
    A(P("Le développement suit une logique d'<b>étapes</b> : consolider le marché national, puis "
        "élargir la gamme, puis explorer les marchés régionaux (CEDEAO, ZLECAf), puis les marchés "
        "internationaux. Chaque étape suppose de nouvelles compétences (réglementations, langues, "
        "logistique) et de nouveaux partenaires. L'organigramme ci-dessous illustre la logique "
        "d'une opération d'exportation, modèle de votre développement vers l'étranger."))
    for f in img("infographie-export.png", 16,
                 "Figure 8 — Organigramme d'une opération d'exportation : de la prospection à l'encaissement."):
        A(f)
    for f in exercise_box("Exercice 12.1 — Mini business plan",
            "Rédigez en 10 lignes le business plan de votre projet : produit, marché, prix de "
            "revient, prix de vente, marge, volumes visés, financement, premiers clients.",
            "Attendu : produit et marché issus des chapitres 2 et 5, prix de revient du chapitre 10, "
            "financement dimensionné sur le besoin réel (12.5), clients identifiés (12.7). "
            "Développez ensuite avec le modèle du Bonus 6."):
        A(f)
    A(H2("12.11 Les indicateurs à suivre chaque mois"))
    A(P("Une entreprise d'import-export se pilote avec peu d'indicateurs, mais suivis "
        "régulièrement. Le tableau ci-dessous constitue votre <b>tableau de bord minimal</b> : "
        "une ligne par indicateur, une colonne par mois."))
    A(styled_table(["Indicateur", "Formule / contenu", "Signal d'alerte"],
                   [["Marge brute par produit", "(Prix de vente − Prix de revient) ÷ Prix de vente",
                     "Marge en baisse deux mois de suite"],
                    ["Rotation des stocks", "Unités vendues ÷ Stock moyen",
                     "Stock qui vieillit, produits invendus"],
                    ["Délai fournisseur réel", "Date de réception − Date de commande",
                     "Écart croissant avec le délai annoncé"],
                    ["Délai de dédouanement", "Date d'enlèvement − Date d'arrivée",
                     "Surestaries, frais de stockage"],
                    ["Taux de conformité", "Unités conformes ÷ Unités reçues",
                     "Sous 97 % : réclamation fournisseur"],
                    ["Trésorerie disponible", "Solde + encaissements prévus − sorties prévues",
                     "Moins de 2 semaines de charges"],
                    ["Taux de recouvrement", "Créances encaissées ÷ Créances échues",
                     "Clients en retard de paiement"]],
                   widths=[4.5 * cm, 7 * cm, 5.5 * cm]))
    A(Spacer(1, 4))
    A(callout("Méthode de pilotage",
              "Tenez ce tableau de bord <b>mensuellement</b>, même quand tout va bien : c'est la "
              "comparaison des mois qui révèle les dérives (fret qui augmente, marge qui s'érode, "
              "délais qui s'allongent). Trois chiffres suffisent pour décider : la marge, le délai "
              "et la trésorerie."))
    A(Paragraph("Ce qu'il faut retenir du chapitre 12", S["h3"]))
    A(B(['Étude de marché, statut, formalités, financement, organisation : cinq chantiers du lancement.', 'Le business plan démontre la rentabilité et le besoin de financement.', "L'organisation écrite (procédures, tableau de bord) fait la différence dès les premières opérations.", 'Le développement international se prépare : nouveaux marchés, nouveaux clients, nouveaux produits.']))
    A(Paragraph("Check-list du chapitre 12", S["h3"]))
    A(B(["Étude de marché réalisée et positionnement défini.",
         "Statut choisi avec conseil juridique ; formalités accomplies.",
         "Business plan rédigé (Bonus 6) et financement dimensionné.",
         "Opérations organisées par procédures et tableau de bord.",
         "Stratégie clients et plan de développement définis."]))
    A(PageBreak())

    # ================================================================
    # ÉTUDE DE CAS INTÉGRÉE
    # ================================================================
    A(MarkParagraph("cas", "Étude de cas intégrée — Une première importation de bout en bout", S["h1"]))
    A(HR())
    A(P("Cette étude de cas fictive mobilise <b>tous les chapitres</b> du guide. Les montants sont "
        "pédagogiques et les taux de droits et taxes ne sont pas reproduits : ils doivent être "
        "vérifiés sur les sources officielles (chapitre 9). L'objectif est de vous montrer "
        "l'enchaînement complet d'une opération, du choix du produit à la vente."))
    A(callout("Le contexte (fictif)",
              "<b>Awa D.</b>, commerçante à Cotonou, veut lancer une activité d'importation "
              "d'accessoires de téléphone. Elle dispose de <b>6 000 000 FCFA</b> d'épargne et de "
              "3 mois pour réaliser sa première opération. Elle travaille seule, à temps partiel, "
              "et veut limiter son risque."))

    A(H2("Étape 1 — Le produit (chap. 2)"))
    A(P("Awa visite 12 boutiques et 2 marchés. Elle relève les prix pratiqués, constate des "
        "ruptures fréquentes sur les chargeurs rapides et une qualité irrégulière. Elle interroge "
        "20 clients : la sensibilité au prix est forte, mais la garantie d'un mois est un argument "
        "de différenciation. Elle compare trois produits avec la matrice du chapitre 2 : "
        "<b>accessoires téléphone (53/60)</b>, cosmétiques (40/60), ustensiles de cuisine (44/60). "
        "Elle retient les accessoires, pour la demande forte, la logistique simple et l'absence "
        "d'autorisation sanitaire lourde. Elle vérifie néanmoins les normes électriques des "
        "chargeurs."))

    A(H2("Étape 2 — Les fournisseurs (chap. 3)"))
    A(P("Elle contacte 8 fournisseurs sur deux plateformes B2B et obtient 5 devis comparables. "
        "Elle élimine deux comptes récents et un fournisseur refusant l'échantillon. Elle retient "
        "trois candidats, remplit sa fiche de comparaison (chapitre 3) et vérifie l'identité de "
        "chacun (licence, ancienneté, références clients). Elle commande <b>deux échantillons</b> "
        "(coût total ≈ 120 000 FCFA, fret inclus) et les teste pendant deux semaines."))

    A(H2("Étape 3 — Négociation et commande (chap. 4)"))
    A(P("L'échantillon du fournisseur A résiste mieux et charge plus vite. Awa négocie : prix "
        "unitaire ramené de 4,80 USD à 4,10 USD, MOQ de 1 000 unités, délai 25 jours, emballage "
        "renforcé, échantillon de production avant expédition. Elle obtient un <b>accord écrit</b> "
        "(facture pro forma signée) et paie un acompte de 30 % par virement, après vérification "
        "des coordonnées bancaires (chapitre 11)."))

    A(H2("Étape 4 — Incoterm et transport (chap. 6 et 7)"))
    A(P("Elle choisit <b>FOB Shenzhen</b> pour garder le contrôle du fret et travailler avec son "
        "propre transitaire à Cotonou. Elle compare trois devis de groupage (LCL) : le volume est "
        "de 2,4 m³, ce qui justifie un groupage plutôt qu'un conteneur complet. Elle retient un "
        "transitaire agréé, avec devis détaillé, et souscrit une <b>assurance tous risques</b> "
        "couvrant la valeur de la marchandise, le fret et sa marge prévisionnelle."))

    A(H2("Étape 5 — Documents (chap. 8)"))
    A(B(["Facture commerciale définitive avec Incoterm et port de destination.",
         "Liste de colisage cohérente avec la facture (cartons, poids brut/net, dimensions).",
         "Connaissement maritime (B/L) émis au nom de son transitaire ou « to order ».",
         "Certificat d'origine du fabricant, visé par l'autorité compétente.",
         "Attestation d'assurance transport.",
         "Attestations de conformité électrique des chargeurs, si disponibles et requises."]))
    A(P("Elle applique la check-list du Bonus 4 et fait relire le dossier par son transitaire "
        "<b>avant</b> le départ du navire. Aucune incohérence n'est laissée au hasard."))

    A(H2("Étape 6 — Douane et fiscalité (chap. 9)"))
    A(P("Awa ne devine aucun taux. Elle fait classer le produit (code SH) par son transitaire agréé, "
        "puis vérifie sur les sources officielles (douane du Bénin, TEC CEDEAO) les droits et taxes "
        "applicables au code retenu et à l'origine de la marchandise. Elle prépare la trésorerie "
        "nécessaire à la liquidation avant l'arrivée du navire, car sans paiement, pas "
        "d'enlèvement — et les frais de stockage courent."))

    A(H2("Étape 7 — Prix de revient et marge (chap. 10)"))
    A(styled_table(["Poste (montants pédagogiques)", "Montant", "Source"],
                   [["Achat marchandise (1 000 unités)", "2 500 000", "Facture fournisseur"],
                    ["Fret maritime groupage + frais au départ", "700 000", "Devis transitaire"],
                    ["Assurance transport", "90 000", "Devis assureur"],
                    ["Transit, manutention, dédouanement", "250 000", "Devis transitaire"],
                    ["Droits et taxes (à vérifier sur sources officielles)", "à compléter", "Douane / TEC"],
                    ["Stockage et livraison intérieure", "120 000", "Tarifs port / transporteur"],
                    ["<b>Total hors droits et taxes</b>", "<b>3 660 000</b>", ""],
                    ["<b>Prix de revient unitaire hors droits</b>", "<b>3 660 FCFA</b>", ""]],
                   widths=[8 * cm, 4 * cm, 5 * cm]))
    A(Spacer(1, 4))
    A(P("En ajoutant les droits et taxes réels (ligne à compléter auprès de la douane), Awa obtient "
        "son prix de revient définitif. Elle fixe son prix de vente à partir du prix de revient "
        "<b>complet</b>, avec une marge cible de 30 % et une réserve de trésorerie de 15 %. "
        "Elle vérifie que ce prix reste compétitif face aux 16,00 constatés sur le marché pour des "
        "produits comparables, et prépare un scénario pessimiste (fret +20 %)."))

    A(H2("Étape 8 — Réception, vente et apprentissage (chap. 11 et 12)"))
    A(P("À l'arrivée, elle contrôle les quantités et l'état, photographie les colis, vérifie la "
        "conformité aux échantillons validés et retourne le conteneur dans les délais. Elle lance "
        "la vente auprès de 15 revendeurs et de ses clients directs, avec une garantie d'un mois "
        "qui la différencie. Elle suit ses marges réelles par produit et note les écarts avec ses "
        "prévisions : fret plus élevé que prévu, délai de dédouanement plus long, meilleure rotation "
        "que prévu sur un modèle."))
    A(callout("Ce que cette étude de cas démontre",
              "<b>1.</b> La méthode remplace l'intuition : chaque étape a un outil (matrice, fiche "
              "de comparaison, calcul du prix de revient, check-lists). <b>2.</b> Le risque se "
              "réduit par le petit volume, l'échantillon, l'acompte et l'assurance. <b>3.</b> Les "
              "informations réglementaires se vérifient, elles ne se devinent pas. <b>4.</b> La "
              "deuxième opération est plus rentable que la première, parce que les coûts réels et "
              "les délais réels sont désormais connus : c'est l'expérience acquise qui crée la "
              "marge durable."))
    A(PageBreak())

    # ================================================================
    # BONUS 1
    # ================================================================
    A(MarkParagraph("b1", "BONUS 1 — 30 messages professionnels pour contacter les fournisseurs", S["h1"]))
    A(HR())
    A(P("Ces 30 messages sont des <b>modèles pédagogiques</b> à adapter (produit, quantités, "
        "destination). Ils sont rédigés en anglais (langue du commerce international) avec "
        "traduction ou équivalent français pour les messages clés. Remplacez les crochets par vos "
        "informations."))
    msgs = [
        ("1. Premier contact / demande de devis (EN)",
         "Dear Supplier, I am an importer based in [Benin/Cotonou]. I am interested in [product, reference]. Please send your quotation including unit price, MOQ, production time, packaging, weight and dimensions, Incoterm and payment terms. Destination: Cotonou. Thank you."),
        ("2. Demande de catalogue (EN)",
         "Dear Sir/Madam, please send your product catalogue with references, photos, MOQ and price lists for [product category]. I import for the [country] market and look for a reliable long-term supplier."),
        ("3. Demande d'échantillon (EN)",
         "Dear Supplier, before a bulk order, I would like to receive a sample of [product, reference]. Please confirm the sample cost, shipping cost to Cotonou and delivery time. I will pay the shipping costs."),
        ("4. Négociation de prix (EN)",
         "Thank you for your quotation. Your price is above our budget. Two other suppliers offered [price]. Could you align on [target price] for [quantity] units, with a trial order and larger volumes to follow? Please confirm your best price in writing."),
        ("5. Négociation de la MOQ (EN)",
         "Your MOQ of [qty] is above our first-order budget. Could you accept a trial order of [smaller qty] for a first test, with larger orders to follow if the quality is satisfactory?"),
        ("6. Demande de délai de production (EN)",
         "Please confirm your production time for [quantity] units and the earliest shipment date to Cotonou. We need delivery before [date]."),
        ("7. Demande de précision sur l'emballage (EN)",
         "Please describe your packaging in detail (cartons, pallets, protection) and confirm the gross weight and carton dimensions. We need packaging suitable for sea transport."),
        ("8. Demande de certificat d'origine (EN)",
         "Please provide the certificate of origin for this shipment. It is required for customs clearance at destination."),
        ("9. Confirmation de commande (EN)",
         "Dear [Supplier], we confirm our order: [product, ref], quantity [qty], unit price [price], total [total], Incoterm [FOB/CIF] [port], production time [days], payment terms [terms]. Please confirm acceptance in writing and send the pro forma invoice."),
        ("10. Demande de facture pro forma (EN)",
         "Please send the pro forma invoice for our confirmed order, including all details (references, quantities, prices, Incoterm, destination port)."),
        ("11. Demande de rapport d'inspection (EN)",
         "Before shipment, please send photos and a quality inspection report of the finished goods. We will confirm before loading."),
        ("12. Demande de correction d'échantillon (EN)",
         "We received the sample. The quality is close but [defect] needs improvement. Could you correct it and send a new sample before production?"),
        ("13. Demande de suivi de production (EN)",
         "Please update us on the production progress. We need confirmation of the completion date and shipment schedule."),
        ("14. Demande de documents d'expédition (EN)",
         "Please send copies of the commercial invoice, packing list and bill of lading / air waybill as soon as the goods are shipped."),
        ("15. Demande de réduction pour gros volume (EN)",
         "For a larger order of [qty] units, what is your best unit price? We plan regular reorders every [period]."),
        ("16. Demande de conditions de paiement (EN)",
         "We propose [30% advance / deposit, balance against shipping documents]. Please confirm if these payment terms are acceptable."),
        ("17. Demande de garantie (EN)",
         "Please confirm your warranty policy for this product (duration, replacement conditions, claim procedure)."),
        ("18. Demande de références clients (EN)",
         "Could you provide references of existing customers, especially in Africa? We would like to verify your delivery record."),
        ("19. Demande de licence commerciale (EN)",
         "Please send a copy of your business licence and your factory address. We verify all new suppliers before our first order."),
        ("20. Demande de devis FOB et CIF (EN)",
         "Please quote both FOB [port] and CIF Cotonou for [quantity] units, so we can compare total landed costs."),
        ("21. Demande de délai d'expédition (EN)",
         "What is the earliest shipment date after production? Please confirm the vessel / flight schedule to Cotonou."),
        ("22. Demande de poids et dimensions (EN)",
         "Please confirm the exact gross weight, net weight and carton dimensions for the full shipment. We need them for freight and customs."),
        ("23. Réclamation qualité (EN)",
         "We found [defect] on [qty] units. Please find attached photos. We request [replacement / credit / corrective action]. Please reply within [days]."),
        ("24. Demande de réassort (EN)",
         "The first order was satisfactory. We would like to reorder [product, ref], quantity [qty], at the same conditions. Please send a new quotation."),
        ("25. Demande d'étiquetage personnalisé (EN)",
         "Could you provide custom labelling / branding for our order? Please confirm the additional cost and minimum quantity."),
        ("26. Demande de certificat de conformité (EN)",
         "Please provide the certificates of conformity / test reports for this product, if available."),
        ("27. Demande de prix dégressif (EN)",
         "Please send your price list for [qty1] / [qty2] / [qty3] units so we can plan our order volumes."),
        ("28. Demande de confirmation d'Incoterm (EN)",
         "Please confirm in writing the Incoterm for this order ([FOB/CIF/DAP…] [place]) and what it includes (freight, insurance, customs)."),
        ("29. Demande de traduction / précision (FR)",
         "Bonjour, merci pour votre devis. Pourriez-vous préciser le délai de production, le type d'emballage et les conditions de paiement ? Nous souhaitons commander [quantité] unités vers Cotonou."),
        ("30. Message de clôture / remerciement (EN)",
         "Thank you for your cooperation. We look forward to a successful long-term partnership. Please keep us updated on any new products in [category]."),
    ]
    for title, body in msgs:
        A(Paragraph(title, S["h3"]))
        A(callout("Modèle", f"<i>{body}</i>", bg=LIGHT, border=NAVY3))
        A(Spacer(1, 2))
    A(PageBreak())

    # ================================================================
    # BONUS 2
    # ================================================================
    A(MarkParagraph("b2", "BONUS 2 — Check-list de vérification d'un fournisseur", S["h1"]))
    A(HR())
    A(P("À appliquer à <b>chaque nouveau fournisseur</b>, sans exception, avant tout paiement. "
        "Cochez chaque point ; un seul point rouge bloque la commande."))
    checks2 = [
        "Raison sociale complète et licence commerciale reçues et vérifiées.",
        "Adresse d'usine / d'entrepôt fournie et cohérente avec les documents.",
        "Site web professionnel et ancienneté sur la plateforme vérifiées.",
        "Badges « fournisseur vérifié » et avis clients contrôlés.",
        "Références clients demandées (et contactées si possible).",
        "Coordonnées bancaires au nom de l'entreprise (raison sociale identique).",
        "IBAN / SWIFT cohérent avec le pays de l'entreprise.",
        "Échantillon reçu, examiné et testé (fiche d'évaluation remplie).",
        "Devis écrit comparé à au moins deux autres offres.",
        "Cahier des charges qualité défini par écrit (photos + échantillon de référence).",
        "Incoterm, délais et conditions de paiement confirmés par écrit.",
        "Aucun signal d'arnaque présent (prix irréaliste, pression, refus de documents).",
        "Paiement progressif et sécurisé prévu (acompte + solde contre documents).",
        "Inspection tierce envisagée pour les gros volumes.",
        "Historique de communication conservé (e-mails, devis, factures).",
    ]
    for c in checks2:
        A(Paragraph(f"[&nbsp;&nbsp;]&nbsp;&nbsp;&nbsp;{c}", S["bullet"]))
    A(Spacer(1, 6))
    A(callout("Règle d'application",
              "Si un point ne peut pas être vérifié, <b>ne payez pas</b>. Demandez le document "
              "manquant par écrit. Un fournisseur sérieux fournit toutes les preuves sans difficulté."))
    A(Spacer(1, 6))
    A(Paragraph("Grille de notation du fournisseur (sur 100)", S["h2"]))
    A(P("Pour comparer objectivement plusieurs fournisseurs, notez chaque bloc et additionnez. "
        "Un score inférieur à 60 signale un risque trop élevé pour une première commande."))
    A(styled_table(["Bloc évalué", "Points", "Ce que vous notez"],
                   [["Identité et existence légale", "/ 20",
                     "Licence, adresse, ancienneté, cohérence des documents"],
                    ["Réputation et références", "/ 15",
                     "Avis clients, références vérifiables, historique de la plateforme"],
                    ["Qualité de l'échantillon", "/ 25",
                     "Conformité au cahier des charges, finitions, fonctionnalité"],
                    ["Transparence commerciale", "/ 15",
                     "Devis complet, prix cohérents, réponses précises aux questions"],
                    ["Conditions de paiement", "/ 15",
                     "Compte au nom de l'entreprise, paiement progressif accepté"],
                    ["Communication et réactivité", "/ 10",
                     "Délai de réponse, qualité de la langue, documentation fournie"],
                    ["<b>TOTAL</b>", "<b>/ 100</b>", "<b>Décision : commander / négocier / écarter</b>"]],
                   widths=[5.5 * cm, 2.5 * cm, 9 * cm]))
    A(Spacer(1, 4))
    A(Paragraph("Les documents à obtenir avant de payer", S["h2"]))
    A(styled_table(["Document", "À quoi il sert", "Point de contrôle"],
                   [["Licence / registre du commerce", "Prouver l'existence légale", "Nom identique à la facture"],
                    ["Coordonnées bancaires officielles", "Sécuriser le virement", "Compte au nom de la société"],
                    ["Devis signé / pro forma", "Fixer prix, MOQ, délai, Incoterm", "Toutes les mentions présentes"],
                    ["Fiche technique produit", "Vérifier la conformité", "Normes et matières indiquées"],
                    ["Rapport d'échantillon", "Comparer objectivement", "Notes et observations écrites"],
                    ["Références clients", "Vérifier la fiabilité", "Contacts réellement joignables"]],
                   widths=[5 * cm, 5.5 * cm, 6.5 * cm]))
    A(Spacer(1, 6))
    A(callout("Comment contacter une référence sans perdre de temps",
              "Écrivez trois lignes : qui vous êtes, le produit que vous envisagez, et une seule "
              "question — « avez-vous été livré dans les délais annoncés et la qualité était-elle "
              "conforme à l'échantillon ? ». Une référence sérieuse répond ; une référence inventée "
              "par le fournisseur reste muette ou répond par politesse sans détail. Vérifiez que "
              "le contact est joignable autrement que par un numéro fourni par le fournisseur lui-même."))
    A(Spacer(1, 4))
    A(Paragraph("Le registre des fournisseurs : l'outil de long terme", S["h2"]))
    A(P("Tenez un tableau unique de tous vos fournisseurs, même écartés. Il vous évite de "
        "recommencer la prospection à chaque commande et documente votre historique commercial."))
    A(styled_table(["Colonne", "Contenu"],
                   [["Nom et pays", "Raison sociale, ville, continent"],
                    ["Contact", "Nom du chargé de compte, e-mail, messagerie professionnelle"],
                    ["Produits", "Références et catégories fournies"],
                    ["Score de vérification", "Note sur 100 (grille ci-dessus)"],
                    ["Conditions", "MOQ, prix, délai, Incoterm, paiement habituels"],
                    ["Historique", "Dates de commande, incidents, qualité constatée"],
                    ["Décision", "Actif, en veille, écarté (avec motif)"]],
                   widths=[5 * cm, 12 * cm]))
    A(PageBreak())

    # ================================================================
    # BONUS 3
    # ================================================================
    A(MarkParagraph("b3", "BONUS 3 — Modèle de calcul du prix de revient d'une importation", S["h1"]))
    A(HR())
    A(P("Remplissez ce tableau pour <b>chaque opération</b>, à partir de devis réels et des taux "
        "officiels en vigueur. Les montants ci-dessous sont des exemples pédagogiques fictifs."))
    A(styled_table(["Poste de coût", "Montant (exemple)", "Votre montant réel", "Source"],
                   [["Prix d'achat (fournisseur)", "5 500", "", "Devis / facture"],
                    ["Transport international (fret)", "1 800", "", "Devis transitaire"],
                    ["Assurance transport", "200", "", "Devis assureur"],
                    ["Frais de transit (manutention, dédouanement)", "500", "", "Devis transitaire"],
                    ["Droits de douane (exemple pédagogique)", "2 000", "", "Sources officielles"],
                    ["Taxes dont TVA import (exemple pédagogique)", "500", "", "Sources officielles"],
                    ["Stockage", "300", "", "Tarifs port / entrepôt"],
                    ["Livraison intérieure", "200", "", "Devis transporteur"],
                    ["<b>PRIX DE REVIENT TOTAL</b>", "<b>11 000</b>", "", ""],
                    ["Quantité (unités)", "1 000", "", ""],
                    ["<b>PRIX DE REVIENT UNITAIRE</b>", "<b>11,00</b>", "", ""],
                    ["Prix de vente visé (marge 30 %)", "15,71", "", "Marché (chap. 2)"],
                    ["Marge unitaire", "4,71", "", ""],
                    ["Marge totale (avant charges)", "4 710", "", ""]],
                   widths=[6 * cm, 3.5 * cm, 3.5 * cm, 4 * cm]))
    A(Spacer(1, 4))
    A(P("<b>Formules :</b> prix de revient unitaire = total ÷ quantité. Prix de vente à marge m % = "
        "prix de revient unitaire ÷ (1 − m/100). Marge unitaire = prix de vente − prix de revient "
        "unitaire. Réserve de prudence recommandée : 15 à 20 % du total."))
    A(Spacer(1, 6))
    A(Paragraph("Exemple de lecture complet (montants pédagogiques)", S["h2"]))
    A(P("Imaginons une commande de 1 000 unités. Le prix d'achat est de 5 500, le fret de 1 800, "
        "l'assurance de 200, le transit de 500, les droits et taxes de 2 500 au total (à vérifier "
        "auprès des sources officielles pour votre code SH réel), le stockage de 300 et la livraison "
        "de 200. Le prix de revient total est de <b>11 000</b>, soit <b>11,00 par unité</b>."))
    A(styled_table(["Étape du calcul", "Formule", "Résultat"],
                   [["Prix de revient total", "Somme de tous les postes", "11 000"],
                    ["Prix de revient unitaire", "11 000 ÷ 1 000", "11,00"],
                    ["Prix de vente pour 30 % de marge", "11,00 ÷ (1 − 0,30)", "15,71"],
                    ["Marge unitaire", "15,71 − 11,00", "4,71"],
                    ["Taux de marque", "4,71 ÷ 15,71", "30 %"],
                    ["Marge totale (1 000 unités)", "4,71 × 1 000", "4 710"],
                    ["Marge après réserve d'imprévus (15 %)", "4 710 − (0,15 × 4 710)", "4 004"]],
                   widths=[6 * cm, 6.5 * cm, 4.5 * cm]))
    A(Spacer(1, 4))
    A(callout("Attention — marge ou taux de marque ?",
              "Une <b>marge de 30 %</b> sur le prix de vente ne s'obtient pas en ajoutant 30 % au "
              "prix de revient. Sur un prix de revient de 11,00, ajouter 30 % donne 14,30, soit "
              "une marge de seulement <b>23 %</b> du prix de vente. La formule correcte est : "
              "prix de vente = prix de revient ÷ (1 − taux de marge souhaité). C'est l'erreur de "
              "calcul la plus fréquente — et la plus coûteuse."))
    A(Spacer(1, 4))
    A(Paragraph("Trois variantes à tester avant de commander", S["h2"]))
    A(styled_table(["Scénario", "Hypothèse", "Prix de revient unitaire", "Prix de vente à 30 %"],
                   [["Central", "Fret et droits conformes aux devis", "11,00", "15,71"],
                    ["Fret élevé", "Fret +20 %", "11,36", "16,23"],
                    ["Droits + contrôle", "Droits +10 %, stockage prolongé", "11,86", "16,94"]],
                   widths=[3.5 * cm, 6 * cm, 4 * cm, 3.5 * cm]))
    A(Spacer(1, 4))
    A(P("Si le marché n'accepte pas le prix du scénario pessimiste, l'opération n'est pas "
        "viable en l'état : renégociez le prix d'achat, réduisez le fret (groupage mieux optimisé, "
        "emballage plus compact), changez d'Incoterm, ou renoncez au produit. Décider avant de "
        "commander coûte zéro ; décider après coûte la marge."))
    A(PageBreak())

    # ================================================================
    # BONUS 4
    # ================================================================
    A(MarkParagraph("b4", "BONUS 4 — Check-list des documents avant expédition", S["h1"]))
    A(HR())
    A(P("À vérifier <b>avant le chargement</b>, avec le fournisseur et le transitaire. Un dossier "
        "incomplet à l'expédition devient un blocage à l'arrivée."))
    checks4 = [
        "Facture commerciale définitive (numérotée, en-tête officiel, Incoterm et lieu indiqués).",
        "Facture pro forma archivée et rapprochée de la facture définitive.",
        "Liste de colisage détaillée (colis, contenu, poids, dimensions, marques).",
        "Connaissement maritime (B/L) ou lettre de transport aérien (AWB) émis.",
        "Certificat d'origine (si requis ou si préférence tarifaire visée).",
        "Certificats de conformité / autorisations sectorielles (si requis).",
        "Police ou certificat d'assurance transport.",
        "Cohérence vérifiée : quantités, valeurs, poids et références identiques sur tous les documents.",
        "Photos de la marchandise et de l'emballage reçues et conformes.",
        "Rapport d'inspection reçu (pour les gros volumes).",
        "Dossier transmis au transitaire avant l'arrivée du navire / de l'avion.",
        "Trésorerie prête pour droits, taxes et frais d'enlèvement.",
    ]
    for c in checks4:
        A(Paragraph(f"[&nbsp;&nbsp;]&nbsp;&nbsp;&nbsp;{c}", S["bullet"]))
    A(Spacer(1, 6))
    A(Paragraph("Le rapprochement documentaire : la vérification qui évite tout", S["h2"]))
    A(P("La majorité des blocages en douane ne viennent pas d'un document manquant, mais d'un "
        "<b>écart entre deux documents</b>. Faites ce rapprochement ligne à ligne avant l'expédition."))
    A(styled_table(["Information", "Facture", "Colisage", "B/L ou AWB", "Certificat"],
                   [["Références produits", "Oui", "Oui", "—", "Oui"],
                    ["Quantités", "Oui", "Oui", "Oui", "Oui"],
                    ["Poids brut / net", "—", "Oui", "Oui", "Oui"],
                    ["Nombre de colis", "—", "Oui", "Oui", "Oui"],
                    ["Valeur", "Oui", "—", "—", "—"],
                    ["Incoterm + lieu", "Oui", "—", "—", "—"],
                    ["Pays d'origine", "Oui", "—", "—", "Oui"],
                    ["Port / aéroport", "Oui", "—", "Oui", "—"],
                    ["<b>Cohérence à vérifier</b>", "<b>Référence</b>", "= facture", "= colisage", "= facture"]],
                   widths=[4.5 * cm, 3 * cm, 3 * cm, 3.2 * cm, 3.3 * cm]))
    A(Spacer(1, 4))
    A(callout("Méthode des trois colonnes",
              "Pour chaque information sensible (quantité, poids, valeur, référence), notez la "
              "valeur figurant sur la facture, celle du colisage et celle du titre de transport. "
              "Les trois colonnes doivent être <b>identiques</b>. Un écart, même mineur, se "
              "justifie par écrit avant le départ du navire — jamais après."))
    A(PageBreak())

    # ================================================================
    # BONUS 5
    # ================================================================
    A(MarkParagraph("b5", "BONUS 5 — Glossaire de 100 termes du commerce international", S["h1"]))
    A(HR())
    A(P("Définitions synthétiques à but pédagogique. En cas de doute, reportez-vous aux sources "
        "officielles (OMC, OMD, CCI)."))
    gloss = [
        ("1. Importation", "Entrée de marchandises en provenance de l'étranger."),
        ("2. Exportation", "Sortie de marchandises vers l'étranger."),
        ("3. Importateur", "Personne qui fait entrer la marchandise et la vend sur le marché national."),
        ("4. Exportateur", "Personne qui vend à l'étranger des produits nationaux ou réexportés."),
        ("5. Grossiste", "Intermédiaire qui achète en gros pour revendre aux détaillants."),
        ("6. Distributeur", "Intermédiaire chargé de la distribution d'une marque sur un territoire."),
        ("7. Transitaire", "Intermédiaire qui organise le transport et les formalités douanières."),
        ("8. Transporteur", "Entreprise qui achemine physiquement la marchandise."),
        ("9. Commissionnaire", "Intermédiaire agissant pour le compte d'un client contre commission."),
        ("10. Fournisseur", "Entreprise qui vend la marchandise à l'importateur."),
        ("11. Fabricant", "Entreprise qui produit la marchandise."),
        ("12. Intermédiaire", "Acteur qui facilite la transaction sans être propriétaire de la marchandise."),
        ("13. Chaîne commerciale", "Succession des étapes et acteurs d'une opération internationale."),
        ("14. Balance commerciale", "Différence entre exportations et importations d'un pays."),
        ("15. Commerce extérieur", "Ensemble des échanges d'un pays avec l'étranger."),
        ("16. MOQ", "Quantité minimale de commande acceptée par le fournisseur."),
        ("17. Devis", "Offre chiffrée du fournisseur (prix, délais, conditions)."),
        ("18. Facture pro forma", "Facture estimative émise avant la commande définitive."),
        ("19. Facture commerciale", "Facture définitive de vente, base de la valeur en douane."),
        ("20. Bon de commande", "Document par lequel l'acheteur commande au fournisseur."),
        ("21. Liste de colisage", "Détail des colis : contenu, poids, dimensions."),
        ("22. Connaissement (B/L)", "Contrat de transport maritime et titre de propriété."),
        ("23. Lettre de transport aérien (LTA/AWB)", "Contrat de transport aérien."),
        ("24. Certificat d'origine", "Document attestant le pays d'origine de la marchandise."),
        ("25. Certificat de conformité", "Document attestant le respect des normes applicables."),
        ("26. Déclaration en douane", "Déclaration de la marchandise auprès de la douane."),
        ("27. Incoterms", "Règles de la CCI définissant les obligations vendeur/acheteur."),
        ("28. EXW", "Incoterm : marchandise à disposition à l'usine du vendeur."),
        ("29. FCA", "Incoterm : livraison au transporteur désigné par l'acheteur."),
        ("30. FAS", "Incoterm maritime : livraison le long du navire."),
        ("31. FOB", "Incoterm maritime : livraison à bord du navire."),
        ("32. CFR", "Incoterm maritime : coût et fret payés par le vendeur."),
        ("33. CIF", "Incoterm maritime : coût, assurance et fret payés par le vendeur."),
        ("34. CPT", "Incoterm : transport payé par le vendeur jusqu'à destination."),
        ("35. CIP", "Incoterm : transport et assurance payés par le vendeur."),
        ("36. DAP", "Incoterm : livraison au lieu de destination, prêt à décharger."),
        ("37. DPU", "Incoterm : livraison déchargée au lieu de destination."),
        ("38. DDP", "Incoterm : livraison droits acquittés à destination."),
        ("39. Transfert du risque", "Moment où le risque de perte passe du vendeur à l'acheteur."),
        ("40. FCL", "Conteneur complet réservé à un seul chargeur."),
        ("41. LCL", "Groupage : conteneur partagé entre plusieurs chargeurs."),
        ("42. Conteneur", "Caisson normalisé pour le transport de marchandises."),
        ("43. Groupage", "Mutualisation d'un conteneur entre plusieurs expéditeurs."),
        ("44. Multimodal", "Transport combinant plusieurs modes (maritime + routier, etc.)."),
        ("45. Fret", "Coût du transport de la marchandise."),
        ("46. Surestaries", "Pénalités pour dépassement du délai gratuit de stockage portuaire."),
        ("47. Manutention", "Opérations de chargement/déchargement au port."),
        ("48. Assurance transport", "Couverture des risques de perte ou d'avarie pendant le transport."),
        ("49. Tous risques", "Formule d'assurance couvrant l'ensemble des risques de transport."),
        ("50. Tracking", "Suivi de la marchandise (numéro de conteneur, B/L, AWB)."),
        ("51. Douane", "Administration contrôlant les marchandises et percevant les droits."),
        ("52. Code SH", "Code du Système harmonisé (OMD) classifiant les marchandises."),
        ("53. Système harmonisé", "Nomenclature mondiale de classification des produits (OMD)."),
        ("54. Valeur en douane", "Valeur de la marchandise servant de base aux droits."),
        ("55. Droits de douane", "Taxes perçues à l'importation selon le tarif applicable."),
        ("56. TVA à l'importation", "Taxe sur la valeur ajoutée perçue sur les importations."),
        ("57. Tarif extérieur commun (TEC)", "Tarif douanier commun de la CEDEAO."),
        ("58. Préférence tarifaire", "Réduction de droits accordée selon l'origine ou un accord."),
        ("59. Règles d'origine", "Critères déterminant le pays d'origine d'un produit."),
        ("60. Mise à la consommation", "Régime douanier : la marchandise entre sur le marché national."),
        ("61. Transit", "Passage sous contrôle douanier sans mise à la consommation."),
        ("62. Réexportation", "Réexpédition vers un pays tiers après entrée temporaire."),
        ("63. Contrôle douanier", "Vérification documentaire ou physique de la marchandise."),
        ("64. Inspection", "Examen physique de la marchandise par la douane ou un tiers."),
        ("65. Liquidation", "Calcul des droits et taxes dus à la douane."),
        ("66. Enlèvement", "Retrait de la marchandise après dédouanement."),
        ("67. Prix de revient", "Coût total pour mettre une unité en entrepôt, prête à vendre."),
        ("68. Prix de vente", "Prix auquel le produit est vendu au client."),
        ("69. Marge commerciale", "Différence entre prix de vente et prix de revient."),
        ("70. Seuil de rentabilité", "Niveau d'activité à partir duquel l'entreprise est rentable."),
        ("71. Trésorerie", "Disponibilités financières pour faire face aux dépenses."),
        ("72. Virement (T/T)", "Transfert bancaire direct vers le fournisseur."),
        ("73. Crédit documentaire (L/C)", "Paiement bancaire contre documents conformes."),
        ("74. Remise documentaire", "Remise de documents contre paiement (D/P) ou acceptation (D/A)."),
        ("75. Escrow", "Séquestre : un tiers retient les fonds jusqu'à livraison conforme."),
        ("76. Acompte", "Versement partiel avant livraison."),
        ("77. Solde", "Versement du reliquat, souvent contre documents d'expédition."),
        ("78. Échantillon", "Exemplaire de la marchandise testé avant commande en gros."),
        ("79. Cahier des charges", "Document définissant les exigences qualité du produit."),
        ("80. Inspection tierce", "Contrôle qualité réalisé par un organisme indépendant."),
        ("81. Contrefaçon", "Imitation illégale d'un produit ou d'une marque."),
        ("82. Norme", "Règle technique obligatoire ou recommandée pour un produit."),
        ("83. Autorisation préalable", "Accord administratif requis avant l'import/export d'un produit."),
        ("84. Quota", "Quantité maximale autorisée à l'import/export."),
        ("85. OMC", "Organisation mondiale du commerce (règles du commerce international)."),
        ("86. OMD", "Organisation mondiale des douanes (classification, procédures)."),
        ("87. CCI", "Chambre de commerce internationale (Incoterms, arbitrage)."),
        ("88. CEDEAO", "Communauté économique des États de l'Afrique de l'Ouest."),
        ("89. UEMOA", "Union économique et monétaire ouest-africaine."),
        ("90. OHADA", "Organisation pour l'harmonisation du droit des affaires en Afrique."),
        ("91. ZLECAf", "Zone de libre-échange continentale africaine."),
        ("92. APIEx", "Agence de promotion des investissements et des exportations (Bénin)."),
        ("93. PAC", "Port autonome de Cotonou."),
        ("94. RCCM", "Registre du commerce et du crédit mobilier."),
        ("95. Business plan", "Document de prévision et de stratégie de l'entreprise."),
        ("96. Étude de marché", "Analyse de la demande, de la concurrence et du positionnement."),
        ("97. SARL", "Société à responsabilité limitée (forme juridique OHADA)."),
        ("98. SA", "Société anonyme (forme juridique OHADA)."),
        ("99. Entreprise individuelle", "Forme d'entreprise à responsabilité de l'exploitant."),
        ("100. Litige commercial", "Différend entre partenaires, réglé par négociation, médiation ou arbitrage."),
    ]
    for term, defi in gloss:
        A(Paragraph(f"<b>{term}</b> — {defi}", S["body_small"]))
    A(PageBreak())

    # ================================================================
    # BONUS 6
    # ================================================================
    A(MarkParagraph("b6", "BONUS 6 — Modèle de business plan pour une activité d'import-export", S["h1"]))
    A(HR())
    A(P("Modèle commenté à remplir avec vos chiffres réels. Les indications entre crochets sont "
        "des guides de rédaction."))
    A(styled_table(["Rubrique", "Contenu à rédiger", "Votre projet"],
                   [["1. Présentation", "Activité, produits, marché visé, forme juridique",
                     "[À rédiger]"],
                    ["2. Produits", "Gammes, fournisseurs, MOQ, qualité, saisonnalité",
                     "[À rédiger]"],
                    ["3. Marché", "Clientèle, taille, concurrents, prix, canaux",
                     "[À rédiger]"],
                    ["4. Stratégie commerciale", "Positionnement prix/qualité, prospection, fidélisation",
                     "[À rédiger]"],
                    ["5. Organisation", "Achats, logistique, douane, stockage, ventes, comptabilité",
                     "[À rédiger]"],
                    ["6. Prévisions financières", "CA, coûts (dont prix de revient chap. 10), trésorerie, seuil de rentabilité",
                     "[À chiffrer]"],
                    ["7. Financement", "Besoin total, fonds propres, crédit, associés",
                     "[À chiffrer]"],
                    ["8. Risques et parades", "Fournisseur, douane, fret, trésorerie, change",
                     "[À rédiger]"],
                    ["9. Plan de développement", "Étapes : national → régional → international",
                     "[À rédiger]"]],
                   widths=[3.5 * cm, 7 * cm, 6.5 * cm]))
    A(Spacer(1, 4))
    A(callout("Conseil de rédaction",
              "Un business plan crédible est <b>chiffré, daté et vérifiable</b> : chaque hypothèse "
              "(prix, volumes, délais) renvoie à une source (devis, étude de marché, tarif officiel). "
              "C'est ce document qui convainc les banques, les associés et les partenaires."))
    A(Spacer(1, 6))
    A(Paragraph("Le tableau des hypothèses : la partie que les financeurs lisent en premier", S["h2"]))
    A(styled_table(["Hypothèse", "Votre valeur", "Source / justification"],
                   [["Prix d'achat unitaire", "", "Devis fournisseur (référence + date)"],
                    ["Quantité par commande", "", "MOQ négocié + capacité de vente"],
                    ["Fret et assurance par commande", "", "Devis transitaire et assureur"],
                    ["Droits et taxes applicables", "", "Sources officielles (code SH vérifié)"],
                    ["Prix de revient unitaire complet", "", "Bonus 3, rempli avec des devis réels"],
                    ["Prix de vente moyen", "", "Relevé de marché (chapitre 2)"],
                    ["Marge brute unitaire / taux", "", "Calcul chapitre 10"],
                    ["Volumes mensuels vendus", "", "Test de vente ou étude de demande"],
                    ["Charges fixes mensuelles", "", "Loyer, salaires, transport, communications"],
                    ["Seuil de rentabilité", "", "Charges fixes ÷ marge unitaire"],
                    ["Besoin en fonds de roulement", "", "Stock + créances − dettes fournisseurs"],
                    ["Besoin de financement total", "", "Investissement + BFR + réserve de trésorerie"]],
                   widths=[5.5 * cm, 3.5 * cm, 8 * cm]))
    A(Spacer(1, 4))
    A(Paragraph("Les cinq erreurs qui font rejeter un business plan", S["h2"]))
    A(B(["<b>Des prévisions sans hypothèses</b> : un chiffre d'affaires annoncé sans volume, prix ni source n'a aucune valeur.",
         "<b>Un besoin de financement sous-estimé</b> : le fonds de roulement et les imprévus sont presque toujours oubliés.",
         "<b>Une marge calculée sur un prix d'achat seul</b> : le prix de revient complet est la seule base valable.",
         "<b>Un scénario unique</b> : sans scénario pessimiste, le plan ne résiste pas à la première question.",
         "<b>Un marché décrit sans preuve</b> : aucune observation terrain, aucun test de vente, aucun relevé de prix."]))
    A(PageBreak())

    # ================================================================
    # BONUS 7
    # ================================================================
    A(MarkParagraph("b7", "BONUS 7 — Guide de préparation d'une première importation", S["h1"]))
    A(HR())
    A(P("Suivez ce guide pas à pas pour votre première importation. Chaque étape renvoie au chapitre "
        "correspondant."))
    A(callout("Règle d'or de la première importation",
              "Petit volume, un seul produit, un seul fournisseur vérifié, paiement progressif, "
              "dossier complet, marge calculée. Mieux vaut une petite opération réussie qu'une "
              "grande opération ratée : l'expérience acquise vaut plus que le premier profit."))
    A(Spacer(1, 4))
    steps7 = [
        ("Étape 1 — Choisir le produit (chap. 2)", "Étudiez la demande sur le terrain, relevez les prix, dressez la fiche concurrentielle, vérifiez les restrictions. Ne choisissez qu'un produit à la fois pour débuter."),
        ("Étape 2 — Trouver les fournisseurs (chap. 3)", "Prospectez 5 à 10 fournisseurs sur les plateformes, demandez 3 devis comparables, vérifiez identité et réputation."),
        ("Étape 3 — Négocier et commander (chap. 4)", "Négociez prix, MOQ et délais après comparaison. Définissez le cahier des charges. Recevez et testez l'échantillon. Confirmez la commande par écrit."),
        ("Étape 4 — Choisir le marché et l'Incoterm (chap. 5 et 7)", "Confirmez la source (Chine, Turquie, Europe…) et choisissez l'Incoterm adapté (souvent FOB/FCA avec transitaire, ou CIF/CIP sans). Écrivez l'Incoterm et le lieu dans le contrat."),
        ("Étape 5 — Organiser le transport (chap. 6)", "Choisissez le mode (maritime groupé pour débuter), comparez FCL/LCL, signez le devis détaillé du transitaire, souscrivez l'assurance tous risques."),
        ("Étape 6 — Préparer les documents (chap. 8)", "Constituez le dossier complet et cohérent (facture, colisage, B/L/AWB, origine, conformité, assurance). Appliquez la check-list du Bonus 4."),
        ("Étape 7 — Vérifier la douane (chap. 9)", "Faites classer le produit (code SH), vérifiez droits et taxes sur les sources officielles, anticipez les autorisations. Pour le Bénin : douane, APIEx, PAC."),
        ("Étape 8 — Calculer avant de payer (chap. 10)", "Remplissez le modèle du Bonus 3 avec des devis réels. Vérifiez la marge (25-30 % minimum) et la trésorerie (réserve 15-20 %)."),
        ("Étape 9 — Payer en sécurité (chap. 11)", "Appliquez la check-list du Bonus 2. Payez par acompte + solde contre documents. Vérifiez les coordonnées bancaires. Conservez toutes les preuves."),
        ("Étape 10 — Réceptionner et vendre", "Suivez l'expédition (tracking), préparez le dédouanement avant l'arrivée, réceptionnez en contrôlant quantités et état, puis vendez et encaissez. Analysez l'opération pour la suivante."),
    ]
    for title, body in steps7:
        A(Paragraph(title, S["h3"]))
        A(P(body))
    A(H2("Budget et planning type d'une première importation"))
    A(P("Le tableau ci-dessous est un <b>cadre de travail</b>, pas un barème : remplacez chaque "
        "montant par vos devis réels. Il vous évite l'erreur la plus fréquente du débutant — "
        "oublier les frais qui s'ajoutent au prix d'achat."))
    A(styled_table(["Poste", "Nature", "Quand le payer ?", "Document à conserver"],
                   [["Échantillons et fret d'échantillon", "Test qualité", "Avant la commande", "Facture + preuve de paiement"],
                    ["Achat marchandise (acompte)", "Souvent 30 %", "À la commande", "Pro forma signée + virement"],
                    ["Achat marchandise (solde)", "70 % restants", "Avant expédition / contre documents", "Facture définitive + B/L"],
                    ["Fret international", "Selon Incoterm", "À la réservation", "Devis + facture transitaire"],
                    ["Assurance transport", "Prime", "Avant le départ", "Attestation d'assurance"],
                    ["Transit et dédouanement", "Prestation locale", "À l'arrivée", "Facture + quittance"],
                    ["Droits et taxes", "Selon code SH", "Avant l'enlèvement", "Quittance de la douane"],
                    ["Stockage et livraison", "Frais portuaires et transport", "À l'enlèvement", "Factures port / transporteur"],
                    ["Réserve d'imprévus", "10 à 20 % du total", "En permanence", "Suivi de trésorerie"]],
                   widths=[4.5 * cm, 3.5 * cm, 4.5 * cm, 4.5 * cm]))
    A(Spacer(1, 4))
    A(callout("Planning réaliste (à adapter à votre corridor)",
              "<b>Semaine 1-2 :</b> choix du produit, étude de demande. <b>Semaine 3-4 :</b> "
              "prospection fournisseurs, devis, commande d'échantillons. <b>Semaine 5-6 :</b> "
              "test des échantillons, négociation, commande. <b>Semaine 7-10 :</b> production, "
              "contrôle, préparation des documents. <b>Semaine 11-16 :</b> transport maritime. "
              "<b>Semaine 17-18 :</b> dédouanement, enlèvement, réception. Prévoyez un décalage "
              "possible de 2 à 3 semaines : c'est normal sur une première opération."))
    A(PageBreak())

    # ================================================================
    # BIBLIOGRAPHIE
    # ================================================================
    A(MarkParagraph("biblio", "Bibliographie et sources officielles", S["h1"]))
    A(HR())
    A(P("Informations vérifiées le <b>15 novembre 2026</b>. Les adresses ci-dessous sont les sites "
        "officiels à consulter pour les informations en vigueur à la date de vos opérations."))
    A(styled_table(["Source", "Domaines couverts", "Site officiel"],
                   [["Organisation mondiale du commerce (OMC)", "Règles du commerce international, accords, statistiques",
                     "wto.org"],
                    ["Organisation mondiale des douanes (OMD)", "Système harmonisé, procédures douanières, facilitation",
                     "wcoomd.org"],
                    ["Chambre de commerce internationale (CCI)", "Incoterms® 2020, arbitrage, règles bancaires",
                     "iccwbo.org"],
                    ["Douane du Bénin", "Tarifs, formalités, réglementation douanière du Bénin",
                     "douane.bj"],
                    ["APIEx Bénin", "Formalités, accompagnement import/export, promotion des exportations",
                     "apiex.bj"],
                    ["Port autonome de Cotonou (PAC)", "Manutention, stockage, délais portuaires",
                     "portcotonou.com"],
                    ["CEDEAO", "TEC, règles d'origine, libre circulation régionale",
                     "ecowas.int"],
                    ["UEMOA", "Tarif extérieur, réglementation régionale",
                     "uemoa.int"],
                    ["OHADA", "Droit des affaires (sociétés, recouvrement, arbitrage)",
                     "ohada.org"]],
                   widths=[5 * cm, 7 * cm, 5 * cm]))
    A(Spacer(1, 4))
    A(P("Distinction importante : les <b>règles internationales</b> (OMC, OMD, CCI) fixent le cadre "
        "général ; les <b>réglementations nationales et régionales</b> (douane du Bénin, CEDEAO, "
        "UEMOA) déterminent les taux, les formalités et les autorisations applicables à votre "
        "opération. Vérifiez toujours les deux niveaux, à la date de l'opération."))
    A(PageBreak())
    A(MarkParagraph("annexe", "Annexe — Suivi de progression", S["h1"]))
    A(HR())
    A(P("Cochez vos acquis au fil de la lecture et de la pratique."))
    prog = ["Chapitre 1 : je distingue les acteurs et décris la chaîne commerciale.",
            "Chapitre 2 : j'ai choisi un produit après étude de demande.",
            "Chapitre 3 : j'ai vérifié un fournisseur (Bonus 2).",
            "Chapitre 4 : j'ai négocié et commandé par écrit.",
            "Chapitre 5 : j'ai choisi un marché fournisseur adapté.",
            "Chapitre 6 : j'ai organisé transport, assurance et suivi.",
            "Chapitre 7 : je maîtrise les Incoterms 2020.",
            "Chapitre 8 : mon dossier documentaire est complet et cohérent.",
            "Chapitre 9 : j'ai vérifié douane et taxes sur les sources officielles.",
            "Chapitre 10 : mon prix de revient et ma marge sont calculés (Bonus 3).",
            "Chapitre 11 : mes paiements sont sécurisés.",
            "Chapitre 12 : mon business plan est rédigé (Bonus 6).",
            "Bonus 7 : ma première importation est préparée de bout en bout."]
    for p in prog:
        A(Paragraph(f"[&nbsp;&nbsp;]&nbsp;&nbsp;&nbsp;{p}", S["bullet"]))
    A(Spacer(1, 6))
    A(Paragraph("Journal de bord de votre première opération", S["h3"]))
    A(P("Photocopiez ou recopiez ce tableau pour chaque opération. Il devient votre mémoire "
        "d'entreprise : les chiffres d'aujourd'hui sont les prévisions fiables de demain."))
    A(styled_table(["Information", "Opération n° 1", "Opération n° 2"],
                   [["Produit et référence", "", ""],
                    ["Fournisseur (pays, contact)", "", ""],
                    ["Quantité commandée / MOQ", "", ""],
                    ["Incoterm et port", "", ""],
                    ["Prix d'achat total", "", ""],
                    ["Fret + assurance", "", ""],
                    ["Droits, taxes, transit", "", ""],
                    ["Prix de revient total / unitaire", "", ""],
                    ["Prix de vente moyen / marge %", "", ""],
                    ["Délai réel (commande → réception)", "", ""],
                    ["Incidents rencontrés", "", ""],
                    ["Décision pour l'opération suivante", "", ""]],
                   widths=[6 * cm, 5.5 * cm, 5.5 * cm]))
    A(Spacer(1, 10))
    A(Paragraph("« Du premier fournisseur à la livraison finale, maîtrisez les étapes du commerce "
                "international. »", S["quote"]))
    A(Paragraph("GLOBAL TRADE ACADEMY — Édition 2026", S["caption"]))

    doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)
    import json
    structure = {"marks": PAGE_MARKS,
                 "chapters": {f"ch{k}": v for k, v in CHAP_TITLES.items()},
                 "headings": [[t, PAGE_MARKS.get(f"h{i+1}")] for i, t in enumerate(H2_ORDER)]}
    with open(os.path.join(OUT, "structure-pages.json"), "w", encoding="utf-8") as fh:
        json.dump(structure, fh, ensure_ascii=False, indent=1)
    print("PDF généré :", os.path.join(OUT, "Global-Trade-Academy.pdf"))


if __name__ == "__main__":
    # Première passe : calcule les numéros de page réels du sommaire.
    build()
    # Deuxième passe : régénère le sommaire avec les pages exactes.
    build()
