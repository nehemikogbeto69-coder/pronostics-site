/**
 * CTR Studio AI — traitements d'image (purs, testables sans DOM).
 *
 * `ctx.filter` est utilisé quand le navigateur le gère (Chrome, Firefox,
 * Safari 18+). Sinon on retombe sur un traitement pixel par pixel, ce qui
 * garantit que l'export PNG correspond toujours à ce que voit l'utilisateur.
 */

import { clamp, degToRad, luma709, round } from "./utils.js";

/**
 * Valeur numérique avec repli. Contrairement à `x || defaut`, un 0 légitime
 * (luminosité à 0 %, saturation à 0 %) est conservé.
 */
const numOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function supportsCanvasFilters(ctx) {
  return !!ctx && "filter" in ctx;
}

/** Chaîne `filter` CSS équivalente aux réglages de la photo. */
export function buildFilterString(image) {
  if (!image) return "none";
  const parts = [];
  const brightness = clamp(numOr(image.brightness, 100), 0, 300);
  const contrast = clamp(numOr(image.contrast, 100), 0, 300);
  const saturate = clamp(numOr(image.saturate, 100), 0, 300);
  const blur = clamp(numOr(image.blur, 0), 0, 40);
  if (brightness !== 100) parts.push(`brightness(${round(brightness / 100, 3)})`);
  if (contrast !== 100) parts.push(`contrast(${round(contrast / 100, 3)})`);
  if (saturate !== 100) parts.push(`saturate(${round(saturate / 100, 3)})`);
  if (blur > 0) parts.push(`blur(${round(blur, 2)}px)`);
  return parts.length ? parts.join(" ") : "none";
}

export function hasPixelAdjustments(image) {
  if (!image) return false;
  return (
    numOr(image.brightness, 100) !== 100 ||
    numOr(image.contrast, 100) !== 100 ||
    numOr(image.saturate, 100) !== 100 ||
    numOr(image.blur, 0) > 0
  );
}

/**
 * Applique luminosité / contraste / saturation sur un ImageData, dans le même
 * ordre que la chaîne CSS `brightness() contrast() saturate()`.
 * Le flou n'est pas simulé ici (trop coûteux) : il est signalé par le rendu.
 */
export function applyPixelFilters(imageData, { brightness = 100, contrast = 100, saturate = 100 } = {}) {
  if (!imageData || !imageData.data) return imageData;
  const b = clamp(numOr(brightness, 100), 0, 300) / 100;
  const c = clamp(numOr(contrast, 100), 0, 300) / 100;
  const s = clamp(numOr(saturate, 100), 0, 300) / 100;
  if (b === 1 && c === 1 && s === 1) return imageData;

  /* Tables de correspondance 256 entrées : un seul calcul par canal. */
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) lut[v] = clamp((v * b - 128) * c + 128, 0, 255);

  const d = imageData.data;
  if (s === 1) {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
    return imageData;
  }
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[d[i]];
    const g = lut[d[i + 1]];
    const bl = lut[d[i + 2]];
    const gray = luma709(r, g, bl);
    d[i] = clamp(gray + (r - gray) * s, 0, 255);
    d[i + 1] = clamp(gray + (g - gray) * s, 0, 255);
    d[i + 2] = clamp(gray + (bl - gray) * s, 0, 255);
  }
  return imageData;
}

/**
 * Dégradé linéaire suivant la convention CSS : 0° = vers le haut, sens horaire.
 * Le dégradé couvre exactement la boîte (x, y, w, h).
 */
export function linearGradient(ctx, angleDeg, x, y, w, h, from, to) {
  const a = degToRad(Number(angleDeg) || 0);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const length = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)) || 1;
  const dx = (Math.sin(a) * length) / 2;
  const dy = (-Math.cos(a) * length) / 2;
  const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  return gradient;
}

/** Vignettage radial : assombrit les bords pour détacher le sujet. */
export function drawVignette(ctx, width, height, strength = 0) {
  const value = clamp(Number(strength) || 0, 0, 1);
  if (value <= 0) return;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.hypot(cx, cy);
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.25, cx, cy, radius);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.55, `rgba(0,0,0,${round(value * 0.25, 3)})`);
  gradient.addColorStop(1, `rgba(0,0,0,${round(value * 0.92, 3)})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** Trace un rectangle aux angles arrondis (compatible tous navigateurs). */
export function traceRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function" && radius > 0) {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Place la photo sur le canvas 1280×720 (mode d'ajustement + zoom + décalage).
 * Fonction pure : renvoie le rectangle de destination et le rectangle source.
 */
export function computeImagePlacement(image, sourceSize, canvas) {
  const iw = Math.max(1, Number(sourceSize?.width) || 1);
  const ih = Math.max(1, Number(sourceSize?.height) || 1);
  const cw = canvas.width;
  const ch = canvas.height;
  const zoom = clamp(numOr(image?.zoom, 1), 0.2, 6);
  const fit = image?.fit || "cover";

  let scaleX;
  let scaleY;
  if (fit === "stretch") {
    scaleX = (cw / iw) * zoom;
    scaleY = (ch / ih) * zoom;
  } else if (fit === "contain") {
    const base = Math.min(cw / iw, ch / ih) * zoom;
    scaleX = base;
    scaleY = base;
  } else {
    const base = Math.max(cw / iw, ch / ih) * zoom;
    scaleX = base;
    scaleY = base;
  }

  const dw = iw * scaleX;
  const dh = ih * scaleY;
  const dx = (cw - dw) / 2 + numOr(image?.offsetX, 0);
  const dy = (ch - dh) / 2 + numOr(image?.offsetY, 0);

  return {
    sx: 0,
    sy: 0,
    sWidth: iw,
    sHeight: ih,
    dx: round(dx, 2),
    dy: round(dy, 2),
    dWidth: round(dw, 2),
    dHeight: round(dh, 2),
    scale: round(scaleX, 4),
  };
}
