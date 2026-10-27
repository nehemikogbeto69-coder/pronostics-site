/**
 * CTR Studio AI — vue « Idées ».
 *
 * Génération locale par gabarits (voir features/ideas/generator.js). Chaque
 * carte est explicitement étiquetée « simulée » : aucune API, aucun modèle
 * distant, aucune donnée YouTube.
 */

import { AVAILABLE_TONES, generateIdeas, SIMULATION_NOTICE } from "../features/ideas/generator.js";
import { IDEAS_COUNT } from "../core/constants.js";
import { $, clear, el, on, setDisabled } from "./dom.js";
import { icon } from "./icons.js";
import { toast, toastError, toastSuccess } from "./toast.js";

const TONE_LABELS = {
  direct: "Direct (tous les angles)",
  pedagogue: "Pédagogue (guides, étapes)",
  punchy: "Punchy (angles forts)",
  sobre: "Sobre (factuel, comparatif)",
};

function scoreClass(score) {
  if (score >= 80) return "is-excellent";
  if (score >= 62) return "is-good";
  if (score >= 42) return "is-fair";
  return "is-poor";
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* repli ci-dessous */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.("copy") ?? false;
    area.remove();
    return !!ok;
  } catch {
    return false;
  }
}

export function createIdeasView({ root, store, onSendToEditor }) {
  const topicInput = $("#ideas-topic", root);
  const audienceInput = $("#ideas-audience", root);
  const toneSelect = $("#ideas-tone", root);
  const runButton = $("#ideas-run", root);
  const resultsHost = $("#ideas-results", root);
  const emptyState = $("#ideas-empty", root);
  const metaLine = $("#ideas-meta", root);
  const noticeHost = $("#ideas-notice", root);

  let seed = 1;
  let lastResult = null;

  if (toneSelect) {
    clear(toneSelect);
    for (const tone of AVAILABLE_TONES) {
      toneSelect.append(
        el("option", { value: tone.id, text: TONE_LABELS[tone.id] ?? tone.id, title: tone.note }),
      );
    }
  }

  if (noticeHost) {
    noticeHost.append(
      el("div", { class: "banner banner-simulated" }, [
        el("span", { class: "banner-icon" }, [icon("alert", 16)]),
        el("div", {}, [
          el("strong", { text: "Résultats simulés, générés sur votre appareil." }),
          el("p", { text: SIMULATION_NOTICE }),
        ]),
      ]),
    );
  }

  function meter(score) {
    return el("div", { class: `meter meter-sm ${scoreClass(score)}` }, [
      el("span", { class: "meter-fill", style: { width: `${Math.max(3, score)}%` } }),
    ]);
  }

  function ideaCard(idea, index) {
    const card = el("article", { class: "idea-card", dataset: { index: String(index) } });

    card.append(
      el("header", { class: "idea-head" }, [
        el("span", { class: "badge badge-angle", text: idea.angleLabel }),
        el("span", { class: "badge badge-local" }, [icon("sparkles", 13), el("span", { text: "simulé" })]),
        el("span", { class: `idea-score ${scoreClass(idea.titleScore)}`, title: "Score heuristique du titre (lisibilité, accroche, précision)" }, [
          el("strong", { text: String(idea.titleScore) }),
          el("small", { text: "/100" }),
        ]),
      ]),
    );

    card.append(el("h3", { class: "idea-title", text: idea.title }));
    card.append(meter(idea.titleScore));

    if (idea.needsRealData) {
      card.append(
        el("p", { class: "idea-warning" }, [
          icon("alert", 14),
          el("span", { text: "Les « ____ » sont à remplacer par VOS chiffres réels — ne publiez jamais une valeur inventée." }),
        ]),
      );
    }

    card.append(
      el("div", { class: "idea-overlay" }, [
        el("span", { class: "idea-overlay-label", text: "Texte sur la miniature" }),
        el("code", { class: "idea-overlay-text", text: idea.overlayText }),
        el("span", { class: "idea-overlay-hint", text: `Taille conseillée : ${idea.concept.fontSizeHint}` }),
      ]),
    );

    card.append(
      el("dl", { class: "idea-concept" }, [
        el("dt", { text: "Visuel" }),
        el("dd", { text: idea.concept.visual }),
        el("dt", { text: "Mise en page" }),
        el("dd", { text: idea.concept.layout }),
        el("dt", { text: "Expression" }),
        el("dd", { text: idea.concept.expression }),
        el("dt", { text: "Modèle" }),
        el("dd", { text: { energie: "Énergie", focus: "Focus", editorial: "Éditorial" }[idea.suggestedTemplate] ?? idea.suggestedTemplate }),
      ]),
    );

    card.append(
      el("div", { class: "idea-palette" }, idea.concept.palette.colors.map((color) =>
        el("span", { class: "swatch", style: { background: color }, title: color, dataset: { color } }),
      )),
    );
    card.append(
      el("p", { class: "idea-mood", text: `Palette ${idea.concept.palette.id} — ambiance ${idea.concept.palette.mood}.` }),
    );

    if (idea.alternatives?.length) {
      card.append(
        el("details", { class: "idea-alt" }, [
          el("summary", { text: `${idea.alternatives.length} variante(s) écartée(s)` }),
          el("ul", {}, idea.alternatives.map((alt) => el("li", { text: alt }))),
        ]),
      );
    }

    if (idea.titleFlags?.length) {
      card.append(
        el("ul", { class: "idea-flags" }, idea.titleFlags.slice(0, 2).map((flag) =>
          el("li", { class: flag.level === "error" ? "is-ko" : flag.level === "warn" ? "is-warn" : "is-info" }, [
            icon("info", 13),
            el("span", { text: flag.text }),
          ]),
        )),
      );
    }

    card.append(
      el("footer", { class: "idea-actions" }, [
        el("button", {
          type: "button",
          class: "btn btn-ghost btn-sm",
          onClick: async () => {
            const ok = await copyText(idea.title);
            if (ok) toastSuccess("Titre copié dans le presse-papiers.");
            else toastError("Copie refusée par le navigateur. Sélectionnez le titre manuellement.");
          },
        }, [icon("copy", 15), el("span", { text: "Copier le titre" })]),
        el("button", {
          type: "button",
          class: "btn btn-primary btn-sm",
          onClick: () => {
            onSendToEditor?.(idea);
          },
        }, [icon("wand", 15), el("span", { text: "Envoyer vers l'éditeur" })]),
      ]),
    );

    return card;
  }

  function render(result) {
    lastResult = result;
    clear(resultsHost);
    if (emptyState) emptyState.hidden = true;
    resultsHost.hidden = false;

    for (const [index, idea] of result.ideas.entries()) {
      resultsHost.append(ideaCard(idea, index));
    }

    if (metaLine) {
      metaLine.textContent =
        `${result.ideas.length} idées · sujet « ${result.meta.topic} » · ton ${TONE_LABELS[result.meta.tone] ?? result.meta.tone}` +
        ` · tirage #${result.meta.seed} · ${result.meta.toneNote}`;
    }
  }

  function generate({ bumpSeed = false } = {}) {
    const topic = topicInput?.value?.trim() ?? "";
    if (!topic) {
      toastError("Indiquez le sujet de votre vidéo pour générer des idées.");
      topicInput?.focus();
      return null;
    }
    if (bumpSeed) seed += 1;
    setDisabled(runButton, true);
    runButton.classList.add("is-busy");
    try {
      const result = generateIdeas({
        topic,
        audience: audienceInput?.value?.trim() ?? "",
        tone: toneSelect?.value ?? "direct",
        count: IDEAS_COUNT,
        seed,
      });
      store.setMeta({ topic, title: result.ideas[0]?.title ?? "" });
      render(result);
      return result;
    } catch (err) {
      console.error("[CTR Studio] générateur d'idées", err);
      toastError(err?.message ?? "Génération impossible.");
      return null;
    } finally {
      setDisabled(runButton, false);
      runButton.classList.remove("is-busy");
    }
  }

  on(runButton, "click", () => generate({ bumpSeed: true }));
  on($("#ideas-regenerate", root), "click", () => generate({ bumpSeed: true }));
  on(topicInput, "keydown", (event) => {
    if (event.key === "Enter") generate({ bumpSeed: true });
  });

  return {
    generate,
    get result() {
      return lastResult;
    },
    get seed() {
      return seed;
    },
  };
}
