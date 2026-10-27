/**
 * CTR Studio AI — mise en page du texte sur canvas.
 *
 * Objectif : un rendu identique à l'écran et à l'export, sur tous les
 * navigateurs. Deux points délicats sont traités ici :
 *
 *  1. L'interlettrage (`letterSpacing`) n'est pas disponible partout. Quand le
 *     contexte le gère nativement on l'utilise ; sinon on dessine caractère par
 *     caractère. Les deux chemins renvoient exactement la même largeur utile.
 *  2. L'alignement est toujours calculé à la main (textAlign = 'left') pour que
 *     le centrage ne dépende pas de l'interprétation du navigateur.
 */

import { clamp } from "./utils.js";

const REFERENCE_GLYPHS = "HgpéA";

/* ------------------------------------------------------- interlettrage */

export function supportsLetterSpacing(ctx) {
  return !!ctx && "letterSpacing" in ctx;
}

/** Applique l'interlettrage ; renvoie true si le mode natif est utilisé. */
export function applyLetterSpacing(ctx, px) {
  const value = Number(px) || 0;
  if (!value) return false;
  if (supportsLetterSpacing(ctx)) {
    ctx.letterSpacing = `${value}px`;
    return true;
  }
  return false;
}

export function clearLetterSpacing(ctx) {
  if (supportsLetterSpacing(ctx)) ctx.letterSpacing = "0px";
}

/**
 * Largeur « utile » d'une ligne : l'espace ajouté après le dernier caractère
 * est retiré, pour que le centrage soit visuellement juste.
 */
export function measureLineWidth(ctx, text, letterSpacing = 0) {
  const str = String(text ?? "");
  if (!str) return 0;
  const ls = Number(letterSpacing) || 0;
  const native = applyLetterSpacing(ctx, ls);
  let width;
  if (native) {
    width = ctx.measureText(str).width - ls;
    clearLetterSpacing(ctx);
  } else if (ls) {
    let sum = 0;
    for (const ch of str) sum += ctx.measureText(ch).width;
    /* [...str].length : nombre de caractères Unicode, pas de units UTF-16. */
    width = sum + ls * ([...str].length - 1);
  } else {
    width = ctx.measureText(str).width;
  }
  return Math.max(0, width);
}

/**
 * Dessine (et/ou contourne) une ligne en respectant l'interlettrage.
 * `x` est le bord gauche visuel de la ligne, `y` la ligne de base.
 */
export function paintLine(ctx, text, x, y, { letterSpacing = 0, stroke = false, fill = true } = {}) {
  const str = String(text ?? "");
  if (!str) return;
  const ls = Number(letterSpacing) || 0;
  const previousAlign = ctx.textAlign;
  const previousBaseline = ctx.textBaseline;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const native = applyLetterSpacing(ctx, ls);
  if (native || !ls) {
    if (stroke) ctx.strokeText(str, x, y);
    if (fill) ctx.fillText(str, x, y);
    clearLetterSpacing(ctx);
  } else {
    let cursor = x;
    for (const ch of str) {
      if (stroke) ctx.strokeText(ch, cursor, y);
      if (fill) ctx.fillText(ch, cursor, y);
      cursor += ctx.measureText(ch).width + ls;
    }
  }

  ctx.textAlign = previousAlign;
  ctx.textBaseline = previousBaseline;
}

/* ------------------------------------------------------------- typographie */

export function buildFontString(layer, scale = 1) {
  const style = layer.italic ? "italic " : "";
  const weight = Number(layer.fontWeight) || 700;
  const size = Math.max(1, (Number(layer.fontSize) || 16) * (Number(scale) || 1));
  const stack = layer.fontStack || "system-ui, sans-serif";
  return `${style}${weight} ${size}px ${stack}`;
}

/** Texte tel qu'il sera dessiné (casse appliquée, \r nettoyés). */
export function displayText(layer) {
  const raw = String(layer.text ?? "").replace(/\r\n?/g, "\n");
  return layer.uppercase ? raw.toLocaleUpperCase("fr-FR") : raw;
}

/**
 * Découpe en lignes : retours manuels d'abord, puis césure douce si `wrap`.
 * Un mot plus long que la boîte est coupé caractère par caractère.
 */
export function splitLines(ctx, layer) {
  const text = displayText(layer);
  const ls = Number(layer.letterSpacing) || 0;
  const manualLines = text.split("\n");
  if (!layer.wrap) return manualLines;

  const maxWidth = Math.max(40, Number(layer.boxWidth) || 0);
  const out = [];
  for (const paragraph of manualLines) {
    const words = paragraph.split(/(\s+)/).filter((w) => w.length > 0);
    let line = "";
    let lineWidth = 0;
    const spaceWidth = measureLineWidth(ctx, " ", ls);

    const flush = () => {
      out.push(line.replace(/\s+$/, ""));
      line = "";
      lineWidth = 0;
    };

    for (const word of words) {
      /* Les espaces sont ignorés : ils sont réinjectés entre les mots. */
      if (/^\s+$/.test(word)) continue;
      const wordWidth = measureLineWidth(ctx, word, ls);

      /*
       * Mot plus large que la boîte : on vide la ligne en cours puis on coupe
       * le mot caractère par caractère, pour ne jamais déborder.
       */
      if (wordWidth > maxWidth) {
        if (line.trim()) flush();
        let chunk = "";
        for (const ch of word) {
          const candidate = chunk + ch;
          if (chunk && measureLineWidth(ctx, candidate, ls) > maxWidth) {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk = candidate;
          }
        }
        line = chunk;
        lineWidth = measureLineWidth(ctx, chunk, ls);
        continue;
      }

      const nextWidth = lineWidth === 0 ? wordWidth : lineWidth + spaceWidth + wordWidth;
      if (nextWidth > maxWidth && line.trim()) {
        flush();
        line = word;
        lineWidth = wordWidth;
      } else {
        line = line ? `${line} ${word}` : word;
        lineWidth = nextWidth;
      }
    }
    if (line.trim() || out.length === 0) out.push(line.replace(/\s+$/, ""));
  }
  return out.length ? out : [""];
}

/** Mesures verticales de la police courante (ascent/descent en px). */
export function measureFontMetrics(ctx, layer) {
  const previousFont = ctx.font;
  ctx.font = buildFontString(layer);
  const m = ctx.measureText(REFERENCE_GLYPHS);
  ctx.font = previousFont;
  const size = Math.max(1, Number(layer.fontSize) || 16);
  const ascent =
    Number.isFinite(m.fontBoundingBoxAscent) && m.fontBoundingBoxAscent > 0
      ? m.fontBoundingBoxAscent
      : Number.isFinite(m.actualBoundingBoxAscent) && m.actualBoundingBoxAscent > 0
        ? m.actualBoundingBoxAscent
        : size * 0.78;
  const descent =
    Number.isFinite(m.fontBoundingBoxDescent) && m.fontBoundingBoxDescent >= 0
      ? m.fontBoundingBoxDescent
      : Number.isFinite(m.actualBoundingBoxDescent) && m.actualBoundingBoxDescent >= 0
        ? m.actualBoundingBoxDescent
        : size * 0.22;
  return { ascent, descent };
}

/**
 * Calcule toute la géométrie d'un calque texte.
 *
 * Repère : `x`/`y` du calque = coin haut-gauche du bloc de texte (hors fond).
 * Le fond (badge) est élargi par `padX`/`padY` autour de ce bloc.
 */
export function layoutText(ctx, layer) {
  const previousFont = ctx.font;
  ctx.font = buildFontString(layer);

  const lines = splitLines(ctx, layer);
  const ls = Number(layer.letterSpacing) || 0;
  const widths = lines.map((line) => measureLineWidth(ctx, line, ls));
  const widest = Math.max(0, ...widths);
  /*
   * Avec la césure active, la boîte a une largeur imposée (`boxWidth`) dans
   * laquelle chaque ligne est alignée — comme une zone de texte classique.
   * Sans césure, la boîte épouse le texte.
   */
  const wrapActive = !!layer.wrap && Number(layer.boxWidth) > 0;
  const contentWidth = wrapActive ? Math.max(Number(layer.boxWidth), widest) : widest;
  const { ascent, descent } = measureFontMetrics(ctx, layer);
  const lineHeightPx = Math.max(1, (Number(layer.fontSize) || 16) * (Number(layer.lineHeight) || 1));
  const contentHeight = lines.length * lineHeightPx;
  /* Centrage vertical des glyphes dans l'interligne. */
  const firstBaseline = (lineHeightPx - (ascent + descent)) / 2 + ascent;

  const lineBoxes = lines.map((text, i) => ({
    text,
    width: widths[i],
    baseline: firstBaseline + i * lineHeightPx,
    left: alignOffset(layer.align, widths[i], contentWidth),
  }));

  ctx.font = previousFont;

  const bg = layer.background ?? {};
  const padX = bg.enabled ? Math.max(0, Number(bg.padX) || 0) : 0;
  const padY = bg.enabled ? Math.max(0, Number(bg.padY) || 0) : 0;

  return {
    lines: lineBoxes,
    lineWidths: widths,
    contentWidth,
    contentHeight,
    wrapActive,
    lineHeightPx,
    ascent,
    descent,
    padding: { x: padX, y: padY },
    box: {
      x: layer.x - padX,
      y: layer.y - padY,
      width: contentWidth + padX * 2,
      height: contentHeight + padY * 2,
    },
    center: {
      x: layer.x + contentWidth / 2,
      y: layer.y + contentHeight / 2,
    },
  };
}

function alignOffset(align, lineWidth, contentWidth) {
  if (align === "center") return (contentWidth - lineWidth) / 2;
  if (align === "right") return contentWidth - lineWidth;
  return 0;
}

/**
 * Boîte utilisée pour la sélection et les poignées : englobe le fond éventuel,
 * le contour et un peu d'air autour des glyphes.
 */
export function hitBounds(layer, layout, margin = 8) {
  const stroke = layer.stroke?.enabled ? (Number(layer.stroke.width) || 0) / 2 : 0;
  const box = layout.box;
  const pad = margin + stroke;
  return {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
}

/**
 * Ramène un calque dans la miniature tout en autorisant un léger débordement
 * artistique (`bleed` = part de la boîte pouvant sortir de chaque côté).
 */
export function clampInsideCanvas(layer, layout, canvas, bleed = 0.25) {
  const box = layout.box;
  const minX = -box.width * bleed;
  const minY = -box.height * bleed;
  const maxX = Math.max(minX, canvas.width - box.width * (1 - bleed));
  const maxY = Math.max(minY, canvas.height - box.height * (1 - bleed));
  const targetX = clamp(box.x, minX, maxX);
  const targetY = clamp(box.y, minY, maxY);
  layer.x += targetX - box.x;
  layer.y += targetY - box.y;
  return layer;
}
