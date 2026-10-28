/**
 * CTR Studio AI — rapport d'analyse.
 *
 * Transforme les mesures brutes (pixels + titre) en scores 0-100, en niveaux
 * lisibles et en conseils actionnables. Chaque règle est explicitée dans le
 * champ `detail` : l'utilisateur peut toujours vérifier d'où vient un score.
 *
 * ⚠️ Ce module ne prédit AUCUN taux de clic. Il mesure des propriétés
 * objectives de l'image et du titre, et le dit.
 */

import { clamp, round } from "../../core/utils.js";
import { titleTips } from "./titleMetrics.js";
import { YOUTUBE_MAX_BYTES } from "../../core/constants.js";

export const DISCLAIMER =
  "Analyse heuristique calculée localement sur vos pixels et votre texte. Aucun serveur, aucune donnée YouTube, aucune prédiction de taux de clic : sans données de performance réelles (impressions, clics), personne ne peut prédire un CTR. Les scores indiquent des risques de lisibilité et de composition, pas une audience.";

export const RULES_DOC = [
  {
    id: "contraste",
    label: "Contraste",
    weight: 22,
    rule: "Écart-type de luminance (contraste RMS) idéal entre 16 % et 40 %, plage dynamique ≥ 170 niveaux, pénalité si noirs ou blancs bouchés.",
  },
  {
    id: "lisibilite",
    label: "Lisibilité du texte",
    weight: 28,
    rule: "Meilleure zone parmi 6 emplacements types : ratio de contraste WCAG du texte (blanc ou sombre) face à la luminance médiane, bruit visuel local et homogénéité du fond.",
  },
  {
    id: "composition",
    label: "Composition",
    weight: 22,
    rule: "Part de zones planes disponibles pour le texte, proximité du point d'attention avec les tiers, encombrement des bords, équilibre gauche/droite et haut/bas.",
  },
  {
    id: "couleur",
    label: "Couleur & netteté",
    weight: 16,
    rule: "Énergie de gradient (netteté perçue), saturation moyenne, nombre de teintes dominantes (palette lisible ≤ 4).",
  },
  {
    id: "titre",
    label: "Titre YouTube",
    weight: 12,
    rule: "Longueur vs troncature (~70 caractères visibles), mot fort en début de titre, précision (chiffre, année), lisibilité, recouvrement avec le sujet, absence de formule invérifiable.",
  },
];

export function levelFor(score) {
  if (score >= 80) return "excellent";
  if (score >= 62) return "correct";
  if (score >= 42) return "perfectible";
  return "faible";
}

const LEVEL_LABEL = {
  excellent: "Excellent",
  correct: "Correct",
  perfectible: "Perfectible",
  faible: "Faible",
};

/* ------------------------------------------------------------ sous-scores */

function scoreContrast(m) {
  const rms = m.luminance.rmsContrast;
  const range = m.luminance.dynamicRange;
  let score;
  if (rms < 0.06) score = 18;
  else if (rms < 0.1) score = 40;
  else if (rms < 0.16) score = 68;
  else if (rms <= 0.4) score = 92;
  else if (rms <= 0.5) score = 74;
  else score = 58;

  if (range < 120) score -= 18;
  else if (range < 170) score -= 8;

  const clipped = m.luminance.clippedDarkShare + m.luminance.clippedBrightShare;
  if (clipped > 0.12) score -= 14;
  else if (clipped > 0.05) score -= 7;

  score = clamp(score, 0, 100);
  const tips = [];
  if (rms < 0.16) tips.push("Augmentez le contraste (ou ajoutez un voile sombre/clair derrière le sujet) : l'image paraît plate en petit format.");
  if (range < 170) tips.push("Étendez la plage dynamique : l'image n'exploite pas les noirs ni les blancs.");
  if (m.luminance.clippedDarkShare > 0.06) tips.push("Beaucoup de noirs bouchés : remontez légèrement les ombres pour garder du détail.");
  if (m.luminance.clippedBrightShare > 0.06) tips.push("Blancs brûlés : baissez la luminosité ou la saturation des hautes lumières.");
  if (rms > 0.5) tips.push("Contraste très dur : vérifiez que les visages ne sont pas bouchés.");
  if (!tips.length) tips.push("Contraste adapté à un affichage en petit format.");

  return {
    score: round(score, 0),
    value: `RMS ${round(rms * 100, 1)} % · plage ${range} niveaux`,
    detail: `Écart-type de luminance ${round(rms * 100, 1)} % (cible 16-40 %), plage dynamique ${range}/255, ${round(m.luminance.clippedDarkShare * 100, 1)} % de noirs bouchés et ${round(m.luminance.clippedBrightShare * 100, 1)} % de blancs brûlés.`,
    tips,
  };
}

function scoreReadability(m) {
  const best = m.zones[0];
  if (!best) return { score: 0, value: "—", detail: "Aucune zone analysable.", tips: [] };
  let score = best.score * 100;
  if (best.bestContrast < 3) score = Math.min(score, 25);
  else if (best.bestContrast < 4.5) score = Math.min(score, 55);

  const second = m.zones[1];
  score = clamp(score, 0, 100);
  const tips = [];
  if (best.bestContrast < 4.5) {
    tips.push(`Aucune zone n'atteint le ratio WCAG 4.5:1 (meilleure : ${round(best.bestContrast, 1)}:1). Ajoutez un fond semi-opaque ou un voile dégradé derrière le texte.`);
  }
  if (best.busy > 0.14) {
    tips.push(`La zone « ${best.label} » est très détaillée (bruit ${round(best.busy * 100, 0)} %) : un contour épais ou un badge plein aidera.`);
  }
  if (second && second.score > 0.72 && best.score < 0.8) {
    tips.push(`La zone « ${second.label} » est nettement plus propice au texte que « ${best.label} ».`);
  }
  if (m.zones.every((z) => z.score < 0.5)) {
    tips.push("Toutes les zones sont difficiles : floutez ou assombrissez l'arrière-plan, ou recadrez pour libérer un fond uni.");
  }
  if (!tips.length) tips.push(`Placez votre texte en « ${best.label} » : contraste ${round(best.bestContrast, 1)}:1 avec un texte ${best.bestColor === "#ffffff" ? "blanc" : "sombre"}.`);

  return {
    score: round(score, 0),
    value: `${best.label} · ${round(best.bestContrast, 1)}:1`,
    detail: `Meilleure zone : « ${best.label} » — contraste WCAG ${round(best.bestContrast, 1)}:1 (texte ${best.bestColor === "#ffffff" ? "blanc" : "sombre"}), bruit visuel ${round(best.busy * 100, 0)} %, homogénéité ${round(best.uniformity * 100, 0)} %.`,
    tips,
    zones: m.zones.map((z) => ({
      id: z.id,
      label: z.label,
      box: z.box,
      score: round(z.score * 100, 0),
      contrast: round(z.bestContrast, 1),
      busy: round(z.busy * 100, 0),
      bestColor: z.bestColor,
    })),
  };
}

function scoreComposition(m) {
  const neg = m.composition.negativeSpace;
  const thirds = m.composition.thirdsProximity;
  const clutter = m.composition.borderClutter;
  const balance = m.grid.leftRightBalance;
  const vertical = m.grid.topBottomBalance;

  let score = 0;
  score += clamp(neg / 0.32, 0, 1) * 38; // 32 % de zones plates = confortable
  score += thirds * 24;
  score += clamp(1 - Math.max(0, clutter - 0.75) / 0.8, 0, 1) * 20;
  score += (balance < 0.08 ? 6 : balance < 0.28 ? 10 : balance < 0.5 ? 6 : 2);
  score += vertical < 0.35 ? 8 : 4;
  score = clamp(score, 0, 100);

  const tips = [];
  if (neg < 0.15) {
    tips.push(`Seulement ${round(neg * 100, 0)} % de zones planes : le texte entrera en collision avec le décor. Recadrez ou ajoutez un voile.`);
  }
  if (thirds < 0.45) {
    tips.push(`Point d'attention à (${round(m.composition.focus.x * 100, 0)} % ; ${round(m.composition.focus.y * 100, 0)} %) : rapprochez le sujet d'une intersection des tiers, ou libérez la zone opposée pour le titre.`);
  }
  if (clutter > 1.25) {
    tips.push(`Bords encombrés (${round(clutter, 2)}× l'intérieur) : ils sont rognés sur certains lecteurs. Éloignez les éléments importants de la bordure.`);
  }
  if (balance > 0.5) {
    tips.push(`Déséquilibre horizontal marqué (${round(balance * 100, 0)} %) : ${m.grid.left > m.grid.right ? "le poids est à gauche" : "le poids est à droite"}, l'autre moitié peut accueillir le titre.`);
  }
  if (!tips.length) tips.push("Composition équilibrée : le regard est guidé et une zone reste disponible pour le texte.");

  return {
    score: round(score, 0),
    value: `${round(neg * 100, 0)} % de zones libres`,
    detail: `Zones planes ${round(neg * 100, 0)} %, point d'attention à ${round(m.composition.focus.x * 100, 0)} %/${round(m.composition.focus.y * 100, 0)} % (proximité des tiers ${round(thirds * 100, 0)} %), bords ${round(clutter, 2)}× l'intérieur, équilibre gauche-droite ${round(balance * 100, 0)} %.`,
    tips,
  };
}

function scoreColorSharpness(m) {
  const sharp = m.edges.sharpness;
  const sat = m.color.saturationMean;
  const diversity = m.color.hueDiversity;

  let score = clamp((sharp - 0.15) / 0.45, 0, 1) * 55;
  if (sat < 0.08) score += 8;
  else if (sat <= 0.62) score += 32;
  else if (sat <= 0.8) score += 20;
  else score += 8;
  score += diversity <= 3 ? 13 : diversity <= 5 ? 8 : 2;
  score = clamp(score, 0, 100);

  const tips = [];
  if (sharp < 0.3) tips.push(`Netteté faible (${round(sharp * 100, 0)} %) : l'image semble floue ou très compressée. Utilisez l'original le plus net possible.`);
  if (sat < 0.12) tips.push("Image très désaturée : en vignette 200 px, elle risque de passer inaperçue.");
  if (sat > 0.75) tips.push("Saturation très élevée : surveillez les peaux et les dégradés qui « claquent ».");
  if (diversity > 5) tips.push(`${diversity} teintes dominantes : simplifiez la palette (2-3 couleurs) pour une lecture instantanée.`);
  if (!tips.length) tips.push(`Palette lisible (dominante ${m.color.dominantHueLabel}, ${diversity} teintes) et netteté correcte.`);

  return {
    score: round(score, 0),
    value: `Netteté ${round(sharp * 100, 0)} % · ${diversity} teintes`,
    detail: `Énergie de contour ${round(sharp * 100, 0)} %, saturation moyenne ${round(sat * 100, 0)} %, dominante ${m.color.dominantHueLabel} (${round(m.color.dominantHueShare * 100, 0)} %), ${diversity} teintes significatives.`,
    tips,
  };
}

function scoreTechnical(file, natural) {
  const checks = [];
  const width = natural?.width ?? file?.width ?? 0;
  const height = natural?.height ?? file?.height ?? 0;
  const ratio = width && height ? width / height : 0;
  const bytes = file?.size ?? 0;

  checks.push({
    ok: Math.abs(ratio - 16 / 9) < 0.02,
    text: width && height
      ? `Dimensions ${width} × ${height} px (ratio ${round(ratio, 2)}:1, recommandé 1,78:1).`
      : "Dimensions inconnues.",
  });
  checks.push({ ok: width >= 1280 && height >= 720, text: width >= 1280 ? "Largeur ≥ 1280 px : conforme." : `Largeur ${width} px < 1280 px : YouTube recommande 1280 × 720 minimum.` });
  if (bytes) {
    checks.push({ ok: bytes <= YOUTUBE_MAX_BYTES, text: `Poids du fichier : ${round(bytes / 1024, 0)} Ko (limite YouTube 2 Mo).` });
  }
  const failed = checks.filter((c) => !c.ok).length;
  return {
    score: round(clamp(100 - failed * 34, 0, 100), 0),
    value: failed ? `${failed} point(s) à corriger` : "Conforme",
    detail: checks.map((c) => c.text).join(" "),
    tips: checks.filter((c) => !c.ok).map((c) => c.text),
    checks,
  };
}

/* ------------------------------------------------------------------ rapport */

/**
 * @param {object} params
 * @param {object} params.metrics  sortie de analyzePixels
 * @param {object} [params.title]  sortie de analyzeTitle
 * @param {object} [params.file]   {name,size,type}
 * @param {object} [params.natural] {width,height} dimensions d'origine
 * @param {string} [params.topic]
 */
export function buildReport({ metrics, title = null, file = null, natural = null, topic = "" }) {
  if (!metrics) throw new Error("Analyse impossible : mesures d'image absentes.");

  const contrast = scoreContrast(metrics);
  const readability = scoreReadability(metrics);
  const composition = scoreComposition(metrics);
  const color = scoreColorSharpness(metrics);
  const technical = scoreTechnical(file, natural);

  const sections = [
    { id: "contraste", label: "Contraste", ...contrast },
    { id: "lisibilite", label: "Lisibilité du texte", ...readability },
    { id: "composition", label: "Composition", ...composition },
    { id: "couleur", label: "Couleur & netteté", ...color },
    {
      id: "technique",
      label: "Conformité technique",
      weight: 0,
      rule: "Ratio 16:9, largeur ≥ 1280 px, poids ≤ 2 Mo : les contraintes de fichier imposées par YouTube.",
      ...technical,
      level: technical.score >= 90 ? "excellent" : technical.score >= 60 ? "perfectible" : "faible",
    },
  ];
  sections[sections.length - 1].levelLabel = LEVEL_LABEL[sections[sections.length - 1].level];

  let weighted = 0;
  let totalWeight = 0;
  for (const rule of RULES_DOC) {
    if (rule.id === "titre") continue;
    const section = sections.find((s) => s.id === rule.id);
    if (!section) continue;
    section.weight = rule.weight;
    section.rule = rule.rule;
    section.level = levelFor(section.score);
    section.levelLabel = LEVEL_LABEL[section.level];
    weighted += section.score * rule.weight;
    totalWeight += rule.weight;
  }

  let titleSection = null;
  if (title) {
    const rule = RULES_DOC.find((r) => r.id === "titre");
    const tips = titleTips(title, { topic });
    titleSection = {
      id: "titre",
      label: "Titre YouTube",
      score: title.score,
      weight: rule.weight,
      rule: rule.rule,
      level: levelFor(title.score),
      value: `${title.chars} caractères · ${title.words} mots`,
      detail: `Longueur ${title.chars}/100 caractères, ${title.words} mots, lisibilité ${title.readability}/100, recouvrement sujet ${round(title.topicOverlap * 100, 0)} %, sous-scores : accroche ${title.subscores.frontScore}, précision ${title.subscores.specificity}, crédibilité ${title.subscores.trustScore}.`,
      tips,
      flags: title.flags,
      subscores: title.subscores,
      feedPreview: title.feedPreview,
      truncated: title.truncated,
    };
    titleSection.levelLabel = LEVEL_LABEL[titleSection.level];
    sections.push(titleSection);
    weighted += titleSection.score * rule.weight;
    totalWeight += rule.weight;
  }

  const overall = totalWeight ? clamp(weighted / totalWeight, 0, 100) : 0;
  const overallLevel = levelFor(overall);

  /* Actions prioritaires : les sections les plus faibles, pondérées. */
  const priorities = sections
    .filter((s) => s.id !== "technique" && s.tips?.length)
    .map((s) => ({
      id: s.id,
      label: s.label,
      score: s.score,
      weight: s.weight ?? 0,
      gain: (100 - s.score) * (s.weight ?? 1),
      tip: s.tips[0],
    }))
    .sort((a, b) => b.gain - a.gain);

  return {
    createdAt: new Date().toISOString(),
    source: "heuristiques locales",
    disclaimer: DISCLAIMER,
    overall: {
      score: round(overall, 0),
      level: overallLevel,
      levelLabel: LEVEL_LABEL[overallLevel],
      label: "Indice de lisibilité",
    },
    sections,
    titleSection,
    technical,
    priorities: priorities.slice(0, 3),
    metrics,
    file,
    natural,
    topic,
    rules: RULES_DOC,
  };
}
