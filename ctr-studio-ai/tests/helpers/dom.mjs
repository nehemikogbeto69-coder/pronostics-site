/**
 * Environnement DOM de test (jsdom) pour CTR Studio AI.
 *
 * jsdom ne sait pas dessiner : on branche `HTMLCanvasElement.getContext`,
 * `toBlob` et `toDataURL` sur `@napi-rs/canvas` (Skia). Les modules testés
 * utilisent donc le VRAI code de rendu et le VRAI encodeur PNG — pas de
 * simulation.
 *
 * @param {{ html?: string, width?: number, height?: number }} [options]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { Canvas as NapiCanvas, loadImage as napiLoadImage } from "@napi-rs/canvas";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, "..", "..");

/** Lit un fichier du projet (index.html, modules…). */
export function projectFile(...parts) {
  return readFileSync(path.join(PROJECT_ROOT, ...parts), "utf8");
}

export async function createDom({ html = projectFile("index.html"), width = 1440, height = 900 } = {}) {
  /* jsdom signale bruyamment ce qu'il n'implémente pas (navigation sur un lien
     de téléchargement, execCommand…). On filtre ces bruitages : le code testé
     les gère déjà proprement. */
  const virtualConsole = new VirtualConsole();
  const IGNORED = [/not implemented/i, /navigation/i, /could not parse css/i, /error: could not/i];
  virtualConsole.on("jsdomError", (error) => {
    const message = String(error?.message ?? error);
    if (!IGNORED.some((rx) => rx.test(message))) console.error("[jsdom]", error);
  });
  virtualConsole.on("error", (...args) => {
    const message = args.map(String).join(" ");
    if (!IGNORED.some((rx) => rx.test(message))) console.error("[jsdom:console]", message);
  });

  const dom = new JSDOM(html, {
    url: "http://localhost/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
    virtualConsole,
  });
  const { window } = dom;

  Object.defineProperty(window, "innerWidth", { value: width, writable: true });
  Object.defineProperty(window, "innerHeight", { value: height, writable: true });
  Object.defineProperty(window, "devicePixelRatio", { value: 1, writable: true });

  /* ---------------------------------------------------- pont canvas 2D */
  const backing = new WeakMap();

  /* Les canvas créés par le code (cache de rendu, export, redimensionnement)
     doivent être de VRAIS canvas Skia pour pouvoir être redessinés via
     drawImage. On intercepte donc createElement('canvas'). */
  NapiCanvas.prototype.toBlob = function toBlob(callback, type = "image/png", quality) {
    try {
      const enc = String(type).includes("jpeg") ? "jpeg" : "png";
      const buffer = this.encodeSync(enc, quality);
      const blob = new window.Blob([new Uint8Array(buffer)], { type });
      if (typeof callback === "function") callback(blob);
      return Promise.resolve(blob);
    } catch (err) {
      if (typeof callback === "function") callback(null);
      return Promise.reject(err);
    }
  };

  function makeSkiaCanvas(width = 300, height = 150) {
    const created = new NapiCanvas(width, height);
    created.style = {};
    created.dataset = {};
    created.hidden = false;
    created.nodeName = "CANVAS";
    created.classList = {
      _set: new Set(),
      add(...names) {
        names.forEach((n) => this._set.add(n));
      },
      remove(...names) {
        names.forEach((n) => this._set.delete(n));
      },
      toggle(name, force) {
        const on = force ?? !this._set.has(name);
        if (on) this._set.add(name);
        else this._set.delete(name);
        return on;
      },
      contains: (name) => created.classList._set.has(name),
    };
    for (const method of ["setAttribute", "getAttribute", "appendChild", "append", "remove", "addEventListener", "removeEventListener"]) {
      created[method] = () => undefined;
    }
    return created;
  }

  const originalCreateElement = window.document.createElement.bind(window.document);
  window.document.createElement = function createElement(tagName, options) {
    if (String(tagName).toLowerCase() === "canvas") return makeSkiaCanvas();
    return originalCreateElement(tagName, options);
  };


  function backingOf(element) {
    const w = Number(element.width) || 300;
    const h = Number(element.height) || 150;
    let canvas = backing.get(element);
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = new NapiCanvas(w, h);
      backing.set(element, canvas);
    }
    return canvas;
  }

  window.HTMLCanvasElement.prototype.getContext = function getContext(type, attrs) {
    if (String(type).toLowerCase() !== "2d") return null;
    return backingOf(this).getContext("2d", attrs);
  };

  window.HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type = "image/png", quality) {
    const enc = String(type).includes("jpeg") ? "jpeg" : "png";
    backingOf(this)
      .encode(enc, quality)
      .then((buffer) => callback(new window.Blob([new Uint8Array(buffer)], { type })))
      .catch(() => callback(null));
  };

  window.HTMLCanvasElement.prototype.toDataURL = function toDataURL(type = "image/png", quality) {
    const enc = String(type).includes("jpeg") ? "jpeg" : "png";
    const buffer = backingOf(this).encodeSync(enc, quality);
    return `data:${type};base64,${Buffer.from(buffer).toString("base64")}`;
  };

  /** Accès direct au canvas Skia d'un élément (assertions de pixels). */
  window.__backingCanvas = (element) => backing.get(element) ?? null;

  /* --------------------------------------------- API navigateur manquantes */
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    let matches = true;
    if (max) matches = window.innerWidth <= Number(max[1]);
    else if (min) matches = window.innerWidth >= Number(min[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    };
  };

  window.createImageBitmap = async (source) => {
    if (source instanceof window.HTMLCanvasElement) {
      const buffer = backingOf(source).encodeSync("png");
      return napiLoadImage(buffer);
    }
    if (source instanceof window.HTMLImageElement && source.src.startsWith("data:")) {
      const base64 = source.src.split(",")[1] ?? "";
      return napiLoadImage(Buffer.from(base64, "base64"));
    }
    const bytes = new Uint8Array(await source.arrayBuffer());
    return napiLoadImage(bytes);
  };

  if (!window.URL.createObjectURL) {
    const store = new Map();
    let counter = 0;
    window.URL.createObjectURL = (blob) => {
      const url = `blob:local/${(counter += 1)}`;
      store.set(url, blob);
      return url;
    };
    window.URL.revokeObjectURL = (url) => store.delete(url);
    window.__blobStore = store;
  }

  if (!window.navigator.clipboard) {
    Object.defineProperty(window.navigator, "clipboard", {
      value: {
        _text: null,
        async writeText(text) {
          this._text = text;
        },
      },
      configurable: true,
    });
  }

  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  /* ------------------------------------------------ publication des globaux */
  const globals = [
    "window",
    "document",
    "navigator",
    "location",
    "history",
    "localStorage",
    "HTMLElement",
    "HTMLCanvasElement",
    "HTMLImageElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
    "File",
    "FileList",
    "Blob",
    "FileReader",
    "URL",
    "DOMParser",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "matchMedia",
    "ResizeObserver",
    "createImageBitmap",
    "atob",
    "btoa",
    "Image",
  ];

  /* Certains globaux Node (navigator…) sont en lecture seule : on passe par
     defineProperty, en conservant le descripteur d'origine pour la restauration. */
  const saved = new Map();
  const define = (name, value) => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  for (const name of globals) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    if (window[name] !== undefined) define(name, window[name]);
  }
  define("window", window);
  define("self", window);

  function destroy() {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    dom.window.close();
  }

  return { dom, window, destroy };
}

/* ------------------------------------------------------------------ utilitaires */

/** Attend qu'une condition soit vraie (UI asynchrone : export, rendu, import). */
export async function waitFor(predicate, { timeout = 4000, interval = 15, label = "condition" } = {}) {
  const started = Date.now();
  for (;;) {
    let value;
    try {
      value = await predicate();
    } catch {
      value = false;
    }
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`waitFor: « ${label} » non atteint après ${timeout} ms`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** Laisse tourner les micro-tâches / timers pending. */
export function settle(ms = 40) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Événement pointeur réaliste sur un élément canvas. */
export function pointer(window, canvas, type, { x, y, rect, shift = false, pointerId = 1 }) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + x,
    clientY: rect.top + y,
    shiftKey: shift,
    button: 0,
  });
  event.pointerId = pointerId;
  event.isPrimary = true;
  event.pointerType = "mouse";
  canvas.dispatchEvent(event);
  return event;
}

/** Force une géométrie stable pour un élément (jsdom ne fait pas de layout). */
export function stubRect(window, element, rect) {
  element.getBoundingClientRect = () => ({
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: (rect.left ?? 0) + rect.width,
    bottom: (rect.top ?? 0) + rect.height,
    width: rect.width,
    height: rect.height,
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    toJSON: () => rect,
  });
}

/** Crée un File image réel (PNG encodé par Skia). */
export async function imageFile(window, { width = 640, height = 360, kind = "split", name = "photo.png" } = {}) {
  const canvas = new NapiCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (kind === "split") {
    ctx.fillStyle = "#101820";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#f5f7fa";
    ctx.fillRect(0, 0, Math.round(width / 2), height);
  } else {
    ctx.fillStyle = "#7c3aed";
    ctx.fillRect(0, 0, width, height);
  }
  const bytes = await canvas.encode("png");
  const file = new window.File([new Uint8Array(bytes)], name, { type: "image/png" });
  return { file, bytes: new Uint8Array(bytes) };
}
