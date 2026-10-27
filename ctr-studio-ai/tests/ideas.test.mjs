/**
 * Tests du générateur d'idées : déterminisme, bornes, honnêteté de l'étiquetage
 * (« généré localement / simulé ») et qualité minimale des titres produits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AVAILABLE_ANGLES,
  AVAILABLE_TONES,
  SIMULATION_NOTICE,
  averageTitleScore,
  generateIdeas,
} from "../src/features/ideas/generator.js";
import { IDEAS_COUNT, THUMB_HEIGHT, THUMB_WIDTH } from "../src/core/constants.js";
import { TITLE_HARD_LIMIT } from "../src/features/analysis/titleMetrics.js";
import { createComposition } from "../src/core/composition.js";
import { applyTemplate } from "../src/core/templates.js";
import { drawComposition } from "../src/core/renderer.js";
import { canvasFactory, fullStats, makeCanvas } from "./helpers/headless.mjs";

const SUJET = "la miniature YouTube";

test("cinq idées par défaut, toutes complètes", () => {
  const result = generateIdeas({ topic: SUJET, seed: 1 });
  assert.equal(result.ideas.length, IDEAS_COUNT);
  for (const idea of result.ideas) {
    assert.ok(idea.title && idea.title.length > 12, `titre trop court : « ${idea.title} »`);
    assert.ok(idea.title.length <= TITLE_HARD_LIMIT, `titre au-delà de 100 caractères : ${idea.title.length}`);
    assert.ok(idea.overlayText && idea.overlayText.length <= 24, `texte miniature trop long : « ${idea.overlayText} »`);
    assert.ok(idea.angleLabel.length > 0);
    assert.ok(AVAILABLE_ANGLES.some((a) => a.id === idea.angle));
    assert.ok(["energie", "focus", "editorial"].includes(idea.suggestedTemplate));
    assert.ok(idea.concept.visual.length > 20);
    assert.ok(idea.concept.layout.length > 20);
    assert.ok(idea.concept.expression.length > 8);
    assert.equal(idea.concept.palette.colors.length, 4);
    for (const color of idea.concept.palette.colors) assert.match(color, /^#[0-9a-f]{6}$/i);
    assert.ok(idea.titleScore >= 0 && idea.titleScore <= 100);
    assert.ok(Array.isArray(idea.titleFlags));
    assert.ok(Array.isArray(idea.alternatives));
  }
  assert.equal(new Set(result.ideas.map((i) => i.id)).size, result.ideas.length, "identifiants uniques");
});

test("le sujet est repris dans les propositions", () => {
  const result = generateIdeas({ topic: "le référencement naturel", seed: 3 });
  const hits = result.ideas.filter((idea) =>
    idea.title.toLowerCase().includes("référencement naturel".toLowerCase()),
  );
  assert.ok(hits.length >= 3, `sujet trop peu présent : ${hits.length}/5`);
});

test("mêmes entrées + même graine = mêmes idées (déterminisme)", () => {
  const a = generateIdeas({ topic: SUJET, tone: "punchy", seed: 7 });
  const b = generateIdeas({ topic: SUJET, tone: "punchy", seed: 7 });
  assert.equal(JSON.stringify(a.ideas), JSON.stringify(b.ideas));
});

test("une autre graine produit d'autres idées", () => {
  const a = generateIdeas({ topic: SUJET, seed: 1 });
  const b = generateIdeas({ topic: SUJET, seed: 2 });
  assert.notEqual(JSON.stringify(a.ideas.map((i) => i.title)), JSON.stringify(b.ideas.map((i) => i.title)));
});

test("un autre sujet produit d'autres idées", () => {
  const a = generateIdeas({ topic: SUJET, seed: 1 });
  const b = generateIdeas({ topic: "la cuisine végétarienne", seed: 1 });
  assert.notEqual(a.ideas[0].title, b.ideas[0].title);
});

test("le ton filtre les angles", () => {
  const pedagogue = generateIdeas({ topic: SUJET, tone: "pedagogue", seed: 2 });
  const allowed = new Set(["methode", "debutant", "liste", "preuve", "comparaison", "erreur"]);
  for (const idea of pedagogue.ideas) {
    assert.ok(allowed.has(idea.angle), `angle hors ton : ${idea.angle}`);
  }
  const punchy = generateIdeas({ topic: SUJET, tone: "punchy", seed: 2 });
  const punchyAllowed = new Set(["erreur", "contrarien", "curiosite", "resultat", "urgence", "preuve"]);
  for (const idea of punchy.ideas) assert.ok(punchyAllowed.has(idea.angle));
  assert.ok(AVAILABLE_TONES.length >= 4);
});

test("les angles sont variés au sein d'une même série", () => {
  const result = generateIdeas({ topic: SUJET, seed: 11 });
  const distinct = new Set(result.ideas.map((i) => i.angle)).size;
  assert.ok(distinct >= 4, `seulement ${distinct} angles distincts sur 5`);
});

test("le nombre demandé est respecté et borné", () => {
  assert.equal(generateIdeas({ topic: SUJET, count: 3, seed: 1 }).ideas.length, 3);
  assert.equal(generateIdeas({ topic: SUJET, count: 8, seed: 1 }).ideas.length, 8);
  assert.equal(generateIdeas({ topic: SUJET, count: 99, seed: 1 }).ideas.length, 8);
  assert.equal(generateIdeas({ topic: SUJET, count: 0, seed: 1 }).ideas.length, IDEAS_COUNT);
});

test("sujet vide ou absent : erreur explicite en français", () => {
  assert.throws(() => generateIdeas({ topic: "" }), /sujet/i);
  assert.throws(() => generateIdeas({}), /sujet/i);
  assert.throws(() => generateIdeas({ topic: "   " }), /sujet/i);
});

test("l'audience est injectée dans le contexte", () => {
  const result = generateIdeas({ topic: SUJET, audience: "les débutants", seed: 5 });
  assert.equal(result.meta.audience, "les débutants");
});

test("étiquetage honnête : local, simulé, et notice visible", () => {
  const result = generateIdeas({ topic: SUJET, seed: 1 });
  assert.equal(result.meta.local, true);
  assert.equal(result.meta.simulated, true);
  assert.match(result.meta.notice, /localement/i);
  assert.match(result.meta.notice, /aucun modèle d'IA distant/i);
  assert.match(result.meta.notice, /aucune donnée YouTube/i);
  assert.equal(result.meta.notice, SIMULATION_NOTICE);
  assert.ok(result.meta.generatedAt);
  assert.equal(result.meta.count, result.ideas.length);
});

test("les chiffres non fournis sont marqués comme à remplacer", () => {
  const result = generateIdeas({ topic: SUJET, tone: "punchy", seed: 4 });
  const withPlaceholder = result.ideas.filter((i) => i.needsRealData);
  for (const idea of withPlaceholder) {
    assert.match(idea.title + idea.overlayText, /____/);
  }
  assert.match(SIMULATION_NOTICE, /à remplacer par vos propres valeurs/i);
});

test("averageTitleScore reste dans les bornes", () => {
  const result = generateIdeas({ topic: SUJET, seed: 1 });
  const avg = averageTitleScore(result);
  assert.ok(avg >= 0 && avg <= 100);
  assert.equal(averageTitleScore(null), 0);
  assert.equal(averageTitleScore({ ideas: [] }), 0);
});

test("les titres générés restent corrects selon nos propres heuristiques", () => {
  const result = generateIdeas({ topic: SUJET, seed: 9 });
  const bad = result.ideas.filter((i) => i.titleScore < 45);
  assert.equal(bad.length, 0, `titres faibles : ${bad.map((b) => `${b.title} (${b.titleScore})`).join(" | ")}`);
  assert.ok(averageTitleScore(result) >= 55);
});

test("une idée peut être envoyée vers l'éditeur et rendue", () => {
  const result = generateIdeas({ topic: SUJET, seed: 1 });
  const idea = result.ideas[0];
  const comp = createComposition();
  applyTemplate(comp, idea.suggestedTemplate);
  comp.layers[0].text = idea.overlayText;
  comp.layers[0].fontSize = idea.overlayText.length > 14 ? 96 : 150;
  comp.background = { ...comp.background, from: idea.concept.palette.colors[1], to: idea.concept.palette.colors[0] };

  const canvas = makeCanvas(THUMB_WIDTH, THUMB_HEIGHT);
  const report = drawComposition(canvas.getContext("2d"), comp, { createCanvas: canvasFactory });
  assert.equal(report.layers.length, comp.layers.length);
  const stats = fullStats(canvas);
  assert.ok(stats.max > 180, "le texte de l'idée doit être visible");
  assert.ok(stats.coloredShare > 0.02);
});

test("le nettoyage du sujet est robuste (ponctuation, espaces, longueur)", () => {
  const result = generateIdeas({ topic: "   la miniature   youtube !!!   ", seed: 1 });
  assert.equal(result.meta.topic, "la miniature youtube");
  const long = generateIdeas({ topic: "x".repeat(400), seed: 1 });
  assert.ok(long.meta.topic.length <= 70);
});
