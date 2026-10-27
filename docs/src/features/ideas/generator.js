/**
 * CTR Studio AI — générateur d'idées (titres + concepts de miniature).
 *
 * ⚠️ Génération **locale et simulée** : une bibliothèque de gabarits français
 * combinée de façon déterministe à partir du sujet. Aucun modèle d'IA distant,
 * aucune donnée YouTube, aucun service payant. Les chiffres proposés sont des
 * emplacements à remplacer par VOS données réelles.
 */

import { IDEAS_COUNT } from "../../core/constants.js";
import { clamp, hashString, makeRandom, pickWith, round, shuffleWith } from "../../core/utils.js";
import { analyzeTitle } from "../analysis/titleMetrics.js";

export const SIMULATION_NOTICE =
  "Résultats générés localement par gabarits (aucun modèle d'IA distant, aucune donnée YouTube). Les chiffres entre crochets ou soulignés sont des emplacements à remplacer par vos propres valeurs.";

/* ------------------------------------------------------------ bibliothèque */

const ANGLES = [
  { id: "erreur", label: "Erreurs à éviter", template: "energie" },
  { id: "preuve", label: "Test / preuve", template: "focus" },
  { id: "methode", label: "Méthode pas à pas", template: "focus" },
  { id: "contrarien", label: "Angle contraire", template: "energie" },
  { id: "curiosite", label: "Curiosité", template: "editorial" },
  { id: "comparaison", label: "Comparaison", template: "focus" },
  { id: "resultat", label: "Résultat chiffré", template: "energie" },
  { id: "liste", label: "Liste de ressources", template: "editorial" },
  { id: "debutant", label: "Débutants", template: "focus" },
  { id: "urgence", label: "Actualité / timing", template: "editorial" },
];

/** Gabarits de titres. `s` = sujet tel que saisi, `S` = sujet capitalisé. */
const PATTERNS = {
  erreur: [
    (c) => `${c.n} erreurs sur ${c.s} qui coûtent cher (la ${c.n2}e surtout)`,
    (c) => `Pourquoi votre ${c.s} ne décolle pas : ${c.n} causes réelles`,
    (c) => `${c.S} : arrêtez ça tout de suite (${c.n} pièges)`,
    (c) => `J'ai vu ${c.n} débutants rater ${c.s} — toujours pour la même raison`,
  ],
  preuve: [
    (c) => `J'ai testé ${c.s} pendant ${c.days} jours : bilan honnête`,
    (c) => `${c.n} tests sur ${c.s}, une seule conclusion utile`,
    (c) => `${c.S} : ce que montrent les données (${c.year})`,
    (c) => `J'ai appliqué ${c.s} à la lettre pendant ${c.weeks} semaines`,
  ],
  methode: [
    (c) => `Comment ${c.s} en ${c.n} étapes (même en partant de zéro)`,
    (c) => `La méthode simple pour ${c.s} — expliquée en ${c.minutes} minutes`,
    (c) => `${c.S} : le plan complet, étape par étape (${c.year})`,
    (c) => `Faites ${c.s} dans le bon ordre : ${c.n} étapes, ${c.minutes} minutes`,
  ],
  contrarien: [
    (c) => `${c.S} est une mauvaise idée (voici quoi faire à la place)`,
    (c) => `On vous ment sur ${c.s} : ${c.n} idées reçues démontées`,
    (c) => `Oubliez ${c.s} — cette approche marche mieux`,
    (c) => `Pourquoi je ne recommande plus ${c.s} en ${c.year}`,
  ],
  curiosite: [
    (c) => `Le détail de ${c.s} que presque personne ne remarque`,
    (c) => `Ce que ${c.s} révèle sur ${c.audience}`,
    (c) => `${c.S} : la question que tout le monde évite`,
    (c) => `Il suffit d'un changement pour ${c.s} — le voici`,
  ],
  comparaison: [
    (c) => `${c.S} : ${c.n} options comparées, la gagnante surprend`,
    (c) => `${c.short} vs ${c.alt} : lequel choisir en ${c.year} ?`,
    (c) => `J'ai comparé ${c.n} approches de ${c.s} (résultats)`,
    (c) => `${c.S} pas cher ou premium ? Le vrai écart`,
  ],
  resultat: [
    (c) => `De 0 à ____ grâce à ${c.s} : le plan exact`,
    (c) => `Comment j'ai ____ en ${c.days} jours avec ${c.s}`,
    (c) => `${c.S} : ____ % de résultat avec ${c.n} changements`,
    (c) => `Mon bilan ${c.s} après ${c.months} mois (chiffres réels)`,
  ],
  liste: [
    (c) => `${c.n} outils gratuits pour ${c.s} (${c.year})`,
    (c) => `${c.n} ressources que j'utilise vraiment pour ${c.s}`,
    (c) => `Ma checklist ${c.s} : ${c.n} points à vérifier`,
    (c) => `${c.n} idées pour ${c.s} quand on manque de temps`,
  ],
  debutant: [
    (c) => `${c.S} pour les débutants : commencer sans se tromper`,
    (c) => `Tout comprendre à ${c.s} en ${c.minutes} minutes`,
    (c) => `Premier pas avec ${c.s} : le guide ${c.year}`,
    (c) => `${c.S} : ${c.n} bases à connaître avant de dépenser un euro`,
  ],
  urgence: [
    (c) => `${c.S} change en ${c.year} : ce qu'il faut savoir maintenant`,
    (c) => `Nouvelle règle sur ${c.s} — à appliquer avant ${c.month}`,
    (c) => `${c.S} : ce qui a changé ces ${c.days} derniers jours`,
    (c) => `Préparez ${c.s} avant la fin ${c.month} (checklist)`,
  ],
};

const TONES = {
  direct: { angles: null, note: "Formules frontales, orientées bénéfice." },
  pedagogue: {
    angles: ["methode", "debutant", "liste", "preuve", "comparaison", "erreur"],
    note: "Ton explicatif : guides, étapes, ressources.",
  },
  punchy: {
    angles: ["erreur", "contrarien", "curiosite", "resultat", "urgence", "preuve"],
    note: "Ton incisif : angles forts et curiosité.",
  },
  sobre: {
    angles: ["preuve", "comparaison", "methode", "urgence", "liste", "curiosite"],
    note: "Ton factuel : données, comparaisons, méthodes.",
  },
};

const OVERLAYS = {
  erreur: ["ERREUR N°{n}", "{n} PIÈGES", "STOP", "À ÉVITER"],
  preuve: ["TESTÉ {days} J", "PREUVE À L'APPUI", "RÉSULTAT BRUT", "{n} TESTS"],
  methode: ["EN {n} ÉTAPES", "LA MÉTHODE", "{minutes} MIN", "PAS À PAS"],
  contrarien: ["FAUSSE IDÉE", "ARRÊTEZ ÇA", "NON.", "MIEUX AILLEURS"],
  curiosite: ["LE DÉTAIL", "PERSONNE NE LE DIT", "REGARDEZ BIEN", "VRAIMENT ?"],
  comparaison: ["A vs B", "LEQUEL ?", "{n} COMPARÉS", "MATCH"],
  resultat: ["+____ %", "AVANT / APRÈS", "BILAN RÉEL", "{days} JOURS"],
  liste: ["{n} OUTILS", "GRATUIT", "LA CHECKLIST", "{n} IDÉES"],
  debutant: ["DÉBUTANT", "LES BASES", "COMMENCER ICI", "0 → 1"],
  urgence: ["{year}", "MAINTENANT", "ÇA CHANGE", "AVANT {month}"],
};

const PALETTES = [
  { id: "violet-neon", colors: ["#0b0614", "#7c3aed", "#f0abfc", "#ffffff"], mood: "électrique, moderne" },
  { id: "ambre-contraste", colors: ["#12080a", "#f59e0b", "#fde047", "#ffffff"], mood: "chaleureux, urgent" },
  { id: "bleu-nuit", colors: ["#0f172a", "#38bdf8", "#e0f2fe", "#f8fafc"], mood: "froid, crédible, tech" },
  { id: "rouge-alerte", colors: ["#180307", "#ef4444", "#fecaca", "#ffffff"], mood: "alerte, erreur" },
  { id: "vert-resultat", colors: ["#04140c", "#22c55e", "#bbf7d0", "#ffffff"], mood: "gain, validation" },
  { id: "creme-editorial", colors: ["#171310", "#a16207", "#fdf6e3", "#d6c7a8"], mood: "sérieux, magazine" },
  { id: "monochrome", colors: ["#09090b", "#52525b", "#e4e4e7", "#ffffff"], mood: "sobre, contraste fort" },
];

const VISUALS = [
  "Gros plan du sujet à droite, fond flouté, regard vers l'objectif.",
  "Avant / après en deux moitiés, séparées par une barre verticale fine.",
  "Objet ou capture d'écran au centre, cerclé de jaune, flèche rouge vers le détail.",
  "Visage expressif à gauche, texte en bloc à droite sur fond uni.",
  "Plan large avec voile sombre sur le tiers gauche pour poser le texte.",
  "Main tenant le résultat (chiffre, objet, capture) en premier plan.",
  "Trois vignettes empilées (étapes 1-2-3) avec numéros géants.",
  "Fond dégradé uni + symbole simple (croix, coche, éclair) en très grand.",
];

const EXPRESSIONS = [
  "sourcils levés, bouche légèrement ouverte (surprise)",
  "regard franc, sourire confiant (preuve)",
  "moue sceptique, main sur le menton (doute)",
  "index pointé vers le texte (directive)",
  "yeux plissés vers l'objet (attention au détail)",
  "aucun visage : place maximale au texte et à l'objet",
];

const LAYOUTS = [
  "Sujet à droite, titre en bas gauche (zone plane) — règle des tiers.",
  "Sujet centré, titre en haut sur bandeau semi-opaque.",
  "Sujet à gauche, titre à droite aligné sur 2 lignes courtes.",
  "Sujet en bas, titre en haut à gauche, bordure dégagée.",
  "Diagonale : sujet en bas à droite, titre en haut à gauche.",
];

const MONTHS = ["janvier", "mars", "juin", "septembre", "novembre", "décembre"];

/* ------------------------------------------------------------------ utils */

function firstLetterUpper(text) {
  const s = String(text ?? "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function cleanSubject(topic) {
  return String(topic ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:…]+$/g, "")
    .trim()
    .slice(0, 70);
}

/** Mot-clé court dérivé du sujet (pour « X vs Y »). */
function shortKeyword(topic) {
  const words = cleanSubject(topic).split(" ").filter((w) => w.length > 3);
  return words[words.length - 1] || words[0] || cleanSubject(topic);
}

function alternativeKeyword(topic) {
  const words = cleanSubject(topic).split(" ").filter((w) => w.length > 3);
  return words[0] || cleanSubject(topic);
}

/* -------------------------------------------------------------- génération */

/**
 * @param {object} params
 * @param {string} params.topic    sujet de la vidéo (obligatoire)
 * @param {string} [params.tone]   direct | pedagogue | punchy | sobre
 * @param {string} [params.audience] public visé
 * @param {number} [params.count]  nombre d'idées (5 par défaut)
 * @param {number} [params.seed]   graine : mêmes entrées + même graine = mêmes idées
 */
export function generateIdeas({ topic = "", tone = "direct", audience = "", count = IDEAS_COUNT, seed = 0 } = {}) {
  const sujet = cleanSubject(topic);
  if (!sujet) {
    throw new Error("Indiquez un sujet : le générateur travaille à partir de votre texte.");
  }
  const total = clamp(Math.round(count) || IDEAS_COUNT, 1, 8);
  const random = makeRandom(hashString(`${sujet.toLowerCase()}|${tone}|${audience}|${seed}`));
  const year = new Date().getFullYear();

  const toneConf = TONES[tone] || TONES.direct;
  const anglePool = toneConf.angles
    ? ANGLES.filter((a) => toneConf.angles.includes(a.id))
    : ANGLES;
  const chosenAngles = shuffleWith(random, anglePool).slice(0, Math.min(total, anglePool.length));
  while (chosenAngles.length < total) {
    chosenAngles.push(pickWith(random, anglePool));
  }

  const context = {
    s: sujet.replace(/^[A-ZÀ-Ý]/, (m) => m.toLowerCase()),
    S: firstLetterUpper(sujet),
    short: firstLetterUpper(shortKeyword(sujet)),
    alt: firstLetterUpper(alternativeKeyword(sujet)),
    audience: audience ? cleanSubject(audience) : "votre audience",
    year,
    month: pickWith(random, MONTHS),
    n: pickWith(random, [3, 4, 5, 6, 7, 8, 9, 12]),
    n2: pickWith(random, [2, 3, 4]),
    days: pickWith(random, [7, 14, 21, 30, 60, 90]),
    weeks: pickWith(random, [2, 4, 6, 8, 12]),
    months: pickWith(random, [3, 6, 9, 12]),
    minutes: pickWith(random, [7, 10, 12, 15, 20]),
  };

  const ideas = chosenAngles.slice(0, total).map((angle, index) => {
    const patterns = PATTERNS[angle.id] || PATTERNS.curiosite;
    /* Plusieurs candidats par angle : on garde le mieux noté par nos propres
       heuristiques (longueur, accroche en tête, précision, crédibilité). */
    const candidates = shuffleWith(random, patterns).slice(0, 3).map((fn) => fn(context));
    const analyzed = candidates
      .map((title) => ({ title, analysis: analyzeTitle(title, { topic: sujet }) }))
      .sort((a, b) => b.analysis.score - a.analysis.score);
    const best = analyzed[0];

    const overlayTemplate = pickWith(random, OVERLAYS[angle.id] || OVERLAYS.curiosite);
    const overlayText = overlayTemplate
      .replace("{n}", String(context.n))
      .replace("{days}", String(context.days))
      .replace("{minutes}", String(context.minutes))
      .replace("{year}", String(year))
      .replace("{month}", firstLetterUpper(context.month).toUpperCase());

    const palette = pickWith(random, PALETTES);
    const needsRealData = /____/.test(best.title) || /____/.test(overlayText);

    return {
      id: `idea_${seed}_${index}`,
      angle: angle.id,
      angleLabel: angle.label,
      suggestedTemplate: angle.template,
      title: best.title,
      titleScore: best.analysis.score,
      titleFlags: best.analysis.flags,
      alternatives: analyzed.slice(1).map((a) => a.title),
      overlayText,
      concept: {
        visual: pickWith(random, VISUALS),
        layout: pickWith(random, LAYOUTS),
        expression: pickWith(random, EXPRESSIONS),
        palette,
        fontSizeHint: overlayText.length > 12 ? "gros (90-120 px)" : "très gros (130-170 px)",
      },
      needsRealData,
    };
  });

  return {
    ideas,
    meta: {
      topic: sujet,
      tone,
      toneNote: toneConf.note,
      audience: audience || "",
      seed,
      count: ideas.length,
      year,
      generatedAt: new Date().toISOString(),
      local: true,
      simulated: true,
      notice: SIMULATION_NOTICE,
    },
  };
}

export const AVAILABLE_TONES = Object.entries(TONES).map(([id, conf]) => ({
  id,
  note: conf.note,
}));

export const AVAILABLE_ANGLES = ANGLES.map((a) => ({ id: a.id, label: a.label }));

/** Score moyen des titres générés — indicateur interne, jamais un CTR. */
export function averageTitleScore(result) {
  const scores = result?.ideas?.map((i) => i.titleScore) ?? [];
  if (!scores.length) return 0;
  return round(scores.reduce((a, b) => a + b, 0) / scores.length, 0);
}
