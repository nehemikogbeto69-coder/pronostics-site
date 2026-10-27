/**
 * CTR Studio AI — notifications temporaires (toasts).
 */

import { el, on } from "./dom.js";
import { icon } from "./icons.js";

const ICON_BY_LEVEL = {
  info: "info",
  success: "check",
  warn: "alert",
  error: "alert",
};

let stack = null;

function ensureStack() {
  if (stack && document.body.contains(stack)) return stack;
  stack = document.querySelector("#toasts") ?? el("div", { class: "toast-stack", id: "toasts" });
  stack.setAttribute("role", "status");
  stack.setAttribute("aria-live", "polite");
  document.body.append(stack);
  return stack;
}

/**
 * Affiche un message temporaire.
 * @param {string} message
 * @param {{level?:'info'|'success'|'warn'|'error', duration?:number, action?:{label:string,onClick:Function}}} [options]
 */
export function toast(message, options = {}) {
  const level = options.level ?? "info";
  const duration = options.duration ?? (level === "error" ? 7000 : 4200);
  const container = ensureStack();

  const node = el("div", { class: `toast toast-${level}`, dataset: { level } }, [
    el("span", { class: "toast-icon" }, [icon(ICON_BY_LEVEL[level] ?? "info", 17)]),
    el("span", { class: "toast-text", text: String(message) }),
    options.action
      ? el("button", {
          type: "button",
          class: "toast-action",
          text: options.action.label,
          onClick: () => {
            options.action.onClick?.();
            close();
          },
        })
      : null,
    el("button", { type: "button", class: "toast-close", "aria-label": "Fermer", onClick: () => close() }, [
      icon("close", 14),
    ]),
  ]);

  let timer = null;
  function close() {
    if (timer) clearTimeout(timer);
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 220);
  }

  container.append(node);
  if (duration > 0) timer = setTimeout(close, duration);
  on(node, "mouseenter", () => {
    if (timer) clearTimeout(timer);
  });

  /* On évite l'empilement infini : 4 messages maximum. */
  while (container.children.length > 4) container.firstElementChild?.remove();

  return close;
}

export const toastSuccess = (message, options) => toast(message, { ...options, level: "success" });
export const toastError = (message, options) => toast(message, { ...options, level: "error" });
export const toastWarn = (message, options) => toast(message, { ...options, level: "warn" });
