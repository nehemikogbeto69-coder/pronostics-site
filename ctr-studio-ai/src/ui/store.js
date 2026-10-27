/**
 * CTR Studio AI — état de l'éditeur (mini-store sans dépendance).
 *
 * Contient la composition, la photo décodée, la sélection et l'historique.
 * Les vues s'abonnent ; chaque action notifie avec une raison explicite.
 */

import {
  addTextLayer,
  createComposition,
  deserializeProject,
  duplicateLayer,
  findLayer,
  removeLayer,
  reorderLayer,
  serializeProject,
  updateLayer,
} from "../core/composition.js";
import { HISTORY_LIMIT } from "../core/constants.js";
import { applyTemplate } from "../core/templates.js";
import { loadImageDataUrl } from "../io/imageImport.js";
import { loadFromLocal, saveToLocal } from "../io/storage.js";
import { debounce } from "../core/utils.js";

const AUTOSAVE_DELAY = 900;

function createStore() {
  const listeners = new Set();

  const state = {
    comp: createComposition(),
    image: null, // drawable décodé (HTMLImageElement | ImageBitmap | canvas)
    selection: null,
    guides: false,
    lastWarning: null,
    past: [],
    future: [],
    _lastKey: null,
    _lastTime: 0,
  };

  const autosave = debounce(() => {
    const report = saveToLocal(state.comp, { quiet: true });
    if (!report.ok) state.lastWarning = report.message;
  }, AUTOSAVE_DELAY);

  function emit(reason = "change") {
    for (const listener of listeners) {
      try {
        listener(reason, state);
      } catch (err) {
        console.error("[CTR Studio] vue en échec", reason, err);
      }
    }
    if (reason !== "selection" && reason !== "view") autosave();
  }

  const api = {
    state,

    get comp() {
      return state.comp;
    },
    get image() {
      return state.image;
    },
    get selection() {
      return state.selection;
    },
    get guides() {
      return state.guides;
    },
    set guides(value) {
      state.guides = !!value;
    },

    /** Bascule les guides (tiers, marges, zone horodatage) et redessine. */
    toggleGuides() {
      state.guides = !state.guides;
      emit("view");
      return state.guides;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit,

    /* --------------------------------------------------------- historique */

    snapshot() {
      return JSON.stringify(serializeProject(state.comp));
    },

    /** Mémorise l'état courant avant une modification (throttle par clé). */
    pushHistory(key = null) {
      const now = Date.now();
      if (key && state._lastKey === key && now - state._lastTime < 700) {
        state._lastTime = now;
        return false;
      }
      state._lastKey = key;
      state._lastTime = now;
      return api.pushSnapshot(api.snapshot());
    },

    pushSnapshot(json) {
      state.past.push(json);
      if (state.past.length > HISTORY_LIMIT) state.past.shift();
      state.future.length = 0;
      state._lastKey = null;
      return true;
    },

    get canUndo() {
      return state.past.length > 0;
    },
    get canRedo() {
      return state.future.length > 0;
    },

    undo() {
      if (!state.past.length) return false;
      state.future.push(api.snapshot());
      api.loadSnapshot(state.past.pop(), "undo");
      return true;
    },

    redo() {
      if (!state.future.length) return false;
      state.past.push(api.snapshot());
      api.loadSnapshot(state.future.pop(), "redo");
      return true;
    },

    loadSnapshot(json, reason = "load") {
      try {
        const comp = deserializeProject(json);
        state.comp = comp;
        api.syncSelection();
        api.syncImage();
        emit(reason);
        return true;
      } catch (err) {
        console.error("[CTR Studio] restauration impossible", err);
        return false;
      }
    },

    /* ------------------------------------------------------------ calques */

    selectedLayer() {
      return state.selection ? findLayer(state.comp, state.selection) : null;
    },

    setSelection(id, { notify = true } = {}) {
      if (state.selection === id) return;
      state.selection = id && findLayer(state.comp, id) ? id : null;
      if (notify) emit("selection");
    },

    syncSelection() {
      if (state.selection && !findLayer(state.comp, state.selection)) {
        state.selection = state.comp.layers.length ? state.comp.layers[state.comp.layers.length - 1].id : null;
      }
    },

    updateSelected(patch, key = null) {
      const layer = api.selectedLayer();
      if (!layer) return null;
      if (key !== null) api.pushHistory(key);
      const updated = updateLayer(state.comp, layer.id, patch);
      emit("layer");
      return updated;
    },

    updateLayerById(id, patch, key = null) {
      if (key !== null) api.pushHistory(key);
      const updated = updateLayer(state.comp, id, patch);
      emit("layer");
      return updated;
    },

    addLayer(partial = {}) {
      api.pushHistory("add-layer");
      const layer = addTextLayer(state.comp, partial);
      state.selection = layer.id;
      emit("layers");
      return layer;
    },

    removeLayer(id) {
      if (!findLayer(state.comp, id)) return false;
      api.pushHistory("remove-layer");
      const index = state.comp.layers.findIndex((l) => l.id === id);
      removeLayer(state.comp, id);
      const remaining = state.comp.layers;
      state.selection = remaining.length
        ? remaining[Math.max(0, Math.min(index, remaining.length - 1))].id
        : null;
      emit("layers");
      return true;
    },

    duplicateSelected() {
      const layer = api.selectedLayer();
      if (!layer) return null;
      api.pushHistory("duplicate");
      const copy = duplicateLayer(state.comp, layer.id);
      state.selection = copy?.id ?? null;
      emit("layers");
      return copy;
    },

    moveSelected(direction) {
      const layer = api.selectedLayer();
      if (!layer) return false;
      api.pushHistory("reorder");
      reorderLayer(state.comp, layer.id, direction);
      emit("layers");
      return true;
    },

    /* ---------------------------------------------------------- composition */

    applyTemplate(id) {
      api.pushHistory("template");
      applyTemplate(state.comp, id);
      state.selection = state.comp.layers.length ? state.comp.layers[state.comp.layers.length - 1].id : null;
      emit("template");
    },

    updateBackground(patch, key = null) {
      if (key !== null) api.pushHistory(key);
      Object.assign(state.comp.background, patch);
      emit("background");
    },

    updateImage(patch, key = null) {
      if (key !== null) api.pushHistory(key);
      Object.assign(state.comp.image, patch);
      if (patch.scrim) Object.assign(state.comp.image.scrim, patch.scrim);
      emit("image");
    },

    setMeta(patch, key = null) {
      if (key !== null) api.pushHistory(key);
      Object.assign(state.comp.meta, patch);
      emit("meta");
    },

    /** Installe une photo décodée (import utilisateur). */
    setPhoto({ drawable, dataUrl = null, width = 0, height = 0, name = "" }) {
      api.pushHistory("photo");
      state.image = drawable ?? null;
      state.comp.image.dataUrl = dataUrl;
      state.comp.image.name = name;
      state.comp.image.naturalWidth = width || drawable?.naturalWidth || drawable?.width || 0;
      state.comp.image.naturalHeight = height || drawable?.naturalHeight || drawable?.height || 0;
      emit("photo");
    },

    clearPhoto() {
      if (!state.comp.image.dataUrl && !state.image) return false;
      api.pushHistory("photo");
      state.image = null;
      state.comp.image.dataUrl = null;
      state.comp.image.name = "";
      state.comp.image.naturalWidth = 0;
      state.comp.image.naturalHeight = 0;
      state.comp.image.zoom = 1;
      state.comp.image.offsetX = 0;
      state.comp.image.offsetY = 0;
      emit("photo");
      return true;
    },

    /**
     * Recharge la photo depuis le dataURL de la composition (projet restauré,
     * annuler/rétablir…). Asynchrone, silencieux en cas d'échec.
     */
    async syncImage() {
      const dataUrl = state.comp.image?.dataUrl;
      if (!dataUrl) {
        if (state.image) {
          state.image = null;
          emit("photo");
        }
        return false;
      }
      try {
        const loaded = await loadImageDataUrl(dataUrl);
        state.image = loaded.drawable;
        state.comp.image.naturalWidth = state.comp.image.naturalWidth || loaded.width;
        state.comp.image.naturalHeight = state.comp.image.naturalHeight || loaded.height;
        emit("photo");
        return true;
      } catch (err) {
        console.warn("[CTR Studio] photo illisible dans le projet", err);
        state.image = null;
        emit("photo");
        return false;
      }
    },

    /** Remplace toute la composition (import de projet, modèle complet). */
    loadComposition(comp, { keepImage = null } = {}) {
      api.pushHistory("load-project");
      state.comp = comp;
      if (keepImage !== null) state.image = keepImage;
      api.syncSelection();
      emit("load");
      api.syncImage();
    },

    reset() {
      api.pushHistory("reset");
      state.comp = createComposition();
      state.image = null;
      state.selection = state.comp.layers[0]?.id ?? null;
      emit("reset");
    },

    /* ------------------------------------------------------------ persistance */

    saveLocal() {
      return saveToLocal(state.comp);
    },

    restoreLocal() {
      const comp = loadFromLocal();
      if (!comp) return false;
      state.comp = comp;
      state.past.length = 0;
      state.future.length = 0;
      api.syncSelection();
      emit("restore");
      api.syncImage();
      return true;
    },

    serialize() {
      return serializeProject(state.comp);
    },
  };

  return api;
}

export const store = createStore();
