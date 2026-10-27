/**
 * CTR Studio AI — inspecteur (calques, texte, style, photo, fond).
 *
 * Les contrôles lisent et écrivent l'état à travers `store`, donc aucun champ
 * n'est reconstruit quand la sélection change : on se contente de rafraîchir.
 */

import { availableFonts } from "../core/fonts.js";
import { LIMITS, THUMB_WIDTH } from "../core/constants.js";
import { createField, mountFields } from "./controls.js";
import { $, clear, el, setDisabled } from "./dom.js";
import { iconButton } from "./icons.js";
import { parseColor, toHex, withAlpha, round } from "../core/utils.js";

const ALIGN_OPTIONS = [
  { value: "left", label: "Gauche" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Droite" },
];

const WEIGHT_OPTIONS = [
  { value: "100", label: "100 — Ultra fin" },
  { value: "300", label: "300 — Léger" },
  { value: "400", label: "400 — Normal" },
  { value: "500", label: "500 — Moyen" },
  { value: "600", label: "600 — Semi-gras" },
  { value: "700", label: "700 — Gras" },
  { value: "800", label: "800 — Extra-gras" },
  { value: "900", label: "900 — Black" },
];

const FIT_OPTIONS = [
  { value: "cover", label: "Remplir", title: "Remplit toute la miniature (recadrage)" },
  { value: "contain", label: "Entier", title: "Image entière, bandes du fond visibles" },
  { value: "stretch", label: "Étirer", title: "Étire aux 1280×720 (déforme)" },
];

/* ------------------------------------------------------- couleurs + alpha */

function hexPart(color) {
  const parsed = parseColor(color);
  return parsed ? toHex(parsed) : "#ffffff";
}

function alphaPart(color) {
  const parsed = parseColor(color);
  return parsed ? parsed.a : 1;
}

/** Paire « couleur + opacité » pour les valeurs rgba() (ombre, badge, voile). */
function alphaColorFields({ label, get, set, key, hint }) {
  return [
    {
      type: "color",
      label,
      get: () => hexPart(get()),
      set: (hex) => set(withAlpha(hex, alphaPart(get())), key),
    },
    {
      type: "range",
      label: "Opacité",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
      hint,
      get: () => Math.round(alphaPart(get()) * 100),
      set: (value) => set(withAlpha(hexPart(get()), value / 100), key),
    },
  ];
}

/* -------------------------------------------------------------- calques */

function createLayersPanel({ container, store, onOpenTextEditor }) {
  let signature = "";

  function signatureOf() {
    return JSON.stringify({
      sel: store.selection,
      layers: store.comp.layers.map((l) => [l.id, l.name, l.visible, l.text.slice(0, 24)]),
    });
  }

  function build() {
    clear(container);
    if (!store.comp.layers.length) {
      container.append(
        el("p", { class: "empty", text: "Aucun calque. Ajoutez du texte pour commencer." }),
      );
      return;
    }

    const list = el("ul", { class: "layer-list" });
    /* Affichage type Photoshop : le haut de la liste est au premier plan. */
    const ordered = [...store.comp.layers].reverse();
    for (const layer of ordered) {
      const selected = layer.id === store.selection;
      const row = el("li", {
        class: `layer-row${selected ? " is-selected" : ""}`,
        dataset: { id: layer.id },
      }, [
        el("button", {
          type: "button",
          class: "layer-main",
          title: "Sélectionner et éditer",
          onClick: () => {
            store.setSelection(layer.id);
            onOpenTextEditor?.(layer.id);
          },
        }, [
          el("span", { class: "layer-name", text: layer.name || "Texte" }),
          el("span", { class: "layer-preview", text: layer.text.replace(/\n/g, " ⏎ ").slice(0, 34) || "—" }),
        ]),
        el("div", { class: "layer-actions" }, [
          iconButton(layer.visible ? "eye" : "eyeOff", {
            label: layer.visible ? "Masquer le calque" : "Afficher le calque",
            onClick: () => store.updateLayerById(layer.id, { visible: !layer.visible }, `visible-${layer.id}`),
          }),
          iconButton("up", {
            label: "Monter le calque",
            onClick: () => {
              store.setSelection(layer.id, { notify: false });
              store.moveSelected("up");
            },
          }),
          iconButton("down", {
            label: "Descendre le calque",
            onClick: () => {
              store.setSelection(layer.id, { notify: false });
              store.moveSelected("down");
            },
          }),
          iconButton("trash", {
            label: "Supprimer le calque",
            className: "icon-btn is-danger",
            onClick: () => store.removeLayer(layer.id),
          }),
        ]),
      ]);
      list.append(row);
    }
    container.append(list);
  }

  return {
    refresh() {
      const next = signatureOf();
      if (next === signature) return;
      signature = next;
      build();
    },
  };
}

/* --------------------------------------------------------------- panneaux */

export function createInspector({ root, store, onOpenTextEditor, onPickPhoto, onRemovePhoto }) {
  const layer = () => store.selectedLayer();
  const image = () => store.comp.image;
  const background = () => store.comp.background;
  const noSelection = () => !layer();

  const setLayer = (patch, key) => {
    if (!layer()) return;
    store.updateSelected(patch, key ?? null);
  };

  /* ------------------------------------------------------------ calques */
  const layersPanel = createLayersPanel({
    container: $("#panel-layers", root),
    store,
    onOpenTextEditor,
  });

  const layersActions = $("#layers-actions", root);
  if (layersActions) {
    layersActions.append(
      el("button", {
        type: "button",
        class: "btn btn-primary btn-sm",
        text: "+ Ajouter du texte",
        onClick: () => {
          const created = store.addLayer({
            text: "NOUVEAU TEXTE",
            x: 120,
            y: 300,
            fontSize: 96,
          });
          onOpenTextEditor?.(created.id);
        },
      }),
      el("button", {
        type: "button",
        class: "btn btn-ghost btn-sm",
        text: "Dupliquer",
        onClick: () => store.duplicateSelected(),
      }),
    );
  }

  /* --------------------------------------------------------------- texte */
  const textFields = mountFields($("#panel-text", root), [
    {
      type: "textarea",
      label: "Contenu du texte",
      rows: 3,
      counter: 400,
      placeholder: "Votre accroche…",
      get: () => layer()?.text ?? "",
      set: (value) => setLayer({ text: value }, "text"),
      onCommit: () => onOpenTextEditor?.(store.selection),
      disabled: noSelection,
    },
    {
      type: "range",
      label: "Taille",
      unit: "px",
      min: LIMITS.fontSize.min,
      max: LIMITS.fontSize.max,
      step: 1,
      get: () => layer()?.fontSize ?? 0,
      set: (value) => setLayer({ fontSize: value }, "fontSize"),
      disabled: noSelection,
    },
    {
      type: "select",
      label: "Police",
      getOptions: () => availableFonts(store.comp).map((font) => ({ value: font.id, label: font.label })),
      get: () => layer()?.fontFamily ?? "system",
      set: (value) => setLayer({ fontFamily: value }, "font"),
      disabled: noSelection,
    },
    {
      type: "select",
      label: "Graisse",
      options: WEIGHT_OPTIONS,
      get: () => String(layer()?.fontWeight ?? 900),
      set: (value) => setLayer({ fontWeight: Number(value) }, "weight"),
      disabled: noSelection,
    },
    {
      type: "segment",
      label: "Alignement",
      options: ALIGN_OPTIONS,
      get: () => layer()?.align ?? "left",
      set: (value) => setLayer({ align: value }, "align"),
      disabled: noSelection,
    },
    {
      type: "toggle",
      label: "CAPITALES",
      get: () => layer()?.uppercase ?? false,
      set: (value) => setLayer({ uppercase: value }, "uppercase"),
      disabled: noSelection,
    },
    {
      type: "toggle",
      label: "Italique",
      get: () => layer()?.italic ?? false,
      set: (value) => setLayer({ italic: value }, "italic"),
      disabled: noSelection,
    },
    {
      type: "range",
      label: "Interlettrage",
      unit: "px",
      min: LIMITS.letterSpacing.min,
      max: LIMITS.letterSpacing.max,
      step: 0.5,
      digits: 1,
      get: () => layer()?.letterSpacing ?? 0,
      set: (value) => setLayer({ letterSpacing: value }, "letterSpacing"),
      disabled: noSelection,
    },
    {
      type: "range",
      label: "Interlignage",
      unit: "×",
      min: LIMITS.lineHeight.min,
      max: LIMITS.lineHeight.max,
      step: 0.01,
      digits: 2,
      get: () => layer()?.lineHeight ?? 1,
      set: (value) => setLayer({ lineHeight: value }, "lineHeight"),
      disabled: noSelection,
    },
    {
      type: "toggle",
      label: "Retour à la ligne automatique",
      hint: "Contraint le texte dans une largeur fixe.",
      get: () => layer()?.wrap ?? false,
      set: (value) => setLayer({ wrap: value, boxWidth: value ? Math.round(THUMB_WIDTH * 0.6) : 0 }, "wrap"),
      disabled: noSelection,
    },
    {
      type: "range",
      label: "Largeur de la zone",
      unit: "px",
      min: 120,
      max: THUMB_WIDTH * 2,
      step: 10,
      get: () => layer()?.boxWidth ?? 0,
      set: (value) => setLayer({ boxWidth: value, wrap: true }, "boxWidth"),
      disabled: () => noSelection() || !layer()?.wrap,
    },
    {
      type: "range",
      label: "Rotation",
      unit: "°",
      min: LIMITS.rotation.min,
      max: LIMITS.rotation.max,
      step: 1,
      get: () => layer()?.rotation ?? 0,
      set: (value) => setLayer({ rotation: value }, "rotation"),
      disabled: noSelection,
    },
    {
      type: "range",
      label: "Opacité du calque",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
      get: () => Math.round((layer()?.opacity ?? 1) * 100),
      set: (value) => setLayer({ opacity: value / 100 }, "opacity"),
      disabled: noSelection,
    },
    {
      type: "buttons",
      label: "Position",
      wrap: true,
      actions: [
        { label: "X −10", onClick: () => setLayer({ x: round((layer()?.x ?? 0) - 10, 1) }, "nudge") },
        { label: "X +10", onClick: () => setLayer({ x: round((layer()?.x ?? 0) + 10, 1) }, "nudge") },
        { label: "Y −10", onClick: () => setLayer({ y: round((layer()?.y ?? 0) - 10, 1) }, "nudge") },
        { label: "Y +10", onClick: () => setLayer({ y: round((layer()?.y ?? 0) + 10, 1) }, "nudge") },
        {
          label: "Centrer",
          class: "btn btn-ghost btn-sm",
          onClick: () => {
            const current = layer();
            if (!current) return;
            setLayer({ x: round((THUMB_WIDTH - 600) / 2, 1), align: "center", wrap: true, boxWidth: 600 }, "center");
          },
        },
      ],
      disabled: noSelection,
    },
  ]);

  /* --------------------------------------------------------------- style */
  const styleFields = mountFields($("#panel-style", root), [
    { type: "static", label: "Remplissage du texte" },
    {
      type: "segment",
      label: "Type de remplissage",
      options: [
        { value: "solid", label: "Uni" },
        { value: "gradient", label: "Dégradé" },
      ],
      get: () => layer()?.fill?.type ?? "solid",
      set: (value) => setLayer({ fill: { type: value } }, "fillType"),
      disabled: noSelection,
    },
    {
      type: "color",
      label: "Couleur du texte",
      get: () => layer()?.fill?.color ?? "#ffffff",
      set: (value) => setLayer({ fill: { color: value } }, "fillColor"),
      disabled: noSelection,
    },
    {
      type: "color",
      label: "Dégradé — couleur 1",
      get: () => layer()?.fill?.from ?? "#ffffff",
      set: (value) => setLayer({ fill: { from: value } }, "fillFrom"),
      disabled: () => noSelection() || layer()?.fill?.type !== "gradient",
    },
    {
      type: "color",
      label: "Dégradé — couleur 2",
      get: () => layer()?.fill?.to ?? "#a855f7",
      set: (value) => setLayer({ fill: { to: value } }, "fillTo"),
      disabled: () => noSelection() || layer()?.fill?.type !== "gradient",
    },
    {
      type: "range",
      label: "Angle du dégradé",
      unit: "°",
      min: 0,
      max: 360,
      step: 1,
      hint: "0° = vers le haut, 90° = vers la droite (comme en CSS).",
      get: () => layer()?.fill?.angle ?? 90,
      set: (value) => setLayer({ fill: { angle: value } }, "fillAngle"),
      disabled: () => noSelection() || layer()?.fill?.type !== "gradient",
    },

    { type: "static", label: "Contour" },
    {
      type: "toggle",
      label: "Activer le contour",
      get: () => layer()?.stroke?.enabled ?? false,
      set: (value) => setLayer({ stroke: { enabled: value } }, "strokeOn"),
      disabled: noSelection,
    },
    {
      type: "color",
      label: "Couleur du contour",
      get: () => layer()?.stroke?.color ?? "#000000",
      set: (value) => setLayer({ stroke: { color: value } }, "strokeColor"),
      disabled: () => noSelection() || !layer()?.stroke?.enabled,
    },
    {
      type: "range",
      label: "Épaisseur",
      unit: "px",
      min: 0,
      max: LIMITS.strokeWidth.max,
      step: 1,
      get: () => layer()?.stroke?.width ?? 0,
      set: (value) => setLayer({ stroke: { width: value } }, "strokeWidth"),
      disabled: () => noSelection() || !layer()?.stroke?.enabled,
    },

    { type: "static", label: "Ombre portée" },
    {
      type: "toggle",
      label: "Activer l'ombre",
      hint: "Si un fond est activé, l'ombre s'applique au fond.",
      get: () => layer()?.shadow?.enabled ?? false,
      set: (value) => setLayer({ shadow: { enabled: value } }, "shadowOn"),
      disabled: noSelection,
    },
    ...alphaColorFields({
      label: "Couleur de l'ombre",
      get: () => layer()?.shadow?.color ?? "rgba(0,0,0,0.65)",
      set: (value, key) => setLayer({ shadow: { color: value } }, key),
      key: "shadowColor",
    }).map((field) => ({ ...field, disabled: () => noSelection() || !layer()?.shadow?.enabled })),
    {
      type: "range",
      label: "Flou de l'ombre",
      unit: "px",
      min: 0,
      max: LIMITS.shadowBlur.max,
      step: 1,
      get: () => layer()?.shadow?.blur ?? 0,
      set: (value) => setLayer({ shadow: { blur: value } }, "shadowBlur"),
      disabled: () => noSelection() || !layer()?.shadow?.enabled,
    },
    {
      type: "range",
      label: "Décalage X",
      unit: "px",
      min: LIMITS.shadowOffset.min,
      max: LIMITS.shadowOffset.max,
      step: 1,
      get: () => layer()?.shadow?.x ?? 0,
      set: (value) => setLayer({ shadow: { x: value } }, "shadowX"),
      disabled: () => noSelection() || !layer()?.shadow?.enabled,
    },
    {
      type: "range",
      label: "Décalage Y",
      unit: "px",
      min: LIMITS.shadowOffset.min,
      max: LIMITS.shadowOffset.max,
      step: 1,
      get: () => layer()?.shadow?.y ?? 0,
      set: (value) => setLayer({ shadow: { y: value } }, "shadowY"),
      disabled: () => noSelection() || !layer()?.shadow?.enabled,
    },

    { type: "static", label: "Fond du texte (badge)" },
    {
      type: "toggle",
      label: "Activer le fond",
      get: () => layer()?.background?.enabled ?? false,
      set: (value) => setLayer({ background: { enabled: value } }, "bgOn"),
      disabled: noSelection,
    },
    {
      type: "segment",
      label: "Type de fond",
      options: [
        { value: "solid", label: "Uni" },
        { value: "gradient", label: "Dégradé" },
      ],
      get: () => layer()?.background?.type ?? "solid",
      set: (value) => setLayer({ background: { type: value } }, "bgType"),
      disabled: () => noSelection() || !layer()?.background?.enabled,
    },
    {
      type: "color",
      label: "Couleur du fond",
      get: () => layer()?.background?.color ?? "#7c3aed",
      set: (value) => setLayer({ background: { color: value } }, "bgColor"),
      disabled: () => noSelection() || !layer()?.background?.enabled,
    },
    {
      type: "color",
      label: "Fond dégradé — couleur 1",
      get: () => layer()?.background?.from ?? "#7c3aed",
      set: (value) => setLayer({ background: { from: value } }, "bgFrom"),
      disabled: () => noSelection() || !layer()?.background?.enabled || layer()?.background?.type !== "gradient",
    },
    {
      type: "color",
      label: "Fond dégradé — couleur 2",
      get: () => layer()?.background?.to ?? "#ec4899",
      set: (value) => setLayer({ background: { to: value } }, "bgTo"),
      disabled: () => noSelection() || !layer()?.background?.enabled || layer()?.background?.type !== "gradient",
    },
    {
      type: "range",
      label: "Angle du dégradé",
      unit: "°",
      min: 0,
      max: 360,
      step: 1,
      get: () => layer()?.background?.angle ?? 90,
      set: (value) => setLayer({ background: { angle: value } }, "bgAngle"),
      disabled: () => noSelection() || !layer()?.background?.enabled || layer()?.background?.type !== "gradient",
    },
    {
      type: "range",
      label: "Marge horizontale",
      unit: "px",
      min: 0,
      max: 200,
      step: 1,
      get: () => layer()?.background?.padX ?? 0,
      set: (value) => setLayer({ background: { padX: value } }, "bgPadX"),
      disabled: () => noSelection() || !layer()?.background?.enabled,
    },
    {
      type: "range",
      label: "Marge verticale",
      unit: "px",
      min: 0,
      max: 200,
      step: 1,
      get: () => layer()?.background?.padY ?? 0,
      set: (value) => setLayer({ background: { padY: value } }, "bgPadY"),
      disabled: () => noSelection() || !layer()?.background?.enabled,
    },
    {
      type: "range",
      label: "Arrondi des coins",
      unit: "px",
      min: 0,
      max: 300,
      step: 1,
      get: () => layer()?.background?.radius ?? 0,
      set: (value) => setLayer({ background: { radius: value } }, "bgRadius"),
      disabled: () => noSelection() || !layer()?.background?.enabled,
    },
    {
      type: "range",
      label: "Opacité du fond",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
      get: () => Math.round((layer()?.background?.opacity ?? 1) * 100),
      set: (value) => setLayer({ background: { opacity: value / 100 } }, "bgOpacity"),
      disabled: () => noSelection() || !layer()?.background?.enabled,
    },
  ]);

  /* --------------------------------------------------------------- photo */
  const photoMeta = $("#photo-meta", root);
  const setImage = (patch, key) => store.updateImage(patch, key ?? null);

  const photoFields = mountFields($("#panel-photo", root), [
    {
      type: "segment",
      label: "Ajustement",
      options: FIT_OPTIONS,
      get: () => image().fit,
      set: (value) => setImage({ fit: value }, "fit"),
    },
    {
      type: "range",
      label: "Zoom",
      unit: "×",
      min: LIMITS.zoom.min,
      max: LIMITS.zoom.max,
      step: 0.05,
      digits: 2,
      get: () => image().zoom,
      set: (value) => setImage({ zoom: value }, "zoom"),
    },
    {
      type: "range",
      label: "Décalage horizontal",
      unit: "px",
      min: -THUMB_WIDTH,
      max: THUMB_WIDTH,
      step: 2,
      get: () => image().offsetX,
      set: (value) => setImage({ offsetX: value }, "offsetX"),
    },
    {
      type: "range",
      label: "Décalage vertical",
      unit: "px",
      min: -720,
      max: 720,
      step: 2,
      get: () => image().offsetY,
      set: (value) => setImage({ offsetY: value }, "offsetY"),
    },
    {
      type: "buttons",
      label: "Orientation",
      wrap: true,
      actions: [
        { label: "Miroir ↔", onClick: () => setImage({ flipH: !image().flipH }, "flip") },
        { label: "Miroir ↕", onClick: () => setImage({ flipV: !image().flipV }, "flip") },
        {
          label: "Recadrage centré",
          onClick: () => setImage({ zoom: 1, offsetX: 0, offsetY: 0, flipH: false, flipV: false }, "reset-crop"),
        },
      ],
    },
    { type: "static", label: "Réglages" },
    {
      type: "range",
      label: "Luminosité",
      unit: "%",
      min: LIMITS.filterPercent.min,
      max: LIMITS.filterPercent.max,
      step: 1,
      get: () => image().brightness,
      set: (value) => setImage({ brightness: value }, "brightness"),
    },
    {
      type: "range",
      label: "Contraste",
      unit: "%",
      min: LIMITS.filterPercent.min,
      max: LIMITS.filterPercent.max,
      step: 1,
      get: () => image().contrast,
      set: (value) => setImage({ contrast: value }, "contrast"),
    },
    {
      type: "range",
      label: "Saturation",
      unit: "%",
      min: LIMITS.filterPercent.min,
      max: LIMITS.filterPercent.max,
      step: 1,
      get: () => image().saturate,
      set: (value) => setImage({ saturate: value }, "saturate"),
    },
    {
      type: "range",
      label: "Flou",
      unit: "px",
      min: 0,
      max: LIMITS.blurPx.max,
      step: 0.5,
      digits: 1,
      hint: "Utile pour détacher un texte posé sur un fond chargé.",
      get: () => image().blur,
      set: (value) => setImage({ blur: value }, "blur"),
    },
    {
      type: "range",
      label: "Vignettage",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
      get: () => Math.round(image().vignette * 100),
      set: (value) => setImage({ vignette: value / 100 }, "vignette"),
    },
    { type: "static", label: "Voile dégradé (lisibilité du texte)" },
    {
      type: "toggle",
      label: "Activer le voile",
      get: () => image().scrim.enabled,
      set: (value) => setImage({ scrim: { enabled: value } }, "scrimOn"),
    },
    ...alphaColorFields({
      label: "Voile — départ",
      get: () => image().scrim.from,
      set: (value, key) => setImage({ scrim: { from: value } }, key),
      key: "scrimFrom",
    }).map((field) => ({ ...field, disabled: () => !image().scrim.enabled })),
    ...alphaColorFields({
      label: "Voile — arrivée",
      get: () => image().scrim.to,
      set: (value, key) => setImage({ scrim: { to: value } }, key),
      key: "scrimTo",
    }).map((field) => ({ ...field, disabled: () => !image().scrim.enabled })),
    {
      type: "range",
      label: "Angle du voile",
      unit: "°",
      min: 0,
      max: 360,
      step: 1,
      hint: "180° = assombrit le bas, 90° = assombrit la droite.",
      get: () => image().scrim.angle,
      set: (value) => setImage({ scrim: { angle: value } }, "scrimAngle"),
      disabled: () => !image().scrim.enabled,
    },
  ]);

  /* ---------------------------------------------------------------- fond */
  const bgFields = mountFields($("#panel-bg", root), [
    {
      type: "segment",
      label: "Type de fond",
      options: [
        { value: "solid", label: "Uni" },
        { value: "gradient", label: "Dégradé" },
      ],
      get: () => background().type,
      set: (value) => store.updateBackground({ type: value }, "bgType"),
    },
    {
      type: "color",
      label: "Couleur de fond",
      get: () => background().color,
      set: (value) => store.updateBackground({ color: value }, "bgColor"),
    },
    {
      type: "color",
      label: "Dégradé — couleur 1",
      get: () => background().from,
      set: (value) => store.updateBackground({ from: value }, "bgFrom"),
      disabled: () => background().type !== "gradient",
    },
    {
      type: "color",
      label: "Dégradé — couleur 2",
      get: () => background().to,
      set: (value) => store.updateBackground({ to: value }, "bgTo"),
      disabled: () => background().type !== "gradient",
    },
    {
      type: "range",
      label: "Angle du dégradé",
      unit: "°",
      min: 0,
      max: 360,
      step: 1,
      get: () => background().angle,
      set: (value) => store.updateBackground({ angle: value }, "bgAngle"),
      disabled: () => background().type !== "gradient",
    },
    {
      type: "buttons",
      label: "Fond visible",
      hint: "Le fond apparaît quand la photo ne couvre pas toute la miniature.",
      wrap: true,
      actions: [
        {
          label: "Violet studio",
          onClick: () => store.updateBackground({ type: "gradient", from: "#2a0f4c", to: "#0b0614", angle: 135 }, "bgPreset"),
        },
        {
          label: "Nuit bleue",
          onClick: () => store.updateBackground({ type: "gradient", from: "#0f172a", to: "#1e1b4b", angle: 135 }, "bgPreset"),
        },
        {
          label: "Noir pur",
          onClick: () => store.updateBackground({ type: "solid", color: "#050308" }, "bgPreset"),
        },
      ],
    },
  ]);

  /* -------------------------------------------------- actions photo (DOM) */
  let refreshPhotoButtons = () => {};
  const photoButtons = $("#photo-actions", root);
  if (photoButtons) {
    const importBtn = el("button", {
      type: "button",
      class: "btn btn-primary btn-sm",
      text: "Importer / remplacer la photo",
      onClick: () => onPickPhoto?.(),
    });
    const removeBtn = el("button", {
      type: "button",
      class: "btn btn-ghost btn-sm",
      text: "Retirer la photo",
      onClick: () => onRemovePhoto?.(),
    });
    photoButtons.append(importBtn, removeBtn);
    refreshPhotoButtons = () => setDisabled(removeBtn, !image().dataUrl);
    refreshPhotoButtons();
  }

  /* ------------------------------------------------------------ rafraîchir */
  function refresh() {
    layersPanel.refresh();
    textFields();
    styleFields();
    photoFields();
    bgFields();
    refreshPhotoButtons();
    if (photoMeta) {
      const img = image();
      photoMeta.textContent = img.dataUrl
        ? `${img.name || "photo"} · ${img.naturalWidth} × ${img.naturalHeight} px`
        : "Aucune photo importée — le fond et les calques sont utilisés.";
      photoMeta.classList.toggle("is-empty", !img.dataUrl);
    }
  }

  const unsubscribe = store.subscribe(() => refresh());
  refresh();

  return { refresh, destroy: unsubscribe };
}
