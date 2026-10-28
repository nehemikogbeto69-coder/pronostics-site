/**
 * Génère des exemples de miniatures avec le VRAI moteur d'export.
 *   node tools/make-samples.mjs
 * Sert à illustrer le README : ce sont de vrais PNG 1280×720 produits par
 * src/io/exporter.js (les mêmes octets que l'utilisateur télécharge).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { compositionFromTemplate, applyTemplate } from "../src/core/templates.js";
import { createComposition } from "../src/core/composition.js";
import { exportPng } from "../src/io/exporter.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..", "docs", "apercus");

const canvasFactory = (w, h) => createCanvas(w, h);
/* Décodeur réel (Skia) pour la vérification post-export, comme le fait un
   navigateur avec createImageBitmap. */
const decode = async (bytes) => loadImage(bytes);

/** Photo de démonstration : dégradé + sujet, fabriquée localement. */
async function demoPhoto() {
  const canvas = createCanvas(1280, 720);
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, 720);
  sky.addColorStop(0, "#1e3a8a");
  sky.addColorStop(0.55, "#7c3aed");
  sky.addColorStop(1, "#0f172a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1280, 720);
  /* halo */
  const halo = ctx.createRadialGradient(900, 250, 20, 900, 250, 380);
  halo.addColorStop(0, "rgba(255,255,255,0.55)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 1280, 720);
  /* sujet : silhouette */
  ctx.fillStyle = "#0b1020";
  ctx.beginPath();
  ctx.ellipse(905, 470, 150, 210, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(905, 250, 96, 0, Math.PI * 2);
  ctx.fill();
  /* sol */
  ctx.fillStyle = "rgba(2,6,23,0.85)";
  ctx.fillRect(0, 600, 1280, 120);
  const bytes = await canvas.encode("png");
  return loadImage(bytes);
}

const samples = [
  { id: "energie", file: "modele-energie.png", title: "Énergie — titre massif, badge et accent jaune" },
  { id: "focus", file: "modele-focus.png", title: "Focus — titre cadré à gauche sur voile dégradé" },
  { id: "editorial", file: "modele-editorial.png", title: "Éditorial — serif centré, ton chaud" },
];

for (const sample of samples) {
  const comp = compositionFromTemplate(sample.id);
  comp.meta.title = sample.title;
  const result = await exportPng(comp, { canvasFactory, decode });
  writeFileSync(path.join(OUT, sample.file), result.bytes);
  console.log(
    `${sample.file} · ${result.info.width}×${result.info.height} · ${result.sizeLabel} · ` +
      `PNG valide=${result.decoded.ok} complet=${result.complete}`,
  );
}

/* Un exemple avec photo importée (cas réel d'utilisation). */
const photo = await demoPhoto();
const comp = createComposition();
applyTemplate(comp, "energie");
comp.image.dataUrl = "demo";           /* marque la présence d'une photo */
comp.image.naturalWidth = photo.width;
comp.image.naturalHeight = photo.height;
comp.layers.at(-1).text = "3 ERREURS";
const withPhoto = await exportPng(comp, { image: photo, canvasFactory, decode });
writeFileSync(path.join(OUT, "avec-photo.png"), withPhoto.bytes);
console.log(
  `avec-photo.png · ${withPhoto.info.width}×${withPhoto.info.height} · ${withPhoto.sizeLabel} · ` +
    `PNG valide=${withPhoto.decoded.ok}`,
);
