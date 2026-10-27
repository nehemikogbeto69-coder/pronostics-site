/**
 * CTR Studio AI — modèles de départ : Énergie, Focus, Éditorial.
 *
 * Un modèle définit le fond, le traitement de la photo et une série de calques
 * texte. La photo importée n'est jamais écrasée : seuls les réglages changent.
 */

import { THUMB_HEIGHT, THUMB_WIDTH } from "./constants.js";
import { createTextLayer } from "./composition.js";

export const TEMPLATES = [
  {
    id: "energie",
    name: "Énergie",
    tagline: "Impact maximal",
    description:
      "Titre énorme en capitales, contour épais et accent jaune. Pensé pour les sujets performance, argent, sport, défi.",
    preview: "linear-gradient(135deg,#4c1d95 0%,#7c3aed 45%,#db2777 100%)",
    swatches: ["#ffffff", "#fde047", "#7c3aed", "#0b0614"],
    build() {
      return {
        background: { type: "gradient", from: "#4c1d95", to: "#db2777", angle: 120, color: "#4c1d95" },
        image: {
          brightness: 103,
          contrast: 114,
          saturate: 134,
          vignette: 0.34,
          scrim: { enabled: true, from: "rgba(18,4,32,0)", to: "rgba(18,4,32,0.9)", angle: 180 },
        },
        layers: [
          {
            name: "Accroche",
            text: "NOUVEAU",
            x: 84,
            y: 88,
            fontSize: 40,
            fontWeight: 800,
            uppercase: true,
            letterSpacing: 6,
            fill: { type: "solid", color: "#ffffff" },
            stroke: { enabled: false, color: "#000000", width: 0 },
            shadow: { enabled: true, color: "rgba(0,0,0,0.55)", blur: 14, x: 0, y: 5 },
            background: {
              enabled: true,
              type: "gradient",
              from: "#7c3aed",
              to: "#ec4899",
              angle: 90,
              color: "#7c3aed",
              padX: 26,
              padY: 12,
              radius: 999,
              opacity: 1,
            },
          },
          {
            name: "Titre",
            text: "ÇA CHANGE\nTOUT",
            x: 76,
            y: 232,
            fontSize: 164,
            fontWeight: 900,
            uppercase: true,
            lineHeight: 0.94,
            letterSpacing: -2,
            rotation: -3,
            fill: { type: "gradient", from: "#ffffff", to: "#fde047", angle: 180, color: "#ffffff" },
            stroke: { enabled: true, color: "#12081f", width: 14 },
            shadow: { enabled: true, color: "rgba(0,0,0,0.6)", blur: 28, x: 0, y: 14 },
            background: { enabled: false },
          },
          {
            name: "Précision",
            text: "en 3 minutes chrono",
            x: 92,
            y: 606,
            fontSize: 54,
            fontWeight: 700,
            uppercase: false,
            fill: { type: "solid", color: "#fde047" },
            stroke: { enabled: true, color: "rgba(10,4,18,0.9)", width: 7 },
            shadow: { enabled: true, color: "rgba(0,0,0,0.5)", blur: 16, x: 0, y: 6 },
            background: { enabled: false },
          },
        ],
      };
    },
  },

  {
    id: "focus",
    name: "Focus",
    tagline: "Lisibilité d'abord",
    description:
      "Voile sombre à gauche, texte net sans contour, hiérarchie claire. Idéal tutoriels, analyses, face caméra.",
    preview: "linear-gradient(135deg,#0f172a 0%,#312e81 60%,#7c3aed 100%)",
    swatches: ["#ffffff", "#c4b5fd", "#7c3aed", "#0f172a"],
    build() {
      return {
        background: { type: "gradient", from: "#0f172a", to: "#1e1b4b", angle: 135, color: "#0f172a" },
        image: {
          brightness: 97,
          contrast: 110,
          saturate: 88,
          vignette: 0.22,
          scrim: { enabled: true, from: "rgba(8,10,20,0.93)", to: "rgba(8,10,20,0.05)", angle: 90 },
        },
        layers: [
          {
            name: "Étiquette",
            text: "MÉTHODE",
            x: 84,
            y: 150,
            fontSize: 38,
            fontWeight: 700,
            letterSpacing: 10,
            fill: { type: "solid", color: "#c4b5fd" },
            stroke: { enabled: false, color: "#000000", width: 0 },
            shadow: { enabled: false, color: "rgba(0,0,0,0.4)", blur: 10, x: 0, y: 4 },
            background: {
              enabled: true,
              type: "solid",
              color: "rgba(124,58,237,0.22)",
              padX: 22,
              padY: 10,
              radius: 8,
              opacity: 1,
            },
          },
          {
            name: "Titre",
            text: "Le sujet principal,\nsans aucun bruit",
            x: 84,
            y: 246,
            boxWidth: 660,
            wrap: true,
            align: "left",
            fontSize: 104,
            fontWeight: 800,
            uppercase: false,
            lineHeight: 1.04,
            letterSpacing: -1,
            fill: { type: "solid", color: "#ffffff" },
            stroke: { enabled: false, color: "#000000", width: 0 },
            shadow: { enabled: true, color: "rgba(0,0,0,0.55)", blur: 22, x: 0, y: 8 },
            background: { enabled: false },
          },
          {
            name: "Promesse",
            text: "3 étapes · 12 min",
            x: 84,
            y: 590,
            fontSize: 50,
            fontWeight: 600,
            uppercase: false,
            fill: { type: "solid", color: "#c4b5fd" },
            stroke: { enabled: false, color: "#000000", width: 0 },
            shadow: { enabled: true, color: "rgba(0,0,0,0.45)", blur: 16, x: 0, y: 6 },
            background: { enabled: false },
          },
        ],
      };
    },
  },

  {
    id: "editorial",
    name: "Éditorial",
    tagline: "Style magazine",
    description:
      "Serif élégante, composition centrée, tons chauds. Pour les essais, documentaires, sujets culture ou business.",
    preview: "linear-gradient(135deg,#1c1917 0%,#3f2d20 55%,#7c3aed 130%)",
    swatches: ["#fdf6e3", "#d6c7a8", "#a16207", "#171310"],
    build() {
      return {
        background: { type: "gradient", from: "#171310", to: "#2b2118", angle: 160, color: "#171310" },
        image: {
          brightness: 98,
          contrast: 120,
          saturate: 78,
          vignette: 0.3,
          scrim: { enabled: true, from: "rgba(12,9,6,0.88)", to: "rgba(12,9,6,0.35)", angle: 0 },
        },
        layers: [
          {
            name: "Surtitre",
            text: "ESSAI · 2026",
            fontFamily: "system",
            x: 90,
            y: 92,
            boxWidth: 1100,
            wrap: true,
            align: "center",
            fontSize: 34,
            fontWeight: 600,
            letterSpacing: 14,
            fill: { type: "solid", color: "#d6c7a8" },
            stroke: { enabled: false, color: "#000000", width: 0 },
            shadow: { enabled: true, color: "rgba(0,0,0,0.5)", blur: 12, x: 0, y: 4 },
            background: { enabled: false },
          },
          {
            name: "Titre",
            text: "La question que\npersonne ne pose",
            fontFamily: "georgia",
            x: 140,
            y: 214,
            boxWidth: 1000,
            wrap: true,
            align: "center",
            fontSize: 96,
            fontWeight: 700,
            uppercase: false,
            lineHeight: 1.1,
            letterSpacing: 0,
            fill: { type: "solid", color: "#fdf6e3" },
            stroke: { enabled: false, color: "#000000", width: 0 },
            shadow: { enabled: true, color: "rgba(0,0,0,0.6)", blur: 26, x: 0, y: 10 },
            background: { enabled: false },
          },
          {
            name: "Chapo",
            text: "Une analyse longue, sans sensationnalisme",
            fontFamily: "system",
            x: 190,
            y: 566,
            boxWidth: 900,
            wrap: true,
            align: "center",
            fontSize: 40,
            fontWeight: 400,
            uppercase: false,
            fill: { type: "solid", color: "rgba(253,246,227,0.82)" },
            stroke: { enabled: false, color: "#000000", width: 0 },
            shadow: { enabled: true, color: "rgba(0,0,0,0.5)", blur: 14, x: 0, y: 6 },
            background: { enabled: false },
          },
        ],
      };
    },
  },
];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

export function templateIds() {
  return TEMPLATES.map((t) => t.id);
}

/**
 * Applique un modèle à la composition : fond + réglages photo + calques.
 * La photo déjà importée (dataUrl, dimensions, recadrage manuel) est conservée.
 */
export function applyTemplate(comp, id) {
  const template = getTemplate(id);
  if (!template) return comp;
  const spec = template.build();

  Object.assign(comp.background, spec.background);

  const preserved = {
    dataUrl: comp.image.dataUrl,
    name: comp.image.name,
    naturalWidth: comp.image.naturalWidth,
    naturalHeight: comp.image.naturalHeight,
    fit: comp.image.fit,
    zoom: comp.image.zoom,
    offsetX: comp.image.offsetX,
    offsetY: comp.image.offsetY,
    flipH: comp.image.flipH,
    flipV: comp.image.flipV,
  };
  Object.assign(comp.image, spec.image, preserved);
  if (spec.image.scrim) Object.assign(comp.image.scrim, spec.image.scrim);

  comp.layers = spec.layers.map((partial) => createTextLayer(partial));
  comp.meta.template = id;
  return comp;
}

/** Composition complète basée sur un modèle (utile aux tests et à la démo). */
export function compositionFromTemplate(id, base) {
  const comp = base ?? {
    version: 1,
    canvas: { width: THUMB_WIDTH, height: THUMB_HEIGHT },
    background: { type: "gradient", color: "#140a24", from: "#2a0f4c", to: "#0b0614", angle: 135 },
    image: {},
    layers: [],
    fonts: [],
    meta: {},
  };
  return applyTemplate(comp, id);
}
