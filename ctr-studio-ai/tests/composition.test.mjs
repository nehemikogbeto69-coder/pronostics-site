import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addTextLayer,
  createComposition,
  createTextLayer,
  deserializeProject,
  duplicateLayer,
  findLayer,
  removeLayer,
  reorderLayer,
  sanitizeComposition,
  sanitizeLayer,
  serializeProject,
  updateLayer,
} from "../src/core/composition.js";
import { THUMB_HEIGHT, THUMB_WIDTH } from "../src/core/constants.js";
import { fontStackById } from "../src/core/fonts.js";
import { applyTemplate, TEMPLATES, templateIds } from "../src/core/templates.js";

test("une composition par défaut est valide et au format YouTube", () => {
  const comp = createComposition();
  assert.equal(comp.canvas.width, THUMB_WIDTH);
  assert.equal(comp.canvas.height, THUMB_HEIGHT);
  assert.equal(comp.canvas.width / comp.canvas.height, 16 / 9);
  assert.equal(comp.layers.length, 1);
  assert.equal(comp.layers[0].type, "text");
  assert.ok(comp.layers[0].id);
});

test("les calques sont bornés (valeurs hors limites neutralisées)", () => {
  const layer = sanitizeLayer({
    text: "x".repeat(1000),
    fontSize: 99999,
    letterSpacing: -5000,
    lineHeight: 99,
    rotation: 725,
    opacity: 42,
    stroke: { width: -20 },
    shadow: { blur: 1e6 },
    background: { padX: -50, radius: 1e5, opacity: 3 },
  });
  assert.equal(layer.fontSize, 400);
  assert.equal(layer.letterSpacing, -20);
  assert.equal(layer.lineHeight, 3);
  assert.equal(layer.rotation, 5);
  assert.equal(layer.opacity, 1);
  assert.equal(layer.stroke.width, 0);
  assert.equal(layer.shadow.blur, 120);
  assert.equal(layer.background.padX, 0);
  assert.equal(layer.background.radius, 300);
  assert.equal(layer.background.opacity, 1);
  assert.equal(layer.text.length, 400);
});

test("valeurs manquantes : les replis par défaut s'appliquent", () => {
  const layer = sanitizeLayer({});
  assert.equal(layer.type, "text");
  assert.equal(layer.align, "left");
  assert.equal(layer.fill.type, "solid");
  assert.equal(layer.fontStack, fontStackById(layer.fontFamily));
  assert.ok(Number.isFinite(layer.fontSize));
  assert.ok(layer.fontSize > 0);
});

test("les valeurs non numériques sont remplacées, jamais propagées", () => {
  const layer = sanitizeLayer({
    fontSize: "abc",
    x: null,
    y: undefined,
    rotation: {},
    align: "diagonal",
    fontWeight: 1234,
    wrap: "yes",
  });
  assert.equal(typeof layer.fontSize, "number");
  assert.equal(layer.x, 0);
  assert.equal(layer.y, 0);
  assert.equal(layer.rotation, 0);
  assert.equal(layer.align, "left");
  assert.ok([100, 200, 300, 400, 500, 600, 700, 800, 900].includes(layer.fontWeight));
  assert.equal(layer.wrap, true);
  assert.ok(layer.boxWidth >= 120, "la césure impose une largeur de boîte utile");
});

test("sans césure, la largeur de boîte est remise à zéro", () => {
  const layer = sanitizeLayer({ wrap: false, boxWidth: 640 });
  assert.equal(layer.wrap, false);
  assert.equal(layer.boxWidth, 0);
});

test("CRUD des calques", () => {
  const comp = createComposition();
  const first = comp.layers[0];
  const second = addTextLayer(comp, { text: "Deuxième" });
  assert.equal(comp.layers.length, 2);
  assert.equal(findLayer(comp, second.id).text, "Deuxième");

  const copy = duplicateLayer(comp, first.id);
  assert.equal(comp.layers.length, 3);
  assert.notEqual(copy.id, first.id);
  assert.equal(comp.layers.indexOf(copy), comp.layers.indexOf(first) + 1);
  assert.equal(copy.text, first.text);

  assert.equal(removeLayer(comp, copy.id), true);
  assert.equal(removeLayer(comp, "inexistant"), false);
  assert.equal(comp.layers.length, 2);
});

test("réordonnancement : monter, descendre, premier, dernier", () => {
  const comp = createComposition();
  const a = comp.layers[0];
  const b = addTextLayer(comp, { text: "B" });
  const c = addTextLayer(comp, { text: "C" });

  /* Ordre du tableau = ordre de peinture : le dernier élément est au premier plan. */
  assert.deepEqual(comp.layers.map((l) => l.id), [a.id, b.id, c.id]);

  reorderLayer(comp, a.id, "top");
  assert.deepEqual(comp.layers.map((l) => l.id), [b.id, c.id, a.id], "« top » = premier plan");

  reorderLayer(comp, c.id, "bottom");
  assert.deepEqual(comp.layers.map((l) => l.id), [c.id, b.id, a.id], "« bottom » = arrière-plan");

  reorderLayer(comp, b.id, "down");
  assert.deepEqual(comp.layers.map((l) => l.id), [b.id, c.id, a.id], "« down » recule d'un cran");

  reorderLayer(comp, c.id, "up");
  assert.deepEqual(comp.layers.map((l) => l.id), [b.id, a.id, c.id], "« up » avance d'un cran");

  /* Cas limites : rien ne casse en bout de pile. */
  reorderLayer(comp, c.id, "up");
  assert.deepEqual(comp.layers.map((l) => l.id), [b.id, a.id, c.id]);
  reorderLayer(comp, b.id, "down");
  assert.deepEqual(comp.layers.map((l) => l.id), [b.id, a.id, c.id]);
  assert.equal(reorderLayer(comp, "inexistant", "up"), false);
});

test("le nombre de calques reste borné (12 maximum)", () => {
  const comp = createComposition();
  for (let i = 0; i < 20; i += 1) addTextLayer(comp, { text: `T${i}` });
  assert.equal(comp.layers.length, 12);
});

test("updateLayer applique un patch profond et met à jour la police", () => {
  const comp = createComposition();
  const layer = comp.layers[0];
  const updated = updateLayer(comp, layer.id, {
    shadow: { blur: 40 },
    fill: { color: "#fde047" },
    fontFamily: "georgia",
  });
  assert.equal(updated.shadow.blur, 40);
  assert.equal(updated.shadow.enabled, true, "les autres champs de shadow sont conservés");
  assert.equal(updated.fill.color, "#fde047");
  assert.equal(updated.fontFamily, "georgia");
  assert.equal(updated.fontStack, fontStackById("georgia"));
  assert.equal(updateLayer(comp, "inconnu", {}), null);
});

test("sérialisation : aller-retour identique", () => {
  const comp = createComposition();
  addTextLayer(comp, { text: "Second calque", fontSize: 54 });
  comp.image.fit = "contain";
  comp.meta.title = "Ma vidéo";
  const json = JSON.stringify(serializeProject(comp));
  const restored = deserializeProject(json);
  assert.equal(restored.layers.length, 2);
  assert.equal(restored.layers[1].text, "Second calque");
  assert.equal(restored.image.fit, "contain");
  assert.equal(restored.meta.title, "Ma vidéo");
  assert.equal(restored.canvas.width, THUMB_WIDTH);
});

test("désérialisation : entrées invalides rejetées avec message clair", () => {
  assert.throws(() => deserializeProject("{ pas du json"), /JSON/);
  assert.throws(() => deserializeProject(null), /invalide/);
  assert.throws(() => deserializeProject({ app: "autre-app", layers: [] }), /CTR Studio/);
  assert.throws(() => deserializeProject({ app: "ctr-studio-ai" }), /calque/);
});

test("un projet corrompu est renormalisé sans exception", () => {
  const comp = sanitizeComposition({
    canvas: { width: 10, height: 10 },
    background: { type: "inconnu", angle: "beaucoup" },
    image: { fit: "zzz", zoom: -5, vignette: 12, scrim: null },
    layers: [{ fontSize: -30 }, null, "pas un objet"],
    fonts: [{ family: "MaPolice", stack: "" }],
    meta: { title: 42 },
  });
  assert.equal(comp.canvas.width, THUMB_WIDTH);
  assert.equal(comp.background.type, "gradient");
  assert.equal(Number.isFinite(comp.background.angle), true);
  assert.equal(comp.image.fit, "cover");
  assert.equal(comp.image.zoom, 0.2);
  assert.equal(comp.image.vignette, 1);
  assert.equal(comp.image.scrim.enabled, false);
  assert.equal(comp.layers.length, 1);
  assert.equal(comp.layers[0].fontSize >= 8, true);
  assert.equal(comp.fonts[0].stack.includes("MaPolice"), true);
  assert.equal(typeof comp.meta.title, "string");
});

test("les trois modèles produisent des compositions valides", () => {
  assert.deepEqual(templateIds(), ["energie", "focus", "editorial"]);
  for (const template of TEMPLATES) {
    const comp = sanitizeComposition(createComposition());
    applyTemplate(comp, template.id);
    assert.ok(comp.layers.length >= 2, `${template.name} : trop peu de calques`);
    for (const layer of comp.layers) {
      assert.ok(layer.text.trim().length > 0, `${template.name} : calque vide`);
      assert.ok(layer.fontSize >= 8 && layer.fontSize <= 400);
      assert.ok(Number.isFinite(layer.x) && Number.isFinite(layer.y));
    }
    assert.ok(["gradient", "solid"].includes(comp.background.type));
  }
});

test("appliquer un modèle conserve la photo importée", () => {
  const comp = createComposition();
  comp.image.dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  comp.image.name = "ma-photo.png";
  comp.image.naturalWidth = 1920;
  comp.image.naturalHeight = 1080;
  comp.image.zoom = 1.4;
  comp.image.offsetX = 30;

  applyTemplate(comp, "focus");
  assert.equal(comp.image.dataUrl, "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(comp.image.name, "ma-photo.png");
  assert.equal(comp.image.naturalWidth, 1920);
  assert.equal(comp.image.zoom, 1.4);
  assert.equal(comp.image.offsetX, 30);
  assert.equal(comp.image.scrim.enabled, true, "le traitement du modèle est appliqué");
});

test("un modèle inconnu laisse la composition intacte", () => {
  const comp = createComposition();
  const before = JSON.stringify(comp);
  applyTemplate(comp, "inexistant");
  assert.equal(JSON.stringify(comp), before);
});

test("createTextLayer respecte les valeurs fournies", () => {
  const layer = createTextLayer({ text: "Bonjour", x: 10, y: 20, fontSize: 40, uppercase: false });
  assert.equal(layer.text, "Bonjour");
  assert.equal(layer.x, 10);
  assert.equal(layer.y, 20);
  assert.equal(layer.fontSize, 40);
  assert.equal(layer.uppercase, false);
  assert.equal(layer.visible, true);
});
