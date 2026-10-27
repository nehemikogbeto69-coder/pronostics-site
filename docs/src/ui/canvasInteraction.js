/**
 * CTR Studio AI — interaction directe sur la miniature.
 *
 * Gère : sélection, déplacement, redimensionnement (8 poignées), rotation,
 * recadrage de la photo par glisser, double-tap pour éditer le texte.
 *
 * Tout est calculé en pixels « miniature » (1280×720) puis mis à l'échelle du
 * canvas affiché, donc le comportement est identique sur mobile et desktop.
 */

import { LIMITS, THUMB_HEIGHT, THUMB_WIDTH } from "../core/constants.js";
import {
  OPPOSITE_HANDLE,
  angleBetween,
  boxCenter,
  distance,
  handlePositions,
  pointInRotatedBox,
  rotatePoint,
  unrotatePoint,
} from "../core/geometry.js";
import { hitBounds, layoutText } from "../core/textLayout.js";
import { clamp, normalizeAngle } from "../core/utils.js";

const CURSORS = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  rotate: "grab",
  layer: "move",
  image: "move",
  none: "default",
};

export function createCanvasInteraction({ canvas, store, getHandleSize, onEditLayer, onStatus }) {
  const ctx = canvas.getContext("2d");
  let gesture = null;
  let lastTap = { time: 0, x: 0, y: 0, layerId: null };

  /* ------------------------------------------------------------- repères */

  function toCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * THUMB_WIDTH, -2000, THUMB_WIDTH + 2000),
      y: clamp(((event.clientY - rect.top) / rect.height) * THUMB_HEIGHT, -2000, THUMB_HEIGHT + 2000),
    };
  }

  function layoutOf(layer) {
    return layoutText(ctx, layer);
  }

  function pivotOf(layout) {
    return boxCenter(layout.box);
  }

  function currentHandles(layer) {
    const layout = layoutOf(layer);
    return { layout, handles: handlePositions(layout.box, getHandleSize()), pivot: pivotOf(layout) };
  }

  /* ---------------------------------------------------------- test de cible */

  function findHandle(point) {
    const layer = store.selectedLayer();
    if (!layer || layer.visible === false) return null;
    const { layout, handles, pivot } = currentHandles(layer);
    const local = unrotatePoint(point, pivot, layer.rotation);
    const size = getHandleSize();
    const tolerance = size * 0.95;
    let best = null;
    let bestDistance = Infinity;
    for (const [name, position] of Object.entries(handles)) {
      const d = Math.hypot(local.x - position.x, local.y - position.y);
      if (d <= tolerance && d < bestDistance) {
        best = { name, layout, pivot, handles };
        bestDistance = d;
      }
    }
    return best;
  }

  function findLayer(point) {
    const layers = store.comp.layers;
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const layer = layers[i];
      if (layer.visible === false) continue;
      const layout = layoutOf(layer);
      const bounds = hitBounds(layer, layout, getHandleSize() * 0.35);
      const pivot = pivotOf(layout);
      if (pointInRotatedBox(point, bounds, pivot, layer.rotation)) {
        return { layer, layout, pivot };
      }
    }
    return null;
  }

  /* --------------------------------------------------------------- gestes */

  function beginResize(event, point, target) {
    const layer = store.selectedLayer();
    const { layout, pivot } = target;
    const anchorName = OPPOSITE_HANDLE[target.name];
    const handles = handlePositions(layout.box, getHandleSize());
    const anchorLocal = handles[anchorName] ?? { x: layout.box.x, y: layout.box.y };
    return {
      mode: target.name === "rotate" ? "rotate" : "resize",
      handle: target.name,
      layerId: layer.id,
      snapshot: store.snapshot(),
      start: point,
      pivot,
      anchorName,
      anchorLocal,
      anchorGlobal: rotatePoint(anchorLocal, pivot, layer.rotation),
      base: {
        fontSize: layer.fontSize,
        boxWidth: layer.boxWidth,
        wrap: layer.wrap,
        x: layer.x,
        y: layer.y,
        rotation: layer.rotation,
        width: Math.max(1, layout.box.width),
        height: Math.max(1, layout.box.height),
        startAngle: angleBetween(pivot, point),
      },
      changed: false,
    };
  }

  function applyResize(pointer, shiftKey) {
    const layer = store.comp.layers.find((l) => l.id === gesture.layerId);
    if (!layer) return;
    const { base, pivot } = gesture;
    const local = unrotatePoint(pointer, pivot, layer.rotation);
    const ax = gesture.anchorLocal.x;
    const ay = gesture.anchorLocal.y;

    let ratio = 1;
    let widthRatio = 1;
    let explicitBoxWidth = null;

    if (gesture.handle === "n" || gesture.handle === "s") {
      ratio = Math.abs(local.y - ay) / Math.max(1, base.height);
    } else if (gesture.handle === "e" || gesture.handle === "w") {
      widthRatio = Math.abs(local.x - ax) / Math.max(1, base.width);
      if (base.wrap) explicitBoxWidth = Math.abs(local.x - ax);
      else ratio = widthRatio;
    } else {
      /* Poignée d'angle : mise à l'échelle uniforme, mesurée depuis le coin opposé. */
      const initialDistance = Math.max(1, Math.hypot(base.width, base.height));
      ratio = distance(local, gesture.anchorLocal) / initialDistance;
      widthRatio = Math.abs(local.x - ax) / Math.max(1, base.width);
    }

    if (shiftKey && gesture.handle !== "rotate") {
      ratio = Math.round(ratio * 20) / 20;
      widthRatio = Math.round(widthRatio * 20) / 20;
    }

    const nextFontSize = clamp(base.fontSize * clamp(ratio, 0.05, 20), LIMITS.fontSize.min, LIMITS.fontSize.max);
    const patch = { fontSize: nextFontSize };
    if (explicitBoxWidth !== null) {
      patch.wrap = true;
      patch.boxWidth = clamp(explicitBoxWidth, 120, LIMITS.boxWidth.max);
    } else if (base.wrap) {
      patch.boxWidth = clamp(base.boxWidth * clamp(widthRatio, 0.1, 10), 120, LIMITS.boxWidth.max);
    }

    layer.fontSize = patch.fontSize;
    if (patch.boxWidth !== undefined) {
      layer.wrap = true;
      layer.boxWidth = patch.boxWidth;
    }

    /* Ré-ancrage : le coin opposé à la poignée saisie ne doit pas bouger. */
    const nextLayout = layoutOf(layer);
    const nextPivot = pivotOf(nextLayout);
    const nextHandles = handlePositions(nextLayout.box, getHandleSize());
    const nextAnchorLocal = nextHandles[gesture.anchorName] ?? { x: nextLayout.box.x, y: nextLayout.box.y };
    const nextAnchorGlobal = rotatePoint(nextAnchorLocal, nextPivot, layer.rotation);
    layer.x += gesture.anchorGlobal.x - nextAnchorGlobal.x;
    layer.y += gesture.anchorGlobal.y - nextAnchorGlobal.y;

    if (Math.abs(layer.fontSize - base.fontSize) > 0.01 || layer.x !== base.x || layer.y !== base.y) {
      gesture.changed = true;
    }
    onStatus?.(`Taille ${Math.round(layer.fontSize)} px`);
  }

  function applyRotate(pointer, shiftKey) {
    const layer = store.comp.layers.find((l) => l.id === gesture.layerId);
    if (!layer) return;
    const { pivot, base } = gesture;
    const angle = angleBetween(pivot, pointer) - base.startAngle + base.rotation;
    let next = normalizeAngle(angle);
    if (shiftKey) next = Math.round(next / 15) * 15;
    layer.rotation = clamp(next, LIMITS.rotation.min, LIMITS.rotation.max);
    gesture.changed = true;
    onStatus?.(`Rotation ${Math.round(layer.rotation)}°`);
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0 && event.pointerType === "mouse") return;
    const point = toCanvasPoint(event);
    const handle = findHandle(point);

    if (handle) {
      gesture = beginResize(event, point, handle);
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    const hit = findLayer(point);
    if (hit) {
      store.setSelection(hit.layer.id);
      gesture = {
        mode: "move",
        layerId: hit.layer.id,
        snapshot: store.snapshot(),
        start: point,
        base: { x: hit.layer.x, y: hit.layer.y },
        changed: false,
      };
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      detectDoubleTap(point, hit.layer.id);
      return;
    }

    /* Zone vide : on déplace la photo si elle existe, sinon on désélectionne. */
    if (store.comp.image.dataUrl && store.image) {
      gesture = {
        mode: "pan",
        snapshot: store.snapshot(),
        start: point,
        base: { offsetX: store.comp.image.offsetX, offsetY: store.comp.image.offsetY },
        changed: false,
      };
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      onStatus?.("Recadrage de la photo");
      return;
    }

    if (store.selection) {
      store.setSelection(null);
      onStatus?.("Aucun calque sélectionné");
    }
  }

  function detectDoubleTap(point, layerId) {
    const now = Date.now();
    const isDouble =
      now - lastTap.time < 340 &&
      lastTap.layerId === layerId &&
      Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 28;
    lastTap = { time: now, x: point.x, y: point.y, layerId };
    if (isDouble) {
      gesture = null;
      onEditLayer?.(layerId);
    }
  }

  function onPointerMove(event) {
    const point = toCanvasPoint(event);
    if (!gesture) {
      updateCursor(point, event.pointerType);
      return;
    }
    if (gesture.mode === "move") {
      const layer = store.comp.layers.find((l) => l.id === gesture.layerId);
      if (!layer) return;
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      const step = event.shiftKey ? Math.round(dx / 10) * 10 : dx;
      const stepY = event.shiftKey ? Math.round(dy / 10) * 10 : dy;
      layer.x = Math.round((gesture.base.x + step) * 10) / 10;
      layer.y = Math.round((gesture.base.y + stepY) * 10) / 10;
      gesture.changed = gesture.changed || step !== 0 || stepY !== 0;
      onStatus?.(`x ${Math.round(layer.x)} · y ${Math.round(layer.y)}`);
      store.emit("transform");
      return;
    }
    if (gesture.mode === "pan") {
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      store.comp.image.offsetX = clamp(gesture.base.offsetX + dx, -THUMB_WIDTH, THUMB_WIDTH);
      store.comp.image.offsetY = clamp(gesture.base.offsetY + dy, -THUMB_HEIGHT, THUMB_HEIGHT);
      gesture.changed = true;
      store.emit("transform");
      return;
    }
    if (gesture.mode === "rotate") applyRotate(point, event.shiftKey);
    else applyResize(point, event.shiftKey);
    store.emit("transform");
  }

  function onPointerUp(event) {
    if (!gesture) return;
    const finished = gesture;
    gesture = null;
    canvas.releasePointerCapture?.(event.pointerId);
    if (finished.changed && finished.snapshot) {
      store.pushSnapshot(finished.snapshot);
      store.emit("commit");
    } else {
      store.emit("transform");
    }
    onStatus?.("");
  }

  function onPointerCancel(event) {
    if (gesture?.snapshot && gesture.changed) {
      store.loadSnapshot(gesture.snapshot, "cancel");
    }
    gesture = null;
    canvas.releasePointerCapture?.(event.pointerId);
    onStatus?.("");
  }

  function updateCursor(point, pointerType) {
    if (pointerType && pointerType !== "mouse") return;
    const handle = findHandle(point);
    if (handle) {
      canvas.style.cursor = CURSORS[handle.name] ?? "pointer";
      return;
    }
    const hit = findLayer(point);
    if (hit) {
      canvas.style.cursor = CURSORS.layer;
      return;
    }
    canvas.style.cursor = store.comp.image.dataUrl ? CURSORS.image : CURSORS.none;
  }

  function attach() {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("pointerleave", () => {
      if (!gesture) canvas.style.cursor = CURSORS.none;
    });
    canvas.addEventListener("dblclick", (event) => {
      const point = toCanvasPoint(event);
      const hit = findLayer(point);
      if (hit) {
        store.setSelection(hit.layer.id);
        onEditLayer?.(hit.layer.id);
      }
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  attach();

  return {
    destroy() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
    },
    get isDragging() {
      return !!gesture;
    },
    toCanvasPoint,
  };
}
