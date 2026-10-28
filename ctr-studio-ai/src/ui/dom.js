/**
 * CTR Studio AI — petits utilitaires DOM.
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Fabrique d'élément : `el("button", { class: "btn", textContent: "OK", onClick })`. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && typeof value !== "object") {
      try {
        node[key] = value;
      } catch {
        node.setAttribute(key, String(value));
      }
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function on(target, type, handler, options) {
  if (!target) return () => {};
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** Ne met à jour le DOM que si la valeur change (évite les sauts de curseur). */
export function setValueIfDifferent(input, value) {
  if (!input) return;
  const next = value === null || value === undefined ? "" : String(value);
  if (input.value !== next) input.value = next;
}

/** Un champ en cours d'édition n'est jamais écrasé par un rafraîchissement. */
export function isEditing(node) {
  return !!node && document.activeElement === node;
}

export function setDisabled(node, disabled) {
  if (!node) return;
  node.disabled = !!disabled;
  node.setAttribute("aria-disabled", disabled ? "true" : "false");
}

/** Accessibilité : état appuyé d'un bouton bascule. */
export function setPressed(button, pressed) {
  if (!button) return;
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
  button.classList.toggle("is-active", !!pressed);
}

export function announce(message) {
  const live = $("#a11y-live");
  if (live) live.textContent = message;
}
