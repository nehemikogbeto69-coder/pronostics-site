/**
 * CTR Studio AI — constantes partagées.
 *
 * Module « pur » : aucune dépendance au DOM, donc importable aussi bien dans le
 * navigateur que dans les tests Node (voir tests/).
 */

/** Format officiel de la miniature YouTube. */
export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;
export const THUMB_RATIO = THUMB_WIDTH / THUMB_HEIGHT; // 16:9

/** Limite officielle YouTube : 2 Mo. */
export const YOUTUBE_MAX_BYTES = 2 * 1024 * 1024;

/** Taille maximale acceptée pour une photo importée (côté client). */
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;
export const IMPORT_MAX_DIMENSION = 8000;

/** Types MIME acceptés à l'import. */
export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
];

/** Schéma de sérialisation des projets. */
export const PROJECT_VERSION = 1;

/** Clé de sauvegarde locale. */
export const STORAGE_KEY = "ctr-studio-ai:projet:v1";

/** Historique annuler/rétablir. */
export const HISTORY_LIMIT = 60;

/** Bornes des valeurs éditables (évite les états incohérents). */
export const LIMITS = {
  fontSize: { min: 8, max: 400 },
  letterSpacing: { min: -20, max: 80 },
  lineHeight: { min: 0.6, max: 3 },
  strokeWidth: { min: 0, max: 60 },
  shadowBlur: { min: 0, max: 120 },
  shadowOffset: { min: -120, max: 120 },
  rotation: { min: -180, max: 180 },
  opacity: { min: 0, max: 1 },
  zoom: { min: 0.2, max: 6 },
  filterPercent: { min: 0, max: 300 },
  blurPx: { min: 0, max: 40 },
  vignette: { min: 0, max: 1 },
  boxWidth: { min: 0, max: THUMB_WIDTH * 2 },
};

/** Nombre d'idées générées à la demande (cahier des charges : 5). */
export const IDEAS_COUNT = 5;
