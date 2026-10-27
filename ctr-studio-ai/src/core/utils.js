/**
 * CTR Studio AI — utilitaires purs (aucune dépendance DOM).
 */

/* ------------------------------------------------------------------ nombres */

export const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

export const round = (v, digits = 0) => {
  const f = 10 ** digits;
  return Math.round((Number.isFinite(v) ? v : 0) * f) / f;
};

export const lerp = (a, b, t) => a + (b - a) * t;

/** Ramène un angle en degrés dans [-180 ; 180]. */
export function normalizeAngle(deg) {
  let a = Number(deg) % 360;
  if (!Number.isFinite(a)) return 0;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

export const degToRad = (deg) => (deg * Math.PI) / 180;

/* ------------------------------------------------------------------- objets */

export function deepClone(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* repli ci-dessous */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/** Fusion profonde : les tableaux sont remplacés, pas concaténés. */
export function mergeDeep(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  if (!base || typeof base !== "object") return deepClone(patch);
  if (Array.isArray(patch)) return deepClone(patch);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeDeep(out[key], value)
        : deepClone(value);
  }
  return out;
}

let idCounter = 0;
export function uid(prefix = "id") {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

/* ------------------------------------------------------------------ chaînes */

/**
 * Slug « à la française » : les accents sont repliés, les caractères non
 * alphanumériques deviennent des tirets. Utilisé pour les noms de fichiers.
 */
export function slugify(text, max = 48) {
  const base = String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return base || "miniature";
}

/** Tronque proprement en ajoutant « … ». */
export function truncate(text, max) {
  const s = String(text ?? "");
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
}

/** Compte les mots (ignore la ponctuation et les espaces multiples). */
export function countWords(text) {
  const s = String(text ?? "").trim();
  if (!s) return 0;
  return s.split(/[\s\n]+/).filter(Boolean).length;
}

/* ------------------------------------------------------------- pseudo-aléa */

/** Hachage déterministe (FNV-1a 32 bits) d'une chaîne. */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function makeRandom(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWith(random, list) {
  if (!list || list.length === 0) return undefined;
  return list[Math.floor(random() * list.length) % list.length];
}

/** Mélange Fisher-Yates déterministe (ne modifie pas le tableau d'origine). */
export function shuffleWith(random, list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* -------------------------------------------------------------------- temps */

export function debounce(fn, wait = 200) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

/** Horodatage compact lisible, ex. « 2026-10-27 15-04 ». */
export function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}`;
}

/* --------------------------------------------------------------- couleurs */

const NAMED_COLORS = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  transparent: "rgba(0,0,0,0)",
};

/**
 * Convertit n'importe quelle couleur CSS simple en {r,g,b,a} (0-255 / 0-1).
 * Retourne null si la valeur n'est pas reconnue — jamais d'exception.
 */
export function parseColor(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const named = NAMED_COLORS[raw];
  const value = named ?? raw;

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split("");
      return {
        r: parseInt(r + r, 16),
        g: parseInt(g + g, 16),
        b: parseInt(b + b, 16),
        a: a === undefined ? 1 : parseInt(a + a, 16) / 255,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const m = value.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const [r, g, b, a] = parts;
    const alpha = a === undefined ? 1 : a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
    return {
      r: clamp(parseFloat(r), 0, 255),
      g: clamp(parseFloat(g), 0, 255),
      b: clamp(parseFloat(b), 0, 255),
      a: Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1,
    };
  }
  return null;
}

export function toHex({ r, g, b }) {
  const h = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Applique un alpha (0-1) à une couleur quelconque, renvoie du rgba(). */
export function withAlpha(color, alpha) {
  const c = parseColor(color);
  if (!c) return "rgba(0,0,0,0)";
  const a = clamp(alpha, 0, 1) * c.a;
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${round(a, 3)})`;
}

/** Luminance relative WCAG (0-1) à partir de sRGB 0-255. */
export function relativeLuminance({ r, g, b }) {
  const ch = [r, g, b].map((v) => {
    const s = clamp(v, 0, 255) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Luminance perceptive rapide (Rec. 709), entrée sRGB 0-255. */
export const luma709 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Ratio de contraste WCAG entre deux couleurs (1 à 21). */
export function contrastRatio(colorA, colorB) {
  const a = parseColor(colorA);
  const b = parseColor(colorB);
  if (!a || !b) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ format */

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 o";
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${round(v, v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** « 3,5 » et non « 3.5 » : formatage numérique francophone. */
export function formatNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
