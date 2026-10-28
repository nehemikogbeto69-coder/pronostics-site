# CTR Studio AI

**Éditeur de miniatures YouTube 1280×720, analyse heuristique et générateur d'idées — 100 % dans le navigateur.**

Application web statique, en français, sans compte, sans backend, sans API payante, sans dépendance
runtime. Tout le code est éditable : modules ES natifs, CSS en clair, aucun outil de build.

---

## 1. Ce que fait l'application

### Éditeur de miniatures
- Import d'une photo locale (bouton, glisser-déposer sur la scène, ou Ctrl+V).
- Toile de **1280 × 720 px** : l'aperçu à l'écran utilise exactement la même résolution que l'export,
  donc ce que vous voyez est ce qui sera enregistré.
- Calques de texte : ajout, édition, déplacement, redimensionnement (8 poignées), rotation,
  duplication, réordonnancement, masquage, suppression.
- Typographie : 9 familles système, graisse 100→900, italique, capitales, interlettrage, interlignage,
  retour à la ligne automatique avec largeur de zone imposée, alignement.
- Habillage : remplissage uni ou dégradé, contour (largeur/couleur), ombre (couleur/flou/décalage),
  pastille de fond (unie ou dégradée, rayon, padding, opacité), opacité du calque.
- Photo : recadrage *Remplir / Entier / Étirer*, zoom, décalage, retournements, luminosité, contraste,
  saturation, flou, vignettage, voile dégradé (scrim).
- Fond : couleur unie ou dégradé avec angle.
- Trois modèles de départ : **Énergie**, **Focus**, **Éditorial** (la photo importée est conservée).
- Guides : règle des tiers, marge de sécurité, zone horodatage YouTube en bas à droite.
- Historique illimité dans la limite de 60 pas (Ctrl+Z / Ctrl+Maj+Z), sauvegarde locale automatique,
  export/import du projet en JSON.
- Import de polices personnelles (`.ttf`, `.otf`, `.woff`, `.woff2`) : la police est embarquée dans le
  projet JSON, aucun CDN de polices.

### Export PNG (le point critique)
- Rendu de la composition réelle dans un canvas neuf de 1280×720, puis `toBlob('image/png')`.
- **Vérification systématique des octets** avant d'annoncer un succès : signature PNG, bloc `IHDR`
  (largeur/hauteur lues dans le fichier), bloc final `IEND`, puis décodage réel de l'image
  (`createImageBitmap`). Si une étape échoue, l'interface affiche un échec — jamais une fausse réussite.
- Contrôle du poids : alerte si le fichier dépasse **2 Mo** (limite YouTube), sans bloquer l'export.
- **Repli Android Chrome** (et tout navigateur qui refuse le téléchargement direct) : aperçu de l'image
  en pleine largeur à maintenir appuyé → « Télécharger l'image », ouverture du PNG dans un onglet,
  partage natif Web Share (`navigator.share` avec fichier) si l'appareil le permet, copie dans le
  presse-papiers, et relance de l'export.

### Analyse de miniature
- Image à analyser : fichier importé, glisser-déposer, ou la miniature en cours d'édition
  (exportée puis analysée, donc analysée sur les vrais pixels).
- Mesures objectives : contraste RMS et local, plage de luminance, zones de texte potentiellement
  lisibles (6 zones), netteté/énergie des bords, équilibre de la composition (tiers, gauche/droite,
  haut/bas, espace négatif), dominante de couleur, saturation, noirs/blancs bouchés, point d'attention.
- Titre YouTube : longueur (100 caractères max, 70 visibles dans le fil), mots creux, mots forts,
  tournures putaclic, lisibilité française, cohérence avec le sujet.
- Rapport pondéré et expliqué : chaque section affiche son score, sa valeur mesurée, la **règle de
  notation** utilisée, des conseils et des contrôles techniques (dimensions, poids, ratio).
- Calque d'annotation dessiné sur l'image : grille des tiers, zones de texte colorées selon leur
  lisibilité, point d'attention, marge de sécurité.

> **Honnêteté assumée.** L'analyse ne prédit **aucun taux de clic**. Sans vos impressions et vos clics
> réels, aucune prédiction de CTR n'est défendable : le rapport mesure des propriétés d'image et de
> texte, et le dit explicitement (bandeau présent dans chaque rapport).

### Générateur d'idées
- 5 idées à partir du sujet (et optionnellement de l'audience et du ton) : titre, texte à poser sur la
  miniature, taille conseillée, visuel, mise en page, expression, palette de 4 couleurs, angle
  éditorial, variantes écartées.
- Génération **déterministe et locale** par combinaison de gabarits + hachage du sujet : aucun modèle
  d'IA distant, aucune donnée YouTube, aucun réseau. Chaque carte porte l'étiquette « simulé » et un
  bandeau rappelle la nature locale du résultat.
- Les titres proposés sont passés à travers les heuristiques de l'analyse de titre : le meilleur
  candidat de chaque angle est retenu, et les titres à chiffres sont marqués « à remplir avec VOS
  données réelles ».
- « Envoyer vers l'éditeur » applique le modèle, le texte, la palette et le titre suggéré à la
  miniature en cours (action annulable).

---

## 2. Lancer l'application

Aucune étape de compilation. Deux options :

### Option A — serveur inclus (recommandé)
```bash
cd ctr-studio-ai
npm install          # installe UNIQUEMENT les outils de test (jsdom, @napi-rs/canvas)
npm start            # http://localhost:5173
npm start -- --port 8080 --host 0.0.0.0
```
`tools/dev-server.mjs` est un serveur statique Node sans dépendance (types MIME corrects, pas de cache
pour le HTML/CSS/JS, protection contre la traversée de chemin).

> `npm install` n'est **pas** nécessaire pour utiliser l'application : il ne sert qu'aux tests.
> L'application elle-même n'a aucune dépendance.

### Voir des exemples de rendu
```bash
node tools/make-samples.mjs    # produit 4 PNG 1280×720 vérifiés dans docs/apercus/
```
Le script utilise le **vrai pipeline d'export** (`src/io/exporter.js`) : ce sont exactement les octets
qu'un utilisateur télécharge, avec la vérification IHDR + décodage affichée à la fin. Les fichiers
générés ne sont pas commités (voir `.gitignore`).

### Option B — n'importe quel serveur statique
```bash
cd ctr-studio-ai
python3 -m http.server 5173      # ou : npx serve . / caddy file-server / nginx
```

### Pourquoi un serveur et pas un double-clic sur `index.html` ?
Les modules ES sont soumis à la politique CORS : ouverts en `file://`, la plupart des navigateurs
bloquent les `import`. Un serveur HTTP local (même minimal) suffit. Tous les chemins du projet sont
**relatifs** (`./src/...`, `./styles/...`), donc l'application fonctionne à la racine d'un domaine
comme dans un sous-dossier (`/ctr-studio-ai/`), sans configuration.

---

## 3. Tester

```bash
npm test               # 174 tests, ~70 s
npm run test:core      # PNG, composition, mise en page texte, rendu, export
npm run test:features  # analyse + générateur d'idées
npm run test:ui        # interface complète (jsdom) + intégrité du projet
node --test tests/export.test.mjs   # un seul fichier
```

Les tests utilisent le vrai code de production :

| Fichier | Couvre |
| --- | --- |
| `tests/png.test.mjs` | signature PNG, lecture IHDR, détection de troncature, vérification d'octets |
| `tests/composition.test.mjs` | schéma de calques, assainissement, CRUD, réordonnancement, sérialisation du projet |
| `tests/textLayout.test.mjs` | mesure de texte, interlettrage, césure, boîtes, lignes de base, cadrage dans la toile |
| `tests/renderer.test.mjs` | rendu pixel par pixel (Skia) : fond, photo, scrim, vignettage, contour, ombre, dégradés, filtres, rotation, guides, sélection |
| `tests/export.test.mjs` | **export PNG réel** : dimensions, décodage, déterminisme, poids > 2 Mo, encodeur menteur détecté |
| `tests/analysis.test.mjs` | métriques d'image sur images synthétiques, analyse de titre, construction du rapport, poids des sections |
| `tests/ideas.test.mjs` | 5 idées, titres ≤ 100 caractères, angles distincts, déterminisme, mentions « local / simulé » |
| `tests/ui.test.mjs` | **interface pilotée comme un utilisateur** : démarrage, modèles, modale de texte, glisser/redimensionner, import de fichier, refus d'un non-image, export vérifié, repli, épargne localStorage, analyse, idées, navigation, raccourcis |
| `tests/modules.test.mjs` | imports résolus, zéro dépendance externe, architecture en couches, ressources et identifiants de `index.html`, `.gitignore` |

Détail technique : `tests/helpers/dom.mjs` charge le vrai `index.html` dans jsdom et branche
`HTMLCanvasElement.getContext/toBlob/toDataURL` sur `@napi-rs/canvas` (Skia). Les pixels comparés et les
octets PNG vérifiés sont donc **réels**, pas simulés. `tests/helpers/headless.mjs` fournit la fabrique
de canvas et des images synthétiques (dégradé, bruit, sujet, split, sombre, asymétrique) pour les tests
de rendu et d'analyse.

---

## 4. Structure du projet

```
ctr-studio-ai/
├── index.html                 page unique : entête, 3 vues, 2 modales, entrées fichier cachées
├── styles/
│   ├── tokens.css             variables (couleurs, rayons, ombres, typographie, espacements)
│   ├── base.css               reset, typographie, fonds, focus, accessibilité, scrollbar
│   ├── layout.css             entête, grille éditeur/inspecteur, scène, analyse, idées, responsive
│   └── components.css         boutons, champs, cartes, jauges, modales, toasts, tableaux
├── src/
│   ├── main.js                démarrage : état, scènes, vues, navigation, passerelles, erreurs globales
│   ├── core/                  moteur sans DOM (testable dans Node)
│   │   ├── constants.js       dimensions, limites, clés de stockage, version du schéma
│   │   ├── utils.js           clamp, couleurs, contraste WCAG, hachage, PRNG, formatage
│   │   ├── fonts.js           9 familles système + polices importées (FontFace)
│   │   ├── composition.js     schéma de projet, calques, création/assainissement, sérialisation
│   │   ├── textLayout.js      mesure, césure, boîtes, lignes de base, cadrage
│   │   ├── effects.js         filtres (natifs ou pixel à pixel), dégradés, vignettage, placement image
│   │   ├── geometry.js        rotation de repère, poignées, tests d'inclusion
│   │   ├── renderer.js        drawBase + drawTextLayers = drawComposition (aperçu ET export)
│   │   └── templates.js       Énergie, Focus, Éditorial
│   ├── io/
│   │   ├── png.js             signature, IHDR, IEND, vérification d'octets
│   │   ├── exporter.js        export 1280×720 + vérification + décodage + rapport
│   │   ├── imageImport.js     validation, décodage, réduction mémoire, dataURL persistable
│   │   └── storage.js         localStorage (avec repli hors-quota) + projet JSON
│   ├── features/
│   │   ├── analysis/          imageMetrics.js, titleMetrics.js, report.js (règles documentées)
│   │   └── ideas/             generator.js (gabarits, angles, tons, palettes, déterminisme)
│   └── ui/
│       ├── dom.js             fabrique d'éléments, sélecteurs, écouteurs
│       ├── controls.js        champs déclaratifs (curseur, couleur, texte, select, bascule, segment)
│       ├── store.js           état unique, historique, autosave, abonnements
│       ├── canvasInteraction.js  pointeur → gestes (déplacer, redimensionner, pivoter, recadrer)
│       ├── stage.js           canvas d'aperçu, cache du fond, rendu par frame
│       ├── inspector.js       panneaux Calques / Texte / Style / Photo / Fond
│       ├── textModal.js       édition de texte en feuille modale (aperçu live, Échap annule)
│       ├── exportPanel.js     export vérifié + replis + gestion du projet
│       ├── editorView.js      barre d'outils, modèles, import photo/police, raccourcis
│       ├── analysisView.js    import, mesures, rapport, calque d'annotation
│       ├── ideasView.js       formulaire, cartes d'idées, envoi vers l'éditeur
│       ├── icons.js           jeu d'icônes SVG inline (aucune police d'icônes externe)
│       └── toast.js           notifications empilées
├── tests/                     9 fichiers de tests + 2 helpers
├── tools/dev-server.mjs       serveur statique de développement
└── package.json               scripts ; devDependencies limitées aux tests
```

**Architecture en couches** : `core/` et `features/` ne connaissent pas le DOM (ils reçoivent un
contexte canvas et renvoient des données pures) → ils s'exécutent tels quels dans Node pendant les
tests. `ui/` orchestre. `io/` isole tout ce qui touche aux fichiers, au réseau (aucun) et au stockage.

---

## 5. Modifier

### Changer les couleurs / le thème
Tout passe par `styles/tokens.css` : `--accent`, `--gradient-brand`, `--bg-panel`, `--text`,
`--line`, `--r-md`, `--sh-2`… Aucune couleur n'est codée en dur dans les composants.

### Ajouter un modèle de départ
Dans `src/core/templates.js`, ajouter une entrée au tableau `TEMPLATES` :
```js
{
  id: "contraste",
  name: "Contraste",
  tagline: "Jaune sur noir, titre massif",
  description: "Pour les sujets chocs.",
  preview: "linear-gradient(135deg,#111 0%,#facc15 140%)",   // aperçu CSS de la carte
  swatches: ["#111111", "#facc15", "#ffffff"],
  build: () => ({
    background: { type: "solid", color: "#111111" },
    image: { vignette: 0.3, scrim: { enabled: true, from: "rgba(0,0,0,0)", to: "rgba(0,0,0,0.7)", angle: 180 } },
    layers: [ /* objets partiels passés à createTextLayer() */ ],
  }),
}
```
La carte apparaît automatiquement dans l'éditeur, et `applyTemplate(comp, "contraste")` fonctionne
(ainsi que la suggestion des idées générées si vous ajoutez l'`id` aux `suggestedTemplate`).

### Ajuster les règles d'analyse
`src/features/analysis/report.js` contient `RULES_DOC` : pour chaque section, le poids, la description
de la règle et les seuils. Les seuils de lisibilité sont dans `imageMetrics.js`
(`analyzePixels`), ceux du titre dans `titleMetrics.js` (`analyzeTitle`). Modifiez un seuil, puis
adaptez `tests/analysis.test.mjs` : les tests comparent des images synthétiques entre elles, donc ils
repèrent immédiatement une dérive.

### Ajouter un contrôle dans l'inspecteur
Les panneaux sont déclaratifs (`src/ui/inspector.js`) :
```js
{ type: "range", label: "Arrondi", min: 0, max: 60, step: 1, unit: "px",
  get: () => layer()?.background.radius ?? 0,
  set: (v) => setLayer({ background: { ...layer().background, radius: v } }, "radius"),
  disabled: () => !layer()?.background.enabled }
```
Types disponibles : `range`, `color`, `text`, `textarea`, `select`, `toggle`, `segment`, `buttons`,
`static`. Les `get`/`set` sont des fermetures sur le store : rien n'est reconstruit au changement de
sélection, seul `refresh()` met à jour les valeurs (et n'écrase jamais un champ en cours de saisie).

### Ajouter une règle d'idée
`src/features/ideas/generator.js` : tableaux `ANGLES`, `TONES`, `VISUALS`, `EXPRESSIONS`, `LAYOUTS`,
`OVERLAYS`, `PALETTES`. La génération est déterministe (`hashString` + `makeRandom` sur le sujet, le
ton, l'audience et le `seed`) : ajouter une entrée enrichit le tirage sans casser les tests existants,
mais modifie les titres produits (à répercuter dans `tests/ideas.test.mjs` si vous y figez des valeurs).

### Brancher une vraie API plus tard
Le code est prêt pour ça sans refonte : `features/ideas/generator.js` et `features/analysis/report.js`
sont des fonctions pures. Il suffirait d'ajouter un module `src/io/remote.js`, de l'appeler depuis les
vues, et d'étiqueter clairement les résultats distants — tout en conservant l'avertissement selon
lequel un score n'est pas une prédiction de CTR.

---

## 6. Déployer

L'application est **100 % statique** : copiez le dossier sur n'importe quel hébergeur. Aucune variable
d'environnement, aucun backend, aucun build.

```bash
# ce qu'il faut publier (node_modules et tests ne servent à rien en production)
ctr-studio-ai/index.html
ctr-studio-ai/styles/
ctr-studio-ai/src/
```

| Hébergeur | Commande |
| --- | --- |
| **GitHub Pages** | `node tools/deploy-pages.mjs` (copie l'app dans `/docs` à la racine du dépôt), commit + push, puis activer Pages avec source = branche + `/docs` ; chemins relatifs ⇒ fonctionne dans `/nom-du-depot/` |
| **Netlify** | `netlify deploy --prod --dir ctr-studio-ai` (build command : vide) |
| **Vercel** | `vercel deploy --prod` avec *Root Directory* = `ctr-studio-ai`, Framework = *Other* |
| **Cloudflare Pages** | dossier `ctr-studio-ai`, commande de build vide |
| **nginx / Apache / OVH** | copier les fichiers dans la racine web ; aucune réécriture d'URL nécessaire |
| **Docker** | `FROM nginx:alpine` + `COPY ctr-studio-ai/{index.html,src,styles} /usr/share/nginx/html/` |

Points d'attention :
- Servir en **HTTPS** : `createImageBitmap`, le presse-papiers et le Web Share exigent un contexte
  sécurisé (localhost compte comme sécurisé).
- Types MIME : `.js` doit partir en `text/javascript`, sinon les modules sont bloqués. Les hébergeurs
  cités le font correctement ; le serveur fourni aussi.
- En-têtes conseillés : `Cache-Control: no-cache` pour `index.html`, `max-age=3600` pour `src/` et
  `styles/` (versionnez les fichiers si vous voulez un cache long).
- Pas de Service Worker ni de manifeste dans cette version : l'application fonctionne hors ligne une
  fois chargée, mais n'est pas installable. Ajout possible sans toucher au reste.

---

## 7. Compatibilité et limites connues

- **Testé** : Chrome/Edge desktop et Android, Firefox, Safari 15+. Le rendu et l'export sont validés par
  des tests sur Skia (`@napi-rs/canvas`) et par des tests d'interface sur jsdom.
- **`ctx.filter`** : natif sur Chrome/Firefox/Edge. Sur Safari < 18, les réglages photo
  (luminosité/contraste/saturation) basculent sur un traitement pixel à pixel : le résultat exporté est
  identique, l'aperçu est un peu plus lent, et un avertissement l'indique. Le **flou** n'est pas simulé
  dans ce repli : il est ignoré et signalé.
- **`letterSpacing`** : natif si disponible, sinon avance caractère par caractère (mêmes pixels).
- **Polices** : uniquement des polices système (aucun CDN). Sur Android, *Impact* retombe sur une
  grasse équivalente. Pour une police précise, importez un fichier `.woff2` : il est embarqué dans le
  projet.
- **Mémoire mobile** : une image importée de plus de 25 Mo est refusée ; au-delà de 8 000 px de côté
  elle est réduite à la volée ; la version enregistrée dans `localStorage` est limitée à 1 600 px (JPEG q0.92,
  ou PNG si l'original a de la transparence). Le fichier exporté, lui, utilise toujours l'image
  pleine résolution chargée en mémoire.
- **`localStorage`** : ~5 Mo par origine. Si la place manque, le projet est enregistré **sans la
  photo** et l'interface le dit (les calques et réglages sont conservés). Utilisez « Exporter le
  projet (.json) » pour une sauvegarde complète.
- **Taille du PNG** : un fond très détaillé peut dépasser 2 Mo (limite YouTube). L'export n'est pas
  bloqué, mais un avertissement chiffré s'affiche. Astuce : réduisez le flou/le bruit de la photo, ou
  simplifiez le fond.

---

## 8. Données et vie privée

- Aucune requête réseau : ni télémétrie, ni police distante, ni API, ni `fetch`.
- Les photos, titres, sujets et projets restent dans le navigateur (mémoire + `localStorage`).
- Effacer les données : panneau **Export → Projet → Effacer la sauvegarde locale**, ou supprimer le
  site des données enregistrées dans les réglages du navigateur.
- Les scores d'analyse et les idées sont explicitement étiquetés comme locaux/simulés et ne constituent
  pas une mesure d'audience.

---

## 9. Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl/⌘ + Z` · `Ctrl/⌘ + Maj + Z` · `Ctrl/⌘ + Y` | Annuler · Rétablir |
| `Ctrl/⌘ + S` | Exporter le PNG |
| `Ctrl/⌘ + D` | Dupliquer le calque |
| `Flèches` (`+ Maj`) | Déplacer de 1 px (10 px) |
| `Suppr` | Supprimer le calque |
| `Entrée` | Éditer le texte du calque sélectionné |
| `Échap` | Désélectionner / fermer une modale |
| `Alt + 1/2/3` | Onglet Éditeur / Analyse / Idées |
| `?` | Aide et à-propos |
| Double-tap / double-clic sur un calque | Ouvrir l'éditeur de texte |
| `Maj` pendant un redimensionnement | Contraindre / aimanter à 15° |

---

## 10. Licence

MIT. Réutilisez, modifiez, redistribuez — la mention « les scores ne prédisent pas un CTR réel »
mérite d'être conservée.
