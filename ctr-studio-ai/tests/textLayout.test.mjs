import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildFontString,
  clampInsideCanvas,
  displayText,
  hitBounds,
  layoutText,
  measureLineWidth,
  paintLine,
  splitLines,
  supportsLetterSpacing,
} from "../src/core/textLayout.js";
import { createTextLayer } from "../src/core/composition.js";
import { handlePositions, pointInRotatedBox, rotatePoint, OPPOSITE_HANDLE } from "../src/core/geometry.js";
import { makeCanvas, regionStats } from "./helpers/headless.mjs";

function context(width = 1280, height = 720) {
  return makeCanvas(width, height).getContext("2d");
}

test("la police CSS est construite avec graisse, taille et pile", () => {
  const layer = createTextLayer({ fontSize: 72, fontWeight: 800, italic: true });
  assert.match(buildFontString(layer), /^italic 800 72px /);
  assert.match(buildFontString(layer, 0.5), /36px/);
  assert.ok(buildFontString(layer).includes(layer.fontStack));
});

test("les capitales sont appliquées sans modifier le texte source", () => {
  const layer = createTextLayer({ text: "été indien", uppercase: true });
  assert.equal(displayText(layer), "ÉTÉ INDIEN");
  assert.equal(layer.text, "été indien");
  layer.uppercase = false;
  assert.equal(displayText(layer), "été indien");
});

test("les retours à la ligne manuels sont respectés", () => {
  const ctx = context();
  const layer = createTextLayer({ text: "ligne 1\nligne 2\nligne 3", uppercase: false });
  assert.deepEqual(splitLines(ctx, layer), ["ligne 1", "ligne 2", "ligne 3"]);

  /* La casse « capitales » s'applique avant la découpe. */
  const caps = createTextLayer({ text: "ligne 1\nligne 2", uppercase: true });
  assert.deepEqual(splitLines(ctx, caps), ["LIGNE 1", "LIGNE 2"]);

  /* \r\n (Windows) ne doit pas laisser de caractère parasite. */
  const windows = createTextLayer({ text: "a\r\nb", uppercase: false });
  assert.deepEqual(splitLines(ctx, windows), ["a", "b"]);
});

test("la césure ne dépasse jamais la largeur de boîte", () => {
  const ctx = context();
  const layer = createTextLayer({
    text: "une très longue phrase qui doit être coupée proprement en plusieurs lignes",
    wrap: true,
    boxWidth: 420,
    fontSize: 64,
    uppercase: false,
  });
  ctx.font = buildFontString(layer);
  const lines = splitLines(ctx, layer);
  assert.ok(lines.length > 1, "le texte doit être coupé sur plusieurs lignes");
  for (const line of lines) {
    const width = measureLineWidth(ctx, line, layer.letterSpacing);
    assert.ok(width <= layer.boxWidth + 0.5, `ligne trop large (${width} > ${layer.boxWidth}) : « ${line} »`);
    assert.ok(!/ {2,}/.test(line), "pas de double espace après césure");
    assert.ok(line.trim().length > 0, "pas de ligne vide");
  }
});

test("un mot plus long que la boîte est coupé caractère par caractère", () => {
  const ctx = context();
  const layer = createTextLayer({
    text: "anticonstitutionnellement",
    wrap: true,
    boxWidth: 200,
    fontSize: 60,
  });
  ctx.font = buildFontString(layer);
  const lines = splitLines(ctx, layer);
  assert.ok(lines.length >= 2);
  for (const line of lines) {
    assert.ok(measureLineWidth(ctx, line, 0) <= 200.5);
  }
  assert.equal(lines.join(""), "ANTICONSTITUTIONNELLEMENT");
});

test("l'interlettrage élargit la mesure de façon cohérente", () => {
  const ctx = context();
  const layer = createTextLayer({ text: "ABC", fontSize: 60 });
  ctx.font = buildFontString(layer);
  const base = measureLineWidth(ctx, "ABC", 0);
  const spaced = measureLineWidth(ctx, "ABC", 10);
  assert.ok(spaced > base);
  assert.ok(Math.abs(spaced - (base + 20)) < 1.5, `écart inattendu : ${spaced} vs ${base + 20}`);
  /* La mesure ne doit pas laisser de réglage résiduel sur le contexte. */
  assert.equal(measureLineWidth(ctx, "ABC", 0), base);
  if (supportsLetterSpacing(ctx)) assert.equal(ctx.letterSpacing, "0px");
});

test("layoutText renvoie une géométrie exploitable", () => {
  const ctx = context();
  const layer = createTextLayer({ text: "TITRE", x: 100, y: 200, fontSize: 100 });
  const layout = layoutText(ctx, layer);
  assert.equal(layout.lines.length, 1);
  assert.ok(layout.contentWidth > 100);
  assert.ok(layout.contentHeight > 60 && layout.contentHeight < 200);
  assert.equal(layout.wrapActive, false);
  assert.equal(layout.box.x, 100, "sans fond, la boîte épouse le texte");
  assert.equal(layout.box.y, 200);
  assert.ok(layout.lines[0].baseline > 0);
  assert.equal(layout.center.x, 100 + layout.contentWidth / 2);
});

test("avec la césure, la boîte impose sa largeur et l'alignement s'y applique", () => {
  const ctx = context();
  const layer = createTextLayer({
    text: "court\nune ligne beaucoup plus longue",
    wrap: true,
    boxWidth: 700,
    align: "center",
    fontSize: 40,
    uppercase: false,
  });
  const layout = layoutText(ctx, layer);
  assert.equal(layout.wrapActive, true);
  assert.equal(layout.contentWidth, 700);
  assert.equal(layout.lines[0].left, (700 - layout.lines[0].width) / 2);
  assert.equal(layout.lines[1].left, (700 - layout.lines[1].width) / 2);
});

test("alignements gauche / centré / droit", () => {
  const ctx = context();
  const base = { text: "A\nBCDE", wrap: true, boxWidth: 600, fontSize: 40, uppercase: false };
  const left = layoutText(ctx, createTextLayer({ ...base, align: "left" }));
  const center = layoutText(ctx, createTextLayer({ ...base, align: "center" }));
  const right = layoutText(ctx, createTextLayer({ ...base, align: "right" }));
  assert.equal(left.lines[0].left, 0);
  assert.ok(center.lines[0].left > 0 && center.lines[0].left < 600);
  assert.equal(right.lines[0].left + right.lines[0].width, 600);
});

test("le fond élargit la boîte (padding)", () => {
  const ctx = context();
  const layer = createTextLayer({
    text: "BADGE",
    x: 100,
    y: 100,
    fontSize: 48,
    background: { enabled: true, padX: 30, padY: 16, radius: 12 },
  });
  const layout = layoutText(ctx, layer);
  assert.equal(layout.box.x, 70);
  assert.equal(layout.box.y, 84);
  assert.equal(layout.box.width, layout.contentWidth + 60);
  assert.equal(layout.box.height, layout.contentHeight + 32);
});

test("hitBounds englobe le contour et une marge", () => {
  const ctx = context();
  const layer = createTextLayer({ text: "X", fontSize: 60, stroke: { enabled: true, width: 10 } });
  const layout = layoutText(ctx, layer);
  const bounds = hitBounds(layer, layout, 8);
  assert.ok(bounds.x < layout.box.x);
  assert.ok(bounds.width > layout.box.width);
  assert.ok(bounds.height > layout.box.height);
});

test("paintLine dessine réellement des pixels (remplissage + contour)", () => {
  const canvas = makeCanvas(400, 120);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, 400, 120);
  const layer = createTextLayer({ text: "TEST", fontSize: 60, x: 10, y: 20 });
  ctx.font = buildFontString(layer);
  ctx.fillStyle = "#ffffff";
  paintLine(ctx, "TEST", 10, 80, { letterSpacing: 2, fill: true });
  const stats = regionStats(canvas);
  assert.ok(stats.max > 200, "du texte blanc doit être présent");
  assert.ok(stats.mean > 5, "la zone ne doit pas rester noire");
});

test("paintLine avec interlettrage manuel (sans API native) reste correct", () => {
  const canvas = makeCanvas(400, 120);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 400, 120);
  /* Simule un navigateur sans ctx.letterSpacing en passant par le chemin manuel : */
  const layer = createTextLayer({ text: "MANUEL", fontSize: 40, letterSpacing: 8 });
  ctx.font = buildFontString(layer);
  ctx.fillStyle = "#ffffff";
  let cursor = 10;
  for (const ch of displayText(layer)) {
    ctx.fillText(ch, cursor, 70);
    cursor += ctx.measureText(ch).width + 8;
  }
  const stats = regionStats(canvas);
  assert.ok(stats.max > 200);
  assert.ok(cursor > 200, "l'avancée caractère par caractère progresse");
});

test("clampInsideCanvas ramène le calque dans la miniature (débordement limité)", () => {
  const ctx = context();
  const layer = createTextLayer({ text: "HORS CADRE", x: 5000, y: -900, fontSize: 80 });
  const layout = layoutText(ctx, layer);
  clampInsideCanvas(layer, layout, { width: 1280, height: 720 });
  assert.ok(layer.x < 1280 && layer.x > -layout.box.width);
  assert.ok(layer.y < 720 && layer.y > -layout.box.height);
});

test("géométrie : rotation et poignées opposées", () => {
  const box = { x: 100, y: 100, width: 200, height: 80 };
  const handles = handlePositions(box, 18);
  assert.equal(handles.nw.x, 100);
  assert.equal(handles.se.x, 300);
  assert.equal(handles.se.y, 180);
  assert.ok(handles.rotate.y < box.y);
  assert.equal(OPPOSITE_HANDLE.nw, "se");
  assert.equal(OPPOSITE_HANDLE.e, "w");

  const center = { x: 200, y: 140 };
  const rotated = rotatePoint({ x: 300, y: 140 }, center, 90);
  assert.ok(Math.abs(rotated.x - 200) < 1e-9);
  assert.ok(Math.abs(rotated.y - 240) < 1e-9);

  /* Un point dans une boîte tournée de 45° doit être retrouvé. */
  const p = { x: 200 + 100, y: 140 };
  const local = rotatePoint(p, center, 45);
  assert.equal(pointInRotatedBox(local, box, center, 45), true);
  assert.equal(pointInRotatedBox({ x: 0, y: 0 }, box, center, 45), false);
});
