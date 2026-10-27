/**
 * CTR Studio AI — moteur de rendu.
 *
 * Une seule fonction dessine la composition, à l'écran comme à l'export :
 * `drawComposition`. L'écran et le PNG final sont donc toujours identiques.
 *
 * Le module est volontairement sans DOM : il reçoit un contexte 2D, ce qui
 * permet de le tester dans Node avec un canvas hors-ligne.
 */

import { THUMB_HEIGHT, THUMB_WIDTH } from "./constants.js";
import {
  applyPixelFilters,
  buildFilterString,
  computeImagePlacement,
  drawVignette,
  hasPixelAdjustments,
  linearGradient,
  supportsCanvasFilters,
  traceRoundedRect,
} from "./effects.js";
import {
  handlePositions,
  rotatePoint,
  boxCenter,
} from "./geometry.js";
import { buildFontString, layoutText, paintLine } from "./textLayout.js";
import { clamp, degToRad } from "./utils.js";

export const WARNING = {
  FILTER_FALLBACK: "filters-pixel",
  BLUR_UNSUPPORTED: "blur-unsupported",
  IMAGE_TAINED: "image-tainted",
  NO_IMAGE: "no-image",
};

/** Dimensions d'une source image selon son type (Image, ImageBitmap, napi…). */
export function sourceSize(drawable) {
  if (!drawable) return { width: 0, height: 0 };
  return {
    width: drawable.naturalWidth || drawable.width || 0,
    height: drawable.naturalHeight || drawable.height || 0,
  };
}

/* ------------------------------------------------------------------- fond */

export function drawBackground(ctx, background, canvas) {
  ctx.save();
  if (background.type === "gradient") {
    ctx.fillStyle = linearGradient(
      ctx,
      background.angle,
      0,
      0,
      canvas.width,
      canvas.height,
      background.from,
      background.to,
    );
  } else {
    ctx.fillStyle = background.color;
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/* ------------------------------------------------------------------ photo */

export function drawPhoto(ctx, image, drawable, canvas, report, options = {}) {
  if (!drawable) {
    report.warnings.push(WARNING.NO_IMAGE);
    return null;
  }
  const size = sourceSize(drawable);
  if (!size.width || !size.height) {
    report.warnings.push(WARNING.NO_IMAGE);
    return null;
  }
  const placement = computeImagePlacement(image, size, canvas);
  const needsFilter = hasPixelAdjustments(image);
  const nativeFilter = supportsCanvasFilters(ctx);

  let paintable = drawable;
  let paintedPlacement = placement;

  if (needsFilter && !nativeFilter) {
    /* Repli : traitement pixel par pixel sur un canvas intermédiaire. */
    const off = createOffscreen(options, Math.max(1, Math.round(placement.dWidth)), Math.max(1, Math.round(placement.dHeight)));
    if (off) {
      const octx = off.getContext("2d");
      octx.imageSmoothingEnabled = true;
      octx.drawImage(drawable, 0, 0, off.width, off.height);
      try {
        const data = octx.getImageData(0, 0, off.width, off.height);
        applyPixelFilters(data, {
          brightness: image.brightness,
          contrast: image.contrast,
          saturate: image.saturate,
        });
        octx.putImageData(data, 0, 0);
        paintable = off;
        paintedPlacement = {
          ...placement,
          sx: 0,
          sy: 0,
          sWidth: off.width,
          sHeight: off.height,
        };
        report.warnings.push(WARNING.FILTER_FALLBACK);
        if (Number(image.blur) > 0) report.warnings.push(WARNING.BLUR_UNSUPPORTED);
      } catch (err) {
        report.warnings.push(WARNING.IMAGE_TAINED);
      }
    } else {
      report.warnings.push(WARNING.FILTER_FALLBACK);
    }
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  if (needsFilter && nativeFilter) ctx.filter = buildFilterString(image);

  const flipH = !!image.flipH;
  const flipV = !!image.flipV;
  if (flipH || flipV) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
  }

  ctx.drawImage(
    paintable,
    paintedPlacement.sx,
    paintedPlacement.sy,
    paintedPlacement.sWidth,
    paintedPlacement.sHeight,
    paintedPlacement.dx,
    paintedPlacement.dy,
    paintedPlacement.dWidth,
    paintedPlacement.dHeight,
  );
  ctx.restore();
  return placement;
}

function createOffscreen(options, width, height) {
  const factory = options.createCanvas;
  if (typeof factory === "function") {
    try {
      return factory(width, height);
    } catch {
      return null;
    }
  }
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }
  return null;
}

/** Voile dégradé (scrim) : assombrit une zone pour rendre le texte lisible. */
export function drawScrim(ctx, scrim, canvas) {
  if (!scrim?.enabled) return;
  ctx.save();
  ctx.fillStyle = linearGradient(
    ctx,
    scrim.angle,
    0,
    0,
    canvas.width,
    canvas.height,
    scrim.from,
    scrim.to,
  );
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/* ------------------------------------------------------------ calque texte */

export function drawTextLayer(ctx, layer) {
  if (!layer || layer.visible === false) return null;
  const layout = layoutText(ctx, layer);
  if (!layout.contentWidth && !layout.contentHeight) return layout;

  const pivot = boxCenter(layout.box);
  const bg = layer.background;
  const shadow = layer.shadow;
  const stroke = layer.stroke;

  ctx.save();
  ctx.globalAlpha = clamp(Number(layer.opacity ?? 1), 0, 1);
  if (layer.rotation) {
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(degToRad(layer.rotation));
    ctx.translate(-pivot.x, -pivot.y);
  }
  ctx.font = buildFontString(layer);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  /* 1. Fond / badge (l'ombre du calque s'applique alors au badge) */
  if (bg?.enabled && layout.box.width > 0 && layout.box.height > 0) {
    traceRoundedRect(ctx, layout.box.x, layout.box.y, layout.box.width, layout.box.height, bg.radius);
    ctx.save();
    ctx.globalAlpha = clamp(Number(layer.opacity ?? 1), 0, 1) * clamp(Number(bg.opacity ?? 1), 0, 1);
    if (shadow?.enabled) applyShadow(ctx, shadow);
    ctx.fillStyle =
      bg.type === "gradient"
        ? linearGradient(ctx, bg.angle, layout.box.x, layout.box.y, layout.box.width, layout.box.height, bg.from, bg.to)
        : bg.color;
    ctx.fill();
    ctx.restore();
  }

  /* 2. Glyphes : contour puis remplissage, une seule ombre au total */
  const strokeOn = !!stroke?.enabled && Number(stroke.width) > 0;
  const shadowOnText = !!shadow?.enabled && !bg?.enabled;

  for (const line of layout.lines) {
    const x = layer.x + line.left;
    const y = layer.y + line.baseline;

    if (strokeOn) {
      ctx.save();
      if (shadowOnText) applyShadow(ctx, shadow);
      ctx.strokeStyle = stroke.color;
      /* Le contour canvas est centré sur le tracé : ×2 pour l'épaisseur visible. */
      ctx.lineWidth = Number(stroke.width) * 2;
      paintLine(ctx, line.text, x, y, {
        letterSpacing: layer.letterSpacing,
        stroke: true,
        fill: false,
      });
      ctx.restore();
    }

    ctx.save();
    if (shadowOnText) applyShadow(ctx, shadow);
    ctx.fillStyle =
      layer.fill?.type === "gradient"
        ? linearGradient(
            ctx,
            layer.fill.angle,
            layer.x,
            layer.y,
            Math.max(1, layout.contentWidth),
            Math.max(1, layout.contentHeight),
            layer.fill.from,
            layer.fill.to,
          )
        : layer.fill?.color || "#ffffff";
    paintLine(ctx, line.text, x, y, {
      letterSpacing: layer.letterSpacing,
      stroke: false,
      fill: true,
    });
    ctx.restore();
  }

  ctx.restore();
  return layout;
}

function applyShadow(ctx, shadow) {
  ctx.shadowColor = shadow.color || "rgba(0,0,0,0.6)";
  ctx.shadowBlur = clamp(Number(shadow.blur) || 0, 0, 120);
  ctx.shadowOffsetX = clamp(Number(shadow.x) || 0, -120, 120);
  ctx.shadowOffsetY = clamp(Number(shadow.y) || 0, -120, 120);
}

/* --------------------------------------------------------- aide visuelle */

/** Affiché tant qu'aucune photo n'est importée (écran uniquement). */
export function drawPlaceholder(ctx, canvas) {
  const { width, height } = canvas;
  ctx.save();
  const glow = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, width * 0.55);
  glow.addColorStop(0, "rgba(168,85,247,0.28)");
  glow.addColorStop(1, "rgba(168,85,247,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const boxW = 620;
  const boxH = 190;
  const bx = (width - boxW) / 2;
  const by = (height - boxH) / 2;
  ctx.setLineDash([14, 12]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(216,180,254,0.45)";
  traceRoundedRect(ctx, bx, by, boxW, boxH, 22);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(233,213,255,0.75)";
  ctx.font = "600 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("Importez une photo pour commencer", width / 2, height / 2 - 16);
  ctx.fillStyle = "rgba(216,180,254,0.5)";
  ctx.font = "400 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(`Toile ${width} × ${height} px — format YouTube`, width / 2, height / 2 + 30);
  ctx.restore();
}

/** Règle des tiers + zone à garder libre (surimpression YouTube). */
export function drawGuides(ctx, canvas) {
  const { width, height } = canvas;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.setLineDash([10, 10]);
  for (let i = 1; i <= 2; i += 1) {
    const x = (width / 3) * i;
    const y = (height / 3) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  /* Marge de sécurité (bordure rognée sur certains lecteurs) */
  ctx.strokeStyle = "rgba(168,85,247,0.5)";
  ctx.strokeRect(width * 0.035, height * 0.05, width * 0.93, height * 0.9);
  /* Zone où YouTube affiche la durée / le survol */
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(244,63,94,0.16)";
  ctx.fillRect(width * 0.78, height * 0.84, width * 0.2, height * 0.14);
  ctx.restore();
}

/** Cadre de sélection + poignées (écran uniquement, jamais à l'export). */
export function drawSelection(ctx, layer, layout, { handleSize = 18, accent = "#c084fc" } = {}) {
  const box = layout.box;
  const pivot = boxCenter(box);
  const handles = handlePositions(box, handleSize);
  const half = handleSize / 2;

  ctx.save();
  if (layer.rotation) {
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(degToRad(layer.rotation));
    ctx.translate(-pivot.x, -pivot.y);
  }

  ctx.lineWidth = Math.max(2, handleSize * 0.14);
  ctx.strokeStyle = accent;
  ctx.setLineDash([handleSize * 0.9, handleSize * 0.7]);
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.setLineDash([]);

  /* Tige vers la poignée de rotation */
  ctx.beginPath();
  ctx.moveTo(handles.n.x, handles.n.y);
  ctx.lineTo(handles.rotate.x, handles.rotate.y);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, handleSize * 0.12);
  ctx.stroke();

  const drawSquare = (p) => {
    ctx.beginPath();
    ctx.rect(p.x - half, p.y - half, handleSize, handleSize);
    ctx.fillStyle = "#0b0614";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, handleSize * 0.16);
    ctx.stroke();
  };
  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((key) => drawSquare(handles[key]));

  ctx.beginPath();
  ctx.arc(handles.rotate.x, handles.rotate.y, handleSize * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.strokeStyle = "#0b0614";
  ctx.lineWidth = Math.max(2, handleSize * 0.14);
  ctx.stroke();

  ctx.restore();
  return handles;
}

/* ------------------------------------------------------------- assemblage */

/**
 * Dessine tout ce qui n'est pas du texte : fond + photo + vignettage + voile.
 *
 * Séparé du texte pour pouvoir être mis en cache côté écran : pendant qu'on
 * déplace un calque, seule la partie texte est redessinée (fluidité mobile).
 */
export function drawBase(ctx, comp, options = {}) {
  const report = { warnings: [], filterSupport: supportsCanvasFilters(ctx), imagePlacement: null };
  const canvas = {
    width: ctx.canvas?.width || options.width || THUMB_WIDTH,
    height: ctx.canvas?.height || options.height || THUMB_HEIGHT,
  };
  ctx.save();
  resetContextState(ctx, canvas);
  drawBackground(ctx, comp.background, canvas);
  report.imagePlacement = drawPhoto(ctx, comp.image, options.image ?? null, canvas, report, options);
  drawVignette(ctx, canvas.width, canvas.height, comp.image?.vignette ?? 0);
  drawScrim(ctx, comp.image?.scrim, canvas);
  /* Message d'attente derrière le texte, uniquement à l'écran. */
  if (options.editable && !options.image) drawPlaceholder(ctx, canvas);
  ctx.restore();
  return report;
}

function resetContextState(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  if ("filter" in ctx) ctx.filter = "none";
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Dessine la composition complète.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} comp   composition (voir core/composition.js)
 * @param {object} [options]
 * @param {object|null} [options.image]     image décodée à dessiner
 * @param {boolean} [options.editable]      affiche placeholder, guides, sélection
 * @param {string|null} [options.selectedId]
 * @param {boolean} [options.guides]
 * @param {number} [options.handleSize]
 * @param {Function} [options.createCanvas] fabrique de canvas (repli filtres)
 * @returns {{warnings:string[], filterSupport:boolean, layers:Array, imagePlacement:object|null}}
 */
export function drawComposition(ctx, comp, options = {}) {
  const base = drawBase(ctx, comp, options);
  const overlay = drawTextLayers(ctx, comp, options);
  return { ...base, layers: overlay.layers, selectedId: overlay.selectedId };
}

/**
 * Dessine uniquement la partie « calques texte + aides visuelles », par-dessus
 * un fond déjà en place. Utilisé à l'écran pour ne pas recalculer la photo à
 * chaque déplacement de texte (le fond est mis en cache par la vue).
 */
export function drawTextLayers(ctx, comp, options = {}) {
  const report = { layers: [], selectedId: null };
  const canvas = {
    width: ctx.canvas?.width || options.width || THUMB_WIDTH,
    height: ctx.canvas?.height || options.height || THUMB_HEIGHT,
  };

  ctx.save();
  const selectedId = options.selectedId ?? null;
  let selectedLayout = null;
  let selectedLayer = null;

  for (const layer of comp.layers ?? []) {
    const layout = drawTextLayer(ctx, layer);
    if (layout) report.layers.push({ id: layer.id, layout });
    if (options.editable && layer.id === selectedId && layer.visible !== false) {
      selectedLayer = layer;
      selectedLayout = layout;
    }
  }

  if (options.editable) {
    if (options.guides) drawGuides(ctx, canvas);
    if (selectedLayer && selectedLayout) {
      drawSelection(ctx, selectedLayer, selectedLayout, {
        handleSize: options.handleSize ?? 18,
        accent: options.accent ?? "#c084fc",
      });
      report.selectedId = selectedId;
    }
  }

  ctx.restore();
  return report;
}

/**
 * Calcule la géométrie d'un calque sans rien dessiner (pour l'interaction).
 * Réutilise un contexte de mesure : le rendu et la sélection restent alignés.
 */
export function measureLayer(ctx, layer) {
  const previousFont = ctx.font;
  const layout = layoutText(ctx, layer);
  ctx.font = previousFont;
  return layout;
}

export { rotatePoint, handlePositions };
