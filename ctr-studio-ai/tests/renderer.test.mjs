/**
 * Tests du moteur de rendu : ce qui est dessiné à l'écran est exactement ce
 * qui sera exporté. On vérifie les pixels produits, pas seulement l'absence
 * d'exception.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  drawBackground,
  drawComposition,
  drawTextLayer,
  sourceSize,
  WARNING,
} from "../src/core/renderer.js";
import { createComposition, createTextLayer, updateLayer } from "../src/core/composition.js";
import { applyTemplate, TEMPLATES } from "../src/core/templates.js";
import {
  applyPixelFilters,
  buildFilterString,
  computeImagePlacement,
  hasPixelAdjustments,
} from "../src/core/effects.js";
import { layoutText } from "../src/core/textLayout.js";
import { toBytes, verifyPngBytes } from "../src/io/png.js";
import {
  canvasFactory,
  fullStats,
  makeCanvas,
  makeTestImage,
  pngBytes,
  regionStats,
} from "./helpers/headless.mjs";

/* Masque un API du contexte pour tester les chemins de repli. */
function withoutFilterSupport(ctx) {
  return new Proxy(ctx, {
    has(target, prop) {
      if (prop === "filter") return false;
      return Reflect.has(target, prop);
    },
    get(target, prop) {
      if (prop === "filter") return undefined;
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value) {
      if (prop === "filter") return true;
      return Reflect.set(target, prop, value);
    },
  });
}

function render(comp, options = {}) {
  const canvas = makeCanvas(1280, 720);
  const ctx = options.proxy ? withoutFilterSupport(canvas.getContext("2d")) : canvas.getContext("2d");
  const report = drawComposition(ctx, comp, { createCanvas: canvasFactory, ...options });
  return { canvas, ctx, report };
}

/* ------------------------------------------------------------------ socle */

test("le rendu par défaut produit une miniature non vide de 1280×720", async () => {
  const comp = createComposition();
  const { canvas, report } = render(comp);
  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 720);

  const bytes = toBytes(await pngBytes(canvas));
  const check = verifyPngBytes(bytes, { width: 1280, height: 720 });
  assert.equal(check.ok, true, check.errors.join(" / "));

  const stats = fullStats(canvas);
  assert.ok(stats.mean > 4, "la miniature ne doit pas être noire");
  assert.ok(stats.max > 200, "le texte par défaut doit être visible");
  assert.ok(report.warnings.includes(WARNING.NO_IMAGE), "aucune photo : avertissement attendu");
});

test("le rendu est déterministe (deux rendus identiques)", async () => {
  const comp = createComposition();
  applyTemplate(comp, "energie");
  const a = toBytes(await pngBytes(render(comp).canvas));
  const b = toBytes(await pngBytes(render(comp).canvas));
  assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
});

/* --------------------------------------------------------------- modèles */

test("les trois modèles rendent un PNG valide avec du texte lisible", async () => {
  for (const template of TEMPLATES) {
    const comp = createComposition();
    applyTemplate(comp, template.id);
    const { canvas } = render(comp);
    const bytes = toBytes(await pngBytes(canvas));
    const check = verifyPngBytes(bytes, { width: 1280, height: 720 });
    assert.equal(check.ok, true, `${template.name} : ${check.errors.join(" / ")}`);

    const stats = fullStats(canvas);
    assert.ok(stats.max > 190, `${template.name} : aucun pixel clair, le texte n'est pas dessiné`);
    assert.ok(stats.coloredShare > 0.02, `${template.name} : rendu monochrome inattendu`);
  }
});

test("chaque modèle dessine bien tous ses calques", () => {
  for (const template of TEMPLATES) {
    const comp = createComposition();
    applyTemplate(comp, template.id);
    const { report } = render(comp);
    assert.equal(report.layers.length, comp.layers.length, `${template.name} : calques non rendus`);
    for (const entry of report.layers) {
      assert.ok(entry.layout.contentWidth > 0, `${template.name} : largeur de texte nulle`);
      assert.ok(entry.layout.contentHeight > 0, `${template.name} : hauteur de texte nulle`);
    }
  }
});

/* ----------------------------------------------------------------- texte */

test("un calque masqué ou transparent ne produit aucun pixel de texte", () => {
  const build = () => {
    const comp = createComposition();
    comp.background = { type: "solid", color: "#000000", from: "#000", to: "#000", angle: 0 };
    comp.image.scrim.enabled = false;
    comp.image.vignette = 0;
    comp.layers = [
      createTextLayer({
        text: "VISIBLE",
        x: 200,
        y: 300,
        fontSize: 120,
        stroke: { enabled: false, width: 0 },
        shadow: { enabled: false, blur: 0, color: "rgba(0,0,0,0)", x: 0, y: 0 },
        fill: { type: "solid", color: "#ffffff", from: "#fff", to: "#fff", angle: 0 },
      }),
    ];
    return comp;
  };

  const shown = render(build());
  const zone = regionStats(shown.canvas, 190, 290, 620, 180);
  assert.ok(zone.max > 230, "le texte doit apparaître");

  const hidden = build();
  hidden.layers[0].visible = false;
  const zoneHidden = regionStats(render(hidden).canvas, 190, 290, 620, 180);
  assert.ok(zoneHidden.max < 20, "un calque invisible ne doit rien dessiner");

  const transparent = build();
  transparent.layers[0].opacity = 0;
  const zoneTransparent = regionStats(render(transparent).canvas, 190, 290, 620, 180);
  assert.ok(zoneTransparent.max < 20, "opacité 0 = aucun pixel");
});

test("le contour épaissit réellement les glyphes", () => {
  const build = (strokeWidth) => {
    const comp = createComposition();
    comp.background = { type: "solid", color: "#ffffff", from: "#fff", to: "#fff", angle: 0 };
    comp.image.scrim.enabled = false;
    comp.image.vignette = 0;
    comp.layers = [
      createTextLayer({
        text: "CONTOUR",
        x: 180,
        y: 280,
        fontSize: 120,
        fill: { type: "solid", color: "#ffffff", from: "#fff", to: "#fff", angle: 0 },
        stroke: { enabled: strokeWidth > 0, color: "#7c3aed", width: strokeWidth },
        shadow: { enabled: false, blur: 0, color: "rgba(0,0,0,0)", x: 0, y: 0 },
      }),
    ];
    return comp;
  };
  const thin = fullStats(render(build(2)).canvas);
  const thick = fullStats(render(build(18)).canvas);
  assert.ok(thick.coloredShare > thin.coloredShare, "un contour plus large couvre plus de pixels");
});

test("le fond (badge) est dessiné derrière le texte", () => {
  const comp = createComposition();
  comp.background = { type: "solid", color: "#000000", from: "#000", to: "#000", angle: 0 };
  comp.image.scrim.enabled = false;
  comp.image.vignette = 0;
  comp.layers = [
    createTextLayer({
      text: "BADGE",
      x: 400,
      y: 300,
      fontSize: 80,
      background: { enabled: true, type: "solid", color: "#7c3aed", padX: 30, padY: 20, radius: 20, opacity: 1 },
      fill: { type: "solid", color: "#ffffff", from: "#fff", to: "#fff", angle: 0 },
      stroke: { enabled: false, width: 0 },
      shadow: { enabled: false, blur: 0, color: "rgba(0,0,0,0)", x: 0, y: 0 },
    }),
  ];
  const { canvas } = render(comp);
  const ctx = canvas.getContext("2d");
  /* Un pixel dans le coin du badge (hors glyphes) doit être violet. */
  const pixel = ctx.getImageData(390, 295, 1, 1).data;
  assert.ok(pixel[0] > 80 && pixel[2] > 150 && pixel[1] < 120, `couleur inattendue : ${[...pixel]}`);
});

test("le dégradé de texte produit des couleurs variables", () => {
  const comp = createComposition();
  comp.background = { type: "solid", color: "#000000", from: "#000", to: "#000", angle: 0 };
  comp.image.scrim.enabled = false;
  comp.image.vignette = 0;
  comp.layers = [
    createTextLayer({
      text: "DÉGRADÉ",
      x: 160,
      y: 260,
      fontSize: 150,
      fill: { type: "gradient", from: "#ff0000", to: "#00ff00", angle: 90, color: "#fff" },
      stroke: { enabled: false, width: 0 },
      shadow: { enabled: false, blur: 0, color: "rgba(0,0,0,0)", x: 0, y: 0 },
    }),
  ];
  const { canvas } = render(comp);
  const layer = comp.layers[0];
  const layout = layoutText(canvas.getContext("2d"), layer);
  const stripY = Math.round(layout.box.y + layout.contentHeight * 0.3);
  const stripH = Math.round(layout.contentHeight * 0.4);

  const channels = (x0, w) => {
    const data = canvas.getContext("2d").getImageData(x0, stripY, w, stripH).data;
    let n = 0;
    let red = 0;
    let green = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (luma < 40) continue;
      n += 1;
      red += data[i];
      green += data[i + 1];
    }
    assert.ok(n > 20, `pas assez de pixels encrés dans la bande (${n})`);
    return { red: red / n, green: green / n };
  };

  const left = channels(Math.round(layout.box.x + 6), 34);
  const right = channels(Math.round(layout.box.x + layout.contentWidth - 40), 34);
  assert.ok(left.red > right.red + 25, `rouge attendu à gauche (${left.red} vs ${right.red})`);
  assert.ok(right.green > left.green + 25, `vert attendu à droite (${right.green} vs ${left.green})`);
});

test("la rotation modifie l'emprise des pixels", () => {
  const build = (rotation) => {
    const comp = createComposition();
    comp.background = { type: "solid", color: "#000000", from: "#000", to: "#000", angle: 0 };
    comp.image.scrim.enabled = false;
    comp.image.vignette = 0;
    comp.layers = [
      createTextLayer({
        text: "ROTATION",
        x: 240,
        y: 320,
        fontSize: 100,
        rotation,
        fill: { type: "solid", color: "#ffffff", from: "#fff", to: "#fff", angle: 0 },
        stroke: { enabled: false, width: 0 },
        shadow: { enabled: false, blur: 0, color: "rgba(0,0,0,0)", x: 0, y: 0 },
      }),
    ];
    return comp;
  };
  const straight = regionStats(render(build(0)).canvas, 200, 300, 900, 140);
  const tilted = regionStats(render(build(-18)).canvas, 200, 240, 900, 320);
  assert.ok(straight.max > 230);
  assert.ok(tilted.max > 230);
  /* Le texte tourné déborde verticalement de la bande étroite du texte droit. */
  const straightBand = regionStats(render(build(0)).canvas, 200, 240, 900, 60);
  const tiltedBand = regionStats(render(build(-18)).canvas, 200, 240, 900, 60);
  assert.ok(tiltedBand.max > straightBand.max, "la rotation doit faire monter une partie du texte");
});

test("l'ombre portée assombrit la zone sous le texte", () => {
  const build = (shadow) => {
    const comp = createComposition();
    comp.background = { type: "solid", color: "#ffffff", from: "#fff", to: "#fff", angle: 0 };
    comp.image.scrim.enabled = false;
    comp.image.vignette = 0;
    comp.layers = [
      createTextLayer({
        text: "OMBRE",
        x: 300,
        y: 300,
        fontSize: 120,
        fill: { type: "solid", color: "#ffffff", from: "#fff", to: "#fff", angle: 0 },
        stroke: { enabled: false, width: 0 },
        shadow,
      }),
    ];
    return comp;
  };
  const withShadow = regionStats(render(build({ enabled: true, color: "rgba(0,0,0,0.9)", blur: 30, x: 10, y: 24 })).canvas, 300, 300, 700, 260);
  const without = regionStats(render(build({ enabled: false, color: "rgba(0,0,0,0.9)", blur: 30, x: 10, y: 24 })).canvas, 300, 300, 700, 260);
  assert.ok(withShadow.mean < without.mean - 2, "l'ombre doit assombrir la zone");
});

/* ------------------------------------------------------------------ photo */

test("la photo importée est dessinée (mode cover : le fond disparaît)", () => {
  const image = makeTestImage(1600, 900, { base: "#1f6f43", accent: "#ff6b00" });
  const comp = createComposition();
  comp.background = { type: "solid", color: "#ff00ff", from: "#f0f", to: "#f0f", angle: 0 };
  comp.image.scrim.enabled = false;
  comp.image.vignette = 0;
  comp.layers = [];

  const { canvas } = render(comp, { image });
  const ctx = canvas.getContext("2d");
  const corner = ctx.getImageData(4, 4, 1, 1).data;
  assert.ok(corner[0] < 200 || corner[2] < 200, `le fond magenta ne doit plus être visible : ${[...corner]}`);
  const stats = fullStats(canvas);
  assert.ok(stats.coloredShare > 0.2, "l'image doit occuper la miniature");
});

test("le mode contain laisse voir le fond sur les côtés", () => {
  const image = makeTestImage(900, 900, { base: "#10408f" });
  const comp = createComposition();
  comp.background = { type: "solid", color: "#ff00ff", from: "#f0f", to: "#f0f", angle: 0 };
  comp.image.fit = "contain";
  comp.image.scrim.enabled = false;
  comp.image.vignette = 0;
  comp.layers = [];

  const { canvas } = render(comp, { image });
  const ctx = canvas.getContext("2d");
  const corner = ctx.getImageData(4, 4, 1, 1).data;
  assert.ok(corner[0] > 200 && corner[2] > 200, "le fond doit rester visible en contain");
});

test("computeImagePlacement : cover, contain, stretch, zoom et décalage", () => {
  const canvas = { width: 1280, height: 720 };
  const src = { width: 1920, height: 1080 };

  const cover = computeImagePlacement({ fit: "cover", zoom: 1, offsetX: 0, offsetY: 0 }, src, canvas);
  assert.equal(cover.dWidth, 1280);
  assert.equal(cover.dHeight, 720, "une source 16:9 remplit exactement la miniature");

  /* Source plus carrée : cover doit déborder pour remplir. */
  const tall = computeImagePlacement({ fit: "cover", zoom: 1, offsetX: 0, offsetY: 0 }, { width: 1920, height: 1440 }, canvas);
  assert.equal(tall.dWidth, 1280);
  assert.ok(tall.dHeight > 720, "cover déborde en hauteur sur une source 4:3");
  const wide = computeImagePlacement({ fit: "cover", zoom: 1, offsetX: 0, offsetY: 0 }, { width: 2400, height: 800 }, canvas);
  assert.ok(wide.dWidth > 1280, "cover déborde en largeur sur une source panoramique");
  assert.equal(wide.dHeight, 720);

  const contain = computeImagePlacement({ fit: "contain", zoom: 1, offsetX: 0, offsetY: 0 }, src, canvas);
  assert.equal(contain.dHeight, 720);
  assert.ok(contain.dWidth <= 1280 + 0.01);

  const stretch = computeImagePlacement({ fit: "stretch", zoom: 1, offsetX: 0, offsetY: 0 }, { width: 800, height: 800 }, canvas);
  assert.equal(stretch.dWidth, 1280);
  assert.equal(stretch.dHeight, 720);

  const zoomed = computeImagePlacement({ fit: "cover", zoom: 2, offsetX: 0, offsetY: 0 }, src, canvas);
  assert.ok(Math.abs(zoomed.dWidth - cover.dWidth * 2) < 0.01);

  const moved = computeImagePlacement({ fit: "cover", zoom: 1, offsetX: 50, offsetY: -20 }, src, canvas);
  assert.equal(moved.dx, cover.dx + 50);
  assert.equal(moved.dy, cover.dy - 20);
});

test("sourceSize accepte Image, ImageBitmap et canvas", () => {
  assert.deepEqual(sourceSize(null), { width: 0, height: 0 });
  assert.deepEqual(sourceSize({ naturalWidth: 800, naturalHeight: 600 }), { width: 800, height: 600 });
  assert.deepEqual(sourceSize({ width: 320, height: 180 }), { width: 320, height: 180 });
  assert.deepEqual(sourceSize(makeTestImage(64, 48)), { width: 64, height: 48 });
});

/* --------------------------------------------------------------- réglages */

test("buildFilterString reflète les réglages", () => {
  assert.equal(buildFilterString({ brightness: 100, contrast: 100, saturate: 100, blur: 0 }), "none");
  const filter = buildFilterString({ brightness: 120, contrast: 90, saturate: 140, blur: 3 });
  assert.match(filter, /brightness\(1\.2\)/);
  assert.match(filter, /contrast\(0\.9\)/);
  assert.match(filter, /saturate\(1\.4\)/);
  assert.match(filter, /blur\(3px\)/);
  assert.equal(hasPixelAdjustments({ brightness: 100, contrast: 100, saturate: 100, blur: 0 }), false);
  assert.equal(hasPixelAdjustments({ brightness: 101, contrast: 100, saturate: 100, blur: 0 }), true);
});

test("les réglages de luminosité changent réellement les pixels", () => {
  const image = makeTestImage(1280, 720, { base: "#404040", accent: false });
  const build = (brightness) => {
    const comp = createComposition();
    comp.layers = [];
    comp.image.vignette = 0;
    comp.image.scrim.enabled = false;
    comp.image.brightness = brightness;
    return comp;
  };
  const normal = fullStats(render(build(100), { image }).canvas);
  const bright = fullStats(render(build(200), { image }).canvas);
  const dark = fullStats(render(build(40), { image }).canvas);
  assert.ok(bright.mean > normal.mean + 20, `200 % devrait éclaircir (${bright.mean} vs ${normal.mean})`);
  assert.ok(dark.mean < normal.mean - 20, `40 % devrait assombrir (${dark.mean} vs ${normal.mean})`);
});

test("le repli pixel par pixel fonctionne quand ctx.filter est absent", () => {
  const image = makeTestImage(1280, 720, { base: "#404040", accent: false });
  const build = (brightness) => {
    const comp = createComposition();
    comp.layers = [];
    comp.image.vignette = 0;
    comp.image.scrim.enabled = false;
    comp.image.brightness = brightness;
    return comp;
  };

  const base = render(build(100), { image, proxy: true });
  const bright = render(build(200), { image, proxy: true });
  assert.ok(bright.report.warnings.includes(WARNING.FILTER_FALLBACK), "le repli doit être signalé");
  const baseStats = fullStats(base.canvas);
  const brightStats = fullStats(bright.canvas);
  assert.ok(brightStats.mean > baseStats.mean + 20, "le repli doit éclaircir l'image");

  /* Et le flou non géré dans ce chemin doit être annoncé honnêtement. */
  const blurred = build(100);
  blurred.image.blur = 6;
  const result = render(blurred, { image, proxy: true });
  assert.ok(result.report.warnings.includes(WARNING.BLUR_UNSUPPORTED));
});

test("applyPixelFilters : luminosité, contraste, saturation", () => {
  const make = (r, g, b) => ({ data: new Uint8ClampedArray([r, g, b, 255]), width: 1, height: 1 });

  const brighter = applyPixelFilters(make(100, 100, 100), { brightness: 200 });
  assert.equal(brighter.data[0], 200);

  const darker = applyPixelFilters(make(100, 100, 100), { brightness: 50 });
  assert.equal(darker.data[0], 50);

  const gray = applyPixelFilters(make(200, 80, 40), { saturate: 0 });
  assert.ok(Math.abs(gray.data[0] - gray.data[1]) <= 1 && Math.abs(gray.data[1] - gray.data[2]) <= 1);

  const saturated = applyPixelFilters(make(200, 80, 40), { saturate: 200 });
  assert.ok(saturated.data[0] > 200 && saturated.data[1] < 80, "la saturation écarte les canaux");

  const contrasted = applyPixelFilters(make(160, 160, 160), { contrast: 200 });
  assert.ok(contrasted.data[0] > 160, "au-dessus du gris moyen, le contraste éclaircit");

  const untouched = applyPixelFilters(make(123, 45, 67), {});
  assert.deepEqual([...untouched.data], [123, 45, 67, 255]);
});

test("le vignettage assombrit les coins", () => {
  const image = makeTestImage(1280, 720, { base: "#808080", accent: false });
  const build = (vignette) => {
    const comp = createComposition();
    comp.layers = [];
    comp.image.vignette = vignette;
    comp.image.scrim.enabled = false;
    return comp;
  };
  const flat = regionStats(render(build(0), { image }).canvas, 0, 0, 120, 90);
  const vign = regionStats(render(build(0.9), { image }).canvas, 0, 0, 120, 90);
  assert.ok(vign.mean < flat.mean - 10, `coin assombri attendu (${vign.mean} vs ${flat.mean})`);
});

test("le voile dégradé (scrim) assombrit le bas de l'image", () => {
  const image = makeTestImage(1280, 720, { base: "#909090", accent: false });
  const build = (enabled) => {
    const comp = createComposition();
    comp.layers = [];
    comp.image.vignette = 0;
    comp.image.scrim = { enabled, from: "rgba(0,0,0,0)", to: "rgba(0,0,0,0.9)", angle: 180 };
    return comp;
  };
  const off = regionStats(render(build(false), { image }).canvas, 400, 620, 400, 80);
  const on = regionStats(render(build(true), { image }).canvas, 400, 620, 400, 80);
  assert.ok(on.mean < off.mean - 20, "le bas doit être assombri par le voile");
  const topOff = regionStats(render(build(false), { image }).canvas, 400, 20, 400, 80);
  const topOn = regionStats(render(build(true), { image }).canvas, 400, 20, 400, 80);
  assert.ok(Math.abs(topOn.mean - topOff.mean) < 12, "le haut doit rester quasi inchangé");
});

/* ------------------------------------------------- éléments d'interface */

test("guides et sélection ne sont jamais dans l'export", async () => {
  const comp = createComposition();
  applyTemplate(comp, "focus");
  const selectedId = comp.layers[0].id;

  const screen = render(comp, { editable: true, selectedId, guides: true });
  const exportRender = render(comp, { editable: false });

  const screenBytes = toBytes(await pngBytes(screen.canvas));
  const exportBytes = toBytes(await pngBytes(exportRender.canvas));
  assert.notEqual(Buffer.compare(Buffer.from(screenBytes), Buffer.from(exportBytes)), 0, "écran et export doivent différer");

  /* Aucune couleur de sélection (violet clair #c084fc) dans l'export. */
  const ctx = exportRender.canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, 1280, 720).data;
  let accentPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - 192) < 6 && Math.abs(data[i + 1] - 132) < 6 && Math.abs(data[i + 2] - 252) < 6) {
      accentPixels += 1;
    }
  }
  assert.equal(accentPixels, 0, "l'export ne doit contenir aucun pixel de sélection");
});

test("le placeholder s'affiche à l'écran sans photo, jamais à l'export", () => {
  const comp = createComposition();
  comp.layers = [];
  const screen = render(comp, { editable: true });
  const exportRender = render(comp, { editable: false });
  const screenStats = fullStats(screen.canvas);
  const exportStats = fullStats(exportRender.canvas);
  assert.ok(screenStats.mean > exportStats.mean, "le placeholder ajoute des pixels visibles");
  assert.equal(exportRender.report.warnings.includes(WARNING.NO_IMAGE), true);
});

test("drawTextLayer seul fonctionne sur un contexte vierge", () => {
  const canvas = makeCanvas(600, 200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 600, 200);
  const layer = createTextLayer({ text: "SEUL", x: 40, y: 60, fontSize: 90 });
  const layout = drawTextLayer(ctx, layer);
  assert.ok(layout && layout.contentWidth > 50);
  assert.ok(fullStats(canvas).max > 200);
  assert.equal(drawTextLayer(ctx, { ...layer, visible: false }), null);
});

test("drawBackground respecte le type de fond", () => {
  const canvas = makeCanvas(200, 100);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, { type: "solid", color: "#ff0000", from: "#000", to: "#000", angle: 0 }, { width: 200, height: 100 });
  let pixel = ctx.getImageData(10, 10, 1, 1).data;
  assert.ok(pixel[0] > 240 && pixel[1] < 20, `fond uni rouge attendu : ${[...pixel]}`);

  drawBackground(ctx, { type: "gradient", from: "#000000", to: "#ffffff", angle: 90, color: "#000" }, { width: 200, height: 100 });
  const left = ctx.getImageData(2, 50, 1, 1).data;
  const right = ctx.getImageData(197, 50, 1, 1).data;
  assert.ok(right[0] > left[0] + 100, "le dégradé doit aller du noir au blanc vers la droite");
});

test("updateLayer puis rendu : le changement est visible dans les pixels", () => {
  const comp = createComposition();
  applyTemplate(comp, "editorial");
  const before = fullStats(render(comp).canvas);
  const layer = comp.layers.find((l) => l.name === "Titre");
  updateLayer(comp, layer.id, { fontSize: 40, fill: { color: "#22d3ee" } });
  const after = fullStats(render(comp).canvas);
  assert.notEqual(Math.round(before.mean), Math.round(after.mean));
});
