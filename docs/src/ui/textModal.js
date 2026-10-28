/**
 * CTR Studio AI — éditeur de texte (feuille modale).
 *
 * Double-tap sur un calque, bouton « Modifier » ou « + Ajouter du texte » :
 * la saisie est plus confortable ici que dans l'inspecteur, surtout sur mobile.
 * Les réglages rapides s'appliquent en direct (aperçu immédiat sur la miniature)
 * et « Annuler » restaure l'état d'avant l'ouverture.
 */

import { $, el, on } from "./dom.js";
import { mountFields } from "./controls.js";
import { availableFonts } from "../core/fonts.js";
import { LIMITS } from "../core/constants.js";

export function createTextModal({ root, store }) {
  const modal = $("#text-modal", root);
  const input = $("#text-modal-input", root);
  const quickHost = $("#text-modal-quick", root);
  const applyButton = $("#text-modal-apply", root);
  const titleNode = $("#text-modal-title", root);

  let openLayerId = null;
  let snapshot = null;
  let quickRefresh = () => {};
  let detachEscape = null;

  if (!modal || !input) {
    return { open() {}, close() {}, get isOpen() { return false; } };
  }

  quickRefresh = mountFields(quickHost, [
    {
      type: "range",
      label: "Taille",
      unit: "px",
      min: LIMITS.fontSize.min,
      max: LIMITS.fontSize.max,
      step: 1,
      get: () => store.selectedLayer()?.fontSize ?? 0,
      set: (value) => store.updateSelected({ fontSize: value }, "fontSize"),
      disabled: () => !store.selectedLayer(),
    },
    {
      type: "select",
      label: "Police",
      getOptions: () => availableFonts(store.comp).map((font) => ({ value: font.id, label: font.label })),
      get: () => store.selectedLayer()?.fontFamily ?? "system",
      set: (value) => store.updateSelected({ fontFamily: value }, "font"),
      disabled: () => !store.selectedLayer(),
    },
    {
      type: "segment",
      label: "Alignement",
      options: [
        { value: "left", label: "Gauche" },
        { value: "center", label: "Centre" },
        { value: "right", label: "Droite" },
      ],
      get: () => store.selectedLayer()?.align ?? "left",
      set: (value) => store.updateSelected({ align: value }, "align"),
      disabled: () => !store.selectedLayer(),
    },
    {
      type: "color",
      label: "Couleur",
      get: () => store.selectedLayer()?.fill?.color ?? "#ffffff",
      set: (value) => store.updateSelected({ fill: { color: value } }, "fillColor"),
      disabled: () => !store.selectedLayer(),
    },
    {
      type: "toggle",
      label: "CAPITALES",
      get: () => store.selectedLayer()?.uppercase ?? false,
      set: (value) => store.updateSelected({ uppercase: value }, "uppercase"),
      disabled: () => !store.selectedLayer(),
    },
  ]);

  function syncFromLayer() {
    const layer = store.selectedLayer();
    input.value = layer?.text ?? "";
    if (titleNode) titleNode.textContent = layer ? `Modifier « ${layer.name} »` : "Modifier le texte";
    quickRefresh();
  }

  function open(layerId) {
    if (layerId) store.setSelection(layerId);
    if (!store.selectedLayer()) return false;
    openLayerId = store.selection;
    snapshot = store.snapshot();
    modal.hidden = false;
    document.body.classList.add("has-modal");
    syncFromLayer();
    detachEscape = on(document, "keydown", onKeydown);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return true;
  }

  function close({ cancel = false } = {}) {
    if (modal.hidden) return;
    if (cancel && snapshot) store.loadSnapshot(snapshot, "modal-cancel");
    modal.hidden = true;
    document.body.classList.remove("has-modal");
    detachEscape?.();
    detachEscape = null;
    snapshot = null;
    openLayerId = null;
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close({ cancel: true });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  }

  function commit() {
    const layer = store.selectedLayer();
    if (!layer) return;
    store.updateSelected({ text: input.value }, "text");
    /* Le nom du calque suit son contenu (liste de calques plus lisible). */
    const firstLine = input.value.split("\n")[0]?.trim() || "Texte";
    store.updateSelected({ name: firstLine.slice(0, 28) }, null);
    close();
  }

  on(input, "input", () => {
    store.updateSelected({ text: input.value }, "text");
  });
  on(applyButton, "click", commit);
  modal.querySelectorAll("[data-close]").forEach((node) =>
    on(node, "click", () => close({ cancel: true })),
  );

  const unsubscribe = store.subscribe((reason) => {
    if (modal.hidden) return;
    if (reason === "selection" && store.selection !== openLayerId) {
      close({ cancel: true });
      return;
    }
    quickRefresh();
  });

  return {
    open,
    close,
    get isOpen() {
      return !modal.hidden;
    },
    destroy() {
      unsubscribe();
      detachEscape?.();
    },
  };
}
