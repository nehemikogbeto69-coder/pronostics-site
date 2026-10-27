/**
 * CTR Studio AI — import d'image (navigateur uniquement).
 *
 * Trois chemins de décodage, du plus fiable au plus compatible :
 *   1. `createImageBitmap` avec orientation EXIF corrigée ;
 *   2. `createImageBitmap` sans options ;
 *   3. `<img>` + `URL.createObjectURL` (universel, y compris vieux Android).
 *
 * Chaque échec renvoie un message en français expliquant quoi faire.
 */

import {
  ACCEPTED_IMAGE_TYPES,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_DIMENSION,
} from "../core/constants.js";

export class ImportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ImportError";
    this.details = details;
  }
}

const PERSIST_MAX_SOURCE_BYTES = 1.5 * 1024 * 1024;
const PERSIST_MAX_DIMENSION = 1600;
const PERSIST_MAX_DATAURL_BYTES = 2.6 * 1024 * 1024;

/** Contrôle du fichier avant tout décodage (rapide, messages clairs). */
export function validateImageFile(file) {
  if (!file) return { ok: false, error: "Aucun fichier reçu." };
  const type = String(file.type || "").toLowerCase();
  const isImage = type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name || "");
  if (!isImage) {
    return {
      ok: false,
      error: `« ${file.name || "fichier"} » n'est pas une image (type : ${type || "inconnu"}).`,
    };
  }
  if (type && !ACCEPTED_IMAGE_TYPES.includes(type)) {
    return {
      ok: false,
      error: `Format ${type} non géré. Utilisez PNG, JPEG, WebP, GIF, AVIF ou BMP.`,
    };
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return {
      ok: false,
      error: `Fichier trop lourd (${Math.round(file.size / 1048576)} Mo). Maximum : ${Math.round(
        IMPORT_MAX_BYTES / 1048576,
      )} Mo.`,
    };
  }
  if (file.size === 0) return { ok: false, error: "Fichier vide." };
  return { ok: true };
}

export function sourceDimensions(drawable) {
  return {
    width: drawable?.naturalWidth || drawable?.width || 0,
    height: drawable?.naturalHeight || drawable?.height || 0,
  };
}

/** Lit un fichier (ou Blob) en dataURL. Rejette avec un message clair. */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new ImportError("FileReader indisponible sur ce navigateur."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new ImportError("Lecture du fichier impossible (erreur disque ou permissions)."));
    reader.onabort = () => reject(new ImportError("Lecture du fichier interrompue."));
    reader.onload = () => {
      const result = String(reader.result || "");
      if (!result.startsWith("data:image/")) {
        reject(new ImportError("Le fichier lu n'est pas une image exploitable."));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

function decodeViaImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    const cleanup = () => {
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* déjà libéré */
        }
      }, 4000);
    };
    img.onload = () => {
      const { width, height } = sourceDimensions(img);
      cleanup();
      if (!width || !height) {
        reject(new ImportError("Image décodée mais de taille nulle."));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(
        new ImportError(
          "Décodage impossible. Formats courants en cause : HEIC/HEIF ou fichier corrompu. Exportez la photo en JPEG ou PNG, puis réessayez.",
        ),
      );
    };
    img.src = url;
  });
}

async function decodeViaBitmap(blob) {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(blob, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
    });
  } catch {
    /* options non gérées : second essai sans options */
  }
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** Réduit une image trop grande (mémoire mobile) dans un canvas intermédiaire. */
export function downscaleDrawable(drawable, maxDimension = IMPORT_MAX_DIMENSION) {
  const { width, height } = sourceDimensions(drawable);
  const longest = Math.max(width, height);
  if (!longest || longest <= maxDimension) return { drawable, scaled: false, width, height };
  if (typeof document === "undefined") return { drawable, scaled: false, width, height };

  const ratio = maxDimension / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { drawable, scaled: false, width, height };
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
  return { drawable: canvas, scaled: true, width: canvas.width, height: canvas.height };
}

/**
 * dataURL stockable (localStorage / fichier projet) :
 *  - petit fichier d'origine  → on garde l'original tel quel (aucune perte) ;
 *  - sinon → version réduite 1600 px (JPEG, ou PNG si la source est un PNG).
 */
export async function buildPersistableDataUrl(file, drawable) {
  if (file && file.size <= PERSIST_MAX_SOURCE_BYTES) {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl.length <= PERSIST_MAX_DATAURL_BYTES) return { dataUrl, lossless: true };
    } catch {
      /* on retombe sur la version réduite */
    }
  }
  if (typeof document === "undefined") return { dataUrl: null, lossless: false };

  const { drawable: small } = downscaleDrawable(drawable, PERSIST_MAX_DIMENSION);
  const canvas =
    small instanceof HTMLCanvasElement ? small : document.createElement("canvas");
  if (!(small instanceof HTMLCanvasElement)) {
    const { width, height } = sourceDimensions(small);
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d");
    if (c) c.drawImage(small, 0, 0);
  }

  const sourceType = String(file?.type || "").toLowerCase();
  const keepPng = sourceType === "image/png" || sourceType === "image/webp";
  const asPng = canvas.toDataURL("image/png");
  if (keepPng && asPng.length <= PERSIST_MAX_DATAURL_BYTES) {
    return { dataUrl: asPng, lossless: false, format: "png" };
  }
  const asJpeg = canvas.toDataURL("image/jpeg", 0.92);
  return { dataUrl: asJpeg, lossless: false, format: "jpeg" };
}

/**
 * Importe un fichier image et renvoie tout ce dont l'éditeur a besoin.
 * @returns {Promise<{drawable:*, width:number, height:number, name:string, size:number, type:string, dataUrl:string|null, downscaled:boolean}>}
 */
export async function loadImageFile(file) {
  const check = validateImageFile(file);
  if (!check.ok) throw new ImportError(check.error);

  let drawable = await decodeViaBitmap(file);
  if (!drawable) drawable = await decodeViaImageElement(file);
  if (!drawable) {
    throw new ImportError(
      "Votre navigateur n'a pas pu décoder cette image. Essayez un JPEG ou un PNG standard.",
    );
  }

  const reduced = downscaleDrawable(drawable, IMPORT_MAX_DIMENSION);
  const { dataUrl } = await buildPersistableDataUrl(file, reduced.drawable);

  return {
    drawable: reduced.drawable,
    width: reduced.width,
    height: reduced.height,
    name: file.name || "photo",
    size: file.size || 0,
    type: file.type || "",
    dataUrl,
    downscaled: reduced.scaled,
  };
}

/** Recharge une photo depuis un dataURL (projet enregistré, glisser-déposer…). */
export async function loadImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new ImportError("dataURL d'image invalide.");
  }
  const res = await fetch(dataUrl);
  if (!res.ok) throw new ImportError("Lecture du dataURL impossible.");
  const blob = await res.blob();
  let drawable = await decodeViaBitmap(blob);
  if (!drawable) drawable = await decodeViaImageElement(blob);
  const reduced = downscaleDrawable(drawable, IMPORT_MAX_DIMENSION);
  return {
    drawable: reduced.drawable,
    width: reduced.width,
    height: reduced.height,
    dataUrl,
    downscaled: reduced.scaled,
  };
}

/** Récupère la première image d'un DataTransfer (glisser-déposer) ou du presse-papiers. */
export function pickImageFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return null;
  const files = dataTransfer.files;
  if (files && files.length) {
    for (const file of files) {
      if (String(file.type || "").startsWith("image/")) return file;
    }
  }
  const items = dataTransfer.items;
  if (items && items.length) {
    for (const item of items) {
      if (item.kind === "file" && String(item.type || "").startsWith("image/")) {
        return item.getAsFile();
      }
    }
  }
  return null;
}
