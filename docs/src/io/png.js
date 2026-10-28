/**
 * CTR Studio AI — vérification PNG (pur).
 *
 * Un export n'est annoncé comme réussi que si les octets produits sont
 * réellement un PNG valide aux bonnes dimensions. On lit l'en-tête IHDR
 * directement : pas besoin de recharger l'image pour prouver le résultat.
 */

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const COLOR_TYPES = {
  0: "niveaux de gris",
  2: "couleur vraie (RGB)",
  3: "palette indexée",
  4: "niveaux de gris + alpha",
  6: "couleur vraie + alpha (RGBA)",
};

/** Accepte Uint8Array, ArrayBuffer, Buffer Node ou tableau classique. */
export function toBytes(input) {
  if (!input) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (typeof ArrayBuffer !== "undefined" && input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  /* ArrayBuffer provenant d'un autre contexte (iframe, worker, environnement de
     test) : `instanceof` échoue, on se rabat sur la forme (canard). */
  if (
    typeof input === "object" &&
    typeof input.byteLength === "number" &&
    typeof input.slice === "function"
  ) {
    return new Uint8Array(input);
  }
  if (Array.isArray(input)) return new Uint8Array(input);
  return new Uint8Array(0);
}

export function hasPngSignature(bytes) {
  const data = toBytes(bytes);
  if (data.length < 8) return false;
  return PNG_SIGNATURE.every((b, i) => data[i] === b);
}

function readUInt32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/**
 * Lit le chunk IHDR. Renvoie null si la structure n'est pas celle d'un PNG.
 */
export function parsePngIhdr(bytes) {
  const data = toBytes(bytes);
  if (!hasPngSignature(data)) return null;
  if (data.length < 33) return null;

  const length = readUInt32BE(data, 8);
  const type = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (type !== "IHDR" || length !== 13) return null;

  return {
    width: readUInt32BE(data, 16),
    height: readUInt32BE(data, 20),
    bitDepth: data[24],
    colorType: data[25],
    compression: data[26],
    filter: data[27],
    interlace: data[28],
    colorTypeLabel: COLOR_TYPES[data[25]] ?? "inconnu",
  };
}

/** Cherche la présence du chunk de fin IEND (fichier complet, non tronqué). */
export function hasIend(bytes) {
  const data = toBytes(bytes);
  if (data.length < 12) return false;
  /* Le champ type d'IEND se trouve 8 octets avant la fin (type + CRC). */
  for (let i = data.length - 8; i >= 8; i -= 1) {
    if (
      data[i] === 0x49 &&
      data[i + 1] === 0x45 &&
      data[i + 2] === 0x4e &&
      data[i + 3] === 0x44
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Contrôle complet d'un PNG : signature, IHDR, dimensions attendues, IEND.
 * @returns {{ok:boolean, errors:string[], info:object|null}}
 */
export function verifyPngBytes(bytes, expected = {}) {
  const data = toBytes(bytes);
  const errors = [];
  if (!data.length) errors.push("Aucun octet produit : l'export a échoué.");
  else if (!hasPngSignature(data)) errors.push("Signature PNG absente : le fichier n'est pas un PNG.");

  const info = parsePngIhdr(data);
  if (data.length && !info) errors.push("En-tête IHDR illisible : PNG invalide.");
  if (info) {
    if (expected.width && info.width !== expected.width) {
      errors.push(`Largeur ${info.width} px au lieu de ${expected.width} px.`);
    }
    if (expected.height && info.height !== expected.height) {
      errors.push(`Hauteur ${info.height} px au lieu de ${expected.height} px.`);
    }
    if (!Number.isFinite(info.width) || info.width <= 0 || info.height <= 0) {
      errors.push("Dimensions incohérentes dans l'en-tête.");
    }
  }
  if (data.length > 8 && !hasIend(data)) {
    errors.push("Chunk IEND manquant : fichier tronqué.");
  }
  return { ok: errors.length === 0, errors, info };
}

/**
 * Vérification supplémentaire : décodage réel de l'image.
 * Utilise `createImageBitmap` (navigateur) ou la fonction `decode` fournie
 * (tests Node avec @napi-rs/canvas). Ne lève jamais : renvoie un rapport.
 */
export async function verifyDecodable(bytes, { decode } = {}) {
  const data = toBytes(bytes);
  try {
    let bitmap = null;
    if (typeof decode === "function") {
      bitmap = await decode(data);
    } else if (typeof createImageBitmap === "function" && typeof Blob === "function") {
      bitmap = await createImageBitmap(new Blob([data], { type: "image/png" }));
    } else {
      return { checked: false, ok: false, errors: ["Décodage indisponible dans cet environnement."] };
    }
    const width = bitmap.width ?? bitmap.naturalWidth ?? 0;
    const height = bitmap.height ?? bitmap.naturalHeight ?? 0;
    if (typeof bitmap.close === "function") bitmap.close();
    if (!width || !height) {
      return { checked: true, ok: false, errors: ["Image décodée de taille nulle."], width, height };
    }
    return { checked: true, ok: true, errors: [], width, height };
  } catch (err) {
    return {
      checked: true,
      ok: false,
      errors: [`Décodage impossible : ${err?.message ?? String(err)}`],
    };
  }
}
