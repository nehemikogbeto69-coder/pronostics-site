/**
 * CTR Studio AI — géométrie 2D (pur).
 *
 * Repère : pixels de la miniature (1280×720). Les angles sont en degrés,
 * positifs dans le sens horaire (comme `ctx.rotate` avec l'axe Y vers le bas).
 */

import { degToRad } from "./utils.js";

export function rotatePoint(point, center, degrees) {
  const a = degToRad(degrees || 0);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: center.y + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

export function unrotatePoint(point, center, degrees) {
  return rotatePoint(point, center, -(degrees || 0));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleBetween(center, point) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

export function boxCenter(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export function boxCorners(box) {
  return {
    nw: { x: box.x, y: box.y },
    ne: { x: box.x + box.width, y: box.y },
    se: { x: box.x + box.width, y: box.y + box.height },
    sw: { x: box.x, y: box.y + box.height },
  };
}

export function pointInBox(point, box) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** Teste un point dans une boîte tournée (on ramène le point en repère local). */
export function pointInRotatedBox(point, box, center, degrees) {
  const local = unrotatePoint(point, center, degrees);
  return pointInBox(local, box);
}

/**
 * Positions des poignées de manipulation, dans le repère local du calque.
 * Partagées par le rendu (dessin) et l'interaction (test de survol) pour que
 * les deux soient toujours d'accord.
 */
export function handlePositions(box, handleSize) {
  const lift = handleSize * 2.6;
  return {
    nw: { x: box.x, y: box.y },
    n: { x: box.x + box.width / 2, y: box.y },
    ne: { x: box.x + box.width, y: box.y },
    e: { x: box.x + box.width, y: box.y + box.height / 2 },
    se: { x: box.x + box.width, y: box.y + box.height },
    s: { x: box.x + box.width / 2, y: box.y + box.height },
    sw: { x: box.x, y: box.y + box.height },
    w: { x: box.x, y: box.y + box.height / 2 },
    rotate: { x: box.x + box.width / 2, y: box.y - lift },
  };
}

export const OPPOSITE_HANDLE = {
  nw: "se",
  n: "s",
  ne: "sw",
  e: "w",
  se: "nw",
  s: "n",
  sw: "ne",
  w: "e",
};
