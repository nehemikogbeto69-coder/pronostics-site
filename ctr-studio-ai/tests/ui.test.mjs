/**
 * Tests d'interface (jsdom + Skia) — CTR Studio AI.
 *
 * Ces tests chargent le VRAI index.html, démarrent le VRAI main.js et
 * pilotent l'application comme un utilisateur : clics, frappes, glissés,
 * imports de fichiers, exports. Le canvas est branché sur @napi-rs/canvas,
 * donc les pixels et les octets PNG vérifiés sont réels.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { createDom, imageFile, pointer, settle, stubRect, waitFor } from "./helpers/dom.mjs";
import { STORAGE_KEY, THUMB_HEIGHT, THUMB_WIDTH } from "../src/core/constants.js";
import { layoutText } from "../src/core/textLayout.js";

globalThis.__CTR_NO_AUTOBOOT__ = true;

/** Le canvas écran fait 640×360 CSS pour une toile de 1280×720 (facteur 2). */
const RECT = { left: 0, top: 0, width: 640, height: 360 };
const toScreen = (canvasX, canvasY) => ({
  x: (canvasX - RECT.left) * (RECT.width / THUMB_WIDTH),
  y: (canvasY - RECT.top) * (RECT.height / THUMB_HEIGHT),
});

let env;
let win;
let doc;
let api;
let canvas;

/** Pixels réels du canvas écran. */
function screenStats() {
  const backing = win.__backingCanvas(canvas);
  assert.ok(backing, "le canvas doit être adossé à Skia");
  const ctx = backing.getContext("2d");
  const { data } = ctx.getImageData(0, 0, backing.width, backing.height);
  let sum = 0;
  let nonBlack = 0;
  const colors = new Set();
  for (let i = 0; i < data.length; i += 4) {
    const luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    sum += luma;
    if (luma > 6) nonBlack += 1;
    if (colors.size < 4096) colors.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
  }
  const total = data.length / 4;
  return { mean: sum / total, share: nonBlack / total, distinctColors: colors.size, total };
}

/** Retrouve un contrôle de l'inspecteur par son libellé (aria-label). */
function controlByLabel(scopeSelector, label, type = "range") {
  const input = doc.querySelector(`${scopeSelector} input[type="${type}"][aria-label="${label}"]`);
  assert.ok(input, `champ « ${label} » introuvable dans ${scopeSelector}`);
  return input;
}

function removePhotoButton() {
  const button = [...doc.querySelectorAll("#photo-actions .btn")].find((b) =>
    /retirer/i.test(b.textContent),
  );
  assert.ok(button, "bouton « Retirer la photo » de l'inspecteur");
  return button;
}

function selectLayerByIndex(indexFromFront = 0) {
  const layers = api.store.comp.layers;
  const layer = layers[layers.length - 1 - indexFromFront];
  api.store.setSelection(layer.id);
  return layer;
}

function typeIn(element, value) {
  element.value = value;
  element.dispatchEvent(new win.Event("input", { bubbles: true }));
  element.dispatchEvent(new win.Event("change", { bubbles: true }));
}

function click(element) {
  assert.ok(element, "élément cliquable manquant");
  element.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
}

before(async () => {
  env = await createDom();
  win = env.window;
  doc = win.document;

  const main = await import("../src/main.js");
  api = main.boot();

  canvas = doc.querySelector("#thumb-canvas");
  stubRect(win, canvas, RECT);
  win.dispatchEvent(new win.Event("resize")); // recalcul des poignées
  api.stage.renderNow();
  await settle(30);
});

/* « Ajouter du texte » ouvre la modale d'édition : on la referme entre les
   tests pour repartir d'un état propre. */
afterEach(() => {
  const modal = doc?.querySelector("#text-modal");
  if (modal && !modal.hidden) api.textModal.close({ cancel: true });
});

after(() => {
  env?.destroy();
});

/* ========================================================================== */

describe("démarrage", () => {
  test("la toile fait 1280×720 et contient un rendu réel", () => {
    assert.equal(canvas.width, THUMB_WIDTH);
    assert.equal(canvas.height, THUMB_HEIGHT);
    const stats = screenStats();
    assert.equal(stats.total, THUMB_WIDTH * THUMB_HEIGHT);
    assert.ok(stats.share > 0.5, `le fond dégradé doit couvrir la toile (share=${stats.share})`);
    assert.ok(stats.distinctColors > 20, "le dégradé produit de nombreuses nuances");
  });

  test("les trois onglets et les six panneaux existent", () => {
    assert.equal(doc.querySelectorAll(".tab").length, 3);
    assert.equal(doc.querySelectorAll(".panel").length, 6);
    assert.equal(doc.querySelectorAll("#template-list .template-card").length, 3);
    assert.ok(doc.querySelector("#inspector #panel-layers"));
  });

  test("l'inspecteur liste les calques et réagit à la sélection", () => {
    const rows = doc.querySelectorAll("#panel-layers .layer-row");
    assert.ok(rows.length >= 1, "au moins un calque listé");
    const layer = selectLayerByIndex(0);
    const selected = doc.querySelector("#panel-layers .layer-row.is-selected");
    assert.ok(selected, "une ligne est marquée sélectionnée");
    assert.ok(selected.textContent.includes(layer.name), "le nom du calque apparaît");
    assert.ok(doc.querySelector("#panel-text input, #panel-text textarea"), "le panneau texte est monté");
  });

  test("les icônes HTML ont été hydratées en SVG", () => {
    assert.ok(doc.querySelector("#btn-photo svg"), "bouton photo avec icône");
    assert.ok(doc.querySelector(".tab.is-active svg"), "onglet actif avec icône");
    assert.equal(doc.querySelectorAll("[data-icon]").length, 0, "plus aucune pastille en attente");
  });
});

describe("modèles de départ", () => {
  test("appliquer « Focus » reconstruit les calques et garde l'historique", async () => {
    api.store.reset();
    const before = api.store.comp.layers.length;
    const cards = doc.querySelectorAll("#template-list .template-card");
    click(cards[1]);
    await settle(20);

    assert.equal(api.store.comp.meta.template, "focus");
    assert.ok(api.store.comp.layers.length >= 2, "le modèle Focus pose plusieurs calques");
    assert.notEqual(api.store.comp.background.from, "#2a0f4c");
    assert.ok(doc.querySelector("#panel-layers .layer-row"), "l'inspecteur suit le changement");
    assert.ok(before >= 1);
  });

  test("le rendu suit le modèle appliqué", async () => {
    api.store.reset();
    api.stage.renderNow();
    const base = screenStats();
    click(doc.querySelectorAll("#template-list .template-card")[0]);
    api.stage.renderNow();
    const afterTemplate = screenStats();
    assert.notEqual(
      afterTemplate.mean.toFixed(2),
      base.mean.toFixed(2),
      "la luminance moyenne change avec le modèle",
    );
  });
});

describe("édition de texte", () => {
  test("le double-clic sur un calque ouvre la modale et la saisie est appliquée", async () => {
    api.store.reset();
    const layer = selectLayerByIndex(0);
    const point = toScreen(layer.x + 60, layer.y + 50);

    pointer(win, canvas, "pointerdown", { ...point, rect: RECT });
    pointer(win, canvas, "pointerup", { ...point, rect: RECT });
    canvas.dispatchEvent(
      new win.MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        clientX: RECT.left + point.x,
        clientY: RECT.top + point.y,
      }),
    );
    await settle(20);

    const modal = doc.querySelector("#text-modal");
    assert.equal(modal.hidden, false, "la modale de texte s'ouvre");
    const input = doc.querySelector("#text-modal-input");
    assert.equal(input.value, layer.text, "le texte courant est pré-rempli");

    typeIn(input, "TEST UI");
    await settle(20);
    click(doc.querySelector("#text-modal-apply"));
    await settle(30);

    assert.equal(modal.hidden, true, "la modale se referme après validation");
    assert.equal(api.store.selectedLayer().text, "TEST UI");
    assert.equal(api.store.selectedLayer().name, "TEST UI", "le calque est renommé d'après le texte");
  });

  test("Échap annule la modification", async () => {
    const layer = selectLayerByIndex(0);
    const original = layer.text;
    api.textModal.open(layer.id);
    await settle(10);
    typeIn(doc.querySelector("#text-modal-input"), "BROUILLON");
    doc.querySelector("#text-modal").dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await settle(20);
    assert.equal(doc.querySelector("#text-modal").hidden, true);
    assert.equal(api.store.selectedLayer().text, original, "le texte revient à son état initial");
  });

  test("le panneau Style met à jour le calque sélectionné", async () => {
    api.store.reset();
    const layer = selectLayerByIndex(0);
    const sizeSlider = controlByLabel("#panel-text", "Taille");
    const sizeNumber = doc.querySelector('#panel-text input[aria-label="Taille (valeur)"]');
    assert.ok(sizeNumber, "le champ numérique de taille existe");
    assert.equal(Number(sizeNumber.value), layer.fontSize, "il affiche la valeur courante");

    const before = layer.fontSize;
    sizeSlider.value = String(Math.min(400, before + 40));
    sizeSlider.dispatchEvent(new win.Event("input", { bubbles: true }));
    await settle(10);
    assert.equal(api.store.selectedLayer().fontSize, before + 40, "la taille a changé");
    assert.equal(Number(sizeNumber.value), before + 40, "le champ numérique suit");

    /* saisie directe dans le champ numérique */
    typeIn(sizeNumber, "180");
    await settle(10);
    assert.equal(api.store.selectedLayer().fontSize, 180);

    /* segmentation de l'alignement */
    const alignButtons = [...doc.querySelectorAll('#panel-text .seg-btn')];
    assert.ok(alignButtons.length >= 3, "des choix d'alignement existent");
  });

  test("ajouter / dupliquer / supprimer un calque", async () => {
    api.store.reset();
    const addButton = [...doc.querySelectorAll("#layers-actions .btn")].find((b) =>
      /ajouter/i.test(b.textContent),
    );
    assert.ok(addButton, "bouton « Ajouter du texte » présent");
    const count = api.store.comp.layers.length;
    click(addButton);
    await settle(20);
    assert.equal(api.store.comp.layers.length, count + 1);
    assert.equal(doc.querySelectorAll("#panel-layers .layer-row").length, count + 1);

    click(
      [...doc.querySelectorAll("#layers-actions .btn")].find((b) => /dupliquer/i.test(b.textContent)),
    );
    await settle(20);
    assert.equal(api.store.comp.layers.length, count + 2);

    /* suppression via la ligne de calque */
    const row = doc.querySelector("#panel-layers .layer-row");
    const removeButton = [...row.querySelectorAll(".icon-btn")].find((b) => /supprimer/i.test(b.title ?? b.getAttribute("aria-label") ?? ""));
    assert.ok(removeButton, "bouton supprimer sur la ligne");
    click(removeButton);
    await settle(20);
    assert.equal(api.store.comp.layers.length, count + 1);
  });
});

describe("interactions canvas", () => {
  test("glisser un calque le déplace et l'annulation le replace", async () => {
    api.store.reset();
    const layer = selectLayerByIndex(0);
    const start = toScreen(layer.x + 60, layer.y + 50);
    const startX = layer.x;
    const startY = layer.y;

    pointer(win, canvas, "pointerdown", { ...start, rect: RECT });
    pointer(win, canvas, "pointermove", { x: start.x + 30, y: start.y + 15, rect: RECT });
    pointer(win, canvas, "pointermove", { x: start.x + 50, y: start.y + 25, rect: RECT });
    assert.match(doc.querySelector("#stage-status").textContent, /x \d+ · y \d+/, "position affichée pendant le glisser");
    pointer(win, canvas, "pointerup", { x: start.x + 50, y: start.y + 25, rect: RECT });
    await settle(30);

    const moved = api.store.comp.layers.find((l) => l.id === layer.id);
    assert.ok(Math.abs(moved.x - startX - 100) <= 4, `x déplacé de ~100 px (réel : ${moved.x - startX})`);
    assert.ok(Math.abs(moved.y - startY - 50) <= 4, `y déplacé de ~50 px (réel : ${moved.y - startY})`);

    click(doc.querySelector("#btn-undo"));
    await settle(20);
    const undone = api.store.comp.layers.find((l) => l.id === layer.id);
    assert.equal(undone.x, startX, "Annuler restaure la position");
    click(doc.querySelector("#btn-redo"));
    await settle(20);
    const redone = api.store.comp.layers.find((l) => l.id === layer.id);
    assert.ok(Math.abs(redone.x - (startX + 100)) <= 4, "Rétablir rejoue le déplacement");
  });

  test("une poignée de coin redimensionne le texte", async () => {
    api.store.reset();
    const layer = selectLayerByIndex(0);
    api.store.updateSelected({ rotation: 0 }, null);
    api.stage.renderNow();
    await settle(10);

    const box = layoutText(canvas.getContext("2d"), api.store.selectedLayer()).box;
    const before = api.store.selectedLayer().fontSize;
    const corner = toScreen(box.x + box.width, box.y + box.height);

    pointer(win, canvas, "pointerdown", { ...corner, rect: RECT });
    pointer(win, canvas, "pointermove", { x: corner.x + 40, y: corner.y + 22, rect: RECT });
    pointer(win, canvas, "pointerup", { x: corner.x + 40, y: corner.y + 22, rect: RECT });
    await settle(30);

    const after = api.store.comp.layers.find((l) => l.id === layer.id).fontSize;
    assert.ok(after > before, `le texte doit grossir (${before} → ${after})`);
  });

  test("le bouton Guides bascule l'affichage", async () => {
    const button = doc.querySelector("#btn-guides");
    const initial = api.store.guides;
    click(button);
    await settle(20);
    assert.equal(api.store.guides, !initial);
    assert.equal(button.getAttribute("aria-pressed"), String(!initial));
    click(button);
    await settle(20);
    assert.equal(api.store.guides, initial);
  });

  test("les flèches du clavier déplacent le calque sélectionné", async () => {
    api.store.reset();
    const layer = selectLayerByIndex(0);
    const x0 = layer.x;
    doc.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    await settle(10);
    assert.equal(api.store.comp.layers.find((l) => l.id === layer.id).x, x0 + 1);
    const y0 = api.store.comp.layers.find((l) => l.id === layer.id).y;
    doc.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "ArrowDown",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle(10);
    assert.equal(api.store.comp.layers.find((l) => l.id === layer.id).y, y0 + 10);
  });
});

describe("import d'image", () => {
  test("un fichier PNG local devient la photo de la miniature", async () => {
    api.store.reset();
    const { file } = await imageFile(win, { width: 800, height: 450, kind: "split" });
    const input = doc.querySelector("#photo-input");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));

    await waitFor(() => api.store.image, { label: "photo décodée" });
    assert.equal(api.store.comp.image.naturalWidth, 800);
    assert.equal(api.store.comp.image.naturalHeight, 450);
    assert.match(api.store.comp.image.dataUrl, /^data:image\//);
    assert.match(doc.querySelector("#photo-meta").textContent, /800\s*×\s*450/);
    assert.equal(removePhotoButton().disabled, false, "le bouton « Retirer » devient actif");

    api.stage.renderNow();
    await settle(20);
    const stats = screenStats();
    assert.ok(stats.share > 0.9, "la photo couvre la toile");
  });

  test("le PNG exporté contient bien la photo importée", async () => {
    const result = await api.exportPanel.exportNow();
    assert.ok(result, "un résultat d'export est renvoyé");
    assert.equal(result.complete, true);
    assert.equal(result.info.width, THUMB_WIDTH);
    assert.equal(result.info.height, THUMB_HEIGHT);

    /* comparaison avec une miniature sans photo : les pixels doivent différer */
    const withPhoto = result.bytes;
    api.store.clearPhoto();
    api.stage.renderNow();
    const without = await api.exportPanel.exportNow();
    assert.ok(without.complete);
    assert.notEqual(withPhoto.length, without.bytes.length, "deux rendus différents produisent des tailles différentes");
  });

  test("un fichier non-image est refusé avec un message clair", async () => {
    const bogus = new win.File(["pas une image"], "note.txt", { type: "text/plain" });
    const input = doc.querySelector("#photo-input");
    Object.defineProperty(input, "files", { value: [bogus], configurable: true });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    await settle(60);
    const toastText = doc.querySelector("#toasts")?.textContent ?? "";
    assert.match(toastText, /image|format|refus|impossible/i);
    assert.equal(api.store.image ?? null, null, "aucune photo installée");
  });

  test("retirer la photo revient au fond", async () => {
    const { file } = await imageFile(win, { width: 640, height: 360 });
    const input = doc.querySelector("#photo-input");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    await waitFor(() => api.store.image, { label: "photo installée" });

    click(removePhotoButton());
    await settle(40);
    assert.equal(api.store.comp.image.dataUrl, null, "la photo est retirée du projet");
    assert.equal(api.store.image, null);
    assert.match(doc.querySelector("#photo-meta").textContent, /aucune/i);
    assert.equal(removePhotoButton().disabled, true, "le bouton redevient inactif");
  });
});

describe("export PNG", () => {
  test("le bouton d'export produit un PNG vérifié 1280×720", async () => {
    api.store.reset();
    api.stage.renderNow();
    const resultHost = doc.querySelector("#export-result");
    resultHost.hidden = true;

    click(doc.querySelector("#btn-export"));
    await waitFor(() => !resultHost.hidden, { label: "carte de résultat d'export" });
    await settle(30);

    const text = resultHost.textContent;
    assert.match(text, /PNG valide/);
    assert.match(text, /1280 × 720 px/);
    assert.match(text, /téléchargement lancé/i);

    const result = api.exportPanel.lastResult;
    assert.ok(result, "le panneau conserve le dernier résultat");
    assert.ok(result.bytes.length > 1000, `PNG de taille réelle (${result.bytes.length} o)`);
    assert.deepEqual(
      [...result.bytes.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "signature PNG",
    );
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    assert.equal(view.getUint32(16), THUMB_WIDTH, "largeur IHDR");
    assert.equal(view.getUint32(20), THUMB_HEIGHT, "hauteur IHDR");
    assert.equal(result.decoded.ok, true, "le PNG se décode réellement");
    assert.equal(result.decoded.width, THUMB_WIDTH);
    assert.equal(result.blob.type, "image/png");
    assert.equal(result.complete, true);
    assert.equal(result.overLimit, false);
  });

  test("l'aperçu de secours contient la même image", async () => {
    const result = await api.exportPanel.exportNow();
    const preview = doc.querySelector("#export-fallback img");
    assert.ok(preview, "un aperçu est proposé dans le repli");
    assert.match(preview.src, /^(data:image\/png;base64,|blob:)/, "l'aperçu pointe vers le PNG produit");
    assert.equal(preview.alt !== "", true, "l'aperçu a un texte alternatif");
  });

  test("un export forcé en mode secours affiche les alternatives réelles", async () => {
    const fallback = doc.querySelector("#export-fallback");
    const result = await api.exportPanel.exportNow({ forceFallback: true });
    await settle(30);
    assert.equal(fallback.hidden, false, "le repli est visible");
    assert.equal(fallback.open, true, "et déplié");
    const text = fallback.textContent;
    assert.match(text, /appuyez longuement/i, "conseil mobile");
    assert.match(text, /onglet/i, "ouverture dans un onglet");
    assert.match(text, /relancer/i, "relance de l'export");
    assert.ok(result.bytes.length > 0);
  });

  test("un encodeur menteur est détecté, jamais présenté comme réussi", async () => {
    /* On remplace toBlob par un encodeur qui renvoie du JPEG : la vérification
       doit échouer et l'interface doit le dire. */
    /* Le canvas d'export est un canvas Skia : on corrompe SON toBlob. */
    const exportProto = Object.getPrototypeOf(win.document.createElement("canvas"));
    const original = exportProto.toBlob;
    exportProto.toBlob = function toBlob(callback) {
      callback(new win.Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: "image/jpeg" }));
    };
    const resultHost = doc.querySelector("#export-result");
    try {
      const result = await api.exportPanel.exportNow();
      await settle(20);
      assert.equal(result?.complete ?? false, false, "l'export n'est pas annoncé complet");
      assert.match(resultHost.textContent, /échec|invalide|impossible|erreur/i);
      assert.ok(doc.querySelector(".result-card.is-error"), "carte d'erreur affichée");
    } finally {
      exportProto.toBlob = original;
    }
  });
});

describe("projet et sauvegarde locale", () => {
  test("le projet s'enregistre dans localStorage et se recharge", async () => {
    api.store.reset();
    selectLayerByIndex(0);
    api.store.updateSelected({ text: "SAUVEGARDE UI" }, "test");
    await api.store.saveLocal();
    const raw = win.localStorage.getItem(STORAGE_KEY);
    assert.ok(raw, "une sauvegarde existe");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.app, "ctr-studio-ai");
    assert.ok(Array.isArray(parsed.layers), "les calques sont sérialisés");
    assert.ok(
      parsed.layers.some((l) => l.text === "SAUVEGARDE UI"),
      "le texte modifié est bien sauvegardé",
    );
    assert.match(doc.querySelector("#autosave-status").textContent, /enregistré|sauvegard/i);
  });

  test("le JSON de projet est téléchargeable", async () => {
    const buttons = [...doc.querySelectorAll("#project-actions .btn")];
    const save = buttons.find((b) => /enregistrer|\.json/i.test(b.textContent));
    assert.ok(save, "bouton d'enregistrement du projet");
    click(save);
    await settle(30);
    const toastText = doc.querySelector("#toasts").textContent;
    assert.match(toastText, /projet|json/i);
  });
});

describe("analyse", () => {
  test("sans image, l'analyse le dit clairement", async () => {
    api.analysisView.reset?.();
    doc.querySelector("#analysis-results").hidden = true;
    click(doc.querySelector("#analysis-run"));
    await settle(60);
    const toastText = doc.querySelector("#toasts").textContent;
    assert.match(toastText, /image|source/i);
  });
  test("« Analyser la miniature en cours » exporte, analyse et change d'onglet", async () => {
    api.store.reset();
    api.store.applyTemplate("energie");
    api.stage.renderNow();
    switchTo("editor");

    click(doc.querySelector("#btn-analyze-current"));
    await waitFor(() => !doc.querySelector("#analysis-results").hidden, {
      label: "rapport d'analyse",
      timeout: 8000,
    });

    assert.equal(doc.body.dataset.view, "analysis", "l'onglet Analyse est activé");
    const text = doc.querySelector("#analysis-results").textContent;
    assert.match(text, /aucune prédiction de taux de clic/i, "l'avertissement honnête est affiché");
    assert.match(text, /Lisibilité/);
    assert.match(text, /Contraste/);
    assert.match(text, /Composition/);
    assert.ok(doc.querySelector("#analysis-results .score-ring"), "le score global est dessiné");
    assert.ok(doc.querySelectorAll("#analysis-results .section-card").length >= 4);
    assert.match(doc.querySelector("#analysis-source").textContent, /miniature-en-cours/);

    const overlay = win.__backingCanvas(doc.querySelector("#analysis-overlay"));
    assert.ok(overlay, "le calque d'annotation existe");
    const octx = overlay.getContext("2d");
    const { data } = octx.getImageData(0, 0, overlay.width, overlay.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 30) lit += 1;
    assert.ok(lit / (data.length / 4) > 0.5, "l'image analysée est bien dessinée sur le calque");
  });

  test("un fichier importé + un titre produisent un rapport avec les règles de titre", async () => {
    switchTo("analysis");
    const { file } = await imageFile(win, { width: 1280, height: 720, kind: "split" });
    const input = doc.querySelector("#analysis-file");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    await waitFor(() => api.analysisView.hasSource, { label: "source d'analyse chargée" });

    typeIn(doc.querySelector("#analysis-title"), "3 erreurs de miniature qui coûtent des clics");
    await settle(20);
    const previewText = doc.querySelector("#analysis-title-preview").textContent;
    assert.match(previewText, /Aperçu dans le fil/, "l'aperçu du fil est affiché");
    assert.match(previewText, /44\/100/, "le compteur de caractères est exact");
    assert.ok(!previewText.includes("null"), "aucun « null » parasite dans l'aperçu");

    click(doc.querySelector("#analysis-run"));
    await waitFor(() => /Titre/.test(doc.querySelector("#analysis-results").textContent), {
      label: "section titre",
    });
    const text = doc.querySelector("#analysis-results").textContent;
    assert.match(text, /Titre YouTube/);
    assert.ok(doc.querySelector("#analysis-results .zones-table"), "le tableau des zones est présent");
    assert.equal(doc.querySelectorAll("#analysis-results .zones-table tbody tr").length, 6);
  });

  test("le titre trop long est signalé dans l'aperçu", async () => {
    const long = "T".repeat(120);
    typeIn(doc.querySelector("#analysis-title"), long);
    await settle(20);
    const preview = doc.querySelector("#analysis-title-preview");
    assert.match(preview.textContent, /…/, "le titre est tronqué visuellement");
    assert.ok(preview.querySelector(".preview-count.is-over"), "le compteur passe en alerte");
  });

});

describe("générateur d'idées", () => {
  test("5 idées locales sont générées et étiquetées simulées", async () => {
    switchTo("ideas");
    assert.match(doc.querySelector("#ideas-notice").textContent, /simul/i);
    assert.match(doc.querySelector("#ideas-notice").textContent, /aucun modèle d'IA distant/i);

    typeIn(doc.querySelector("#ideas-topic"), "réussir ses miniatures youtube");
    typeIn(doc.querySelector("#ideas-audience"), "créateurs débutants");
    click(doc.querySelector("#ideas-run"));
    await waitFor(() => doc.querySelectorAll(".idea-card").length === 5, { label: "5 cartes d'idées" });

    const cards = [...doc.querySelectorAll(".idea-card")];
    assert.equal(cards.length, 5);
    for (const card of cards) {
      assert.match(card.textContent, /simulé/, "chaque idée est étiquetée simulée");
      assert.ok(card.querySelector(".idea-title").textContent.length >= 12);
      assert.ok(card.querySelector(".idea-overlay-text").textContent.length >= 3);
      assert.equal(card.querySelectorAll(".idea-palette .swatch").length, 4);
    }
    assert.match(doc.querySelector("#ideas-meta").textContent, /tirage #/);
  });

  test("un autre tirage produit des titres différents", async () => {
    const first = [...doc.querySelectorAll(".idea-title")].map((n) => n.textContent);
    click(doc.querySelector("#ideas-regenerate"));
    await settle(40);
    const second = [...doc.querySelectorAll(".idea-title")].map((n) => n.textContent);
    assert.equal(second.length, 5);
    assert.notDeepEqual(first, second, "le tirage suivant change au moins un titre");
  });

  test("sans sujet, la génération est refusée poliment", async () => {
    typeIn(doc.querySelector("#ideas-topic"), "   ");
    click(doc.querySelector("#ideas-run"));
    await settle(30);
    assert.match(doc.querySelector("#toasts").textContent, /sujet/i);
  });

  test("« Envoyer vers l'éditeur » applique le modèle, le texte et la palette", async () => {
    typeIn(doc.querySelector("#ideas-topic"), "monter une vidéo rapidement");
    click(doc.querySelector("#ideas-run"));
    await waitFor(() => doc.querySelectorAll(".idea-card").length === 5, { label: "idées générées" });

    const card = doc.querySelector(".idea-card");
    const overlayText = card.querySelector(".idea-overlay-text").textContent;
    const buttons = [...card.querySelectorAll(".idea-actions .btn")];
    click(buttons.at(-1));
    await settle(60);

    assert.equal(doc.body.dataset.view, "editor", "retour à l'éditeur");
    assert.ok(api.store.comp.meta.template, "un modèle est appliqué");
    assert.ok(
      api.store.comp.layers.some((layer) => layer.text === overlayText),
      `le texte « ${overlayText} » est posé sur la miniature`,
    );
    assert.equal(api.store.comp.meta.title, card.querySelector(".idea-title").textContent);
    api.stage.renderNow();
    assert.ok(screenStats().share > 0.4, "la miniature résultante est dessinée");
  });

  test("copier le titre passe par le presse-papiers", async () => {
    switchTo("ideas");
    const card = doc.querySelector(".idea-card");
    const copyButton = [...card.querySelectorAll(".idea-actions .btn")].find((b) =>
      /copier/i.test(b.textContent),
    );
    click(copyButton);
    await settle(40);
    assert.equal(win.navigator.clipboard._text, card.querySelector(".idea-title").textContent);
  });
});

describe("navigation et robustesse", () => {
  test("les onglets basculent les vues", async () => {
    switchTo("editor");
    assert.equal(doc.querySelector("#view-editor").hidden, false);
    assert.equal(doc.querySelector("#view-analysis").hidden, true);
    switchTo("ideas");
    assert.equal(doc.querySelector("#view-ideas").hidden, false);
    assert.equal(doc.querySelector("#view-editor").hidden, true);
    assert.equal(doc.querySelector('.tab[data-view="ideas"]').getAttribute("aria-selected"), "true");
    assert.equal(win.location.hash, "#ideas");
  });

  test("la modale « À propos » s'ouvre et se ferme", async () => {
    const modal = doc.querySelector("#about-modal");
    click(doc.querySelector("#btn-about"));
    assert.equal(modal.hidden, false);
    assert.match(modal.textContent, /ne prédit pas de taux de clic/i);
    modal.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(modal.hidden, true);
  });

  test("le raccourci Ctrl+S déclenche l'export", async () => {
    switchTo("editor");
    const resultHost = doc.querySelector("#export-result");
    resultHost.hidden = true;
    doc.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await waitFor(() => !resultHost.hidden, { label: "export via raccourci", timeout: 8000 });
    assert.match(resultHost.textContent, /PNG valide/);
  });

  test("un dépôt de fichier sur la scène importe la photo", async () => {
    api.store.clearPhoto();
    const { file } = await imageFile(win, { width: 512, height: 288 });
    const frame = doc.querySelector("#canvas-frame");
    const event = new win.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [file], items: [], types: ["Files"] },
      configurable: true,
    });
    frame.dispatchEvent(event);
    await waitFor(() => api.store.image, { label: "photo déposée" });
    assert.equal(api.store.comp.image.naturalWidth, 512);
  });
});

describe("boucle inspecteur → rendu", () => {
  test("changer la couleur de fond modifie les pixels de la miniature", async () => {
    switchTo("editor");
    api.store.reset();
    api.store.clearPhoto();
    api.store.updateBackground({ type: "solid", color: "#101820" }, "test");
    api.stage.renderNow();
    await settle(20);
    const dark = screenStats();

    const colorInput = doc.querySelector('#panel-bg input[type="color"]');
    assert.ok(colorInput, "un sélecteur de couleur existe dans le panneau Fond");
    colorInput.value = "#f8fafc";
    colorInput.dispatchEvent(new win.Event("input", { bubbles: true }));
    colorInput.dispatchEvent(new win.Event("change", { bubbles: true }));
    api.stage.renderNow();
    await settle(20);
    const light = screenStats();

    assert.equal(api.store.comp.background.color.toLowerCase(), "#f8fafc", "le store a reçu la couleur");
    assert.ok(light.mean - dark.mean > 60, `la luminance suit la couleur (${dark.mean.toFixed(1)} → ${light.mean.toFixed(1)})`);
  });

  test("l'ajustement « Entier » laisse voir le fond", async () => {
    api.store.reset();
    const { file } = await imageFile(win, { width: 400, height: 800, kind: "flat" });
    const input = doc.querySelector("#photo-input");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    await waitFor(() => api.store.image, { label: "photo importée" });

    const coverButton = [...doc.querySelectorAll('#panel-photo .seg-btn')].find((b) =>
      /remplir/i.test(b.textContent),
    );
    const containButton = [...doc.querySelectorAll('#panel-photo .seg-btn')].find((b) =>
      /entier/i.test(b.textContent),
    );
    assert.ok(coverButton && containButton, "les deux ajustements sont proposés");

    click(coverButton);
    api.stage.renderNow();
    await settle(20);
    const filled = screenStats();

    click(containButton);
    api.stage.renderNow();
    await settle(20);
    const contained = screenStats();

    assert.equal(api.store.comp.image.fit, "contain");
    assert.notEqual(
      contained.mean.toFixed(1),
      filled.mean.toFixed(1),
      "le rendu diffère entre Remplir et Entier",
    );
    api.store.clearPhoto();
  });

  test("le bouton « Importer / remplacer la photo » ouvre le sélecteur de fichier", async () => {
    let clicks = 0;
    const input = doc.querySelector("#photo-input");
    const original = input.click.bind(input);
    input.click = () => {
      clicks += 1;
    };
    try {
      const button = [...doc.querySelectorAll("#photo-actions .btn")].find((b) =>
        /importer/i.test(b.textContent),
      );
      assert.ok(button, "bouton d'import dans le panneau Photo");
      click(button);
      await settle(10);
      assert.equal(clicks, 1, "le sélecteur de fichier est ouvert");

      click(doc.querySelector("#btn-photo"));
      await settle(10);
      assert.equal(clicks, 2, "le bouton de la barre d'outils fait la même chose");
    } finally {
      input.click = original;
    }
  });

  test("le bouton « Exporter le PNG » de la barre d'outils exporte vraiment", async () => {
    switchTo("editor");
    api.store.reset();
    const resultHost = doc.querySelector("#export-result");
    resultHost.hidden = true;
    click(doc.querySelector("#btn-export-quick"));
    await waitFor(() => !resultHost.hidden, { label: "export depuis la barre d'outils" });
    assert.match(resultHost.textContent, /PNG valide/);
    assert.ok(api.exportPanel.lastResult.bytes.length > 1000);
  });
});

describe("analyse par glisser-déposer", () => {
  test("déposer une image sur la zone d'analyse lance le rapport", async () => {
    switchTo("analysis");
    const { file } = await imageFile(win, { width: 1280, height: 720, kind: "split" });
    const dropzone = doc.querySelector("#analysis-dropzone");
    const event = new win.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [file], items: [], types: ["Files"] },
      configurable: true,
    });
    dropzone.dispatchEvent(event);

    await waitFor(() => !doc.querySelector("#analysis-results").hidden, {
      label: "rapport après dépôt",
      timeout: 8000,
    });
    assert.match(doc.querySelector("#analysis-source").textContent, /photo\.png/);
    assert.match(doc.querySelector("#analysis-results").textContent, /Contraste/);
    assert.ok(dropzone.classList.contains("has-image"), "la zone signale l'image chargée");
  });

  test("la zone d'analyse réagit au clavier", async () => {
    let clicks = 0;
    const input = doc.querySelector("#analysis-file");
    const original = input.click.bind(input);
    input.click = () => {
      clicks += 1;
    };
    try {
      const dropzone = doc.querySelector("#analysis-dropzone");
      dropzone.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      dropzone.dispatchEvent(new win.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
      await settle(10);
      assert.equal(clicks, 2, "Entrée et Espace ouvrent le sélecteur");
    } finally {
      input.click = original;
    }
  });

  test("un dépôt sans image est refusé clairement", async () => {
    const dropzone = doc.querySelector("#analysis-dropzone");
    const event = new win.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [], items: [], types: [] }, configurable: true });
    dropzone.dispatchEvent(event);
    await settle(40);
    assert.match(doc.querySelector("#toasts").textContent, /aucune image/i);
  });
});

function switchTo(view) {
  const tab = doc.querySelector(`.tab[data-view="${view}"]`);
  click(tab);
}
