/**
 * CTR Studio AI — panneau d'export.
 *
 * Règle absolue : on n'annonce un succès qu'après vérification des octets PNG
 * (signature, IHDR 1280×720, IEND, décodage réel). Si le téléchargement direct
 * n'est pas possible, on propose des solutions de repli réelles — jamais une
 * fausse confirmation.
 */

import { THUMB_HEIGHT, THUMB_WIDTH, YOUTUBE_MAX_BYTES } from "../core/constants.js";
import { ExportError, buildFilename, describeWarnings, exportPng } from "../io/exporter.js";
import { clearLocal, projectBlob, readProjectFile } from "../io/storage.js";
import { formatBytes, slugify } from "../core/utils.js";
import { $, clear, el, on, setDisabled } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { mountFields } from "./controls.js";
import { toast, toastError, toastSuccess } from "./toast.js";

/** Déclenche le téléchargement. Renvoie un rapport honnête sur la tentative. */
export function triggerDownload(blob, filename) {
  if (!blob) return { ok: false, reason: "no-blob" };
  if (typeof URL?.createObjectURL !== "function") {
    return { ok: false, reason: "no-object-url" };
  }
  const anchor = document.createElement("a");
  if (!("download" in anchor)) {
    return { ok: false, reason: "download-unsupported" };
  }
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  try {
    anchor.click();
  } catch (err) {
    anchor.remove();
    return { ok: false, reason: "click-failed", message: err?.message ?? String(err) };
  }
  anchor.remove();
  /* Laisser le temps au navigateur de démarrer le téléchargement. */
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* déjà libéré */
    }
  }, 60000);
  return { ok: true, reason: "download-started" };
}

export function createExportPanel({ root, store }) {
  const fieldsHost = $("#export-fields", root);
  const button = $("#btn-export", root);
  const resultHost = $("#export-result", root);
  const fallbackHost = $("#export-fallback", root);
  const projectHost = $("#project-actions", root);
  const autosaveStatus = $("#autosave-status", root);
  const projectInput = $("#project-import-input", root);

  let previewUrl = null;
  let lastResult = null;
  let busy = false;

  const filenameField = mountFields(fieldsHost, [
    {
      type: "text",
      label: "Nom du fichier",
      placeholder: "miniature-youtube",
      maxlength: 80,
      hint: "Sans accent ni espace : le .png est ajouté automatiquement.",
      get: () => store.comp.meta.exportName || buildSuggestedName(),
      set: (value) => {
        store.setMeta({ exportName: value });
      },
    },
  ]);

  function buildSuggestedName() {
    return slugify(store.comp.meta.title || store.comp.meta.topic || "miniature-youtube", 40);
  }

  function filename() {
    const base = (store.comp.meta.exportName || buildSuggestedName()).trim();
    return `${slugify(base, 60)}.png`;
  }

  function setBusy(value, label) {
    busy = value;
    setDisabled(button, value);
    button.classList.toggle("is-busy", value);
    clear(button);
    button.append(value ? el("span", { class: "spinner" }) : icon("download", 18));
    button.append(el("span", { text: label ?? (value ? "Export en cours…" : "Télécharger le PNG 1280×720") }));
  }

  function renderSuccess(result, downloadReport) {
    lastResult = result;
    clear(resultHost);
    resultHost.hidden = false;

    const info = result.info ?? {};
    const items = [
      ["Dimensions", `${info.width ?? THUMB_WIDTH} × ${info.height ?? THUMB_HEIGHT} px`],
      ["Format", `PNG · ${info.colorTypeLabel ?? "RGBA"} · ${info.bitDepth ?? 8} bits`],
      ["Poids", result.sizeLabel],
      ["Décodage", result.decoded?.ok ? `${result.decoded.width} × ${result.decoded.height} px vérifiés` : "non vérifié"],
      ["Fichier", result.filename ?? filename()],
    ];

    resultHost.append(
      el("div", { class: "result-card is-success" }, [
        el("div", { class: "result-head" }, [
          el("span", { class: "result-badge" }, [icon("check", 16), el("span", { text: "PNG valide" })]),
          el("p", {
            class: "result-title",
            text: downloadReport.ok
              ? "Export terminé — téléchargement lancé."
              : "PNG créé, mais le téléchargement direct n'a pas abouti.",
          }),
        ]),
        el("dl", { class: "result-grid" }, items.flatMap(([label, value]) => [
          el("dt", { text: label }),
          el("dd", { text: value }),
        ])),
        result.overLimit
          ? el("p", { class: "result-warn" }, [
              icon("alert", 15),
              el("span", {
                text: `Poids supérieur à la limite YouTube (${formatBytes(YOUTUBE_MAX_BYTES)}). Réduisez le flou/bruit ou simplifiez le fond.`,
              }),
            ])
          : null,
      ]),
    );

    const warnings = describeWarnings(result.report?.warnings ?? []);
    if (warnings.length) {
      resultHost.append(
        el("ul", { class: "result-notes" }, warnings.map((text) => el("li", {}, [icon("info", 14), el("span", { text })]))),
      );
    }

    renderFallback(result, downloadReport);
  }

  /** Solutions de repli : aperçu longue-pression, nouvel onglet, partage, copie. */
  function renderFallback(result, downloadReport) {
    clear(fallbackHost);
    fallbackHost.hidden = false;
    fallbackHost.open = !downloadReport.ok;

    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch {
        /* déjà libéré */
      }
    }
    previewUrl = result.blob ? URL.createObjectURL(result.blob) : null;

    const summary = el("summary", {}, [
      icon(downloadReport.ok ? "info" : "alert", 16),
      el("span", {
        text: downloadReport.ok
          ? "Le fichier n'est pas arrivé ? Autres moyens d'enregistrer"
          : "Téléchargement direct indisponible — autres moyens d'enregistrer",
      }),
    ]);

    const body = el("div", { class: "fallback-body" });

    if (previewUrl) {
      const image = el("img", {
        class: "fallback-preview",
        src: previewUrl,
        alt: "Aperçu du PNG exporté (1280 × 720)",
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
      });
      body.append(
        el("p", {
          class: "fallback-hint",
          text: "Sur mobile : appuyez longuement sur l'image ci-dessous, puis « Télécharger l'image » ou « Enregistrer l'image ».",
        }),
        image,
      );
    } else {
      body.append(el("p", { class: "fallback-hint", text: "Aperçu indisponible : les objets Blob ne sont pas gérés par ce navigateur." }));
    }

    const actions = el("div", { class: "button-row is-wrap" });

    if (previewUrl) {
      actions.append(
        el("button", {
          type: "button",
          class: "btn btn-ghost btn-sm",
          onClick: () => {
            const win = window.open(previewUrl, "_blank", "noopener");
            if (!win) {
              toastError("Ouverture bloquée par le navigateur. Autorisez les pop-ups pour ce site.");
              return;
            }
            toast("Image ouverte dans un nouvel onglet : menu ⋮ puis « Télécharger ».");
          },
        }, [icon("external", 16), el("span", { text: "Ouvrir dans un onglet" })]),
      );
    }

    const fileForShare = result.blob && typeof File === "function"
      ? new File([result.blob], filename(), { type: "image/png" })
      : null;
    if (fileForShare && navigator.canShare?.({ files: [fileForShare] })) {
      actions.append(
        el("button", {
          type: "button",
          class: "btn btn-ghost btn-sm",
          onClick: async () => {
            try {
              await navigator.share({ files: [fileForShare], title: "Miniature YouTube" });
              toastSuccess("Image partagée.");
            } catch (err) {
              if (err?.name !== "AbortError") toastError(`Partage impossible : ${err?.message ?? err}`);
            }
          },
        }, [icon("share", 16), el("span", { text: "Partager l'image" })]),
      );
    }

    if (typeof ClipboardItem === "function" && navigator.clipboard?.write && result.blob) {
      actions.append(
        el("button", {
          type: "button",
          class: "btn btn-ghost btn-sm",
          onClick: async () => {
            try {
              await navigator.clipboard.write([new ClipboardItem({ "image/png": result.blob })]);
              toastSuccess("PNG copié dans le presse-papiers.");
            } catch (err) {
              toastError(`Copie refusée par le navigateur : ${err?.message ?? err}`);
            }
          },
        }, [icon("copy", 16), el("span", { text: "Copier l'image" })]),
      );
    }

    actions.append(
      el("button", {
        type: "button",
        class: "btn btn-ghost btn-sm",
        onClick: () => exportNow({ forceFallback: true }),
      }, [icon("refresh", 16), el("span", { text: "Relancer l'export" })]),
    );

    body.append(actions);
    body.append(
      el("p", {
        class: "fallback-note",
        text: downloadReport.ok
          ? "Vérifiez le dossier Téléchargements de votre navigateur. En navigation privée ou avec un bloqueur, l'enregistrement peut être refusé : utilisez alors l'une des options ci-dessus."
          : `Raison technique : ${downloadReport.reason}. Les options ci-dessus permettent d'enregistrer l'image sans téléchargement automatique.`,
      }),
    );

    fallbackHost.append(summary, body);
  }

  function renderError(err) {
    clear(resultHost);
    resultHost.hidden = false;
    const message = err?.message ?? "Erreur inconnue pendant l'export.";
    resultHost.append(
      el("div", { class: "result-card is-error" }, [
        el("div", { class: "result-head" }, [
          el("span", { class: "result-badge is-error" }, [icon("alert", 16), el("span", { text: "Échec de l'export" })]),
        ]),
        el("p", { class: "result-title", text: message }),
        el("p", {
          class: "fallback-note",
          text:
            err instanceof ExportError
              ? "Aucun fichier n'a été produit. Le message ci-dessus vient de la vérification des octets : l'application ne déclare jamais un export réussi à tort."
              : "Erreur inattendue. Essayez de recharger la page, puis réduisez la taille de la photo importée si le problème persiste.",
        }),
      ]),
    );
    fallbackHost.hidden = true;
  }

  /** Export réel : rendu → encodage → vérification → téléchargement. */
  async function exportNow({ forceFallback = false } = {}) {
    if (busy) return null;
    setBusy(true);
    clear(resultHost);
    resultHost.hidden = true;
    try {
      const result = await exportPng(store.comp, { image: store.image });
      result.filename = filename();
      const downloadReport = forceFallback
        ? { ok: false, reason: "relance-manuelle" }
        : triggerDownload(result.blob, result.filename);
      renderSuccess(result, downloadReport);
      if (downloadReport.ok) {
        toastSuccess(`PNG ${result.info?.width}×${result.info?.height} exporté (${result.sizeLabel}).`);
      } else {
        toast("PNG créé. Utilisez l'un des autres moyens d'enregistrer.", { level: "warn", duration: 9000 });
      }
      return result;
    } catch (err) {
      console.error("[CTR Studio] export échoué", err);
      renderError(err);
      toastError(err?.message ?? "Export impossible.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  on(button, "click", () => exportNow());

  /* ------------------------------------------------------------ projet */
  if (projectHost) {
    projectHost.append(
      el("button", {
        type: "button",
        class: "btn btn-ghost btn-sm",
        onClick: () => {
          const { blob, bytes } = projectBlob(store.comp);
          if (!blob) {
            toastError("Export du projet impossible : Blob non géré par ce navigateur.");
            return;
          }
          const report = triggerDownload(blob, `projet-ctr-studio-${slugify(store.comp.meta.title || "miniature", 24)}.json`);
          if (report.ok) toastSuccess(`Projet exporté (${formatBytes(bytes)}).`);
          else toastError(`Téléchargement du projet refusé (${report.reason}).`);
        },
      }, [icon("save", 16), el("span", { text: "Exporter le projet (.json)" })]),

      el("button", {
        type: "button",
        class: "btn btn-ghost btn-sm",
        onClick: () => projectInput?.click(),
      }, [icon("upload", 16), el("span", { text: "Importer un projet" })]),

      el("button", {
        type: "button",
        class: "btn btn-ghost btn-sm",
        onClick: () => {
          const report = store.saveLocal();
          if (report.ok) {
            toastSuccess(
              report.partial
                ? "Projet enregistré sans la photo (stockage saturé)."
                : `Projet enregistré localement (${report.sizeLabel ?? formatBytes(report.bytes ?? 0)}).`,
            );
          } else {
            toastError(report.message ?? "Enregistrement local impossible.");
          }
          refreshAutosave();
        },
      }, [icon("save", 16), el("span", { text: "Enregistrer maintenant" })]),

      iconButton("trash", {
        label: "Effacer la sauvegarde locale",
        className: "btn btn-ghost btn-sm",
        onClick: () => {
          clearLocal();
          refreshAutosave();
          toast("Sauvegarde locale effacée.");
        },
      }),
    );
  }

  if (projectInput) {
    on(projectInput, "change", async () => {
      const file = projectInput.files?.[0];
      projectInput.value = "";
      if (!file) return;
      try {
        const comp = await readProjectFile(file);
        store.loadComposition(comp);
        toastSuccess("Projet importé. Rechargement de la photo…");
      } catch (err) {
        toastError(err?.message ?? "Import du projet impossible.");
      }
    });
  }

  function refreshAutosave() {
    if (!autosaveStatus) return;
    const saved = store.saveLocal();
    if (saved.ok) {
      autosaveStatus.textContent = saved.partial
        ? `Sauvegarde automatique : calques enregistrés, photo trop lourde pour le stockage local (${saved.message ?? ""}).`
        : `Sauvegarde automatique active · ${saved.sizeLabel ?? formatBytes(saved.bytes ?? 0)} dans le stockage local de ce navigateur.`;
      autosaveStatus.classList.remove("is-alert");
    } else {
      autosaveStatus.textContent = `Sauvegarde automatique indisponible : ${saved.message ?? "stockage local inaccessible"}. Exportez le projet en .json pour ne rien perdre.`;
      autosaveStatus.classList.add("is-alert");
    }
  }

  setBusy(false);
  refreshAutosave();

  const unsubscribe = store.subscribe((reason) => {
    filenameField();
    if (reason === "load" || reason === "restore" || reason === "reset") refreshAutosave();
  });

  return {
    exportNow,
    refreshAutosave,
    get lastResult() {
      return lastResult;
    },
    destroy() {
      unsubscribe();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  };
}
