/**
 * CTR Studio AI — fabrique de contrôles.
 *
 * Tous les réglages de l'inspecteur passent par ici : même rendu, même
 * accessibilité, même comportement (mise à jour en direct sur `input`,
 * validation sur `change`). Ajouter un réglage = ajouter une ligne de schéma.
 */

import { el, isEditing, setDisabled, setValueIfDifferent } from "./dom.js";
import { clamp, round } from "../core/utils.js";

function head(label, right) {
  return el("div", { class: "field-head" }, [
    label ? el("span", { class: "field-label", text: label }) : null,
    right ?? null,
  ]);
}

function hint(text) {
  return text ? el("p", { class: "field-hint", text }) : null;
}

function numeric(spec) {
  return {
    min: Number.isFinite(+spec.min) ? +spec.min : -Infinity,
    max: Number.isFinite(+spec.max) ? +spec.max : Infinity,
    step: Number.isFinite(+spec.step) ? +spec.step : 1,
  };
}

function toNumber(value, bounds, fallback = 0) {
  const n = parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  const stepped = bounds.step ? Math.round(n / bounds.step) * bounds.step : n;
  return round(clamp(stepped, bounds.min, bounds.max), 4);
}

/** Champ curseur + saisie numérique. */
function rangeField(spec) {
  const bounds = numeric(spec);
  const unit = spec.unit ?? "";
  const digits = spec.digits ?? (bounds.step < 1 ? 2 : 0);

  const number = el("input", {
    type: "number",
    class: "num",
    min: bounds.min === -Infinity ? undefined : bounds.min,
    max: bounds.max === Infinity ? undefined : bounds.max,
    step: bounds.step,
    inputmode: "decimal",
    "aria-label": `${spec.label ?? ""} (valeur)`,
  });
  const slider = el("input", {
    type: "range",
    min: bounds.min === -Infinity ? 0 : bounds.min,
    max: bounds.max === Infinity ? 100 : bounds.max,
    step: bounds.step,
    "aria-label": spec.label ?? "",
  });
  if (unit) number.dataset.unit = unit;

  const push = (raw, final) => {
    const value = toNumber(raw, bounds, Number(spec.get?.()) || 0);
    spec.set?.(value);
    if (final) spec.onCommit?.(value);
    return value;
  };

  slider.addEventListener("input", () => {
    const value = push(slider.value, false);
    setValueIfDifferent(number, round(value, digits));
  });
  slider.addEventListener("change", () => push(slider.value, true));
  number.addEventListener("input", () => {
    if (number.value === "") return;
    const value = push(number.value, false);
    setValueIfDifferent(slider, value);
  });
  number.addEventListener("change", () => {
    const value = push(number.value, true);
    setValueIfDifferent(number, round(value, digits));
    setValueIfDifferent(slider, value);
  });
  number.addEventListener("blur", () => {
    const value = Number(spec.get?.()) || 0;
    setValueIfDifferent(number, round(value, digits));
  });

  const node = el("div", { class: "field field-range" }, [
    head(spec.label, el("span", { class: "field-inline" }, [number, unit ? el("em", { text: unit }) : null])),
    slider,
    hint(spec.hint),
  ]);

  return {
    el: node,
    refresh() {
      const value = Number(spec.get?.()) || 0;
      if (!isEditing(slider)) setValueIfDifferent(slider, value);
      if (!isEditing(number)) setValueIfDifferent(number, round(value, digits));
      setDisabled(node, !!spec.disabled?.());
    },
  };
}

/** Champ couleur : pastille native + saisie hexadécimale. */
function colorField(spec) {
  const swatch = el("input", { type: "color", "aria-label": spec.label ?? "couleur" });
  const text = el("input", {
    type: "text",
    class: "hex",
    spellcheck: "false",
    maxlength: 32,
    "aria-label": `${spec.label ?? "couleur"} (code)`,
  });

  swatch.addEventListener("input", () => {
    spec.set?.(swatch.value);
    if (!isEditing(text)) setValueIfDifferent(text, swatch.value);
  });
  swatch.addEventListener("change", () => spec.onCommit?.(swatch.value));
  text.addEventListener("change", () => {
    const value = text.value.trim();
    if (!value) return;
    spec.set?.(value);
    spec.onCommit?.(value);
    refresh();
  });

  const node = el("div", { class: "field field-color" }, [
    head(spec.label),
    el("div", { class: "color-row" }, [swatch, text]),
    hint(spec.hint),
  ]);

  function refresh() {
    const value = String(spec.get?.() ?? "#ffffff");
    if (!isEditing(swatch) && /^#[0-9a-f]{6}$/i.test(value)) setValueIfDifferent(swatch, value);
    if (!isEditing(text)) setValueIfDifferent(text, value);
    setDisabled(node, !!spec.disabled?.());
  }

  return { el: node, refresh };
}

function textField(spec, { multiline = false } = {}) {
  const input = multiline
    ? el("textarea", { rows: spec.rows ?? 3, placeholder: spec.placeholder ?? "", spellcheck: "false" })
    : el("input", { type: "text", placeholder: spec.placeholder ?? "", maxlength: spec.maxlength ?? 200 });
  if (spec.label) input.setAttribute("aria-label", spec.label);

  input.addEventListener("input", () => spec.set?.(input.value));
  input.addEventListener("change", () => spec.onCommit?.(input.value));

  const node = el("div", { class: `field ${multiline ? "field-textarea" : "field-text"}` }, [
    spec.label ? head(spec.label, spec.counter ? el("span", { class: "field-count", dataset: { role: "counter" } }) : null) : null,
    input,
    hint(spec.hint),
  ]);
  const counter = node.querySelector('[data-role="counter"]');

  return {
    el: node,
    refresh() {
      const value = String(spec.get?.() ?? "");
      if (!isEditing(input)) setValueIfDifferent(input, value);
      if (counter) {
        const max = spec.counter;
        counter.textContent = `${value.length}${max ? ` / ${max}` : ""}`;
        counter.classList.toggle("is-over", max ? value.length > max : false);
      }
      setDisabled(node, !!spec.disabled?.());
    },
  };
}

function selectField(spec) {
  const select = el("select");
  let optionsSignature = null;

  /* Les options peuvent évoluer (polices importées en cours de session). */
  function syncOptions() {
    const options = (typeof spec.getOptions === "function" ? spec.getOptions() : spec.options) ?? [];
    const signature = options.map((option) => option.value).join("|");
    if (signature === optionsSignature) return;
    optionsSignature = signature;
    select.textContent = "";
    for (const option of options) {
      select.append(el("option", { value: option.value, text: option.label, title: option.title ?? "" }));
    }
  }
  syncOptions();
  if (spec.label) select.setAttribute("aria-label", spec.label);
  select.addEventListener("change", () => {
    spec.set?.(select.value);
    spec.onCommit?.(select.value);
  });

  const node = el("div", { class: "field field-select" }, [head(spec.label), select, hint(spec.hint)]);
  return {
    el: node,
    refresh() {
      syncOptions();
      const value = String(spec.get?.() ?? "");
      if (!isEditing(select)) setValueIfDifferent(select, value);
      setDisabled(node, !!spec.disabled?.());
    },
  };
}

function toggleField(spec) {
  const button = el("button", {
    type: "button",
    class: "switch",
    role: "switch",
    "aria-checked": "false",
  }, [el("span", { class: "switch-track" }, [el("span", { class: "switch-thumb" })])]);
  button.addEventListener("click", () => {
    const next = !spec.get?.();
    spec.set?.(next);
    spec.onCommit?.(next);
    refresh();
  });

  const node = el("div", { class: "field field-toggle" }, [
    el("div", { class: "toggle-row" }, [
      el("div", {}, [
        el("span", { class: "field-label", text: spec.label ?? "" }),
        spec.hint ? el("p", { class: "field-hint", text: spec.hint }) : null,
      ]),
      button,
    ]),
  ]);

  function refresh() {
    const on = !!spec.get?.();
    button.setAttribute("aria-checked", on ? "true" : "false");
    button.classList.toggle("is-on", on);
    setDisabled(node, !!spec.disabled?.());
  }
  return { el: node, refresh };
}

function segmentField(spec) {
  const buttons = (spec.options ?? []).map((option) =>
    el("button", {
      type: "button",
      class: "seg-btn",
      text: option.label,
      title: option.title ?? "",
      dataset: { value: option.value },
      onClick: () => {
        spec.set?.(option.value);
        spec.onCommit?.(option.value);
        refresh();
      },
    }),
  );
  const node = el("div", { class: "field field-segment" }, [
    head(spec.label),
    el("div", { class: "segmented", role: "group", "aria-label": spec.label ?? "" }, buttons),
    hint(spec.hint),
  ]);

  function refresh() {
    const value = String(spec.get?.() ?? "");
    for (const button of buttons) {
      const active = button.dataset.value === value;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.classList.toggle("is-active", active);
    }
    setDisabled(node, !!spec.disabled?.());
  }
  return { el: node, refresh };
}

function buttonsField(spec) {
  const buttons = (spec.actions ?? []).map((action) =>
    el("button", {
      type: "button",
      class: action.class ?? "btn btn-ghost btn-sm",
      text: action.label,
      title: action.title ?? "",
      onClick: () => action.onClick?.(),
    }),
  );
  const node = el("div", { class: "field field-buttons" }, [
    spec.label ? head(spec.label) : null,
    el("div", { class: `button-row ${spec.wrap ? "is-wrap" : ""}` }, buttons),
    hint(spec.hint),
  ]);
  return {
    el: node,
    refresh() {
      setDisabled(node, !!spec.disabled?.());
      (spec.actions ?? []).forEach((action, index) => {
        if (buttons[index]) setDisabled(buttons[index], !!action.disabled?.());
      });
    },
  };
}

function staticField(spec) {
  const value = el("span", { class: "field-value", text: "—" });
  const node = el("div", { class: "field field-static" }, [head(spec.label, value), hint(spec.hint)]);
  return {
    el: node,
    refresh() {
      value.textContent = String(spec.get?.() ?? "—");
      node.classList.toggle("is-alert", !!spec.alert?.());
    },
  };
}

/** Point d'entrée unique : renvoie `{ el, refresh }`. */
export function createField(spec) {
  switch (spec.type) {
    case "range":
      return rangeField(spec);
    case "color":
      return colorField(spec);
    case "text":
      return textField(spec);
    case "textarea":
      return textField(spec, { multiline: true });
    case "select":
      return selectField(spec);
    case "toggle":
      return toggleField(spec);
    case "segment":
      return segmentField(spec);
    case "buttons":
      return buttonsField(spec);
    case "static":
      return staticField(spec);
    default:
      throw new Error(`Type de contrôle inconnu : ${spec.type}`);
  }
}

/** Construit une liste de champs dans un conteneur, renvoie leur `refresh`. */
export function mountFields(container, specs) {
  if (!container) return () => {};
  container.textContent = "";
  const fields = specs.filter(Boolean).map((spec) => createField(spec));
  for (const field of fields) container.append(field.el);
  const refresh = () => fields.forEach((field) => field.refresh());
  refresh();
  return refresh;
}
