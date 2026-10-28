/**
 * CTR Studio AI — vue « Éditeur » : barre d'outils, import photo, modèles,
 * historique, navigation des panneaux et raccourcis clavier.
 */

import { TEMPLATES } from "../core/templates.js";
import { createCustomFont } from "../core/fonts.js";
import { loadImageFile, pickImageFromDataTransfer, readFileAsDataUrl } from "../io/imageImport.js";
import { $, el, on, setDisabled, setPressed } from "./dom.js";
import { icon } from "./icons.js";
import { toast, toastError, toastSuccess } from "./toast.js";

const PANELS = [
  { id: "calques", label: "Calques", iconName: "layers" },
  { id: "texte", label: "Texte", iconName: "text" },
  { id: "style", label: "Style", iconName: "palette" },
  { id: "photo", label: "Photo", iconName: "image" },
  { id: "fond", label: "Fond", iconName: "sparkles" },
  { id: "export", label: "Export", iconName: "download" },
];

function familyFromFileName(fileName) {
  const base = String(fileName || "Police").replace(/\.[^.]+$/, "");
  const clean = base.replace(/[^A-Za-z0-9]+/g, " ").trim();
  const family = clean
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return family || "PoliceImportee";
}

export function createEditorView({ root, store, stage, textModal, exportPanel, onAnalyzeCurrent }) {
  const photoInput = $("#photo-input", root);
  const fontInput = $("#font-input", root);
  const frame = $("#canvas-frame", root);
  const status = $("#stage-status", root);
  const inspector = $("#inspector", root);
  const panelNav = $("#panel-nav", root);
  const undoButton = $("#btn-undo", root);
  const redoButton = $("#btn-redo", root);
  const guidesButton = $("#btn-guides", root);

  const setStatus = (text) => {
    if (status) status.textContent = text ?? "";
  };

  /* ----------------------------------------------------------- modèles */
  const templateHost = $("#template-list", root);
  if (templateHost) {
    for (const template of TEMPLATES) {
      const card = el("button", {
        type: "button",
        class: "template-card",
        title: template.description,
        onClick: () => {
          store.applyTemplate(template.id);
          toastSuccess(`Modèle « ${template.name} » appliqué.`);
          setStatus(`Modèle ${template.name}`);
        },
      }, [
        el("span", { class: "template-swatch", style: { backgroundImage: template.preview } }),
        el("span", { class: "template-name", text: template.name }),
        el("span", { class: "template-tag", text: template.tagline }),
        el("span", {
          class: "template-dots",
        }, template.swatches.map((color) => el("i", { style: { background: color } }))),
      ]);
      templateHost.append(card);
    }
  }

  /* -------------------------------------------------------- import photo */
  async function importPhoto(file) {
    if (!file) return;
    setStatus("Import de la photo…");
    try {
      const loaded = await loadImageFile(file);
      store.setPhoto({
        drawable: loaded.drawable,
        dataUrl: loaded.dataUrl,
        width: loaded.width,
        height: loaded.height,
        name: loaded.name,
      });
      const ratio = loaded.width / Math.max(1, loaded.height);
      const advice =
        Math.abs(ratio - 16 / 9) > 0.05
          ? `Format ${ratio.toFixed(2)}:1 différent du 16:9 : la miniature sera recadrée (mode « Remplir »).`
          : "Format proche du 16:9 : aucune perte au recadrage.";
      toastSuccess(`Photo importée · ${loaded.width} × ${loaded.height} px`);
      setStatus(advice);
      if (loaded.downscaled) {
        toast("Image très grande : réduite pour ménager la mémoire de l'appareil.", { level: "info" });
      }
      if (!loaded.dataUrl) {
        toast("Photo affichée mais non enregistrable dans le projet local (poids trop élevé).", { level: "warn" });
      }
    } catch (err) {
      console.error("[CTR Studio] import photo", err);
      toastError(err?.message ?? "Import de la photo impossible.");
      setStatus("Import échoué");
    }
  }

  const detachPhotoButton = on($("#btn-photo", root), "click", () => photoInput?.click());
  const detachPhotoInput = on(photoInput, "change", () => {
    const file = photoInput.files?.[0];
    photoInput.value = "";
    importPhoto(file);
  });

  if (frame) {
    on(frame, "dragover", (event) => {
      event.preventDefault();
      frame.classList.add("is-dropping");
    });
    on(frame, "dragleave", () => frame.classList.remove("is-dropping"));
    on(frame, "drop", (event) => {
      event.preventDefault();
      frame.classList.remove("is-dropping");
      const file = pickImageFromDataTransfer(event.dataTransfer);
      if (file) importPhoto(file);
      else toastError("Aucune image détectée dans ce dépôt.");
    });
  }

  /* Coller une image depuis le presse-papiers (Ctrl+V), éditeur visible uniquement. */
  const detachPaste = on(document, "paste", (event) => {
    const editorView = $("#view-editor", root);
    if (!editorView || editorView.hidden) return;
    if (textModal?.isOpen) return;
    const file = pickImageFromDataTransfer(event.clipboardData);
    if (file) {
      event.preventDefault();
      importPhoto(file);
    }
  });

  /* ------------------------------------------------------ police importée */
  const detachFontButton = on($("#btn-font", root), "click", () => fontInput?.click());
  const detachFontInput = on(fontInput, "change", async () => {
    const file = fontInput.files?.[0];
    fontInput.value = "";
    if (!file) return;
    if (typeof FontFace === "undefined") {
      toastError("Cet appareil ne permet pas d'importer une police (API FontFace absente).");
      return;
    }
    const isFontFile = /\.(ttf|otf|woff2?)$/i.test(file.name || "") || /^font\//.test(file.type || "");
    if (!isFontFile) {
      toastError("Fichier non reconnu comme une police. Formats acceptés : .ttf, .otf, .woff, .woff2.");
      return;
    }
    try {
      setStatus("Installation de la police…");
      const family = familyFromFileName(file.name);
      const dataUrl = await readFileAsDataUrl(file);
      const font = createCustomFont({ family, dataUrl, fileName: file.name });
      const face = new FontFace(family, `url(${dataUrl})`);
      await face.load();
      document.fonts.add(face);
      store.pushHistory("font");
      store.comp.fonts.push(font);
      store.emit("fonts");
      const layer = store.selectedLayer();
      if (layer) store.updateSelected({ fontFamily: font.id, fontStack: font.stack }, "font");
      toastSuccess(`Police « ${family} » installée et sélectionnée.`);
      setStatus("");
    } catch (err) {
      console.error("[CTR Studio] police", err);
      toastError(`Police refusée : ${err?.message ?? err}. Formats acceptés : .ttf, .otf, .woff2.`);
      setStatus("");
    }
  });

  /* ---------------------------------------------------------- historique */
  const refreshHistory = () => {
    setDisabled(undoButton, !store.canUndo);
    setDisabled(redoButton, !store.canRedo);
  };
  on(undoButton, "click", () => {
    if (store.undo()) setStatus("Action annulée");
  });
  on(redoButton, "click", () => {
    if (store.redo()) setStatus("Action rétablie");
  });

  on(guidesButton, "click", () => {
    store.toggleGuides();
    setPressed(guidesButton, store.guides);
    setStatus(store.guides ? "Guides affichés : tiers + zones à éviter" : "Guides masqués");
    store.emit("view");
  });

  on($("#btn-reset", root), "click", () => {
    const ok = window.confirm(
      "Réinitialiser la miniature ?\n\nLe fond, la photo et les calques seront remplacés par la composition de départ. Utilisez Annuler (Ctrl+Z) pour revenir en arrière.",
    );
    if (!ok) return;
    store.reset();
    toast("Miniature réinitialisée.");
    setStatus("Composition réinitialisée");
  });

  on($("#btn-analyze-current", root), "click", async () => {
    await onAnalyzeCurrent?.();
  });

  on($("#btn-export-quick", root), "click", () => exportPanel?.exportNow());

  /* -------------------------------------------------- navigation panneaux */
  const mediaMobile = window.matchMedia?.("(max-width: 1079px)");
  function buildPanelNav() {
    if (!panelNav) return;
    panelNav.textContent = "";
    for (const panel of PANELS) {
      const button = el("button", {
        type: "button",
        class: "panel-tab",
        dataset: { target: panel.id },
        onClick: () => activatePanel(panel.id),
      }, [icon(panel.iconName, 16), el("span", { text: panel.label })]);
      panelNav.append(button);
    }
  }

  function activatePanel(id) {
    if (!inspector) return;
    inspector.dataset.active = id;
    const mobile = !!mediaMobile?.matches;
    for (const panel of inspector.querySelectorAll(".panel")) {
      panel.hidden = mobile && panel.dataset.panel !== id;
    }
    for (const button of panelNav?.querySelectorAll(".panel-tab") ?? []) {
      const active = button.dataset.target === id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    }
  }

  buildPanelNav();
  activatePanel(inspector?.dataset?.active ?? "calques");
  mediaMobile?.addEventListener?.("change", () => activatePanel(inspector?.dataset?.active ?? "calques"));

  /* --------------------------------------------------------- raccourcis */
  function onKeydown(event) {
    /* La modale de texte pilote ses propres raccourcis : on lui laisse la main
       (sinon Échap désélectionnerait le calque pendant l'édition). */
    if (textModal?.isOpen) return;
    const target = event.target;
    const typing =
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable || target.tagName === "SELECT");
    const meta = event.ctrlKey || event.metaKey;

    if (meta && event.key.toLowerCase() === "z" && !typing) {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
      refreshHistory();
      return;
    }
    if (meta && event.key.toLowerCase() === "y" && !typing) {
      event.preventDefault();
      store.redo();
      refreshHistory();
      return;
    }
    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      exportPanel?.exportNow();
      return;
    }
    if (typing || !store.selection) return;

    const step = event.shiftKey ? 10 : 1;
    const layer = store.selectedLayer();
    if (!layer) return;

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      store.pushHistory("nudge");
      if (event.key === "ArrowLeft") layer.x -= step;
      if (event.key === "ArrowRight") layer.x += step;
      if (event.key === "ArrowUp") layer.y -= step;
      if (event.key === "ArrowDown") layer.y += step;
      store.emit("transform");
      setStatus(`x ${Math.round(layer.x)} · y ${Math.round(layer.y)}`);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      store.removeLayer(store.selection);
      setStatus("Calque supprimé");
      return;
    }
    if (meta && event.key.toLowerCase() === "d") {
      event.preventDefault();
      store.duplicateSelected();
      setStatus("Calque dupliqué");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      textModal?.open(store.selection);
    }
    if (event.key === "Escape") {
      store.setSelection(null);
    }
  }
  const detachKeydown = on(document, "keydown", onKeydown);

  const unsubscribe = store.subscribe((reason) => {
    if (reason === "transform") return; // rendu déjà demandé par la scène
    refreshHistory();
    if (reason === "photo" || reason === "load" || reason === "restore") {
      const hasPhoto = !!store.comp.image.dataUrl;
      setDisabled($("#btn-remove-photo", root), !hasPhoto);
    }
  });

  on($("#btn-remove-photo", root), "click", () => {
    if (store.clearPhoto()) {
      toast("Photo retirée : le fond et les calques restent en place.");
      setStatus("Photo retirée");
    }
  });

  setPressed(guidesButton, store.guides);
  refreshHistory();

  return {
    importPhoto,
    setStatus,
    activatePanel,
    refresh() {
      refreshHistory();
      setDisabled($("#btn-remove-photo", root), !store.comp.image.dataUrl);
    },
    destroy() {
      unsubscribe();
      detachKeydown();
      detachPhotoButton();
      detachPhotoInput();
      detachFontButton();
      detachFontInput();
      detachPaste();
    },
  };
}
