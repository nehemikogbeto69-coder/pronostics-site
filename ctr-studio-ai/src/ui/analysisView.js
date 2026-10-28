/**
 * CTR Studio AI — vue « Analyse ».
 *
 * Le calcul se fait entièrement dans le navigateur : l'image est réduite à
 * 320×180, puis mesurée (contraste, bruit visuel, zones de texte, grille des
 * tiers). Aucun serveur, aucune donnée YouTube, aucune prédiction de CTR.
 */

import { ANALYSIS_HEIGHT, ANALYSIS_WIDTH, analyzePixels } from "../features/analysis/imageMetrics.js";
import { buildReport } from "../features/analysis/report.js";
import { analyzeTitle } from "../features/analysis/titleMetrics.js";
import { THUMB_HEIGHT, THUMB_WIDTH } from "../core/constants.js";
import { formatBytes } from "../core/utils.js";
import { $, clear, el, on, setDisabled } from "./dom.js";
import { icon } from "./icons.js";
import { toast, toastError } from "./toast.js";
import { pickImageFromDataTransfer, validateImageFile } from "../io/imageImport.js";
import { exportPng } from "../io/exporter.js";

const OVERLAY_WIDTH = 640;
const OVERLAY_HEIGHT = 360;

function scoreClass(score) {
  if (score >= 80) return "is-excellent";
  if (score >= 62) return "is-good";
  if (score >= 42) return "is-fair";
  return "is-poor";
}

function zoneColor(score) {
  if (score >= 0.7) return { fill: "rgba(52,211,153,0.26)", stroke: "#34d399" };
  if (score >= 0.45) return { fill: "rgba(251,191,36,0.22)", stroke: "#fbbf24" };
  return { fill: "rgba(251,113,133,0.2)", stroke: "#fb7185" };
}

/** Dessine l'image analysée + grille des tiers + zones de texte + point d'attention. */
export function drawAnalysisOverlay(canvas, image, report) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  if (image) {
    ctx.drawImage(image, 0, 0, width, height);
  } else {
    ctx.fillStyle = "#140a24";
    ctx.fillRect(0, 0, width, height);
  }
  if (!report) return;

  const metrics = report.metrics;

  /* Zones de texte, de la meilleure à la moins bonne (3 affichées). */
  const zones = [...metrics.zones].sort((a, b) => b.score - a.score).slice(0, 3);
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  zones.forEach((zone, index) => {
    const [zx, zy, zw, zh] = zone.box;
    const x = zx * width;
    const y = zy * height;
    const w = zw * width;
    const h = zh * height;
    const color = zoneColor(zone.score);
    ctx.fillStyle = color.fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color.stroke;
    ctx.lineWidth = index === 0 ? 3 : 1.6;
    ctx.setLineDash(index === 0 ? [] : [7, 5]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    const label = `${index + 1}. ${zone.label} · ${Math.round(zone.score * 100)} %`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(7,4,13,0.78)";
    ctx.fillRect(x, y - 19, textWidth + 12, 19);
    ctx.fillStyle = color.stroke;
    ctx.fillText(label, x + 6, y - 9.5);
  });

  /* Grille des tiers. */
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  for (let i = 1; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo((width / 3) * i, 0);
    ctx.lineTo((width / 3) * i, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, (height / 3) * i);
    ctx.lineTo(width, (height / 3) * i);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  /* Point d'attention principal. */
  const focus = metrics.composition.focus;
  const fx = focus.x * width;
  const fy = focus.y * height;
  ctx.strokeStyle = "#c084fc";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(fx, fy, 13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(fx - 20, fy);
  ctx.lineTo(fx + 20, fy);
  ctx.moveTo(fx, fy - 20);
  ctx.lineTo(fx, fy + 20);
  ctx.stroke();

  /* Marge de sécurité. */
  ctx.strokeStyle = "rgba(168,85,247,0.65)";
  ctx.setLineDash([4, 6]);
  ctx.strokeRect(width * 0.035, height * 0.05, width * 0.93, height * 0.9);
  ctx.setLineDash([]);
}

export function createAnalysisView({ root, store }) {
  const fileInput = $("#analysis-file", root);
  const dropzone = $("#analysis-dropzone", root);
  const overlay = $("#analysis-overlay", root);
  const titleInput = $("#analysis-title", root);
  const topicInput = $("#analysis-topic", root);
  const analyzeButton = $("#analysis-run", root);
  const useCurrentButton = $("#analysis-use-current", root);
  const sourceInfo = $("#analysis-source", root);
  const resultsHost = $("#analysis-results", root);
  const emptyState = $("#analysis-empty", root);
  const titlePreview = $("#analysis-title-preview", root);

  let sourceBlob = null;
  let sourceImage = null;
  let sourceMeta = { name: "", size: 0, width: 0, height: 0 };
  let lastReport = null;

  overlay.width = OVERLAY_WIDTH;
  overlay.height = OVERLAY_HEIGHT;

  function setSourceInfo() {
    if (!sourceInfo) return;
    if (!sourceBlob) {
      sourceInfo.textContent = "Aucune image chargée.";
      sourceInfo.classList.add("is-empty");
      return;
    }
    sourceInfo.classList.remove("is-empty");
    sourceInfo.textContent = `${sourceMeta.name} · ${sourceMeta.width} × ${sourceMeta.height} px · ${formatBytes(sourceMeta.size)}`;
  }

  function decodeBlob(blob) {
    /* createImageBitmap d'abord : plus rapide, sans URL objet à libérer, et
       disponible sur tous les navigateurs visés. */
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob).catch(() => decodeViaImageElement(blob));
    }
    return decodeViaImageElement(blob);
  }

  function decodeViaImageElement(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image illisible : format non géré ou fichier corrompu."));
      };
      image.src = url;
    });
  }

  async function setSource(blob, meta = {}) {
    const check =
      typeof File === "function" && blob instanceof File ? validateImageFile(blob) : { ok: true };
    if (!check?.ok) throw new Error(check?.error ?? "Source d'image invalide.");
    if (!(blob instanceof Blob)) throw new Error("Source d'image invalide.");
    const image = await decodeBlob(blob);
    sourceBlob = blob;
    sourceImage = image;
    sourceMeta = {
      name: meta.name ?? "image",
      size: meta.size ?? blob.size ?? 0,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
    setSourceInfo();
    drawAnalysisOverlay(overlay, sourceImage, lastReport);
    if (dropzone) dropzone.classList.add("has-image");
    return image;
  }

  /** Analyse une miniature produite par l'éditeur (appel depuis main.js). */
  async function analyzeBlob(blob, meta = {}) {
    await setSource(blob, meta);
    run();
  }

  /** Mesure les pixels : réduction à 320×180 puis analyse. */
  function measurePixels(image) {
    const canvas = document.createElement("canvas");
    canvas.width = ANALYSIS_WIDTH;
    canvas.height = ANALYSIS_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Contexte canvas indisponible : analyse impossible sur cet appareil.");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    return ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  }

  function run() {
    if (!sourceImage) {
      toastError("Choisissez d'abord une image à analyser.");
      return null;
    }
    setDisabled(analyzeButton, true);
    analyzeButton.classList.add("is-busy");
    try {
      const imageData = measurePixels(sourceImage);
      const metrics = analyzePixels(imageData);
      const titleValue = titleInput?.value?.trim() ?? "";
      const topicValue = topicInput?.value?.trim() ?? "";
      const title = titleValue ? analyzeTitle(titleValue, { topic: topicValue }) : null;

      const report = buildReport({
        metrics,
        title,
        topic: topicValue,
        file: { name: sourceMeta.name, size: sourceMeta.size, type: sourceBlob?.type ?? "" },
        natural: { width: sourceMeta.width, height: sourceMeta.height },
      });
      lastReport = report;
      store.setMeta({ title: titleValue, topic: topicValue });
      render(report);
      drawAnalysisOverlay(overlay, sourceImage, report);
      updateTitlePreview();
      return report;
    } catch (err) {
      console.error("[CTR Studio] analyse", err);
      toastError(err?.message ?? "Analyse impossible.");
      return null;
    } finally {
      setDisabled(analyzeButton, false);
      analyzeButton.classList.remove("is-busy");
    }
  }

  function updateTitlePreview() {
    if (!titlePreview) return;
    const value = titleInput?.value ?? "";
    const visible = [...value].slice(0, 70).join("");
    clear(titlePreview);
    /* `append(null)` écrirait le texte « null » : on filtre les nœuds absents. */
    const nodes = [
      el("span", { class: "preview-label", text: "Aperçu dans le fil :" }),
      el("span", { class: "preview-text", text: visible || "Votre titre YouTube…" }),
      value.length > 70 ? el("span", { class: "preview-cut", text: "…" }) : null,
      el("span", {
        class: `preview-count${value.length > 100 ? " is-over" : value.length > 70 ? " is-warn" : ""}`,
        text: `${value.length}/100`,
      }),
    ];
    titlePreview.append(...nodes.filter(Boolean));
  }

  /* --------------------------------------------------------------- rendu */

  function meter(score) {
    return el("div", { class: `meter ${scoreClass(score)}` }, [
      el("span", { class: "meter-fill", style: { width: `${Math.max(2, Math.min(100, score))}%` } }),
    ]);
  }

  function render(report) {
    if (!resultsHost) return;
    clear(resultsHost);
    if (emptyState) emptyState.hidden = true;
    resultsHost.hidden = false;

    /* Score global */
    resultsHost.append(
      el("div", { class: "score-hero" }, [
        el("div", { class: "score-ring", dataset: { score: report.overall.score } }, [
          el("strong", { text: String(report.overall.score) }),
          el("small", { text: "/100" }),
        ]),
        el("div", { class: "score-text" }, [
          el("h3", { text: report.overall.label }),
          el("p", { class: `score-level ${scoreClass(report.overall.score)}`, text: report.overall.levelLabel }),
          el("p", {
            class: "score-sub",
            text: "Synthèse des mesures ci-dessous — pas une estimation d'audience.",
          }),
        ]),
      ]),
    );

    /* Actions prioritaires */
    if (report.priorities.length) {
      resultsHost.append(
        el("div", { class: "priorities" }, [
          el("h4", {}, [icon("target", 16), el("span", { text: "À traiter en priorité" })]),
          el("ol", {}, report.priorities.map((priority) =>
            el("li", {}, [
              el("strong", { text: `${priority.label} (${priority.score}/100) — ` }),
              el("span", { text: priority.tip }),
            ]),
          )),
        ]),
      );
    }

    /* Sections */
    const sections = el("div", { class: "sections" });
    for (const section of report.sections) {
      const card = el("article", { class: `section-card ${scoreClass(section.score)}` }, [
        el("header", { class: "section-head" }, [
          el("h4", { text: section.label }),
          el("span", { class: "section-score", text: `${section.score}` }),
        ]),
        meter(section.score),
        el("p", { class: "section-value", text: section.value }),
        el("p", { class: "section-detail", text: section.detail }),
        section.tips?.length
          ? el("ul", { class: "section-tips" }, section.tips.slice(0, 3).map((tip) =>
              el("li", {}, [icon("sparkles", 14), el("span", { text: tip })]),
            ))
          : null,
        section.checks
          ? el("ul", { class: "checks" }, section.checks.map((check) =>
              el("li", { class: check.ok ? "is-ok" : "is-ko" }, [
                icon(check.ok ? "check" : "alert", 14),
                el("span", { text: check.text }),
              ]),
            ))
          : null,
        section.rule ? el("p", { class: "section-rule", text: `Règle appliquée : ${section.rule}` }) : null,
      ]);
      sections.append(card);
    }
    resultsHost.append(sections);

    /* Zones de texte détaillées */
    const zones = report.sections.find((s) => s.id === "lisibilite")?.zones ?? [];
    if (zones.length) {
      resultsHost.append(
        el("div", { class: "zones" }, [
          el("h4", {}, [icon("target", 16), el("span", { text: "Où poser le texte (6 zones testées)" })]),
          el("table", { class: "zones-table" }, [
            el("thead", {}, el("tr", {}, ["Zone", "Score", "Contraste", "Bruit"].map((label) => el("th", { text: label })))),
            el("tbody", {}, zones.map((zone) =>
              el("tr", { class: scoreClass(zone.score) }, [
                el("td", { text: zone.label }),
                el("td", { text: `${zone.score}` }),
                el("td", { text: `${zone.contrast}:1` }),
                el("td", { text: `${zone.busy} %` }),
              ]),
            )),
          ]),
          el("p", {
            class: "section-rule",
            text: "Contraste = ratio WCAG entre le texte (blanc ou sombre, le meilleur des deux) et la luminance médiane de la zone. Bruit = énergie de contour locale, plus elle est haute plus le fond est chargé.",
          }),
        ]),
      );
    }

    /* Titre analysé */
    if (report.titleSection) {
      const title = report.titleSection;
      resultsHost.append(
        el("div", { class: "title-analysis" }, [
          el("h4", {}, [icon("text", 16), el("span", { text: "Titre analysé" })]),
          el("div", { class: "title-sub" }, [
            el("span", { text: `Aperçu fil : « ${title.feedPreview}${title.truncated ? "…" : ""} »` }),
          ]),
          title.flags?.length
            ? el("ul", { class: "checks" }, title.flags.map((flag) =>
                el("li", { class: flag.level === "error" ? "is-ko" : flag.level === "warn" ? "is-warn" : "is-info" }, [
                  icon(flag.level === "info" ? "info" : "alert", 14),
                  el("span", { text: flag.text }),
                ]),
              ))
            : el("p", { class: "section-value", text: "Aucun problème détecté sur le titre." }),
        ]),
      );
    }

    /* Avertissement d'honnêteté */
    resultsHost.append(
      el("aside", { class: "disclaimer" }, [
        el("div", { class: "disclaimer-head" }, [icon("alert", 16), el("strong", { text: "Ce que cette analyse n'est pas" })]),
        el("p", { text: report.disclaimer }),
        el("p", {
          class: "disclaimer-more",
          text: `Calcul local sur une version réduite de l'image (${ANALYSIS_WIDTH} × ${ANALYSIS_HEIGHT} px). Règles appliquées : ${report.rules.map((r) => `${r.label} (${r.weight} %)`).join(" · ")}.`,
        }),
      ]),
    );
  }

  /* ------------------------------------------------------------ événements */
  on(analyzeButton, "click", () => run());
  on(titleInput, "input", updateTitlePreview);
  on(titleInput, "change", () => store.setMeta({ title: titleInput.value }));
  on(topicInput, "change", () => store.setMeta({ topic: topicInput.value }));

  on(fileInput, "change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      await setSource(file, { name: file.name, size: file.size });
      toast("Image chargée. Lancez l'analyse.");
      run();
    } catch (err) {
      toastError(err?.message ?? "Import impossible.");
    }
  });

  if (dropzone) {
    on(dropzone, "click", () => fileInput.click());
    /* La zone est un role="button" : elle doit réagir au clavier. */
    on(dropzone, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        fileInput.click();
      }
    });
    on(dropzone, "dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dropping");
    });
    on(dropzone, "dragleave", () => dropzone.classList.remove("is-dropping"));
    on(dropzone, "drop", async (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dropping");
      const file = pickImageFromDataTransfer(event.dataTransfer);
      if (!file) {
        toastError("Aucune image détectée dans ce dépôt.");
        return;
      }
      try {
        await setSource(file, { name: file.name, size: file.size });
        run();
      } catch (err) {
        toastError(err?.message ?? "Import impossible.");
      }
    });
  }

  /** Exporte la miniature en cours d'édition puis l'analyse (bouton + raccourci). */
  async function useCurrentThumbnail() {
    setDisabled(useCurrentButton, true);
    useCurrentButton.classList.add("is-busy");
    try {
      const result = await exportPng(store.comp, { image: store.image });
      await setSource(result.blob, { name: "miniature-en-cours.png", size: result.sizeBytes });
      sourceMeta.width = result.info?.width ?? THUMB_WIDTH;
      sourceMeta.height = result.info?.height ?? THUMB_HEIGHT;
      setSourceInfo();
      if (titleInput && store.comp.meta.title) titleInput.value = store.comp.meta.title;
      if (topicInput && store.comp.meta.topic) topicInput.value = store.comp.meta.topic;
      updateTitlePreview();
      run();
      toast("Miniature en cours analysée.");
      return lastReport;
    } catch (err) {
      console.error("[CTR Studio] analyse de la miniature en cours", err);
      toastError(err?.message ?? "Impossible d'analyser la miniature en cours.");
      return null;
    } finally {
      setDisabled(useCurrentButton, false);
      useCurrentButton.classList.remove("is-busy");
    }
  }

  on(useCurrentButton, "click", useCurrentThumbnail);

  setSourceInfo();
  updateTitlePreview();
  drawAnalysisOverlay(overlay, null, null);

  return {
    run,
    analyzeBlob,
    useCurrentThumbnail,
    get report() {
      return lastReport;
    },
    get hasSource() {
      return !!sourceImage;
    },
  };
}

export const ANALYSIS_OVERLAY_SIZE = { width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT };
