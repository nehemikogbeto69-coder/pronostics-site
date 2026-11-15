# GLOBAL TRADE ACADEMY — Livrables

**Le guide complet pour comprendre, démarrer et développer une activité d'import-export.**
Slogan : *Du premier fournisseur à la livraison finale, maîtrise les étapes du commerce international.*

Édition 2026 — informations réglementaires vérifiées le **15 novembre 2026**.

---

## 1. Produit principal

| Fichier | Contenu | Format |
|---|---|---|
| `Global-Trade-Academy-Ebook-Complet.pdf` | Manuel complet : **73 pages**, 12 chapitres, étude de cas intégrée, 7 bonus, bibliographie, annexe | PDF A4 |
| `Couverture-Global-Trade-Academy.pdf` | Couverture seule, prête pour la page de vente | PDF A4 |
| `images/Couverture-Global-Trade-Academy-300dpi.png` | Couverture haute résolution (300 dpi) | PNG |

## 2. Les 7 bonus séparés (dossier `bonus/`)

Chaque bonus est un PDF autonome avec sa propre couverture navy/or, une page « mode d'emploi »
et le contenu complet.

| # | Fichier | Pages |
|---|---|---|
| 1 | `Bonus-1-30-messages-fournisseurs.pdf` | 6 |
| 2 | `Bonus-2-Checklist-verification-fournisseur.pdf` | 4 |
| 3 | `Bonus-3-Modele-calcul-prix-de-revient.pdf` | 4 |
| 4 | `Bonus-4-Checklist-documents-avant-expedition.pdf` | 3 |
| 5 | `Bonus-5-Glossaire-100-termes.pdf` | 5 |
| 6 | `Bonus-6-Modele-business-plan.pdf` | 4 |
| 7 | `Bonus-7-Guide-premiere-importation.pdf` | 6 |

## 3. Documents commerciaux et éditoriaux

| Fichier | Contenu |
|---|---|
| `Table-des-matieres-detaillee.pdf` / `.md` | Sommaire complet avec numéros de page réels (23 sections, ~100 sous-sections) |
| `Textes-commerciaux-Chariow-Instagram.md` | Description Chariow complète, 3 textes Instagram, présentation commerciale (60 s, 30 s, version écrite), notes d'usage |

## 4. Illustrations et infographies (`images/`)

- `cover-art.jpg` — illustration de couverture (globe doré, porte-conteneurs, avion cargo, camion, port)
- `illustration-globe.jpg`, `illustration-port.jpg`, `illustration-warehouse.jpg` — illustrations de chapitres
- `infographie-processus.png` — processus d'importation en 8 étapes
- `infographie-transport.png` — comparaison des modes de transport
- `infographie-incoterms.png` — schéma des Incoterms 2020
- `infographie-couts.png` — décomposition du prix de revient
- `infographie-documents.png` — circuit des documents douaniers
- `infographie-export.png` — organigramme d'une opération d'exportation

## 5. Reproductibilité (scripts)

| Script | Rôle |
|---|---|
| `../build/build_ebook.py` | Génère le PDF principal (ReportLab), le sommaire paginé et `output/structure-pages.json` |
| `../build/build_bonuses.py` | Découpe les 7 bonus, crée leurs couvertures et pages « mode d'emploi », exporte la couverture 300 dpi |
| `../build/build_toc.py` | Génère la table des matières détaillée (PDF + Markdown) |
| `../build/make_infographics.py` | Génère les 6 infographies matplotlib (palette navy/or) |

Ordre d'exécution :

```bash
python3 build/make_infographics.py
python3 build/build_ebook.py      # génère le PDF complet (double passe pour la pagination)
python3 build/build_bonuses.py    # crée le dossier livrables/bonus
python3 build/build_toc.py        # table des matières détaillée
```

## 6. Règles éditoriales respectées

- **Aucun taux de douane, taxe ou formalité officielle inventé.** Le guide explique la méthode
  (classification SH, valeur en douane, origine) et renvoie aux sources officielles à consulter :
  OMC, OMD, CCI, Douane du Bénin, APIEx, Port autonome de Cotonou, CEDEAO, UEMOA, OHADA.
- **Date de vérification affichée** sur la couverture, chaque page (pied de page) et dans les mentions.
- **Exemples pédagogiques clairement identifiés** : montants fictifs, modèles de documents signalés
  comme exemples, jamais présentés comme documents officiels.
- **Avertissement explicite** : le guide ne constitue ni un conseil juridique, ni fiscal, ni douanier personnalisé.
- **Aucune page de remplissage** : chaque page porte du contenu utile (concepts, tableaux, cas,
  exercices corrigés, check-lists, études de cas).

## 7. Contenu du manuel — vue d'ensemble

1. Comprendre le commerce international (acteurs, chaîne commerciale, grandes routes, erreurs fréquentes)
2. Choisir les bons produits (demande, concurrence, marges, restrictions, matrice de sélection)
3. Trouver des fournisseurs fiables (plateformes, vérification, échantillons, grille de notation, arnaques)
4. Négocier avec les fournisseurs (devis, prix, MOQ, délais, dialogue complet, pièges, modèles de messages)
5. Acheter à l'international (Chine, Turquie, Europe, USA, Afrique, corridors vers Cotonou)
6. Transport et logistique (4 modes, conteneurs, groupage, transitaires, assurance, coûts du fret, suivi)
7. Incoterms 2020 (les 11 termes détaillés, risques, coûts, assurance, tableau de décision)
8. Documents commerciaux et douaniers (8 documents, modèles pédagogiques, erreurs, archivage)
9. Douanes, taxes et réglementations (SH, droits, TVA, régimes, cas pratique Bénin, parcours portuaire)
10. Calculer les coûts et les marges (prix de revient, marge/taux de marque, BFR, sensibilité, exercices corrigés)
11. Sécuriser ses transactions (fausses factures, coordonnées bancaires, moyens de paiement, litiges)
12. Créer son entreprise d'import-export (marché, statut, formalités, business plan, financement, tableau de bord)
- **Étude de cas intégrée** : une première importation de bout en bout (8 étapes chiffrées)
- **7 bonus** + bibliographie des sources officielles + annexe (suivi de progression et journal de bord)
