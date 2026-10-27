/**
 * CTR Studio AI — la scène : canvas d'aperçu, boucle de rendu, cache du fond.
 *
 * Le canvas d'aperçu fait exactement 1280×720 pixels de mémoire ; le CSS se
 * charge de l'adapter à l'écran. L'aperçu est donc toujours net (sur-échantillonné
 * sur mobile) et strictement identique à l'export.
 */

import { THUMB_HEIGHT, THUMB_WIDTH } from "../core/constants.js";
import { drawBase, drawTextLayers } from "../core/renderer.js";
import { on } from "./dom.js";

export function createStage({ canvas, store, onEditLayer, onStatus }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible sur ce navigateur.");
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;

  let baseCanvas = null;
  let baseCache = null;
  let pending = false;
  let frame = 0;
  let lastReport = { warnings: [], filterSupport: true };
  let handleSize = 18;

  function baseKey() {
    const image = store.comp.image;
    return JSON.stringify({
      bg: store.comp.background,
      img: {
        fit: image.fit,
        zoom: image.zoom,
        offsetX: image.offsetX,
        offsetY: image.offsetY,
        flipH: image.flipH,
        flipV: image.flipV,
        brightness: image.brightness,
        contrast: image.contrast,
        saturate: image.saturate,
        blur: image.blur,
        vignette: image.vignette,
        scrim: image.scrim,
      },
    });
  }

  function baseIsValid() {
    if (!baseCache) return false;
    if (baseCache.drawable !== (store.image ?? null)) return false;
    return baseCache.key === baseKey();
  }

  function rebuildBase() {
    if (!baseCanvas) {
      baseCanvas = document.createElement("canvas");
      baseCanvas.width = THUMB_WIDTH;
      baseCanvas.height = THUMB_HEIGHT;
    }
    const bctx = baseCanvas.getContext("2d");
    lastReport = drawBase(bctx, store.comp, {
      image: store.image,
      editable: true,
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
    });
    baseCache = { key: baseKey(), drawable: store.image ?? null };
    return lastReport;
  }

  function paint() {
    pending = false;
    if (!baseIsValid()) rebuildBase();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    ctx.drawImage(baseCanvas, 0, 0);
    drawTextLayers(ctx, store.comp, {
      editable: true,
      selectedId: store.selection,
      guides: store.guides,
      handleSize,
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
    });
  }

  /** Rendu différé : plusieurs modifications = une seule passe par frame. */
  function requestRender() {
    if (pending) return;
    pending = true;
    frame = requestAnimationFrame(paint);
  }

  function renderNow() {
    if (pending) {
      cancelAnimationFrame(frame);
      pending = false;
    }
    paint();
  }

  function updateHandleSize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    /* Poignées de taille constante à l'écran, quelle que soit la largeur. */
    handleSize = Math.round(Math.min(46, Math.max(11, 17 * (THUMB_WIDTH / rect.width))));
  }

  const stopResize = on(window, "resize", () => {
    updateHandleSize();
    requestRender();
  });

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      updateHandleSize();
      requestRender();
    });
    observer.observe(canvas);
  }

  updateHandleSize();
  renderNow();

  const unsubscribe = store.subscribe((reason) => {
    if (reason === "selection" || reason === "transform" || reason === "view") requestRender();
    else renderNow();
  });

  return {
    canvas,
    ctx,
    requestRender,
    renderNow,
    getHandleSize: () => handleSize,
    getReport: () => lastReport,
    onEditLayer,
    onStatus,
    destroy() {
      unsubscribe();
      stopResize();
      if (pending) cancelAnimationFrame(frame);
    },
  };
}
