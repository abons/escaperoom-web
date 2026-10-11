// Small DOM helpers: element builder, modal stack, toast.
import { t } from './i18n.js';

/** h('div', {class:'x', onclick: fn}, 'text', child) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function button(label, onClick, ghost = false, cls = '') {
  return h('button', { type: 'button', class: 'btn ' + (ghost ? 'ghost ' : '') + cls, onclick: onClick }, label);
}

// ---- modal stack
const stack = [];

export function modalOpen() { return stack.length > 0; }

/** Close every open modal (browser back, leaving a screen). */
export function closeAllModals() { while (stack.length) stack[stack.length - 1].close(); }

/**
 * modal({title, message, content, buttons:[{label, primary, onClick}], cancelable, className})
 * A button handler returning false keeps the modal open. Returns {close}.
 */
export function modal({ title, message, content, buttons = [], cancelable = true, className = '', onKey } = {}) {
  const box = h('div', { class: 'modal-box ' + className, role: 'dialog', 'aria-modal': 'true' });
  if (title) box.append(h('h2', { class: 'modal-title' }, title));
  if (message) box.append(h('div', { class: 'modal-msg' }, message));
  if (content) box.append(content);
  const entry = { cancelable, onKey, el: null };
  const close = () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    entry.el.remove();
  };
  if (buttons.length) {
    const row = h('div', { class: 'modal-buttons' });
    for (const b of buttons) {
      row.append(button(b.label, () => {
        const r = b.onClick ? b.onClick() : undefined;
        if (r !== false) close();
      }, !b.primary));
    }
    box.append(row);
  }
  const overlay = h('div', { class: 'overlay' }, box);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay && cancelable) close(); });
  entry.el = overlay;
  entry.close = close;
  stack.push(entry);
  document.body.append(overlay);
  return { close, box };
}

document.addEventListener('keydown', (e) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.onKey && top.onKey(e) === true) return;
  if (e.key === 'Escape' && top.cancelable) { top.close(); e.preventDefault(); }
});

// ---- toast
let toastEl = null;
let toastTimer = 0;
export function toast(text) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status' });
    document.body.append(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2400);
}

export function okButton() { return { label: t('ok'), primary: true }; }
