/**
 * CTR Studio AI — point d'entrée.
 *
 * Assemble la boutique (store), la scène, l'inspecteur, les modales et les
 * trois vues (éditeur / analyse / idées), gère la navigation et les passages
 * d'une fonctionnalité à l'autre.
 */

import { THUMB_HEIGHT, THUMB_WIDTH } from "./core/constants.js";
import { $, $$, el, on } from "./ui/dom.js";
import { icon } from "./ui/icons.js";
import { store } from "./ui/store.js";
import { createStage } from "./ui/stage.js";
import { createInspector } from "./ui/inspector.js";
import { createCanvasInteraction } from "./ui/canvasInteraction.js";
import { createTextModal } from "./ui/textModal.js";
import { createExportPanel } from "./ui/exportPanel.js";
import { createEditorView } from "./ui/editorView.js";
import { createAnalysisView } from "./ui/analysisView.js";
import { createIdeasView } from "./ui/ideasView.js";
import { toast, toastError, toastSuccess } from "./ui/toast.js";

const VIEWS = ["editor", "analysis", "ideas"];
const TAB_ICONS = { editor: "layers", analysis: "chart", ideas: "sparkles" };

/* ------------------------------------------------------------ icônes HTML */

/** Remplace les pastilles [data-icon] du HTML par les vrais SVG. */
function hydrateIcons(root = document) {
  for (const slot of $$("[data-icon]", root)) {
    const name = slot.dataset.icon;
    if (!name || slot.querySelector("svg")) continue;
    slot.append(icon(name, slot.dataset.size ? Number(slot.dataset.size) : 16));
    slot.removeAttribute("data-icon");
  }
}

/* ------------------------------------------------------- vérifications API */

function checkBrowserSupport() {
  const problems = [];
  const canvas = document.createElement("canvas");
  if (!canvas.getContext?.("2d")) problems.push("Canvas 2D indisponible");
  if (typeof OffscreenCanvas === "undefined" && !canvas.toBlob) {
    problems.push("canvas.toBlob indisponible");
  }
  if (!("createImageBitmap" in globalThis) && !canvas.toDataURL) {
    problems.push("décodage d'image indisponible");
  }
  return problems;
}

function showBlockingNotice(problems) {
  const host = $("#main");
  host.prepend(
    el("div", { class: "banner banner-simulated", style: { margin: "0 0 16px" } }, [
      el("span", { class: "banner-icon" }, [icon("alert", 16)]),
      el("div", {}, [
        el("strong", { text: "Ce navigateur ne fournit pas tout le nécessaire." }),
        el("p", {
          text:
            `${problems.join(" · ")}. L'export PNG peut échouer : l'application vous le dira` +
            " franchement au lieu d'afficher une fausse réussite. Essayez Chrome, Edge ou Firefox récents.",
        }),
      ]),
    ]),
  );
}

/* ------------------------------------------------------------- navigation */

function switchView(view) {
  if (!VIEWS.includes(view)) return;
  document.body.dataset.view = view;
  for (const tab of $$(".tab")) {
    const active = tab.dataset.view === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const section of $$(".view")) {
    const active = section.id === `view-${view}`;
    section.hidden = !active;
  }
  try {
    if (history.replaceState) {
      history.replaceState(null, "", `#${view}`);
    } else {
      location.hash = view;
    }
  } catch {
    /* navigation interne non critique */
  }
  window.dispatchEvent(new CustomEvent("ctr:vue", { detail: { view } }));
}

/* ------------------------------------------------------------------ modale */

function bindModal(id) {
  const root = $(id);
  if (!root) return { open: () => {}, close: () => {} };

  const sheet = root.querySelector(".sheet");
  sheet?.setAttribute("tabindex", "-1");

  const open = () => {
    root.hidden = false;
    document.body.classList.add("has-modal");
    const focusable =
      root.querySelector("textarea, input:not([type=hidden]), select") ??
      root.querySelector("button:not([data-close])") ??
      sheet;
    focusable?.focus?.({ preventScroll: true });
  };
  const close = () => {
    root.hidden = true;
    document.body.classList.remove("has-modal");
  };

  for (const target of $$("[data-close]", root)) {
    on(target, "click", close);
  }
  on(root, "keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  });

  return { open, close, root };
}

/* ------------------------------------------------------------------ boot */

function boot() {
  const problems = checkBrowserSupport();
  if (problems.length) showBlockingNotice(problems);

  /* 1. état initial : projet sauvegardé ou composition par défaut */
  try {
    const restored = store.restoreLocal();
    if (restored) {
      toast("Projet précédent rechargé depuis ce navigateur.");
    }
  } catch (err) {
    console.warn("[CTR Studio] sauvegarde locale illisible", err);
    store.reset();
  }
  const lastLayer = store.comp.layers[store.comp.layers.length - 1];
  if (lastLayer) store.setSelection(lastLayer.id);

  /* 2. modales */
  const aboutModal = bindModal("#about-modal");
  const textModal = createTextModal({ root: document, store });

  /* 3. scène, interactions, inspecteur, export */
  const canvas = $("#thumb-canvas");
  const statusLine = $("#stage-status");
  const setStatus = (text) => {
    if (statusLine) statusLine.textContent = text ?? "";
  };

  const stage = createStage({
    canvas,
    store,
    onEditLayer: (layerId) => textModal.open(layerId),
    onStatus: setStatus,
  });

  const interaction = createCanvasInteraction({
    canvas,
    store,
    getHandleSize: () => stage.getHandleSize(),
    onEditLayer: (layerId) => textModal.open(layerId),
    onStatus: setStatus,
  });

  const inspector = createInspector({
    root: $("#inspector"),
    store,
    onOpenTextEditor: (layerId) => textModal.open(layerId),
    onPickPhoto: () => $("#photo-input")?.click(),
    onRemovePhoto: () => {
      if (store.clearPhoto()) {
        toast("Photo retirée — le fond et les calques restent en place.");
        setStatus("Photo retirée");
      }
    },
  });

  const exportPanel = createExportPanel({ root: document, store });

  /* 4. vues */
  const analysisView = createAnalysisView({ root: $("#view-analysis"), store });
  const ideasView = createIdeasView({
    root: $("#view-ideas"),
    store,
    onSendToEditor: sendIdeaToEditor,
  });

  const editorView = createEditorView({
    root: document,
    store,
    stage,
    textModal,
    exportPanel,
    onAnalyzeCurrent: async () => {
      switchView("analysis");
      await analysisView.useCurrentThumbnail();
    },
  });

  /* 5. navigation par onglets */
  for (const tab of $$(".tab")) {
    const slot = tab.querySelector(".tab-ico");
    if (slot && TAB_ICONS[tab.dataset.view]) slot.dataset.icon = TAB_ICONS[tab.dataset.view];
    on(tab, "click", () => {
      const view = tab.dataset.view;
      switchView(view);
      prefillFromMeta(view);
    });
  }
  hydrateIcons(document);

  on($("#btn-about"), "click", aboutModal.open);

  /* 6. état de départ de l'UI */
  editorView.refresh();
  exportPanel.refreshAutosave();
  stage.renderNow();
  window.dispatchEvent(new Event("resize"));

  /* 7. raccourcis globaux (en dehors de l'éditeur) */
  window.addEventListener("keydown", (event) => {
    if (event.key === "?" && !event.metaKey && !event.ctrlKey && !isTyping(event.target)) {
      event.preventDefault();
      if (aboutModal.root.hidden) aboutModal.open();
      else aboutModal.close();
    }
    if (event.key >= "1" && event.key <= "3" && event.altKey) {
      event.preventDefault();
      const view = VIEWS[Number(event.key) - 1];
      switchView(view);
      prefillFromMeta(view);
    }
  });

  /* 8. erreurs globales : message franc plutôt qu'un silence */
  window.addEventListener("error", (event) => {
    console.error("[CTR Studio] erreur non gérée", event.error ?? event.message);
    toastError(`Erreur inattendue : ${event.message}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[CTR Studio] promesse rejetée", event.reason);
    const reason = event.reason;
    toastError(reason?.message ? `Erreur : ${reason.message}` : "Une opération asynchrone a échoué.");
  });

  /* 9. hash d'entrée (#analysis, #ideas) */
  const initial = (location.hash || "").replace("#", "");
  if (VIEWS.includes(initial)) {
    switchView(initial);
    prefillFromMeta(initial);
  }

  console.info(
    `[CTR Studio AI] prêt — toile ${THUMB_WIDTH}×${THUMB_HEIGHT}, ` +
      `${store.comp.layers.length} calque(s), rendu et analyse 100 % locaux.`,
  );

  return {
    store,
    stage,
    interaction,
    inspector,
    textModal,
    exportPanel,
    editorView,
    analysisView,
    ideasView,
  };
}

/** Récupère le titre/sujet de l'éditeur pour pré-remplir analyse et idées. */
function prefillFromMeta(view) {
  const meta = store.comp.meta;
  if (view === "analysis") {
    const titleInput = $("#analysis-title");
    const topicInput = $("#analysis-topic");
    if (titleInput && !titleInput.value.trim() && meta.title) titleInput.value = meta.title;
    if (topicInput && !topicInput.value.trim() && meta.topic) topicInput.value = meta.topic;
    titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (view === "ideas") {
    const topicInput = $("#ideas-topic");
    if (topicInput && !topicInput.value.trim()) {
      const source = meta.topic || meta.title;
      if (source) topicInput.value = source;
      topicInput.focus({ preventScroll: true });
    }
  }
}

/**
 * Applique une idée générée à l'éditeur : modèle, texte principal, palette.
 * Tout est annulable (Ctrl+Z).
 */
function sendIdeaToEditor(idea) {
  try {
    store.applyTemplate(idea.suggestedTemplate);
    const layers = store.comp.layers;
    const main = layers.find((layer) => /titre/i.test(layer.name)) ?? layers[layers.length - 1];
    const [bg, accent, , text] = idea.concept.palette.colors;

    store.updateBackground({ type: "gradient", from: bg, to: accent, angle: 135 }, "idea");

    if (main) {
      store.updateLayerById(
        main.id,
        {
          text: idea.overlayText,
          fontSize: idea.overlayText.length > 13 ? 108 : 156,
          fill: { ...main.fill, color: text },
          stroke: { ...main.stroke, enabled: true, color: bg, width: Math.max(main.stroke.width, 10) },
        },
        "idea",
      );
      store.setSelection(main.id, { notify: true });
    }

    store.setMeta({ title: idea.title }, "idea");
    switchView("editor");
    toastSuccess(
      `Idée « ${idea.angleLabel} » appliquée à l'éditeur. Ajustez le texte puis exportez le PNG.`,
    );
  } catch (err) {
    console.error("[CTR Studio] envoi vers l'éditeur", err);
    toastError(err?.message ?? "Impossible d'appliquer cette idée.");
  }
}

function isTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export { boot, switchView, prefillFromMeta, sendIdeaToEditor, hydrateIcons };

/* Lancement — désactivable depuis les tests (`globalThis.__CTR_NO_AUTOBOOT__`). */
if (!globalThis.__CTR_NO_AUTOBOOT__) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
