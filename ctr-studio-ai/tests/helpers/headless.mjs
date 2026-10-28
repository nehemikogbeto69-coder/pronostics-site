/**
 * Socle de test hors navigateur : on pilote le MÊME code de rendu que dans le
 * navigateur, mais avec un canvas Node (@napi-rs/canvas). Cela permet de
 * vérifier réellement l'export PNG (octets, dimensions, pixels) sans simulateur.
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";

export const canvasFactory = (width, height) => createCanvas(width, height);

export function makeCanvas(width = 1280, height = 720) {
  return createCanvas(width, height);
}

/** Décode des octets PNG pour vérification (comme createImageBitmap côté navigateur). */
export async function decodePng(bytes) {
  return loadImage(Buffer.from(bytes));
}

export async function pngBytes(canvas) {
  return await canvas.encode("png");
}

/** Fabrique une image de test (canvas utilisable comme source de drawImage). */
export function makeTestImage(width = 640, height = 360, options = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const base = options.base ?? "#3b6ea5";
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  if (options.accent !== false) {
    ctx.fillStyle = options.accent ?? "#f5d76e";
    ctx.beginPath();
    ctx.arc(width * 0.68, height * 0.42, Math.min(width, height) * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  if (options.label) {
    ctx.fillStyle = options.labelColor ?? "#0b0614";
    ctx.font = `700 ${Math.round(height / 8)}px sans-serif`;
    ctx.fillText(options.label, width * 0.06, height * 0.8);
  }
  return canvas;
}

/** Statistiques de luminance sur une zone (vérifie que quelque chose est dessiné). */
export function regionStats(canvas, x = 0, y = 0, w = canvas.width, h = canvas.height) {
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(x, y, w, h).data;
  let sum = 0;
  let min = 255;
  let max = 0;
  let colored = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += luma;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    if (mx - mn > 24) colored += 1;
  }
  const pixels = data.length / 4;
  return {
    pixels,
    mean: sum / pixels,
    min,
    max,
    coloredShare: colored / pixels,
  };
}

export function fullStats(canvas) {
  return regionStats(canvas, 0, 0, canvas.width, canvas.height);
}

/** ImageData d'un canvas, pour tester le moteur d'analyse. */
export function imageDataOf(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
}

/** Image synthétique : dégradé / aplats / bruit, pour les tests d'analyse. */
export function syntheticImage(width, height, kind = "gray") {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  const d = img.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let r = 128;
      let g = 128;
      let b = 128;
      if (kind === "flat" || kind === "midgray") {
        r = g = b = 120;
      } else if (kind === "split") {
        r = g = b = x < width / 2 ? 12 : 245;
      } else if (kind === "gradient") {
        r = g = b = Math.round((x / width) * 255);
      } else if (kind === "noise") {
        r = g = b = Math.round(Math.random() * 255);
      } else if (kind === "subject") {
        /* fond sombre à droite + zone plate claire à gauche : cas « miniature exploitable » */
        const inSubject = x > width * 0.55 && y > height * 0.2 && y < height * 0.9;
        r = inSubject ? 226 : 26;
        g = inSubject ? 198 : 20;
        b = inSubject ? 140 : 34;
      } else if (kind === "dark") {
        r = g = b = Math.round((y / height) * 30);
      } else if (kind === "asym") {
        /* Fond sombre + sujet saturé dans le tiers droit : déséquilibre attendu. */
        const dx = x - width * 0.76;
        const dy = y - height * 0.45;
        const inBlob = dx * dx + dy * dy < (width * 0.15) ** 2;
        r = inBlob ? 245 : 26;
        g = inBlob ? 158 : 24;
        b = inBlob ? 11 : 46;
      }
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
