/**
 * CTR Studio AI — mesures d'image (heuristiques locales, 100 % transparentes).
 *
 * Tout est calculé à partir des pixels fournis : aucune donnée YouTube, aucun
 * serveur, aucune prédiction de taux de clic. Chaque mesure renvoie la valeur
 * brute ET sa version normalisée, afin que l'interface puisse expliquer d'où
 * vient chaque score (voir features/analysis/report.js).
 */

import { clamp, round } from "../../core/utils.js";

/** Taille d'analyse par défaut : assez précise, rapide sur mobile. */
export const ANALYSIS_WIDTH = 320;
export const ANALYSIS_HEIGHT = 180;
const BLOCK = 16;

const HUE_LABELS = [
  "rouge",
  "orange",
  "jaune",
  "jaune-vert",
  "vert",
  "vert-bleu",
  "cyan",
  "bleu",
  "bleu-violet",
  "violet",
  "magenta",
  "rose",
];

/* LUT de linéarisation sRGB (WCAG) : évite 3 Math.pow par pixel. */
const LINEAR_LUT = (() => {
  const lut = new Float64Array(256);
  for (let v = 0; v < 256; v += 1) {
    const s = v / 255;
    lut[v] = s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }
  return lut;
})();

/** Zones candidates pour poser un titre (fractions de la miniature). */
export const TEXT_ZONES = [
  { id: "bottom-left", label: "Bas gauche", box: [0.04, 0.6, 0.6, 0.34] },
  { id: "bottom-center", label: "Bas centré", box: [0.18, 0.6, 0.64, 0.34] },
  { id: "top-left", label: "Haut gauche", box: [0.04, 0.06, 0.54, 0.26] },
  { id: "top-right", label: "Haut droit", box: [0.42, 0.06, 0.54, 0.26] },
  { id: "center", label: "Centre", box: [0.18, 0.3, 0.64, 0.4] },
  { id: "left-band", label: "Bande gauche", box: [0.03, 0.16, 0.42, 0.68] },
];

/* -------------------------------------------------------------- utilitaires */

function percentileFromHistogram(histogram, total, p) {
  const target = clamp(p, 0, 1) * total;
  let acc = 0;
  for (let v = 0; v < histogram.length; v += 1) {
    acc += histogram[v];
    if (acc >= target) return v;
  }
  return histogram.length - 1;
}

function contrastRatioFromLuminance(luminance, textLuminance) {
  const hi = Math.max(luminance, textLuminance);
  const lo = Math.min(luminance, textLuminance);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE_LUMINANCE = 1;
const BLACK_LUMINANCE = 0;

/* ------------------------------------------------------------- analyse */

/**
 * @param {{data:Uint8ClampedArray|Uint8Array, width:number, height:number}} source
 * @returns {object} mesures brutes
 */
export function analyzePixels(source) {
  if (!source || typeof source !== "object") {
    throw new Error("Analyse impossible : aucune donnée pixel valide.");
  }
  const { data, width, height } = source;
  if (!data || !width || !height || data.length < width * height * 4) {
    throw new Error("Analyse impossible : aucune donnée pixel valide.");
  }

  const count = width * height;
  const luma = new Float32Array(count);
  const relLum = new Float32Array(count);
  const sat = new Float32Array(count);
  const hueHist = new Float64Array(12);
  const histogram = new Uint32Array(256);

  let sumLuma = 0;
  let sumSat = 0;
  let satSamples = 0;

  for (let i = 0, p = 0; i < data.length && p < count; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[p] = y;
    sumLuma += y;
    histogram[Math.round(y)] += 1;

    relLum[p] = 0.2126 * LINEAR_LUT[r] + 0.7152 * LINEAR_LUT[g] + 0.0722 * LINEAR_LUT[b];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const s = max === 0 ? 0 : delta / max;
    sat[p] = s;
    if (max > 24) {
      sumSat += s;
      satSamples += 1;
      if (delta > 0) {
        let h;
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
        hueHist[Math.min(11, Math.floor(h / 30))] += s * (max / 255);
      }
    }
  }

  const meanLuma = sumLuma / count;
  let variance = 0;
  for (let p = 0; p < count; p += 1) {
    const d = luma[p] - meanLuma;
    variance += d * d;
  }
  const stdLuma = Math.sqrt(variance / count);

  /* Énergie de contour (gradient de luminance) — proxy de la netteté et du « bruit visuel ». */
  const gradient = new Float32Array(count);
  let sumGrad = 0;
  let gradSamples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const gx = luma[p + 1] - luma[p - 1];
      const gy = luma[p + width] - luma[p - width];
      const mag = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 180);
      gradient[p] = mag;
      sumGrad += mag;
      gradSamples += 1;
    }
  }
  const meanGradient = gradSamples ? sumGrad / gradSamples : 0;

  let clippedDark = 0;
  let clippedBright = 0;
  for (let v = 0; v < 8; v += 1) clippedDark += histogram[v];
  for (let v = 248; v < 256; v += 1) clippedBright += histogram[v];

  const p5 = percentileFromHistogram(histogram, count, 0.05);
  const p50 = percentileFromHistogram(histogram, count, 0.5);
  const p95 = percentileFromHistogram(histogram, count, 0.95);

  /* Blocs : variance locale + énergie. Sert aux zones libres et au bruit visuel. */
  const blocksX = Math.max(1, Math.floor(width / BLOCK));
  const blocksY = Math.max(1, Math.floor(height / BLOCK));
  const blocks = [];
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      let sum = 0;
      let sumSq = 0;
      let energy = 0;
      let n = 0;
      let relSum = 0;
      const relValues = [];
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y += 1) {
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x += 1) {
          const p = y * width + x;
          sum += luma[p];
          sumSq += luma[p] * luma[p];
          energy += gradient[p];
          relSum += relLum[p];
          relValues.push(relLum[p]);
          n += 1;
        }
      }
      if (!n) continue;
      const mean = sum / n;
      const varLocal = Math.max(0, sumSq / n - mean * mean);
      relValues.sort((a, b) => a - b);
      blocks.push({
        bx,
        by,
        mean,
        variance: varLocal,
        std: Math.sqrt(varLocal),
        energy: energy / n,
        relMedian: relValues[Math.floor(relValues.length / 2)] ?? 0,
        relMean: relSum / n,
      });
    }
  }

  const varianceThreshold = 260; // ≈ écart-type 16/255 : zone considérée « plate »
  const flatBlocks = blocks.filter((b) => b.variance < varianceThreshold).length;
  const negativeSpace = blocks.length ? flatBlocks / blocks.length : 0;

  /* Grille des tiers : poids visuel par cellule (contour + saturation + écart au gris). */
  const cells = Array.from({ length: 9 }, () => ({ energy: 0, saturation: 0, weight: 0 }));
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(2, Math.floor((y / height) * 3));
    for (let x = 0; x < width; x += 1) {
      const col = Math.min(2, Math.floor((x / width) * 3));
      const p = y * width + x;
      const cell = cells[row * 3 + col];
      cell.energy += gradient[p];
      cell.saturation += sat[p];
    }
  }
  const perCell = (width * height) / 9;
  let totalWeight = 0;
  for (const cell of cells) {
    cell.energy /= perCell;
    cell.saturation /= perCell;
    cell.weight = cell.energy * 0.7 + cell.saturation * 0.3;
    totalWeight += cell.weight;
  }
  for (const cell of cells) cell.share = totalWeight ? cell.weight / totalWeight : 1 / 9;

  const left = cells[0].share + cells[3].share + cells[6].share;
  const right = cells[2].share + cells[5].share + cells[8].share;
  const top = cells[0].share + cells[1].share + cells[2].share;
  const bottom = cells[6].share + cells[7].share + cells[8].share;

  /* Centroïde du poids visuel → point d'attention principal. */
  let cx = 0;
  let cy = 0;
  cells.forEach((cell, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    cx += (col + 0.5) / 3 * cell.share;
    cy += (row + 0.5) / 3 * cell.share;
  });

  /* Proximité avec les intersections des tiers (points forts de la composition). */
  const thirdPoints = [
    { x: 1 / 3, y: 1 / 3 },
    { x: 2 / 3, y: 1 / 3 },
    { x: 1 / 3, y: 2 / 3 },
    { x: 2 / 3, y: 2 / 3 },
  ];
  const thirdsDistance = Math.min(...thirdPoints.map((pt) => Math.hypot(pt.x - cx, pt.y - cy)));

  /* Encombrement des bords (zone rognée par certains lecteurs / interfaces). */
  const margin = Math.round(Math.min(width, height) * 0.06);
  let borderEnergy = 0;
  let borderCount = 0;
  let innerEnergy = 0;
  let innerCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const isBorder = x < margin || y < margin || x >= width - margin || y >= height - margin;
      if (isBorder) {
        borderEnergy += gradient[p];
        borderCount += 1;
      } else {
        innerEnergy += gradient[p];
        innerCount += 1;
      }
    }
  }
  const borderMean = borderCount ? borderEnergy / borderCount : 0;
  const innerMean = innerCount ? innerEnergy / innerCount : 0;
  const borderClutter = innerMean > 0 ? borderMean / innerMean : borderMean;

  /* Dominante couleur. */
  let hueTotal = 0;
  for (let i = 0; i < 12; i += 1) hueTotal += hueHist[i];
  let dominantHueIndex = 0;
  let dominantHueShare = 0;
  const hueShares = Array.from({ length: 12 }, (_, i) => (hueTotal ? hueHist[i] / hueTotal : 0));
  hueShares.forEach((share, i) => {
    if (share > dominantHueShare) {
      dominantHueShare = share;
      dominantHueIndex = i;
    }
  });
  const hueDiversity = hueShares.filter((s) => s > 0.08).length;

  /* Zones de texte : lisibilité estimée pour un texte blanc ou sombre. */
  const zones = TEXT_ZONES.map((zone) => {
    const [zx, zy, zw, zh] = zone.box;
    const x0 = Math.round(zx * width);
    const y0 = Math.round(zy * height);
    const x1 = Math.min(width - 1, Math.round((zx + zw) * width));
    const y1 = Math.min(height - 1, Math.round((zy + zh) * height));
    const values = [];
    let energySum = 0;
    let lumaSum = 0;
    let n = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const p = y * width + x;
        values.push(relLum[p]);
        energySum += gradient[p];
        lumaSum += luma[p];
        n += 1;
      }
    }
    if (!n) {
      return { ...zone, score: 0, busy: 0, contrastWhite: 1, contrastBlack: 1, bestContrast: 1, bestColor: "#ffffff", medianLuma: 0, lumaStd: 0, uniformity: 0 };
    }
    values.sort((a, b) => a - b);
    const medianRel = values[Math.floor(values.length / 2)];
    const q1 = values[Math.floor(values.length * 0.25)];
    const q3 = values[Math.floor(values.length * 0.75)];
    const spread = q3 - q1; // écart interquartile : homogénéité du fond
    const meanLumaZone = lumaSum / n;
    let varZone = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = luma[y * width + x] - meanLumaZone;
        varZone += d * d;
      }
    }
    const stdZone = Math.sqrt(varZone / n);

    const contrastWhite = contrastRatioFromLuminance(medianRel, WHITE_LUMINANCE);
    const contrastBlack = contrastRatioFromLuminance(medianRel, BLACK_LUMINANCE);
    const useWhite = contrastWhite >= contrastBlack;
    const bestContrast = Math.max(contrastWhite, contrastBlack);
    const busy = energySum / n;
    const uniformity = clamp(1 - spread / 0.45, 0, 1);

    return {
      ...zone,
      medianLuma: meanLumaZone,
      lumaStd: stdZone,
      relMedian: medianRel,
      spread,
      busy,
      uniformity,
      contrastWhite,
      contrastBlack,
      bestColor: useWhite ? "#ffffff" : "#0b0614",
      bestContrast,
    };
  });

  for (const zone of zones) {
    /* Score WCAG : 4.5 = minimum lisible, 7 = confortable, 12+ = aucun intérêt à monter. */
    const contrastScore = clamp((zone.bestContrast - 1.6) / (7 - 1.6), 0, 1);
    const busyScore = clamp(1 - zone.busy / 0.22, 0, 1);
    zone.score = clamp(contrastScore * 0.62 + busyScore * 0.24 + zone.uniformity * 0.14, 0, 1);
  }
  zones.sort((a, b) => b.score - a.score);

  return {
    width,
    height,
    pixels: count,
    luminance: {
      mean: meanLuma,
      std: stdLuma,
      p5,
      p50,
      p95,
      dynamicRange: p95 - p5,
      clippedDarkShare: clippedDark / count,
      clippedBrightShare: clippedBright / count,
      rmsContrast: stdLuma / 255,
    },
    edges: {
      mean: meanGradient,
      sharpness: clamp(meanGradient / 0.22, 0, 1),
    },
    color: {
      saturationMean: satSamples ? sumSat / satSamples : 0,
      dominantHueIndex,
      dominantHueLabel: HUE_LABELS[dominantHueIndex],
      dominantHueShare,
      hueShares,
      hueDiversity,
      warm: [0, 1, 2, 10, 11].includes(dominantHueIndex),
    },
    grid: {
      cells,
      leftRightBalance: Math.abs(left - right) / Math.max(1e-6, left + right),
      topBottomBalance: Math.abs(top - bottom) / Math.max(1e-6, top + bottom),
      centerWeight: cells[4].share,
      left,
      right,
      top,
      bottom,
    },
    composition: {
      focus: { x: cx, y: cy },
      thirdsDistance,
      thirdsProximity: clamp(1 - thirdsDistance / 0.35, 0, 1),
      borderClutter,
      negativeSpace,
      flatBlocks,
      blockCount: blocks.length,
    },
    blocks,
    zones,
  };
}

/* ----------------------------------------------------------- rapport brut */

/** Résumé chiffré destiné à la carte de résultat (valeurs brutes arrondies). */
export function metricsSummary(metrics) {
  return {
    contraste: round(metrics.luminance.rmsContrast * 100, 1),
    plageDynamique: round(metrics.luminance.dynamicRange, 0),
    nettete: round(metrics.edges.sharpness * 100, 0),
    saturation: round(metrics.color.saturationMean * 100, 0),
    zoneLibre: round(metrics.composition.negativeSpace * 100, 0),
    meilleureZone: metrics.zones[0]?.label ?? "—",
    contrasteTexte: round(metrics.zones[0]?.bestContrast ?? 1, 1),
    bords: round(metrics.composition.borderClutter, 2),
  };
}

export { HUE_LABELS };
