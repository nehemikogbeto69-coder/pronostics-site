# -*- coding: utf-8 -*-
"""
GLOBAL TRADE ACADEMY — Génération des livrables séparés.

Produit, à partir du PDF principal :
  * une page de couverture dédiée pour chaque bonus,
  * les 7 bonus au format PDF autonome (couverture + pages du bonus),
  * une couverture haute qualité autonome (PNG 300 dpi + PDF),
  * un fichier table-des-matieres.md pointant vers les livrables.
"""
import os
import re
import shutil

import pymupdf                       # PyMuPDF
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, ".."))
OUT = os.path.join(ROOT, "output")
LIV = os.path.join(ROOT, "livrables")
BONUS_DIR = os.path.join(LIV, "bonus")
IMG_DIR = os.path.join(LIV, "images")

SOURCE = os.path.join(OUT, "Global-Trade-Academy.pdf")

NAVY = HexColor("#0B1F3A")
GOLD = HexColor("#C9A227")
GOLD_L = HexColor("#E8C766")

PAGE_W, PAGE_H = A4

BONUS_TITLES = {
    1: ("30 messages professionnels pour contacter les fournisseurs",
        "Modèles prêts à l'emploi, en anglais commercial, à adapter à chaque situation"),
    2: ("Check-list de vérification d'un fournisseur",
        "Le contrôle à effectuer avant tout paiement, sans exception"),
    3: ("Modèle de calcul du prix de revient d'une importation",
        "Le tableau à remplir pour connaître votre marge avant de commander"),
    4: ("Check-list des documents avant expédition",
        "Ce qui doit être prêt avant le chargement, pour éviter le blocage à l'arrivée"),
    5: ("Glossaire de 100 termes du commerce international",
        "Le vocabulaire indispensable pour lire un devis, un connaissement, un contrat"),
    6: ("Modèle de business plan pour une activité d'import-export",
        "Les 9 rubriques attendues par un financeur, avec les points de vigilance"),
    7: ("Guide de préparation d'une première importation",
        "Les 10 étapes de votre première opération, du produit à la réception"),
}

SLUGS = {
    1: "Bonus-1-30-messages-fournisseurs",
    2: "Bonus-2-Checklist-verification-fournisseur",
    3: "Bonus-3-Modele-calcul-prix-de-revient",
    4: "Bonus-4-Checklist-documents-avant-expedition",
    5: "Bonus-5-Glossaire-100-termes",
    6: "Bonus-6-Modele-business-plan",
    7: "Bonus-7-Guide-premiere-importation",
}




USAGE = {
    1: ("Comment utiliser ces 30 messages",
        ["Choisissez le message correspondant à l'étape où vous êtes : premier contact, demande "
         "de devis, échantillon, négociation, commande, expédition, réclamation.",
         "Remplacez systématiquement les crochets [ ] par vos informations réelles : produit, "
         "quantité, port, délai, prix cible.",
         "Envoyez un seul message à la fois et attendez la réponse : un fournisseur sérieux "
         "répond précisément, un interlocuteur douteux reste vague.",
         "Conservez toutes les réponses écrites : elles constituent votre preuve en cas de litige "
         "(chapitre 11 du guide).",
         "Ne payez jamais avant d'avoir obtenu un devis écrit complet, un échantillon testé et "
         "une confirmation de commande."],
        "Conseil : commencez toujours par le message 1 (demande de devis) accompagné de la "
        "référence exacte du produit et de la quantité visée. Un message précis obtient un devis "
        "précis."),
    2: ("Comment utiliser cette check-list",
        ["Imprimez une fiche par fournisseur candidat — jamais une fiche pour plusieurs.",
         "Cochez chaque point uniquement lorsque vous avez une preuve écrite (document, e-mail, "
         "capture d'écran datée).",
         "Un seul point non validé bloque la commande : cherchez une explication écrite ou "
         "changez de fournisseur.",
         "Archivez la fiche remplie avec le devis et les échanges : elle documente votre "
         "diligence en cas de litige.",
         "Refaites l'exercice à chaque nouveau fournisseur, même recommandé par un proche."],
        "Conseil : la vérification d'identité (licence, adresse, références) élimine à elle seule "
        "la majorité des tentatives d'escroquerie."),
    3: ("Comment remplir ce modèle de prix de revient",
        ["Remplissez une colonne par opération, avec des devis réels : aucun montant ne doit être "
         "estimé « au feeling ».",
         "Pour les droits et taxes, ne devinez pas : faites classer le produit (code SH) par "
         "votre transitaire, puis vérifiez les taux en vigueur sur les sources officielles.",
         "N'oubliez aucun poste : fret, assurance, transit, manutention, stockage, livraison "
         "intérieure, frais bancaires.",
         "Ajoutez une réserve de 15 à 20 % pour les imprévus, puis calculez le prix de revient "
         "unitaire.",
         "Fixez le prix de vente à partir du prix de revient complet et vérifiez qu'il reste "
         "compétitif face aux prix du marché."],
        "Conseil : refaites le calcul avec un scénario pessimiste (fret +20 %). Si la marge "
        "devient négative, renégociez ou changez de produit avant de commander."),
    4: ("Comment utiliser cette check-list",
        ["Utilisez-la avec le fournisseur et le transitaire, avant le chargement — pas après "
         "l'arrivée du navire.",
         "Vérifiez la cohérence entre les documents : références, quantités, poids, valeurs, "
         "Incoterm et ports doivent concorder.",
         "Transmettez le dossier complet au transitaire avant le départ, pour qu'il prépare la "
         "déclaration.",
         "Conservez une copie numérique de chaque pièce dans un dossier par opération.",
         "En cas de doute sur un document, faites-le corriger avant expédition : une correction "
         "à l'arrivée coûte du temps et des frais de stockage."],
        "Conseil : un dossier incomplet à l'expédition devient systématiquement un blocage à "
        "l'arrivée."),
    5: ("Comment utiliser ce glossaire",
        ["Servez-vous-en pendant la lecture d'un devis, d'un connaissement ou d'un contrat : "
         "cherchez le terme inconnu avant de répondre.",
         "Notez dans la marge les termes utilisés par vos fournisseurs et transitaires : le "
         "vocabulaire varie d'un pays à l'autre.",
         "Utilisez les définitions pour poser les bonnes questions, pas comme substitut à un "
         "conseil juridique ou douanier.",
         "Croisez les définitions avec les sources officielles (OMC, OMD, CCI) pour les termes "
         "sensibles : Incoterms, origine, valeur en douane."],
        "Conseil : les termes les plus rentables à maîtriser sont ceux qui déterminent l'argent — "
        "Incoterm, valeur en douane, origine, fret, surestaries, crédit documentaire."),
    6: ("Comment utiliser ce modèle de business plan",
        ["Remplissez chaque rubrique avec vos chiffres, issus des chapitres 2 et 10 du guide.",
         "Ne présentez pas de prévisions sans hypothèses : indiquez la source de chaque montant "
         "(devis, tarif officiel, étude de marché).",
         "Démontrez le besoin de financement en incluant le besoin en fonds de roulement, souvent "
         "oublié par les débutants.",
         "Préparez trois scénarios : optimiste, central, pessimiste.",
         "Faites relire le document par un professionnel (comptable, organisme d'accompagnement) "
         "avant de le présenter à un financeur."],
        "Conseil : un financeur finance une méthode et des hypothèses crédibles, pas une "
        "promesse de chiffre d'affaires."),
    7: ("Comment utiliser ce guide de préparation",
        ["Suivez les 10 étapes dans l'ordre : chacune sécurise la suivante.",
         "Cochez une étape uniquement quand la preuve écrite existe (devis, échantillon validé, "
         "documents reçus, calcul terminé).",
         "Adaptez les montants et les délais à votre corridor et à votre budget réels.",
         "Prévoyez un décalage de 2 à 3 semaines : une première opération prend presque toujours "
         "plus de temps que prévu.",
         "À la fin de l'opération, remplissez le journal de bord : il devient la base de votre "
         "deuxième importation."],
        "Conseil : la première importation sert à apprendre autant qu'à gagner. Petit volume, "
        "fournisseur vérifié, dossier complet, marge calculée."),
}

NEXT_STEPS = {
    1: ("Après les messages", "Une fois les réponses reçues, comparez les offres (chapitre 3), remplissez la fiche de vérification (Bonus 2), puis négociez (chapitre 4). Ne commandez jamais sur la base d'un seul message favorable."),
    2: ("Après la vérification", "Un fournisseur validé ne dispense pas de l'échantillon (chapitre 3) ni du calcul de prix de revient (Bonus 3). La confiance se construit par étapes documentées."),
    3: ("Après le calcul", "Comparez le prix de revient au prix du marché (chapitre 2). Si la marge est inférieure à 20 %, renégociez le prix d'achat, le fret ou l'emballage avant de commander."),
    4: ("Après la check-list", "Transmettez le dossier au transitaire, vérifiez le classement du produit (chapitre 9) et préparez la trésorerie nécessaire aux droits et taxes avant l'arrivée."),
    5: ("Après le glossaire", "Relisez votre dernier devis avec le glossaire en main : chaque terme que vous ne comprenez pas est un risque de coût caché. Demandez une clarification écrite au fournisseur."),
    6: ("Après le business plan", "Testez la solidité du projet avec un scénario pessimiste (chapitre 10), puis validez le statut juridique et les formalités (chapitre 12) avant de commander."),
    7: ("Après la première importation", "Remplissez le journal de bord de l'annexe du guide, comparez prévisions et réalité, puis préparez la deuxième opération avec des coûts et des délais désormais connus."),
}


# --------------------------------------------------------------- couvertures
def bonus_cover(path, num, title, subtitle):
    """Couverture A4 bleu nuit / or pour un bonus autonome."""
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle(f"Global Trade Academy — Bonus {num}")
    c.setAuthor("Global Trade Academy")

    # fond
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # filets or haut et bas
    c.setFillColor(GOLD)
    c.rect(0, PAGE_H - 1.1 * cm, PAGE_W, 3, stroke=0, fill=1)
    c.rect(0, 0.9 * cm, PAGE_W, 1.2, stroke=0, fill=1)

    # mention
    c.setFillColor(GOLD_L)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 3.4 * cm,
                        "GLOBAL TRADE ACADEMY  •  BONUS PRATIQUE")

    # numéro
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 92)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 8.4 * cm, f"{num:02d}")

    # libellé
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 9.4 * cm, f"BONUS {num}")

    # titre (retour à la ligne manuel)
    c.setFont("Helvetica-Bold", 23)
    words = title.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if c.stringWidth(test, "Helvetica-Bold", 23) > PAGE_W - 4 * cm:
            lines.append(cur)
            cur = w
        else:
            cur = test
    if cur:
        lines.append(cur)
    y = PAGE_H - 11.6 * cm
    for ln in lines:
        c.drawCentredString(PAGE_W / 2, y, ln)
        y -= 0.95 * cm

    # filet
    c.setFillColor(GOLD)
    c.rect(PAGE_W / 2 - 55, y - 0.1 * cm, 110, 2, stroke=0, fill=1)

    # sous-titre
    c.setFillColor(HexColor("#C9D6EA"))
    c.setFont("Helvetica-Oblique", 11)
    y -= 1.3 * cm
    words = subtitle.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if c.stringWidth(test, "Helvetica-Oblique", 11) > PAGE_W - 5 * cm:
            lines.append(cur)
            cur = w
        else:
            cur = test
    if cur:
        lines.append(cur)
    for ln in lines:
        c.drawCentredString(PAGE_W / 2, y, ln)
        y -= 0.6 * cm

    # pied
    c.setFillColor(HexColor("#8FA3BF"))
    c.setFont("Helvetica", 8.5)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 20.5 * cm,
                        "Extrait du guide « Le guide complet pour comprendre, démarrer et")
    c.drawCentredString(PAGE_W / 2, PAGE_H - 20.9 * cm,
                        "développer une activité d'import-export »")
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawCentredString(PAGE_W / 2, 1.7 * cm, "ÉDITION 2026  •  INFORMATIONS VÉRIFIÉES LE 15 NOVEMBRE 2026")
    c.setFillColor(HexColor("#8FA3BF"))
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(PAGE_W / 2, 1.2 * cm,
                        "Document pédagogique — ne constitue pas un conseil juridique, fiscal ou douanier personnalisé")

    c.showPage()
    c.save()


# --------------------------------------------------------------- découpage
def locate_bonus_pages(doc):
    """Retourne {num: [index pages]} pour chaque bonus, en ignorant le sommaire."""
    found = {}
    for i in range(doc.page_count):
        if i < 4:                      # couverture + mentions + sommaire
            continue
        text = doc[i].get_text()
        for n in range(1, 8):
            if re.search(rf"^BONUS {n} — ", text, re.MULTILINE):
                found.setdefault(n, []).append(i)
    # compléter : chaque bonus s'étend jusqu'au bonus suivant / biblio
    starts = {n: v[0] for n, v in found.items()}
    ordered = sorted(starts.items())
    ranges = {}
    for idx, (n, start) in enumerate(ordered):
        end = ordered[idx + 1][1] if idx + 1 < len(ordered) else doc.page_count
        ranges[n] = (start, end)
    return ranges


def bonus_usage_page(path, num):
    """Page « mode d'emploi » pour un bonus autonome."""
    title, points, conseil = USAGE[num]
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle(f"Global Trade Academy — Bonus {num} — mode d'emploi")
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(2 * cm, PAGE_H - 1.6 * cm, "GLOBAL TRADE ACADEMY")
    c.setFillColor(GOLD)
    c.rect(2 * cm, PAGE_H - 1.85 * cm, PAGE_W - 4 * cm, 1.2, stroke=0, fill=1)

    y = PAGE_H - 3.2 * cm
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(2 * cm, y, f"BONUS {num} — MODE D'EMPLOI")
    y -= 1.0 * cm
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 17)
    for line in wrap_text(c, title, "Helvetica-Bold", 17, PAGE_W - 4 * cm):
        c.drawString(2 * cm, y, line)
        y -= 0.85 * cm

    y -= 0.4 * cm
    c.setFillColor(HexColor("#1A2B45"))
    c.setFont("Helvetica", 10.5)
    for i, pt in enumerate(points, 1):
        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 10.5)
        c.drawString(2 * cm, y, f"{i}.")
        c.setFillColor(HexColor("#1A2B45"))
        c.setFont("Helvetica", 10.5)
        for j, line in enumerate(wrap_text(c, pt, "Helvetica", 10.5, PAGE_W - 5.6 * cm)):
            c.drawString(2.6 * cm, y, line)
            y -= 0.52 * cm
        y -= 0.28 * cm

    y -= 0.5 * cm
    box_top = y + 0.25 * cm
    lines = wrap_text(c, conseil, "Helvetica", 10, PAGE_W - 6.4 * cm)
    box_h = len(lines) * 0.5 * cm + 0.9 * cm
    c.setFillColor(HexColor("#FBF6E3"))
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.7)
    c.rect(2 * cm, box_top - box_h, PAGE_W - 4 * cm, box_h, stroke=1, fill=1)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(2.5 * cm, box_top - 0.55 * cm, "À RETENIR")
    c.setFont("Helvetica", 10)
    c.setFillColor(HexColor("#1A2B45"))
    yy = box_top - 1.15 * cm
    for line in lines:
        c.drawString(2.5 * cm, yy, line)
        yy -= 0.5 * cm

    # bloc « étapes suivantes »
    y2 = box_top - box_h - 1.4 * cm
    t2, b2 = NEXT_STEPS[num]
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 11.5)
    c.drawString(2 * cm, y2, t2)
    y2 -= 0.9 * cm
    c.setFillColor(HexColor("#1A2B45"))
    c.setFont("Helvetica", 10)
    for line in wrap_text(c, b2, "Helvetica", 10, PAGE_W - 4 * cm):
        c.drawString(2 * cm, y2, line)
        y2 -= 0.52 * cm

    # bloc « ce que ce bonus ne remplace pas »
    y3 = y2 - 0.9 * cm
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(2 * cm, y3, "CE QUE CE BONUS NE REMPLACE PAS")
    y3 -= 0.6 * cm
    c.setFillColor(HexColor("#1A2B45"))
    c.setFont("Helvetica", 9.5)
    disclaimer = ("Un outil pédagogique. Il ne remplace ni la vérification des sources officielles "
                  "(douane, TEC, réglementation), ni un avis juridique, fiscal ou douanier "
                  "personnalisé, ni le travail d'un transitaire agréé.")
    for line in wrap_text(c, disclaimer, "Helvetica", 9.5, PAGE_W - 4 * cm):
        c.drawString(2 * cm, y3, line)
        y3 -= 0.5 * cm

    c.setFillColor(HexColor("#5A6B84"))
    c.setFont("Helvetica", 8)
    c.drawString(2 * cm, 1.3 * cm,
                 "Extrait de GLOBAL TRADE ACADEMY — Édition 2026 — informations vérifiées le 15 novembre 2026")
    c.drawRightString(PAGE_W - 2 * cm, 1.3 * cm, "Document pédagogique")
    c.showPage()
    c.save()


def wrap_text(c, text, font, size, max_width):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if c.stringWidth(test, font, size) > max_width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = test
    if cur:
        lines.append(cur)
    return lines


def build_bonus_pdf(src_doc, num, start, end, out_pdf):
    cover_path = os.path.join(BONUS_DIR, "_cover_tmp.pdf")
    bonus_cover(cover_path, num, *BONUS_TITLES[num])

    usage_path = os.path.join(BONUS_DIR, "_usage_tmp.pdf")
    bonus_usage_page(usage_path, num)

    merged = pymupdf.open()
    merged.insert_pdf(pymupdf.open(cover_path))
    merged.insert_pdf(pymupdf.open(usage_path))
    part = pymupdf.open()
    part.insert_pdf(src_doc, from_page=start, to_page=end - 1)
    merged.insert_pdf(part)
    merged.set_metadata({
        "title": f"Global Trade Academy — Bonus {num} : {BONUS_TITLES[num][0]}",
        "author": "Global Trade Academy",
        "subject": "Bonus pratique du guide Global Trade Academy",
        "keywords": "import-export, commerce international, bonus, formation",
    })
    merged.save(out_pdf, garbage=3, deflate=True)
    merged.close()
    part.close()
    os.remove(cover_path)
    os.remove(usage_path)
    return merged.page_count if False else pymupdf.open(out_pdf).page_count


# --------------------------------------------------------------- livrables
def export_cover(src_doc):
    os.makedirs(IMG_DIR, exist_ok=True)
    page = src_doc[0]

    # PNG haute résolution
    pix = page.get_pixmap(dpi=300)
    png = os.path.join(IMG_DIR, "Couverture-Global-Trade-Academy-300dpi.png")
    pix.save(png)

    # PDF de la couverture seule
    pdf = os.path.join(LIV, "Couverture-Global-Trade-Academy.pdf")
    one = pymupdf.open()
    one.insert_pdf(src_doc, from_page=0, to_page=0)
    one.set_metadata({"title": "Global Trade Academy — Couverture",
                      "author": "Global Trade Academy"})
    one.save(pdf, garbage=3, deflate=True)
    one.close()
    return png, pdf


def main():
    os.makedirs(BONUS_DIR, exist_ok=True)
    os.makedirs(IMG_DIR, exist_ok=True)
    if not os.path.exists(SOURCE):
        raise SystemExit("PDF principal introuvable : " + SOURCE)

    src = pymupdf.open(SOURCE)
    ranges = locate_bonus_pages(src)
    print("Pages détectées par bonus :", {k: v for k, v in sorted(ranges.items())})

    produced = []
    for n in range(1, 8):
        if n not in ranges:
            print(f"  ! bonus {n} introuvable")
            continue
        start, end = ranges[n]
        out_pdf = os.path.join(BONUS_DIR, SLUGS[n] + ".pdf")
        pages = build_bonus_pdf(src, n, start, end, out_pdf)
        produced.append((n, out_pdf, pages))
        print(f"  Bonus {n} : pages {start + 1}-{end} -> {os.path.basename(out_pdf)} ({pages} p.)")

    png, cover_pdf = export_cover(src)
    print("  Couverture PNG :", os.path.basename(png))
    print("  Couverture PDF :", os.path.basename(cover_pdf))

    # copie du manuel complet dans livrables
    shutil.copy2(SOURCE, os.path.join(LIV, "Global-Trade-Academy-Ebook-Complet.pdf"))

    src.close()
    print("Terminé.")


if __name__ == "__main__":
    main()
