/**
 * Tests d'export PNG — le point critique de l'application.
 *
 * On vérifie :
 *  - que le fichier produit est un vrai PNG de 1280×720 (octets + décodage) ;
 *  - qu'il contient bien la composition (photo, texte, réglages) ;
 *  - que tout échec d'encodage est signalé par une ExportError, jamais masqué.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ExportError,
  buildFilename,
  canvasToPngBytes,
  createCanvasElement,
  describeWarnings,
  exportPng,
} from "../src/io/exporter.js";
import { createComposition, createTextLayer } from "../src/core/composition.js";
import { applyTemplate, TEMPLATES } from "../src/core/templates.js";
import { drawComposition } from "../src/core/renderer.js";
import { parsePngIhdr, toBytes } from "../src/io/png.js";
import { YOUTUBE_MAX_BYTES } from "../src/core/constants.js";
import {
  canvasFactory,
  decodePng,
  fullStats,
  makeCanvas,
  makeTestImage,
  regionStats,
} from "./helpers/headless.mjs";

function exportOptions(image = null) {
  return { canvasFactory, decode: decodePng, image };
}

function solidComp(color) {
  const comp = createComposition();
  comp.background = { type: "solid", color, from: color, to: color, angle: 0 };
  comp.image.scrim.enabled = false;
  comp.image.vignette = 0;
  comp.layers = [];
  return comp;
}

test("export nominal : PNG valide, 1280×720, décodable", async () => {
  const comp = createComposition();
  applyTemplate(comp, "energie");
  const result = await exportPng(comp, exportOptions());

  assert.ok(result.bytes.length > 5000, `fichier suspect : ${result.bytes.length} octets`);
  const info = parsePngIhdr(result.bytes);
  assert.equal(info.width, 1280);
  assert.equal(info.height, 720);
  assert.equal(result.complete, true, "IEND présent");
  assert.equal(result.decoded.checked, true);
  assert.equal(result.decoded.ok, true);
  assert.equal(result.decoded.width, 1280);
  assert.equal(result.decoded.height, 720);
  assert.ok(result.blob, "un Blob doit être produit pour le téléchargement");
  assert.equal(result.blob.type, "image/png");
  assert.equal(result.blob.size, result.bytes.length);
  assert.equal(result.report.layers.length, comp.layers.length);
});

test("les trois modèles s'exportent correctement", async () => {
  for (const template of TEMPLATES) {
    const comp = createComposition();
    applyTemplate(comp, template.id);
    const result = await exportPng(comp, exportOptions());
    assert.equal(result.info.width, 1280, template.name);
    assert.equal(result.info.height, 720, template.name);
    assert.ok(result.bytes.length > 3000, `${template.name} : PNG vide`);
  }
});

test("l'export contient la photo importée et ses réglages", async () => {
  const photo = makeTestImage(1600, 900, { base: "#0f7b3d", accent: "#ff5a1f" });
  const comp = solidComp("#ff00ff");
  const result = await exportPng(comp, exportOptions(photo));

  const decoded = await decodePng(result.bytes);
  const canvas = makeCanvas(1280, 720);
  canvas.getContext("2d").drawImage(decoded, 0, 0);
  const stats = fullStats(canvas);

  assert.ok(stats.coloredShare > 0.3, "la photo doit occuper la miniature");
  const corner = regionStats(canvas, 0, 0, 20, 20);
  assert.ok(corner.mean < 200, "le fond magenta doit être recouvert par la photo");

  /* Les réglages appliqués changent réellement le fichier exporté. */
  const brighter = solidComp("#ff00ff");
  brighter.image.brightness = 190;
  const resultBright = await exportPng(brighter, exportOptions(photo));
  const decodedBright = await decodePng(resultBright.bytes);
  const canvasBright = makeCanvas(1280, 720);
  canvasBright.getContext("2d").drawImage(decodedBright, 0, 0);
  assert.ok(fullStats(canvasBright).mean > stats.mean + 15, "la luminosité doit se retrouver dans le PNG");
});

test("l'export est identique au rendu direct de la composition", async () => {
  const photo = makeTestImage(1280, 720, { base: "#253a75", accent: "#f2c14e", label: "CTRL" });
  const comp = createComposition();
  applyTemplate(comp, "focus");

  const direct = makeCanvas(1280, 720);
  drawComposition(direct.getContext("2d"), comp, { image: photo, editable: false });

  const result = await exportPng(comp, exportOptions(photo));
  const decoded = await decodePng(result.bytes);
  const fromExport = makeCanvas(1280, 720);
  fromExport.getContext("2d").drawImage(decoded, 0, 0);

  const a = direct.getContext("2d").getImageData(0, 0, 1280, 720).data;
  const b = fromExport.getContext("2d").getImageData(0, 0, 1280, 720).data;
  assert.equal(a.length, b.length);

  let differences = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 1 || Math.abs(a[i + 1] - b[i + 1]) > 1 || Math.abs(a[i + 2] - b[i + 2]) > 1) {
      differences += 1;
    }
  }
  assert.equal(differences, 0, `${differences} pixels diffèrent entre l'écran et l'export`);
});

test("le texte modifié avant l'export se retrouve dans le fichier", async () => {
  const comp = createComposition();
  applyTemplate(comp, "editorial");
  const title = comp.layers.find((l) => l.name === "Titre");
  title.text = "ZZZQXW";
  title.fontSize = 200;
  title.fill = { type: "solid", color: "#ff0000", from: "#f00", to: "#f00", angle: 0 };
  title.stroke.enabled = false;
  title.shadow.enabled = false;

  const result = await exportPng(comp, exportOptions());
  const decoded = await decodePng(result.bytes);
  const canvas = makeCanvas(1280, 720);
  canvas.getContext("2d").drawImage(decoded, 0, 0);
  const data = canvas.getContext("2d").getImageData(0, 0, 1280, 720).data;

  let redPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 170 && data[i + 1] < 90 && data[i + 2] < 90) redPixels += 1;
  }
  assert.ok(redPixels > 400, `le texte rouge doit être présent (${redPixels} px)`);
});

test("échec d'encodage : ExportError, jamais un faux succès", async () => {
  const comp = createComposition();

  /* Contexte 2D indisponible. */
  await assert.rejects(
    exportPng(comp, { canvasFactory: () => ({ getContext: () => null }), decode: decodePng }),
    (err) => err instanceof ExportError && /Contexte 2D/.test(err.message),
  );

  /* toBlob renvoie null (comportement réel sur certains navigateurs saturés). */
  const real = canvasFactory(1280, 720);
  const fake = {
    width: 1280,
    height: 720,
    getContext: () => real.getContext("2d"),
    toBlob: (cb) => cb(null),
  };
  await assert.rejects(
    exportPng(comp, { canvasFactory: () => fake, decode: decodePng }),
    (err) => err instanceof ExportError && /toBlob/.test(err.message),
  );

  /* Encodeur qui produit autre chose qu'un PNG (octets JPEG). */
  const liar = canvasFactory(1280, 720);
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  liar.toBlob = (cb) => cb(new Blob([jpegBytes], { type: "image/jpeg" }));
  await assert.rejects(
    exportPng(comp, { canvasFactory: () => liar, decode: decodePng }),
    (err) => err instanceof ExportError && /signature|PNG/i.test(err.message),
  );

  /* Dimensions produites incohérentes. */
  const wrongSize = canvasFactory(640, 360);
  await assert.rejects(
    exportPng(comp, { canvasFactory: () => wrongSize, decode: decodePng }),
    (err) => err instanceof ExportError && /1280/.test(err.message),
  );
});

test("aucun canvas disponible hors navigateur : erreur explicite", () => {
  assert.throws(() => createCanvasElement(1280, 720), (err) => err instanceof ExportError);
});

test("canvasToPngBytes gère toBlob, encode, toBuffer et toDataURL", async () => {
  const real = canvasFactory(64, 32);
  real.getContext("2d").fillRect(0, 0, 64, 32);

  const viaEncode = await canvasToPngBytes({ encode: () => real.encode("png") });
  assert.ok(viaEncode.length > 50);
  assert.deepEqual([...viaEncode.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  const viaToBuffer = await canvasToPngBytes({ toBuffer: () => Buffer.from(real.toBuffer("image/png")) });
  assert.ok(viaToBuffer.length > 50);

  const dataUrl = `data:image/png;base64,${Buffer.from(toBytes(await real.encode("png"))).toString("base64")}`;
  const viaDataUrl = await canvasToPngBytes({ toDataURL: () => dataUrl });
  assert.ok(viaDataUrl.length > 50);

  const viaToBlob = await canvasToPngBytes({
    toBlob: (cb) => cb(new Blob([Buffer.from(real.toBuffer("image/png"))], { type: "image/png" })),
  });
  assert.ok(viaToBlob.length > 50);

  await assert.rejects(canvasToPngBytes(null), (err) => err instanceof ExportError);
  await assert.rejects(canvasToPngBytes({}), (err) => err instanceof ExportError);
  await assert.rejects(
    canvasToPngBytes({ toDataURL: () => "data:image/jpeg;base64,AAAA" }),
    (err) => err instanceof ExportError && /PNG/.test(err.message),
  );
});

test("le poids du fichier est mesuré et comparé à la limite YouTube", async () => {
  const noise = makeCanvas(1280, 720);
  const nctx = noise.getContext("2d");
  const img = nctx.createImageData(1280, 720);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.floor(Math.random() * 256);
    img.data[i + 1] = Math.floor(Math.random() * 256);
    img.data[i + 2] = Math.floor(Math.random() * 256);
    img.data[i + 3] = 255;
  }
  nctx.putImageData(img, 0, 0);

  const comp = solidComp("#000000");
  const result = await exportPng(comp, exportOptions(noise));
  assert.ok(result.sizeBytes > 1_000_000, `bruit incompressible attendu, obtenu ${result.sizeBytes}`);
  assert.equal(result.overLimit, result.sizeBytes > YOUTUBE_MAX_BYTES);
  assert.equal(result.overLimit, true, "un bruit aléatoire dépasse la limite YouTube de 2 Mo");
  assert.match(result.sizeLabel, /Mo|Ko/);

  /* Un aplat reste bien sous la limite. */
  const flat = await exportPng(solidComp("#123456"), exportOptions());
  assert.equal(flat.overLimit, false);
  assert.ok(flat.sizeBytes < 20_000, `aplat attendu léger : ${flat.sizeBytes}`);
});

test("nom de fichier : lisible, sans accent, horodaté", () => {
  const comp = createComposition();
  comp.meta.title = "Comment réussir ses miniatures Étape 2 !";
  const name = buildFilename(comp);
  assert.match(name, /\.png$/);
  assert.match(name, /1280x720/);
  assert.equal(/[À-ÿ]/.test(name), false, "pas d'accent dans le nom de fichier");
  assert.equal(/\s/.test(name), false, "pas d'espace");
  assert.match(name, /^comment-reussir-ses-miniatures-etape-2-1280x720-/);

  const empty = buildFilename(createComposition({ meta: { title: "", topic: "" } }));
  assert.match(empty, /^miniature-youtube-1280x720-.*\.png$/);

  const custom = buildFilename(comp, { base: "Été 2026 ?", suffix: "v2" });
  assert.match(custom, /^ete-2026-v2-1280x720-/);
});

test("les avertissements du rendu sont traduits en français", () => {
  assert.deepEqual(describeWarnings([]), []);
  const messages = describeWarnings(["filters-pixel", "blur-unsupported"]);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /pixel par pixel/);
  assert.match(messages[1], /flou/i);
});

test("l'export ignore l'état d'interface (sélection, guides)", async () => {
  const comp = createComposition();
  applyTemplate(comp, "focus");
  const plain = await exportPng(comp, exportOptions());
  const withUiOptions = await exportPng(comp, { ...exportOptions(), editable: true, guides: true, selectedId: comp.layers[0].id });
  assert.deepEqual(
    Buffer.from(plain.bytes).equals(Buffer.from(withUiOptions.bytes)),
    true,
    "les options d'interface ne doivent pas influencer l'export",
  );
});

test("une composition sans photo s'exporte quand même (fond + texte)", async () => {
  const comp = createComposition();
  comp.layers = [createTextLayer({ text: "SANS PHOTO", fontSize: 120, x: 200, y: 300 })];
  const result = await exportPng(comp, exportOptions(null));
  assert.equal(result.info.width, 1280);
  assert.ok(result.report.warnings.includes("no-image"));
  assert.ok(result.bytes.length > 3000);
});
