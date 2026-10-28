/**
 * CTR Studio AI — modèle de données d'une composition (miniature).
 *
 * Une composition est un objet JSON sérialisable : fond, photo, calques texte.
 * Toutes les valeurs sont bornées par `sanitizeComposition` afin qu'un projet
 * importé ou un état corrompu ne puisse jamais casser le rendu.
 */

import { LIMITS, PROJECT_VERSION, THUMB_HEIGHT, THUMB_WIDTH } from "./constants.js";
import { clamp, deepClone, mergeDeep, normalizeAngle, round, uid } from "./utils.js";
import { DEFAULT_FONT_ID, fontStackById } from "./fonts.js";

const ALIGNS = ["left", "center", "right"];
const FITS = ["cover", "contain", "stretch"];
const FILL_TYPES = ["solid", "gradient"];
const BACKGROUND_TYPES = ["solid", "gradient"];
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/* ------------------------------------------------------------ calque texte */

export function createTextLayer(partial = {}) {
  const fontFamily = partial.fontFamily || DEFAULT_FONT_ID;
  const layer = {
    id: partial.id || uid("txt"),
    type: "text",
    name: partial.name || "Texte",
    text: partial.text ?? "VOTRE TEXTE",

    /* géométrie (unités = pixels de la miniature 1280×720) */
    x: partial.x ?? 90,
    y: partial.y ?? 420,
    boxWidth: partial.boxWidth ?? 0, // 0 = largeur automatique (pas de retour à la ligne)
    wrap: partial.wrap ?? false,
    align: partial.align ?? "left",
    rotation: partial.rotation ?? 0,

    /* typographie */
    fontFamily,
    fontStack: partial.fontStack || fontStackById(fontFamily),
    fontSize: partial.fontSize ?? 96,
    fontWeight: partial.fontWeight ?? 900,
    italic: partial.italic ?? false,
    uppercase: partial.uppercase ?? true,
    letterSpacing: partial.letterSpacing ?? 0,
    lineHeight: partial.lineHeight ?? 1.05,

    /* apparence */
    fill: partial.fill ?? {
      type: "solid",
      color: "#ffffff",
      from: "#ffffff",
      to: "#a855f7",
      angle: 90,
    },
    stroke: partial.stroke ?? { enabled: true, color: "#0b0614", width: 10 },
    shadow: partial.shadow ?? {
      enabled: true,
      color: "rgba(0,0,0,0.65)",
      blur: 24,
      x: 0,
      y: 8,
    },
    background: partial.background ?? {
      enabled: false,
      type: "solid",
      color: "#7c3aed",
      from: "#7c3aed",
      to: "#ec4899",
      angle: 90,
      padX: 28,
      padY: 14,
      radius: 18,
      opacity: 1,
    },

    opacity: partial.opacity ?? 1,
    visible: partial.visible ?? true,
  };
  return sanitizeLayer(layer);
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function num(value, limits, fallback) {
  const n = Number(value);
  const base = Number.isFinite(n) ? n : fallback;
  return round(clamp(base, limits.min, limits.max), 2);
}

/** Normalise un calque texte (valeurs manquantes, hors bornes, mauvais type). */
export function sanitizeLayer(input) {
  const src = input && typeof input === "object" ? input : {};
  const fontFamily =
    typeof src.fontFamily === "string" && src.fontFamily ? src.fontFamily : DEFAULT_FONT_ID;
  const fontStack =
    typeof src.fontStack === "string" && src.fontStack.trim()
      ? src.fontStack
      : fontStackById(fontFamily) || FONT_FALLBACK_STACK;

  const fill = src.fill ?? {};
  const stroke = src.stroke ?? {};
  const shadow = src.shadow ?? {};
  const bg = src.background ?? {};

  const layer = {
    id: typeof src.id === "string" && src.id ? src.id : uid("txt"),
    type: "text",
    name: typeof src.name === "string" && src.name ? src.name.slice(0, 40) : "Texte",
    text: String(src.text ?? "").slice(0, 400),

    x: round(Number.isFinite(+src.x) ? +src.x : 0, 1),
    y: round(Number.isFinite(+src.y) ? +src.y : 0, 1),
    boxWidth: num(src.boxWidth, LIMITS.boxWidth, 0),
    wrap: Boolean(src.wrap),
    align: oneOf(src.align, ALIGNS, "left"),
    rotation: round(normalizeAngle(src.rotation ?? 0), 1),

    fontFamily,
    fontStack: typeof fontStack === "string" ? fontStack : FONT_FALLBACK_STACK,
    fontSize: num(src.fontSize, LIMITS.fontSize, 96),
    fontWeight: oneOf(Number(src.fontWeight), FONT_WEIGHTS, 900),
    italic: Boolean(src.italic),
    uppercase: Boolean(src.uppercase ?? true),
    letterSpacing: num(src.letterSpacing, LIMITS.letterSpacing, 0),
    lineHeight: num(src.lineHeight, LIMITS.lineHeight, 1.05),

    fill: {
      type: oneOf(fill.type, FILL_TYPES, "solid"),
      color: strColor(fill.color, "#ffffff"),
      from: strColor(fill.from, "#ffffff"),
      to: strColor(fill.to, "#a855f7"),
      angle: round(normalizeAngle(fill.angle ?? 90), 1),
    },
    stroke: {
      enabled: Boolean(stroke.enabled),
      color: strColor(stroke.color, "#0b0614"),
      width: num(stroke.width, LIMITS.strokeWidth, 10),
    },
    shadow: {
      enabled: Boolean(shadow.enabled ?? true),
      color: strColor(shadow.color, "rgba(0,0,0,0.65)"),
      blur: num(shadow.blur, LIMITS.shadowBlur, 24),
      x: num(shadow.x, LIMITS.shadowOffset, 0),
      y: num(shadow.y, LIMITS.shadowOffset, 8),
    },
    background: {
      enabled: Boolean(bg.enabled),
      type: oneOf(bg.type, BACKGROUND_TYPES, "solid"),
      color: strColor(bg.color, "#7c3aed"),
      from: strColor(bg.from, "#7c3aed"),
      to: strColor(bg.to, "#ec4899"),
      angle: round(normalizeAngle(bg.angle ?? 90), 1),
      padX: num(bg.padX ?? 28, { min: 0, max: 200 }, 28),
      padY: num(bg.padY ?? 14, { min: 0, max: 200 }, 14),
      radius: num(bg.radius ?? 18, { min: 0, max: 300 }, 18),
      opacity: num(bg.opacity ?? 1, LIMITS.opacity, 1),
    },

    opacity: num(src.opacity, LIMITS.opacity, 1),
    visible: src.visible === undefined ? true : Boolean(src.visible),
  };

  /* Sans retour à la ligne, la largeur de boîte n'a pas de sens. */
  if (!layer.wrap && layer.boxWidth > 0) layer.boxWidth = 0;
  if (layer.wrap && layer.boxWidth < 120) layer.boxWidth = Math.round(THUMB_WIDTH * 0.6);
  return layer;
}

const FONT_FALLBACK_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function strColor(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : fallback;
}

/* ------------------------------------------------------------- composition */

export function defaultImageState() {
  return {
    dataUrl: null,
    name: "",
    naturalWidth: 0,
    naturalHeight: 0,
    fit: "cover",
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    flipH: false,
    flipV: false,
    brightness: 100,
    contrast: 100,
    saturate: 100,
    blur: 0,
    vignette: 0.15,
    scrim: {
      enabled: true,
      from: "rgba(5,2,12,0)",
      to: "rgba(5,2,12,0.85)",
      angle: 180,
    },
  };
}

export function defaultBackground() {
  return {
    type: "gradient",
    color: "#140a24",
    from: "#2a0f4c",
    to: "#0b0614",
    angle: 135,
  };
}

export function createComposition(partial = {}) {
  const comp = mergeDeep(
    {
      version: PROJECT_VERSION,
      canvas: { width: THUMB_WIDTH, height: THUMB_HEIGHT },
      background: defaultBackground(),
      image: defaultImageState(),
      layers: [],
      fonts: [],
      meta: { title: "", topic: "", createdAt: new Date().toISOString() },
    },
    partial,
  );
  if (!Array.isArray(comp.layers) || comp.layers.length === 0) {
    comp.layers = [
      createTextLayer({
        text: "VOTRE TEXTE",
        x: 84,
        y: 404,
        fontSize: 112,
        rotation: -2,
      }),
    ];
  }
  return sanitizeComposition(comp);
}

/** Normalisation complète — utilisée à la création, à l'import et au chargement. */
export function sanitizeComposition(input) {
  const src = input && typeof input === "object" ? input : {};
  const img = src.image ?? {};
  const bg = src.background ?? {};
  const scrim = img.scrim ?? {};
  const meta = src.meta ?? {};

  const comp = {
    version: PROJECT_VERSION,
    canvas: { width: THUMB_WIDTH, height: THUMB_HEIGHT },
    background: {
      type: oneOf(bg.type, BACKGROUND_TYPES, "gradient"),
      color: strColor(bg.color, "#140a24"),
      from: strColor(bg.from, "#2a0f4c"),
      to: strColor(bg.to, "#0b0614"),
      angle: round(normalizeAngle(bg.angle ?? 135), 1),
    },
    image: {
      dataUrl: typeof img.dataUrl === "string" && img.dataUrl.startsWith("data:") ? img.dataUrl : null,
      name: typeof img.name === "string" ? img.name.slice(0, 120) : "",
      naturalWidth: Math.max(0, Math.round(+img.naturalWidth || 0)),
      naturalHeight: Math.max(0, Math.round(+img.naturalHeight || 0)),
      fit: oneOf(img.fit, FITS, "cover"),
      zoom: num(img.zoom ?? 1, LIMITS.zoom, 1),
      offsetX: round(clamp(+img.offsetX || 0, -THUMB_WIDTH, THUMB_WIDTH), 1),
      offsetY: round(clamp(+img.offsetY || 0, -THUMB_HEIGHT, THUMB_HEIGHT), 1),
      flipH: Boolean(img.flipH),
      flipV: Boolean(img.flipV),
      brightness: num(img.brightness ?? 100, LIMITS.filterPercent, 100),
      contrast: num(img.contrast ?? 100, LIMITS.filterPercent, 100),
      saturate: num(img.saturate ?? 100, LIMITS.filterPercent, 100),
      blur: num(img.blur ?? 0, LIMITS.blurPx, 0),
      vignette: num(img.vignette ?? 0, LIMITS.vignette, 0),
      scrim: {
        enabled: Boolean(scrim.enabled),
        from: strColor(scrim.from, "rgba(5,2,12,0)"),
        to: strColor(scrim.to, "rgba(5,2,12,0.85)"),
        angle: round(normalizeAngle(scrim.angle ?? 180), 1),
      },
    },
    layers: (Array.isArray(src.layers) ? src.layers : [])
      .filter((l) => l && typeof l === "object")
      .slice(0, 12)
      .map(sanitizeLayer),
    fonts: (Array.isArray(src.fonts) ? src.fonts : [])
      .filter((f) => f && typeof f.family === "string")
      .slice(0, 8)
      .map((f) => ({
        id: typeof f.id === "string" ? f.id : `custom:${f.family}`,
        kind: "custom",
        family: String(f.family).slice(0, 60),
        label: typeof f.label === "string" ? f.label.slice(0, 80) : `${f.family} (importée)`,
        stack:
          typeof f.stack === "string" && f.stack
            ? f.stack
            : `"${String(f.family).slice(0, 60)}", system-ui, sans-serif`,
        dataUrl: typeof f.dataUrl === "string" && f.dataUrl.startsWith("data:") ? f.dataUrl : null,
        fileName: typeof f.fileName === "string" ? f.fileName.slice(0, 120) : "",
      })),
    meta: {
      title: String(meta.title ?? "").slice(0, 200),
      topic: String(meta.topic ?? "").slice(0, 300),
      createdAt:
        typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString(),
    },
  };
  return comp;
}

/* ------------------------------------------------------------ opérations */

export function findLayer(comp, id) {
  return comp.layers.find((l) => l.id === id) ?? null;
}

export function findLayerIndex(comp, id) {
  return comp.layers.findIndex((l) => l.id === id);
}

/** Ajoute un calque texte et le renvoie. */
export function addTextLayer(comp, partial = {}) {
  const layer = createTextLayer(partial);
  comp.layers.push(layer);
  if (comp.layers.length > 12) comp.layers.shift();
  return layer;
}

export function removeLayer(comp, id) {
  const index = findLayerIndex(comp, id);
  if (index < 0) return false;
  comp.layers.splice(index, 1);
  return true;
}

/** Applique un patch (fusion profonde) puis renormalise le calque. */
export function updateLayer(comp, id, patch) {
  const index = findLayerIndex(comp, id);
  if (index < 0) return null;
  const merged = mergeDeep(comp.layers[index], patch || {});
  /* Changer de police doit mettre à jour la pile de rendu. */
  if (patch && typeof patch.fontFamily === "string" && !patch.fontStack) {
    merged.fontStack = fontStackById(patch.fontFamily);
  }
  const custom = (comp.fonts || []).find((f) => f.id === merged.fontFamily);
  if (custom) merged.fontStack = custom.stack;
  comp.layers[index] = sanitizeLayer(merged);
  return comp.layers[index];
}

export function duplicateLayer(comp, id) {
  const layer = findLayer(comp, id);
  if (!layer) return null;
  const copy = sanitizeLayer({
    ...deepClone(layer),
    id: uid("txt"),
    name: `${layer.name} (copie)`,
    x: layer.x + 36,
    y: layer.y + 36,
  });
  const index = findLayerIndex(comp, id);
  comp.layers.splice(index + 1, 0, copy);
  return copy;
}

/** `direction` : 'up' | 'down' | 'top' | 'bottom'. */
export function reorderLayer(comp, id, direction) {
  const index = findLayerIndex(comp, id);
  if (index < 0) return false;
  const [layer] = comp.layers.splice(index, 1);
  let target = index;
  if (direction === "up") target = Math.min(comp.layers.length, index + 1);
  else if (direction === "down") target = Math.max(0, index - 1);
  else if (direction === "top") target = comp.layers.length;
  else if (direction === "bottom") target = 0;
  comp.layers.splice(target, 0, layer);
  return true;
}

/* --------------------------------------------------------- (dé)sérialisation */

/** Projet JSON partageable : contenu seul, sans état d'interface. */
export function serializeProject(comp) {
  return {
    app: "ctr-studio-ai",
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    canvas: { ...comp.canvas },
    background: deepClone(comp.background),
    image: deepClone(comp.image),
    layers: comp.layers.map((l) => deepClone(l)),
    fonts: comp.fonts.map((f) => deepClone(f)),
    meta: deepClone(comp.meta),
  };
}

/**
 * Reconstruit une composition depuis un projet JSON.
 * Lève une Error explicite (message en français) si le contenu est invalide.
 */
export function deserializeProject(data) {
  let parsed = data;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error("Fichier projet illisible : ce n'est pas un JSON valide.");
    }
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Fichier projet invalide.");
  }
  if (parsed.app && parsed.app !== "ctr-studio-ai") {
    throw new Error("Ce fichier n'a pas été produit par CTR Studio AI.");
  }
  if (!Array.isArray(parsed.layers)) {
    throw new Error("Projet incomplet : aucun calque trouvé.");
  }
  return sanitizeComposition(parsed);
}
