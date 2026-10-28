/**
 * Tests de l'analyse heuristique : les mesures doivent classer correctement des
 * images synthétiques dont on connaît les propriétés, et le rapport doit rester
 * honnête (jamais de prédiction de taux de clic).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANALYSIS_HEIGHT,
  ANALYSIS_WIDTH,
  TEXT_ZONES,
  analyzePixels,
  metricsSummary,
} from "../src/features/analysis/imageMetrics.js";
import {
  DISCLAIMER,
  RULES_DOC,
  buildReport,
  levelFor,
} from "../src/features/analysis/report.js";
import {
  TITLE_HARD_LIMIT,
  TITLE_VISIBLE_FEED,
  analyzeTitle,
  frenchReadability,
  titleTips,
  tokenize,
} from "../src/features/analysis/titleMetrics.js";
import { imageDataOf, syntheticImage } from "./helpers/headless.mjs";

function metricsFor(kind) {
  const canvas = syntheticImage(ANALYSIS_WIDTH, ANALYSIS_HEIGHT, kind);
  return analyzePixels(imageDataOf(canvas));
}

/* ------------------------------------------------------------- mesures */

test("analyzePixels refuse une entrée invalide", () => {
  assert.throws(() => analyzePixels(null), /pixel/);
  assert.throws(() => analyzePixels({ data: null, width: 0, height: 0 }), /pixel/);
});

test("image plate : contraste quasi nul détecté", () => {
  const m = metricsFor("flat");
  assert.ok(m.luminance.rmsContrast < 0.02, `rms = ${m.luminance.rmsContrast}`);
  assert.ok(m.luminance.dynamicRange < 10);
  assert.ok(m.edges.mean < 0.01, "aucun contour dans un aplat");
  assert.ok(m.composition.negativeSpace > 0.95, "un aplat est entièrement « zone libre »");
});

test("image très contrastée (noir/blanc) : contraste élevé détecté", () => {
  const m = metricsFor("split");
  assert.ok(m.luminance.rmsContrast > 0.4, `rms = ${m.luminance.rmsContrast}`);
  assert.ok(m.luminance.dynamicRange > 200);
  assert.ok(m.edges.mean > 0.001, "la frontière noir/blanc crée un contour net");
  assert.ok(m.grid.leftRightBalance < 0.2, "une image symétrique doit avoir un poids équilibré");
});

test("dégradé : plage dynamique large mais peu de contours", () => {
  const m = metricsFor("gradient");
  assert.ok(m.luminance.dynamicRange > 180);
  assert.ok(m.edges.mean < 0.05);
});

test("bruit : image très chargée, zones de texte dégradées", () => {
  const noise = metricsFor("noise");
  const flat = metricsFor("flat");
  assert.ok(noise.edges.mean > flat.edges.mean * 10, "le bruit doit saturer l'énergie de contour");
  assert.ok(noise.zones[0].busy > 0.05, `zone la plus calme encore bruitée : ${noise.zones[0].busy}`);
  assert.ok(noise.composition.negativeSpace < 0.35, "peu de zones planes dans le bruit");
});

test("sujet + fond sombre : une zone de texte exploitable est trouvée", () => {
  const m = metricsFor("subject");
  assert.ok(m.zones.length === TEXT_ZONES.length);
  const sorted = m.zones.map((z) => z.score);
  assert.deepEqual(sorted, [...sorted].sort((a, b) => b - a), "les zones doivent être triées par pertinence");
  assert.ok(m.zones[0].score > 0.35, `meilleure zone trop faible : ${m.zones[0].score}`);
  assert.ok(m.zones[0].bestContrast > 4.5, `contraste insuffisant : ${m.zones[0].bestContrast}`);
  assert.ok(["#ffffff", "#0b0614"].includes(m.zones[0].bestColor));
  assert.ok(m.color.saturationMean > 0.2, "image saturée attendue");
});

test("chaque zone renvoie ses mesures de lisibilité", () => {
  const m = metricsFor("subject");
  for (const zone of m.zones) {
    assert.ok(zone.contrastWhite >= 1 && zone.contrastBlack >= 1);
    assert.ok(Number.isFinite(zone.busy) && zone.busy >= 0);
    assert.ok(zone.uniformity >= 0 && zone.uniformity <= 1);
    assert.ok(zone.score >= 0 && zone.score <= 1);
    assert.equal(zone.box.length, 4);
    assert.ok(zone.label.length > 0);
  }
});

test("grille des tiers : parts normalisées et équilibre mesuré", () => {
  const m = metricsFor("subject");
  assert.equal(m.grid.cells.length, 9);
  const total = m.grid.cells.reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-6, `somme des parts = ${total}`);
  assert.ok(m.grid.left >= 0 && m.grid.right >= 0);
  assert.ok(m.composition.thirdsProximity >= 0 && m.composition.thirdsProximity <= 1);
  assert.ok(m.composition.focus.x >= 0 && m.composition.focus.x <= 1);
});

test("image sombre : noirs bouchés signalés", () => {
  const m = metricsFor("dark");
  assert.ok(m.luminance.mean < 60, `luminance moyenne = ${m.luminance.mean}`);
  assert.ok(m.luminance.clippedDarkShare > 0.2, `noirs bouchés = ${m.luminance.clippedDarkShare}`);
  assert.ok(m.luminance.dynamicRange < 60, "plage dynamique réduite");
});

test("poids visuel asymétrique : le point d'attention est localisé", () => {
  const m = metricsFor("asym");
  assert.ok(m.grid.leftRightBalance > 0.15, `équilibre = ${m.grid.leftRightBalance}`);
  assert.ok(m.grid.right > m.grid.left, "le sujet est à droite");
  assert.ok(m.composition.focus.x > 0.52, `centroïde = ${m.composition.focus.x}`);
  assert.ok(m.color.saturationMean > 0.15);
});

test("couleur dominante identifiée", () => {
  const canvas = syntheticImage(ANALYSIS_WIDTH, ANALYSIS_HEIGHT, "split");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2563eb";
  ctx.fillRect(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const m = analyzePixels(imageDataOf(canvas));
  assert.equal(m.color.dominantHueLabel, "bleu");
  assert.ok(m.color.dominantHueShare > 0.9);
  assert.equal(m.color.hueDiversity, 1);
  assert.equal(m.color.warm, false);
});

test("metricsSummary renvoie des valeurs lisibles", () => {
  const summary = metricsSummary(metricsFor("subject"));
  assert.equal(typeof summary.contraste, "number");
  assert.ok(summary.meilleureZone.length > 0);
  assert.ok(summary.contrasteTexte >= 1);
  assert.ok(Object.keys(summary).length >= 7);
});

/* --------------------------------------------------------------- rapport */

test("levelFor : seuils cohérents", () => {
  assert.equal(levelFor(95), "excellent");
  assert.equal(levelFor(70), "correct");
  assert.equal(levelFor(50), "perfectible");
  assert.equal(levelFor(10), "faible");
});

test("buildReport : structure complète et honnête", () => {
  const metrics = metricsFor("subject");
  const title = analyzeTitle("3 réglages pour une miniature YouTube lisible", { topic: "miniature youtube" });
  const report = buildReport({
    metrics,
    title,
    topic: "miniature youtube",
    file: { name: "test.png", size: 400_000, type: "image/png" },
    natural: { width: 1280, height: 720 },
  });

  assert.equal(report.source, "heuristiques locales");
  assert.ok(report.overall.score >= 0 && report.overall.score <= 100);
  assert.equal(report.overall.label, "Indice de lisibilité");
  assert.match(report.disclaimer, /taux de clic/i);
  assert.match(report.disclaimer, /local/i);
  assert.ok(!/prédit|prévision de CTR/i.test(report.overall.label));

  const ids = report.sections.map((s) => s.id);
  assert.deepEqual(ids, ["contraste", "lisibilite", "composition", "couleur", "technique", "titre"]);
  for (const section of report.sections) {
    assert.ok(section.score >= 0 && section.score <= 100, `${section.id} hors bornes`);
    assert.ok(section.detail && section.detail.length > 10, `${section.id} : détail manquant`);
    assert.ok(section.level && section.levelLabel);
    if (section.id !== "technique") assert.ok(section.weight > 0, `${section.id} : poids manquant`);
  }
  assert.ok(report.priorities.length > 0 && report.priorities.length <= 3);
  assert.equal(report.rules.length, RULES_DOC.length);
});

function reportLisibilite(kind) {
  return buildReport({ metrics: metricsFor(kind) }).sections.find((s) => s.id === "lisibilite");
}

test("buildReport sans titre : les poids sont renormalisés", () => {
  const metrics = metricsFor("gradient");
  const report = buildReport({ metrics });
  assert.equal(report.titleSection, null);
  assert.equal(report.sections.length, 5);
  const weighted = report.sections
    .filter((s) => s.id !== "technique")
    .reduce((sum, s) => sum + s.score * s.weight, 0);
  const totalWeight = report.sections
    .filter((s) => s.id !== "technique")
    .reduce((sum, s) => sum + s.weight, 0);
  assert.equal(Math.round(weighted / totalWeight), report.overall.score);
});

test("le rapport classe une image plate sous une image exploitable", () => {
  const flat = buildReport({ metrics: metricsFor("flat") });
  const subject = buildReport({ metrics: metricsFor("subject") });
  assert.ok(subject.overall.score > flat.overall.score + 10, `${subject.overall.score} vs ${flat.overall.score}`);
  assert.ok(reportLisibilite("midgray").score < reportLisibilite("dark").score - 20,
    "un fond gris moyen est bien moins lisible pour un texte blanc qu'un fond sombre");
});

test("conformité technique : ratio, résolution, poids", () => {
  const metrics = metricsFor("subject");
  const ok = buildReport({ metrics, file: { size: 500_000 }, natural: { width: 1920, height: 1080 } });
  assert.equal(ok.technical.score, 100);
  assert.deepEqual(ok.technical.checks.map((c) => c.ok), [true, true, true]);

  const bad = buildReport({ metrics, file: { size: 4_000_000 }, natural: { width: 640, height: 640 } });
  assert.ok(bad.technical.score < 100);
  assert.equal(bad.technical.checks.filter((c) => !c.ok).length, 3);
  assert.match(bad.technical.detail, /2 Mo|Mo/);
});

test("buildReport refuse une analyse sans mesures", () => {
  assert.throws(() => buildReport({}), /mesures d'image absentes/);
});

/* ----------------------------------------------------------------- titre */

test("tokenize normalise les accents et la casse", () => {
  assert.deepEqual(tokenize("Miniature YouTube, été !"), ["miniature", "youtube", "ete"]);
  assert.deepEqual(tokenize(""), []);
});

test("lisibilité : une phrase simple score mieux qu'une phrase complexe", () => {
  const simple = frenchReadability("Fais simple. Fais court.");
  const complexe = frenchReadability(
    "L'anticonstitutionnalité des réglementations audiovisuelles européennes complique considérablement l'optimisation.",
  );
  assert.ok(simple > complexe);
});

test("titre vide : score nul et erreur explicite", () => {
  const a = analyzeTitle("");
  assert.equal(a.score, 0);
  assert.equal(a.chars, 0);
  assert.ok(a.flags.some((f) => f.level === "error"));
});

test("titre trop long : dépassement de la limite YouTube signalé", () => {
  const long = "Comment faire ".repeat(9).trim();
  const a = analyzeTitle(long);
  assert.ok(a.chars > TITLE_HARD_LIMIT);
  assert.ok(a.flags.some((f) => f.level === "error" && /limite YouTube/.test(f.text)));
  assert.ok(a.subscores.lengthScore < 20);
});

test("troncature dans le fil : aperçu limité à 70 caractères", () => {
  const title = "Un titre raisonnable au début puis une suite beaucoup trop longue pour rester visible";
  const a = analyzeTitle(title);
  assert.equal(a.feedPreview.length, TITLE_VISIBLE_FEED);
  assert.equal(a.truncated, true);
  assert.ok(a.flags.some((f) => /tronqué/i.test(f.text)));
});

test("bon titre : chiffre, mot fort, longueur maîtrisée", () => {
  const a = analyzeTitle("3 erreurs de miniature YouTube (et comment les corriger)", {
    topic: "miniature youtube",
  });
  assert.equal(a.hasNumber, true);
  assert.ok(a.powerHits.includes("erreur") || a.powerHits.includes("erreurs"));
  assert.ok(a.powerHits.includes("comment"));
  assert.ok(a.chars <= TITLE_VISIBLE_FEED);
  assert.ok(a.subscores.lengthScore >= 80);
  assert.ok(a.topicOverlap > 0.4);
  assert.ok(a.score >= 60, `score = ${a.score}`);
  assert.equal(a.clickbaitHits.length, 0);
});

test("titre racoleur : détecté et pénalisé", () => {
  const a = analyzeTitle("INCROYABLE ! Vous ne croirez jamais cette astuce 100 % garantie 🔥🔥🔥");
  assert.ok(a.clickbaitHits.length >= 2);
  assert.ok(a.capsRatio > 0.15);
  assert.ok(a.emoji >= 3);
  assert.ok(a.subscores.trustScore < 30);
  assert.ok(a.flags.some((f) => /accrocheuse|crédibilité|agressif/i.test(f.text)));
});

test("sujet sans rapport : recouvrement faible signalé", () => {
  const a = analyzeTitle("Ma recette de pancakes moelleux", { topic: "miniature youtube clic" });
  assert.ok(a.topicOverlap < 0.2);
  assert.ok(a.flags.some((f) => /hors-sujet/.test(f.text)));
});

test("titleTips : toujours des conseils, jamais plus de cinq", () => {
  const cases = [
    analyzeTitle("Miniature", { topic: "miniature youtube" }),
    analyzeTitle("Comment doubler vos vues YouTube en 7 jours avec une meilleure miniature", { topic: "miniature youtube" }),
    analyzeTitle("INCROYABLE !!! 100 % GARANTI 🔥🔥🔥🔥", { topic: "youtube" }),
    analyzeTitle(""),
  ];
  for (const analysis of cases) {
    const tips = titleTips(analysis, { topic: analysis.title ? "miniature youtube" : "" });
    assert.ok(Array.isArray(tips) && tips.length >= 1 && tips.length <= 5);
    for (const tip of tips) assert.ok(tip.length > 15, `conseil trop vague : « ${tip} »`);
  }
});

test("les drapeaux de titre sont classés par gravité", () => {
  const a = analyzeTitle("x".repeat(140));
  assert.ok(a.flags.every((f) => ["error", "warn", "info"].includes(f.level)));
  assert.ok(a.flags.some((f) => f.level === "error"));
});

test("le rapport ne promet jamais de CTR", () => {
  const report = buildReport({
    metrics: metricsFor("subject"),
    title: analyzeTitle("3 erreurs de miniature", { topic: "miniature" }),
    topic: "miniature",
  });
  const text = JSON.stringify(report).toLowerCase();
  assert.ok(!/prédira|ctr garanti|taux de clic estimé|vues garanties/.test(text));
  assert.match(DISCLAIMER, /aucun/i);
  assert.match(report.disclaimer, /données de performance/i);
  assert.match(report.disclaimer, /prédire un CTR|prédiction de taux de clic/i);
});
