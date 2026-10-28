/**
 * CTR Studio AI — export PNG.
 *
 * Principe : la composition est redessinée sur un canvas dédié de 1280×720
 * (jamais celui de l'écran), encodée en PNG, puis **vérifiée au niveau des
 * octets** avant d'être annoncée comme réussie. Aucun succès simulé : si
 * l'encodage échoue, une ExportError est levée avec la raison exacte.
 */

import { THUMB_HEIGHT, THUMB_WIDTH, YOUTUBE_MAX_BYTES } from "../core/constants.js";
import { drawComposition, WARNING } from "../core/renderer.js";
import { ensureFontsReady } from "../core/fonts.js";
import { hasIend, parsePngIhdr, toBytes, verifyDecodable, verifyPngBytes } from "./png.js";
import { formatBytes, slugify, timestamp } from "../core/utils.js";

export class ExportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ExportError";
    this.details = details;
  }
}

/** Fabrique un canvas : injectable pour les tests Node, sinon DOM. */
export function createCanvasElement(width, height, factory) {
  if (typeof factory === "function") return factory(width, height);
  if (typeof document === "undefined") {
    throw new ExportError("Aucun canvas disponible dans cet environnement.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Encode un canvas en octets PNG, quelle que soit l'API disponible
 * (toBlob navigateur, encode/toBuffer Node, toDataURL en dernier recours).
 */
export async function canvasToPngBytes(canvas) {
  if (!canvas) throw new ExportError("Canvas d'export absent.");

  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new ExportError("Encodage PNG trop long (délai dépassé)."));
        }
      }, 20000);
      try {
        canvas.toBlob((result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(result);
        }, "image/png");
      } catch (err) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(new ExportError(`toBlob a échoué : ${err?.message ?? err}`));
        }
      }
    });
    if (!blob) {
      throw new ExportError(
        "Le navigateur a refusé d'encoder le PNG (toBlob → null). Cela arrive si le canvas est vide ou si la mémoire manque.",
      );
    }
    return toBytes(await blob.arrayBuffer());
  }

  if (typeof canvas.encode === "function") {
    const buf = await canvas.encode("png");
    return toBytes(buf);
  }

  if (typeof canvas.toBuffer === "function") {
    return toBytes(canvas.toBuffer("image/png"));
  }

  if (typeof canvas.toDataURL === "function") {
    const url = canvas.toDataURL("image/png");
    if (!url.startsWith("data:image/png")) {
      throw new ExportError("toDataURL n'a pas produit de PNG.");
    }
    return base64ToBytes(url.split(",")[1] ?? "");
  }

  throw new ExportError("Aucune méthode d'encodage PNG disponible.");
}

function base64ToBytes(base64) {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return toBytes(Buffer.from(base64, "base64"));
}

/** Nom de fichier proposé : lisible, sans accent, horodaté. */
export function buildFilename(comp, { base = "", suffix = "" } = {}) {
  const seed = base || comp?.meta?.title || comp?.meta?.topic || "miniature-youtube";
  const parts = [slugify(seed, 40), "1280x720", timestamp()];
  if (suffix) parts.splice(1, 0, slugify(suffix, 20));
  return `${parts.filter(Boolean).join("-")}.png`;
}

/**
 * Rend la composition dans un canvas neuf et produit le PNG vérifié.
 *
 * @returns {Promise<{bytes:Uint8Array, blob:Blob|null, info:object, decoded:object, report:object, sizeBytes:number, overLimit:boolean}>}
 */
export async function exportPng(comp, options = {}) {
  const width = options.width || THUMB_WIDTH;
  const height = options.height || THUMB_HEIGHT;
  const canvas = createCanvasElement(width, height, options.canvasFactory);
  /* `alpha:false` donne un PNG opaque, plus léger — la miniature a toujours un
     fond plein. Repli sur un contexte standard si l'option est refusée. */
  const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
  if (!ctx) {
    throw new ExportError("Contexte 2D indisponible : le canvas d'export n'a pas pu être initialisé.");
  }

  /* Les polices doivent être réellement chargées avant de figer les pixels. */
  await ensureFontsReady(comp);

  const report = drawComposition(ctx, comp, {
    image: options.image ?? null,
    editable: false,
    createCanvas: options.canvasFactory,
  });

  const bytes = await canvasToPngBytes(canvas);
  const verification = verifyPngBytes(bytes, { width, height });
  if (!verification.ok) {
    throw new ExportError(verification.errors.join(" "), { bytes, report, verification });
  }

  const decoded = await verifyDecodable(bytes, { decode: options.decode });
  if (decoded.checked && !decoded.ok) {
    throw new ExportError(decoded.errors.join(" "), { bytes, report, verification, decoded });
  }

  const info = parsePngIhdr(bytes);
  const blob = typeof Blob === "function" ? new Blob([bytes], { type: "image/png" }) : null;

  return {
    bytes,
    blob,
    info,
    decoded,
    report,
    sizeBytes: bytes.length,
    complete: hasIend(bytes),
    overLimit: bytes.length > YOUTUBE_MAX_BYTES,
    sizeLabel: formatBytes(bytes.length),
  };
}

/** Traduit les avertissements du moteur de rendu en messages français. */
export function describeWarnings(warnings = []) {
  const messages = [];
  if (warnings.includes(WARNING.FILTER_FALLBACK)) {
    messages.push(
      "Votre navigateur ne gère pas les filtres canvas : les réglages ont été appliqués pixel par pixel (résultat identique, export un peu plus long).",
    );
  }
  if (warnings.includes(WARNING.BLUR_UNSUPPORTED)) {
    messages.push("Le flou n'a pas pu être appliqué sur ce navigateur (réglage ignoré à l'export).");
  }
  if (warnings.includes(WARNING.IMAGE_TAINED)) {
    messages.push("Image protégée (canvas « tainted ») : réglages non appliqués à l'export.");
  }
  return messages;
}
