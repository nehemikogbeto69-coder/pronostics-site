/**
 * CTR Studio AI — heuristiques sur le titre YouTube.
 *
 * Règles issues des contraintes d'affichage connues de YouTube (troncature,
 * nombre de caractères visibles) et de bonnes pratiques éditoriales. Ce sont
 * des règles locales et explicites : aucune donnée de performance réelle n'est
 * consultée, et aucun taux de clic n'est prédit.
 */

import { clamp, countWords, round } from "../../core/utils.js";

/** YouTube accepte 100 caractères ; l'affichage réel est souvent plus court. */
export const TITLE_HARD_LIMIT = 100;
export const TITLE_VISIBLE_FEED = 70;
export const TITLE_IDEAL_MIN = 32;
export const TITLE_IDEAL_MAX = 62;

const STOPWORDS = new Set([
  "le","la","les","un","une","des","du","de","d","au","aux","et","ou","a","à","en","dans","sur",
  "pour","par","avec","sans","que","qui","quoi","dont","où","ce","cet","cette","ces","mon","ma",
  "mes","ton","ta","tes","son","sa","ses","notre","votre","leur","leurs","je","tu","il","elle",
  "on","nous","vous","ils","elles","est","sont","etre","être","the","of","and","to","in","for",
]);

const POWER_WORDS = [
  "secret","secrets","erreur","erreurs","pourquoi","comment","gratuit","gratuite","nouveau",
  "nouvelle","testé","testée","vérifié","preuve","méthode","système","simple","facile","rapide",
  "résultat","résultats","vérité","attention","arrêter","arrêtez","jamais","toujours","personne",
  "réellement","chiffres","étude","guide","complet","ultime","avant","après","gagner","perdre",
  "piège","pièges","mythe","mythes","leçon","leçons","étape","étapes","minute","minutes","jours",
  "mois","euros","fois","meilleur","meilleure","pire","réussir","échouer","échec","transformé",
];

const CLICKBAIT = [
  "incroyable","choquant","choquante","hallucinant","vous ne croirez"," dingue"," dingue !",
  "urgent","scandale","révélations choc","100 %","garanti","miracle","secret interdit",
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}]/gu;

/* ------------------------------------------------------------------ utils */

function normalizeWord(word) {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function tokenize(text) {
  return String(text ?? "")
    .split(/[\s,;:.!?()\[\]{}«»"'’\/\\|]+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);
}

function keywords(text) {
  return new Set(tokenize(text).filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

/** Approximation du nombre de syllabes françaises (groupes de voyelles). */
function syllables(word) {
  const w = normalizeWord(word);
  if (!w) return 0;
  const groups = w.match(/[aeiouyàâäéèêëîïôöùûü]+/g) || [];
  let n = groups.length;
  if (/e$/.test(w) && n > 1) n -= 1; // « e » final muet
  return Math.max(1, n);
}

/** Indice de lisibilité (Flesch adapté au français), 0-100, plus haut = plus simple. */
export function frenchReadability(text) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const sentences = Math.max(1, (String(text).match(/[.!?]+/g) || []).length || 1);
  const totalSyllables = words.reduce((sum, w) => sum + syllables(w), 0);
  const asl = words.length / sentences;
  const asw = totalSyllables / words.length;
  return clamp(206.835 - 1.015 * asl - 84.6 * asw, 0, 100);
}

/* ------------------------------------------------------------- analyse */

/**
 * @param {string} title
 * @param {{topic?:string}} [context]
 */
export function analyzeTitle(title, context = {}) {
  const raw = String(title ?? "").replace(/\s+/g, " ").trim();
  const chars = [...raw].length;
  const words = raw.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const tokens = tokenize(raw);

  const upperLetters = (raw.match(/[A-ZÀ-ÖØ-Þ]/g) || []).length;
  const letters = (raw.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const capsRatio = letters ? upperLetters / letters : 0;

  const hasNumber = /\d/.test(raw);
  const hasYear = /(19|20)\d{2}/.test(raw);
  const hasQuestion = /\?\s*$/.test(raw) || /\?/.test(raw);
  const brackets = (raw.match(/[[({][^)\]}]{2,40}[)\]}]/g) || []).length;
  const hasSeparator = /[:—–\-|]/.test(raw);
  const emoji = (raw.match(EMOJI_RE) || []).length;

  const lower = ` ${raw.toLowerCase()} `;
  const powerHits = POWER_WORDS.filter((w) => lower.includes(w));
  const clickbaitHits = CLICKBAIT.filter((w) => lower.includes(w.toLowerCase()));

  const topicSet = keywords(context.topic || "");
  const titleSet = keywords(raw);
  let overlap = 0;
  if (topicSet.size) {
    for (const w of topicSet) if (titleSet.has(w)) overlap += 1;
    overlap = topicSet.size ? overlap / topicSet.size : 0;
  }

  /* Le début du titre est ce qui survit à la troncature dans le fil d'actualité. */
  const feedCut = [...raw].slice(0, TITLE_VISIBLE_FEED).join("");
  const hookWordEarly = powerHits.some((w) => {
    const idx = lower.indexOf(w);
    return idx >= 0 && idx < 26;
  });
  const endsAbruptly = chars > TITLE_VISIBLE_FEED && !/[\s,.:;!?—–-]/.test([...raw][TITLE_VISIBLE_FEED] ?? " ");

  const duplicates = tokens.filter((w, i) => tokens.indexOf(w) !== i && w.length > 3);
  const readability = frenchReadability(raw);
  const avgWordLength = tokens.length ? tokens.reduce((s, w) => s + w.length, 0) / tokens.length : 0;

  /* ------------------------------------------------------------ sous-scores */
  const lengthScore = chars === 0
    ? 0
    : chars > TITLE_HARD_LIMIT
      ? 8
      : chars <= TITLE_IDEAL_MAX && chars >= TITLE_IDEAL_MIN
        ? 100
        : chars < TITLE_IDEAL_MIN
          ? clamp(45 + (chars / TITLE_IDEAL_MIN) * 45, 0, 90)
          : clamp(100 - ((chars - TITLE_IDEAL_MAX) / (TITLE_HARD_LIMIT - TITLE_IDEAL_MAX)) * 70, 15, 92);

  const frontScore = clamp((hookWordEarly ? 60 : 0) + (hasSeparator ? 25 : 0) + (endsAbruptly ? -25 : 15), 0, 100);
  const specificity = clamp((hasNumber ? 55 : 0) + (hasYear ? 15 : 0) + (brackets ? 15 : 0) + (powerHits.length ? 20 : 0), 0, 100);
  const clarity = clamp(readability * 0.7 + (wordCount >= 4 && wordCount <= 12 ? 30 : wordCount < 4 ? 10 : 12) + (avgWordLength < 9 ? 10 : 0), 0, 100);
  const relevance = topicSet.size ? clamp(overlap * 100, 0, 100) : 55;
  const trustScore = clamp(100 - clickbaitHits.length * 45 - Math.max(0, capsRatio - 0.35) * 90 - (emoji > 2 ? 20 : emoji > 0 ? 6 : 0), 0, 100);

  const computed = round(
    lengthScore * 0.28 +
      frontScore * 0.16 +
      specificity * 0.16 +
      clarity * 0.14 +
      relevance * 0.14 +
      trustScore * 0.12,
    0,
  );
  /* Un titre vide ne peut pas être « un peu bon » : score nul. */
  const score = chars === 0 ? 0 : computed;

  /* ---------------------------------------------------------------- drapeaux */
  const flags = [];
  if (chars === 0) flags.push({ level: "error", text: "Titre vide." });
  if (chars > TITLE_HARD_LIMIT) {
    flags.push({ level: "error", text: `Au-delà de la limite YouTube (${chars}/100 caractères).` });
  } else if (chars > TITLE_VISIBLE_FEED) {
    flags.push({
      level: "warn",
      text: `Visible tronqué vers ${TITLE_VISIBLE_FEED} caractères dans le fil d'actualité : « ${feedCut.slice(0, 44)}… »`,
    });
  } else if (chars && chars < TITLE_IDEAL_MIN) {
    flags.push({ level: "warn", text: `Titre court (${chars} caractères) : la promesse peut manquer de précision.` });
  }
  if (capsRatio > 0.55) flags.push({ level: "warn", text: "Beaucoup de capitales : perçu comme agressif." });
  if (clickbaitHits.length) {
    flags.push({ level: "warn", text: `Formule accrocheuse non étayée (« ${clickbaitHits[0].trim()} ») : risque de déception et de rétention faible.` });
  }
  if (emoji > 2) flags.push({ level: "warn", text: `${emoji} émojis : sur certains sujets, cela réduit la crédibilité.` });
  if (duplicates.length) {
    flags.push({ level: "info", text: `Répétition(s) : ${[...new Set(duplicates)].slice(0, 3).join(", ")}.` });
  }
  if (topicSet.size && overlap < 0.2) {
    flags.push({ level: "warn", text: "Peu de mots communs avec le sujet déclaré : risque de hors-sujet perçu." });
  }
  if (!hasNumber && !hasQuestion && !powerHits.length) {
    flags.push({ level: "info", text: "Aucun déclencheur de curiosité détecté (chiffre, question, mot fort)." });
  }
  if (hasSeparator && !hookWordEarly) {
    flags.push({ level: "info", text: "Structure en deux temps détectée : placez la promesse avant le séparateur." });
  }

  return {
    title: raw,
    chars,
    words: wordCount,
    feedPreview: feedCut,
    truncated: chars > TITLE_VISIBLE_FEED,
    capsRatio: round(capsRatio, 2),
    hasNumber,
    hasYear,
    hasQuestion,
    brackets,
    hasSeparator,
    emoji,
    powerHits,
    clickbaitHits,
    topicOverlap: round(overlap, 2),
    readability: round(readability, 0),
    avgWordLength: round(avgWordLength, 1),
    duplicates: [...new Set(duplicates)],
    subscores: {
      lengthScore: round(lengthScore, 0),
      frontScore: round(frontScore, 0),
      specificity: round(specificity, 0),
      clarity: round(clarity, 0),
      relevance: round(relevance, 0),
      trustScore: round(trustScore, 0),
    },
    score,
    flags,
  };
}

/** Suggestions concrètes déduites de l'analyse (toujours locales). */
export function titleTips(analysis, context = {}) {
  const tips = [];
  const { chars, subscores, hasNumber, powerHits, topicOverlap } = analysis;

  if (chars > TITLE_VISIBLE_FEED) {
    tips.push(
      `Raccourcissez sous ${TITLE_VISIBLE_FEED} caractères : la fin « ${analysis.title.slice(TITLE_VISIBLE_FEED - 6, TITLE_VISIBLE_FEED + 14)}… » disparaît dans le fil.`,
    );
  }
  if (chars && chars < TITLE_IDEAL_MIN) {
    tips.push("Ajoutez une précision utile (chiffre, durée, contexte) pour dépasser 30 caractères.");
  }
  if (!hasNumber) tips.push("Un chiffre (durée, montant, nombre d'étapes) rend la promesse mesurable.");
  if (subscores.frontScore < 60) {
    tips.push("Placez le mot le plus fort dans les 3 premiers mots : c'est ce qui reste visible après troncature.");
  }
  if (!powerHits.length) tips.push("Un mot d'action ou de bénéfice (méthode, erreur, résultat, sans…) clarifie l'intérêt.");
  if (context.topic && topicOverlap < 0.35) {
    tips.push("Reprenez au moins un mot-clé du sujet : l'algorithme et le spectateur s'y retrouvent.");
  }
  if (analysis.capsRatio > 0.5) tips.push("Réservez les capitales à un seul mot : l'effet est plus fort et moins agressif.");
  if (analysis.clickbaitHits.length) {
    tips.push("Remplacez la promesse invérifiable par un fait précis (« 12 tests », « 30 jours », « 4 erreurs »).");
  }
  if (analysis.readability < 55) tips.push("Phrases plus courtes, mots plus simples : le titre se lit en moins d'une seconde.");
  if (!tips.length) tips.push("Titre solide. Testez une variante avec un chiffre ou un angle contraire pour comparer.");
  return tips.slice(0, 5);
}
