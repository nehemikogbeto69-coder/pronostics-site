# -*- coding: utf-8 -*-
"""Génère les infographies de Global Trade Academy (matplotlib)."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Circle
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "images")
os.makedirs(OUT, exist_ok=True)

NAVY = "#0B1F3A"
NAVY2 = "#1B3A66"
GOLD = "#C9A227"
GOLD_L = "#E8C766"
LIGHT = "#F4F6FA"
GREY = "#5A6B84"
WHITE = "#FFFFFF"

plt.rcParams["font.family"] = "DejaVu Sans"


def save(fig, name):
    path = os.path.join(OUT, name)
    fig.savefig(path, dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("OK", name)


def box(ax, x, y, w, h, text, fc=NAVY, tc="white", fs=8, ec=GOLD):
    b = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08",
                       fc=fc, ec=ec, lw=1.2)
    ax.add_patch(b)
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center",
            fontsize=fs, color=tc, weight="bold", wrap=True)
    return b


def arrow(ax, x1, y1, x2, y2):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="->", mutation_scale=12,
                        color=GOLD, lw=1.6)
    ax.add_patch(a)


# ---------------------------------------------------------------- 1. Processus
def processus():
    fig, ax = plt.subplots(figsize=(11, 2.6))
    ax.set_xlim(0, 11); ax.set_ylim(0, 2.6); ax.axis("off")
    steps = ["1\nFournisseur", "2\nNégociation\n+ devis", "3\nCommande\n+ paiement",
             "4\nProduction\n+ contrôle", "5\nExpédition\n+ transport", "6\nDédouanement",
             "7\nLivraison\n+ réception", "8\nVente\n+ marge"]
    n = len(steps)
    w = 1.15; gap = 0.22; x = 0.15
    for i, s in enumerate(steps):
        fc = NAVY if i % 2 == 0 else NAVY2
        box(ax, x, 0.7, w, 1.2, s, fc=fc, fs=7.5)
        if i < n - 1:
            arrow(ax, x + w + 0.02, 1.3, x + w + gap - 0.02, 1.3)
        x += w + gap
    ax.text(5.5, 2.35, "LE PROCESSUS D'UNE IMPORTATION RÉUSSIE", ha="center",
            fontsize=11, weight="bold", color=NAVY)
    ax.text(5.5, 0.35, "Chaque étape conditionne la suivante : ne jamais payer avant d'avoir sécurisé la précédente.",
            ha="center", fontsize=8, color=GREY, style="italic")
    save(fig, "infographie-processus.png")


# ---------------------------------------------------------------- 2. Transport
def transport():
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 3.6))
    modes = ["Maritime", "Aérien", "Routier"]
    cout = [100, 520, 280]   # indices relatifs (maritime = 100)
    delai = [35, 5, 12]      # jours indicatifs
    cols = [NAVY, GOLD, NAVY2]
    ax1.bar(modes, cout, color=cols, edgecolor="white")
    ax1.set_ylabel("Coût relatif (indice)", fontsize=9)
    ax1.set_title("Coût relatif du transport", fontsize=11, weight="bold", color=NAVY)
    for i, v in enumerate(cout):
        ax1.text(i, v + 12, str(v), ha="center", fontsize=10, weight="bold", color=NAVY)
    ax1.set_ylim(0, 620)
    ax2.bar(modes, delai, color=cols, edgecolor="white")
    ax2.set_ylabel("Délai indicatif (jours)", fontsize=9)
    ax2.set_title("Délai indicatif de livraison", fontsize=11, weight="bold", color=NAVY)
    for i, v in enumerate(delai):
        ax2.text(i, v + 0.8, str(v), ha="center", fontsize=10, weight="bold", color=NAVY)
    ax2.set_ylim(0, 42)
    fig.suptitle("COMPARAISON DES MODES DE TRANSPORT (indices indicatifs, à titre pédagogique)",
                 fontsize=11, weight="bold", color=NAVY, y=1.02)
    fig.tight_layout()
    save(fig, "infographie-transport.png")


# ---------------------------------------------------------------- 3. Incoterms
def incoterms():
    fig, ax = plt.subplots(figsize=(11, 4.2))
    ax.set_xlim(0, 11); ax.set_ylim(0, 4.2); ax.axis("off")
    ax.text(5.5, 3.95, "LES INCOTERMS 2020 : QUI PAIE QUOI, QUI RISQUE QUOI ?", ha="center",
            fontsize=11, weight="bold", color=NAVY)
    # Vendeur
    box(ax, 0.3, 1.5, 2.2, 1.6, "VENDEUR\n(fournisseur)", fc=NAVY, fs=10)
    # Acheteur
    box(ax, 8.5, 1.5, 2.2, 1.6, "ACHETEUR\n(importateur)", fc=GOLD, tc=NAVY, fs=10, ec=NAVY)
    # Chaîne
    ax.plot([2.5, 8.5], [2.3, 2.3], color=NAVY, lw=2)
    for x, lab in [(3.3, "Usine / entrepôt"), (4.6, "Port / aéroport\ndépart"),
                   (6.0, "Transport\nprincipal"), (7.3, "Port / aéroport\narrivée")]:
        ax.plot([x, x], [2.3, 2.55], color=NAVY, lw=1)
        ax.text(x, 2.65, lab, ha="center", va="bottom", fontsize=7.5, color=NAVY)
        ax.plot([x], [2.3], marker="o", color=GOLD, markersize=7)
    # Point de transfert de risque (ex. FOB)
    ax.annotate("Point de transfert\ndu risque (ex. FOB :\nà bord du navire)",
                xy=(4.6, 2.3), xytext=(4.6, 0.55), ha="center", fontsize=8, color=NAVY,
                arrowprops=dict(arrowstyle="->", color=GOLD, lw=1.6))
    ax.text(5.5, 3.45, "Le point de transfert du risque dépend de l'Incoterm choisi — il ne coïncide pas toujours avec le transfert de propriété.",
            ha="center", fontsize=8, color=GREY, style="italic")
    save(fig, "infographie-incoterms.png")


# ---------------------------------------------------------------- 4. Coûts
def couts():
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 3.8))
    labels = ["Prix d'achat", "Transport", "Assurance", "Douane\n+ taxes", "Frais locaux"]
    vals = [55, 18, 2, 20, 5]
    cols = [NAVY, GOLD, NAVY2, "#8A6D1B", GREY]
    ax1.pie(vals, labels=labels, colors=cols, autopct="%1.0f%%", startangle=90,
            textprops={"fontsize": 8}, wedgeprops={"edgecolor": "white", "linewidth": 2})
    ax1.set_title("Exemple de structure du prix de revient", fontsize=11, weight="bold", color=NAVY)
    # Barres cumulées
    cats = ["Prix d'achat", "+ Transport", "+ Assurance", "+ Douane/taxes", "+ Frais locaux", "= Prix de revient"]
    cum = [5500, 7300, 7500, 9500, 10000, 10000]
    ax2.barh(cats, cum, color=[NAVY, GOLD, NAVY2, "#8A6D1B", GREY, NAVY], edgecolor="white")
    ax2.set_xlabel("Montant cumulé (exemple pédagogique, en unités monétaires)", fontsize=8)
    ax2.set_title("Construction du prix de revient, étape par étape", fontsize=11, weight="bold", color=NAVY)
    for i, v in enumerate(cum):
        ax2.text(v + 150, i, f"{v:,}".replace(",", " "), va="center", fontsize=8, color=NAVY)
    ax2.set_xlim(0, 11800)
    fig.tight_layout()
    save(fig, "infographie-couts.png")


# ---------------------------------------------------------------- 5. Documents
def documents():
    fig, ax = plt.subplots(figsize=(11, 3.4))
    ax.set_xlim(0, 11); ax.set_ylim(0, 3.4); ax.axis("off")
    ax.text(5.5, 3.15, "LE CIRCUIT DES DOCUMENTS D'UNE IMPORTATION", ha="center",
            fontsize=11, weight="bold", color=NAVY)
    docs = ["Facture\npro forma", "Bon de\ncommande", "Facture\ncommerciale", "Liste de\ncolisage",
            "Connaissement /\nLTA", "Certificat\nd'origine", "Déclaration\nen douane", "Livraison\n+ facture finale"]
    n = len(docs); w = 1.15; gap = 0.2; x = 0.2
    for i, d in enumerate(docs):
        fc = GOLD if i in (2, 6) else NAVY
        tc = NAVY if i in (2, 6) else "white"
        box(ax, x, 1.3, w, 1.1, d, fc=fc, tc=tc, fs=7.5, ec=NAVY if i in (2, 6) else GOLD)
        if i < n - 1:
            arrow(ax, x + w + 0.02, 1.85, x + w + gap - 0.02, 1.85)
        x += w + gap
    ax.text(5.5, 0.95, "Documents clés : la facture commerciale et la déclaration en douane conditionnent la liquidation des droits et taxes.",
            ha="center", fontsize=8, color=GREY, style="italic")
    ax.text(5.5, 0.55, "Un dossier incomplet ou incohérent est la première cause de blocage en douane.",
            ha="center", fontsize=8, color=GREY, style="italic")
    save(fig, "infographie-documents.png")


# ---------------------------------------------------------------- 6. Export
def export():
    fig, ax = plt.subplots(figsize=(11, 4.6))
    ax.set_xlim(0, 11); ax.set_ylim(0, 4.6); ax.axis("off")
    ax.text(5.5, 4.35, "ORGANIGRAMME D'UNE OPÉRATION D'EXPORTATION", ha="center",
            fontsize=11, weight="bold", color=NAVY)
    box(ax, 4.0, 3.3, 3.0, 0.7, "1. Prospection + offre", fs=9)
    box(ax, 4.0, 2.45, 3.0, 0.7, "2. Contrat + paiement sécurisé", fs=9)
    box(ax, 4.0, 1.6, 3.0, 0.7, "3. Production / préparation", fs=9)
    box(ax, 4.0, 0.75, 3.0, 0.7, "4. Expédition + documents", fs=9)
    box(ax, 0.3, 0.75, 3.0, 0.7, "5. Dédouanement export", fc=GOLD, tc=NAVY, fs=9, ec=NAVY)
    box(ax, 7.7, 0.75, 3.0, 0.7, "6. Transport international", fc=GOLD, tc=NAVY, fs=9, ec=NAVY)
    box(ax, 7.7, 1.6, 3.0, 0.7, "7. Livraison + encaissement", fs=9)
    arrow(ax, 5.5, 3.3, 5.5, 3.15)
    arrow(ax, 5.5, 2.45, 5.5, 2.3)
    arrow(ax, 5.5, 1.6, 5.5, 1.45)
    arrow(ax, 4.0, 1.1, 3.3, 1.1)
    arrow(ax, 7.7, 1.1, 9.2, 1.1)
    arrow(ax, 9.2, 1.45, 9.2, 1.6)
    ax.text(5.5, 0.35, "L'exportateur maîtrise la conformité de ses produits et la fiabilité de ses documents.",
            ha="center", fontsize=8, color=GREY, style="italic")
    save(fig, "infographie-export.png")


if __name__ == "__main__":
    processus(); transport(); incoterms(); couts(); documents(); export()
    print("Toutes les infographies sont générées.")
