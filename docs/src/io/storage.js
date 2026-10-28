/**
 * CTR Studio AI — persistance (localStorage + fichier projet JSON).
 *
 * La sauvegarde locale est « best effort » : si le quota du navigateur est
 * atteint (photo trop lourde), on le dit clairement au lieu d'échouer en
 * silence. Le fichier projet .json, lui, est un export explicite et complet.
 */

import { STORAGE_KEY } from "../core/constants.js";
import { deserializeProject, sanitizeComposition, serializeProject } from "../core/composition.js";
import { formatBytes } from "../core/utils.js";

export class StorageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "StorageError";
    this.details = details;
  }
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage.setItem;
  } catch {
    return false;
  }
}

/** Enregistre le projet (sans état d'interface). Renvoie un rapport explicite. */
export function saveToLocal(comp, { quiet = false } = {}) {
  if (!hasLocalStorage()) {
    return { ok: false, reason: "unavailable", message: "Stockage local indisponible (navigation privée ?)." };
  }
  try {
    const payload = JSON.stringify(serializeProject(comp));
    localStorage.setItem(STORAGE_KEY, payload);
    return { ok: true, bytes: payload.length, sizeLabel: formatBytes(payload.length) };
  } catch (err) {
    const quota =
      err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22);
    /* Repli : on retente sans la photo, pour conserver au moins les calques. */
    if (quota) {
      try {
        const light = serializeProject(comp);
        light.image = { ...light.image, dataUrl: null, dropped: true };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(light));
        return {
          ok: true,
          partial: true,
          reason: "quota",
          message:
            "Projet enregistré sans la photo (stockage local saturé). Utilisez « Exporter le projet » pour tout conserver.",
        };
      } catch {
        return {
          ok: false,
          reason: "quota",
          message: "Stockage local saturé : projet non enregistré. Utilisez « Exporter le projet ».",
        };
      }
    }
    if (!quiet) console.warn("[CTR Studio] sauvegarde locale impossible", err);
    return { ok: false, reason: "error", message: `Sauvegarde impossible : ${err?.message ?? err}` };
  }
}

export function loadFromLocal() {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const comp = deserializeProject(raw);
    return sanitizeComposition(comp);
  } catch (err) {
    console.warn("[CTR Studio] projet local illisible, ignoré", err);
    return null;
  }
}

export function clearLocal() {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function localProjectExists() {
  if (!hasLocalStorage()) return false;
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

/** Blob JSON du projet complet (photo incluse) — pour sauvegarde/partage. */
export function projectBlob(comp) {
  const data = JSON.stringify(serializeProject(comp), null, 2);
  if (typeof Blob === "undefined") return { data, blob: null };
  return { data, blob: new Blob([data], { type: "application/json" }), bytes: data.length };
}

/** Lit un fichier projet .json sélectionné par l'utilisateur. */
export async function readProjectFile(file) {
  if (!file) throw new StorageError("Aucun fichier sélectionné.");
  if (file.size > 30 * 1024 * 1024) {
    throw new StorageError("Fichier projet trop volumineux (plus de 30 Mo).");
  }
  const text = await file.text
    ? file.text()
    : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new StorageError("Lecture du fichier impossible."));
        reader.readAsText(file);
      });
  try {
    return deserializeProject(text);
  } catch (err) {
    throw new StorageError(err?.message ?? "Fichier projet invalide.");
  }
}
