/**
 * CTR Studio AI — polices disponibles.
 *
 * Aucun service externe : uniquement des polices déjà présentes sur l'appareil,
 * plus les fichiers de police que le créateur importe lui-même (FontFace API).
 */

export const FONT_PRESETS = [
  {
    id: "system",
    label: "Système — sobre",
    stack:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    note: "Disponible partout, y compris Android.",
  },
  {
    id: "impact",
    label: "Impact — condensé",
    stack:
      'Impact, Haettenschweiler, "Arial Narrow Bold", "Anton", "Oswald", system-ui, sans-serif',
    note: "Le classique des miniatures. Repli gras si absent (Android).",
  },
  {
    id: "arial-black",
    label: "Arial Black — massif",
    stack: '"Arial Black", "Arial Bold", Gadget, "Helvetica Neue", system-ui, sans-serif',
    note: "Très présent sur Windows/macOS.",
  },
  {
    id: "helvetica",
    label: "Helvetica — neutre",
    stack: '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
    note: "Lisible, élégant.",
  },
  {
    id: "trebuchet",
    label: "Trebuchet — dynamique",
    stack: '"Trebuchet MS", "Lucida Grande", "Segoe UI", system-ui, sans-serif',
    note: "Un peu de caractère sans perdre en lisibilité.",
  },
  {
    id: "verdana",
    label: "Verdana — très lisible",
    stack: 'Verdana, Geneva, "DejaVu Sans", system-ui, sans-serif',
    note: "Chasse large : privilégier les textes courts.",
  },
  {
    id: "georgia",
    label: "Georgia — éditorial",
    stack: 'Georgia, "Times New Roman", "DejaVu Serif", serif',
    note: "Style magazine / essai.",
  },
  {
    id: "mono",
    label: "Mono — technique",
    stack: 'ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", "Courier New", monospace',
    note: "Pour les sujets code, finance, data.",
  },
  {
    id: "script",
    label: "Manuscrit — accent",
    stack: '"Segoe Script", "Brush Script MT", "Comic Sans MS", cursive',
    note: "À utiliser en petites touches.",
  },
];

export const DEFAULT_FONT_ID = "system";

export function fontStackById(id) {
  const preset = FONT_PRESETS.find((f) => f.id === id);
  return preset ? preset.stack : FONT_PRESETS[0].stack;
}

/** Fabrique l'entrée « police importée » stockée dans le projet. */
export function createCustomFont({ family, dataUrl, fileName = "" }) {
  return {
    id: `custom:${family}`,
    kind: "custom",
    family,
    label: `${family} (importée)`,
    stack: `"${family}", system-ui, sans-serif`,
    dataUrl,
    fileName,
  };
}

/** Liste complète (presets + polices importées du projet). */
export function availableFonts(comp) {
  const custom = Array.isArray(comp?.fonts) ? comp.fonts : [];
  return [
    ...custom.map((f) => ({
      id: f.id,
      label: f.label ?? `${f.family} (importée)`,
      stack: f.stack ?? `"${f.family}", system-ui, sans-serif`,
      custom: true,
    })),
    ...FONT_PRESETS.map((f) => ({ id: f.id, label: f.label, stack: f.stack })),
  ];
}

/**
 * Charge dans le document les polices personnalisées du projet.
 * Sans DOM (tests Node) : opération neutre.
 */
export async function ensureCustomFonts(comp) {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return [];
  const loaded = [];
  for (const font of comp?.fonts ?? []) {
    if (!font?.family || !font?.dataUrl) continue;
    try {
      const already = document.fonts?.check?.(`16px "${font.family}"`);
      if (already) {
        loaded.push(font.family);
        continue;
      }
      const face = new FontFace(font.family, `url(${font.dataUrl})`);
      await face.load();
      document.fonts.add(face);
      loaded.push(font.family);
    } catch (err) {
      console.warn("[CTR Studio] police ignorée", font.family, err);
    }
  }
  return loaded;
}

/**
 * Attente du chargement effectif des polices utilisées par une composition.
 * Indispensable avant un export : sinon le PNG peut être rendu avec une police
 * de repli alors que l'écran affiche la bonne.
 */
export async function ensureFontsReady(comp) {
  if (typeof document === "undefined" || !document.fonts) return;
  await ensureCustomFonts(comp);
  const specs = new Set();
  for (const layer of comp?.layers ?? []) {
    const weight = layer.fontWeight ?? 700;
    const style = layer.italic ? "italic" : "normal";
    specs.add(`${style} ${weight} 64px ${layer.fontStack || fontStackById(layer.fontFamily)}`);
  }
  const jobs = [...specs].map((spec) =>
    document.fonts.load(spec).catch(() => null),
  );
  await Promise.all(jobs);
  if (typeof document.fonts.ready?.then === "function") {
    await document.fonts.ready.catch(() => null);
  }
}
