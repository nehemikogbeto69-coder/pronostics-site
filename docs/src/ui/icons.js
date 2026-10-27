/**
 * CTR Studio AI — jeu d'icônes SVG inline.
 *
 * Aucune dépendance externe, aucune police d'icônes à télécharger : les tracés
 * sont dans le code, donc l'interface s'affiche immédiatement et hors ligne.
 */

const PATHS = {
  image: ["<rect x='3' y='4' width='18' height='16' rx='2'/>", "<circle cx='8.5' cy='9.5' r='1.5'/>", "<path d='m21 16-4.5-4.5L7 21'/>"],
  sparkles: ["<path d='m12 3 1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z'/>", "<path d='M18 15.5 19 18l2.5 1-2.5 1-1 2.5-1-2.5L14.5 19l2.5-1z'/>"],
  chart: ["<path d='M3 3v18h18'/>", "<path d='m7 14 3-4 3 3 4-6'/>"],
  wand: ["<path d='m4 20 10-10'/>", "<path d='M15 4.5 16 7l2.5 1L16 9l-1 2.5L14 9l-2.5-1L14 7z'/>", "<path d='M19 14.5 19.7 16l1.5.7-1.5.8-.7 1.5-.7-1.5-1.5-.8 1.5-.7z'/>"],
  layers: ["<path d='m12 3 9 5-9 5-9-5z'/>", "<path d='m3 13 9 5 9-5'/>"],
  undo: ["<path d='M9 14 4 9l5-5'/>", "<path d='M4 9h11a5 5 0 0 1 0 10H9'/>"],
  redo: ["<path d='m15 14 5-5-5-5'/>", "<path d='M20 9H9a5 5 0 0 0 0 10h6'/>"],
  grid: ["<rect x='3' y='3' width='18' height='18' rx='2'/>", "<path d='M9 3v18M15 3v18M3 9h18M3 15h18'/>"],
  download: ["<path d='M12 3v12'/>", "<path d='m7 11 5 5 5-5'/>", "<path d='M4 20h16'/>"],
  upload: ["<path d='M12 21V9'/>", "<path d='m7 13 5-5 5 5'/>", "<path d='M4 4h16'/>"],
  trash: ["<path d='M4 7h16'/>", "<path d='M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'/>", "<path d='m6 7 1 13h10l1-13'/>"],
  copy: ["<rect x='9' y='9' width='12' height='12' rx='2'/>", "<path d='M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'/>"],
  plus: ["<path d='M12 5v14M5 12h14'/>"],
  minus: ["<path d='M5 12h14'/>"],
  eye: ["<path d='M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z'/>", "<circle cx='12' cy='12' r='2.6'/>"],
  eyeOff: ["<path d='M4 4l16 16'/>", "<path d='M9.9 5.3A9.8 9.8 0 0 1 12 5c6.4 0 10 6 10 6a17 17 0 0 1-3.3 3.9'/>", "<path d='M6.3 7.9A17 17 0 0 0 2 11s3.6 6 10 6a9.7 9.7 0 0 0 3.5-.6'/>"],
  up: ["<path d='m6 14 6-6 6 6'/>"],
  down: ["<path d='m6 10 6 6 6-6'/>"],
  close: ["<path d='M6 6l12 12M18 6 6 18'/>"],
  check: ["<path d='m4 12 5 5L20 6'/>"],
  alert: ["<path d='M12 4 2.5 20h19z'/>", "<path d='M12 10v4'/>", "<circle cx='12' cy='17' r='.6'/>"],
  info: ["<circle cx='12' cy='12' r='9'/>", "<path d='M12 11v5'/>", "<circle cx='12' cy='8' r='.6'/>"],
  share: ["<circle cx='18' cy='5' r='2.6'/>", "<circle cx='6' cy='12' r='2.6'/>", "<circle cx='18' cy='19' r='2.6'/>", "<path d='m8.4 10.8 7.2-4.2M8.4 13.2l7.2 4.2'/>"],
  external: ["<path d='M14 4h6v6'/>", "<path d='M20 4 11 13'/>", "<path d='M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'/>"],
  text: ["<path d='M5 6h14'/>", "<path d='M12 6v13'/>", "<path d='M9 19h6'/>"],
  palette: ["<path d='M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.6-1.4-1.8-1.4-3 0-.8.7-1.4 1.6-1.4H16a5 5 0 0 0 5-5c0-3.9-4-6.8-9-6.8z'/>", "<circle cx='7.5' cy='11' r='1'/>", "<circle cx='11' cy='7.5' r='1'/>", "<circle cx='15.5' cy='8.5' r='1'/>"],
  refresh: ["<path d='M20 11a8 8 0 1 0-.7 4.3'/>", "<path d='M20 5v6h-6'/>"],
  save: ["<path d='M5 4h11l3 3v13H5z'/>", "<path d='M8 4v6h7V4'/>", "<rect x='8' y='13' width='8' height='7'/>"],
  file: ["<path d='M6 3h8l4 4v14H6z'/>", "<path d='M14 3v4h4'/>"],
  play: ["<path d='M8 5.5v13l11-6.5z'/>"],
  target: ["<circle cx='12' cy='12' r='8'/>", "<circle cx='12' cy='12' r='3'/>", "<path d='M12 2v3M12 19v3M2 12h3M19 12h3'/>"],
};

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/**
 * Renvoie une icône SVG prête à insérer.
 * @param {keyof PATHS} name
 */
export function icon(name, size = 18) {
  const svg = svgElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.75,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    class: "icon",
  });
  const shapes = PATHS[name] ?? [];
  for (const raw of shapes) {
    /* Les tracés sont stockés sous forme de balises simples et sûres. */
    const match = raw.match(/^<(\w+)(.*)\/>$/);
    if (!match) continue;
    const [, tag, attrString] = match;
    const node = svgElement(tag);
    for (const attr of attrString.matchAll(/([\w-]+)='([^']*)'/g)) {
      node.setAttribute(attr[1], attr[2]);
    }
    svg.append(node);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);

/** Bouton icône accessible. */
export function iconButton(name, { label, title, className = "icon-btn", onClick, size = 18 } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title ?? label ?? "";
  if (label) button.setAttribute("aria-label", label);
  button.append(icon(name, size));
  if (onClick) button.addEventListener("click", onClick);
  return button;
}
