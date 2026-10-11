// Code pad: len slots and the keys of one input type (digits, letters, dirs, colors).
import { h, button } from './ui.js';
import { t } from './i18n.js';

const COLORS = { R: '#D64545', G: '#3FA34D', B: '#3D6FD6', Y: '#E6C229', W: '#F2F2F2', K: '#111111' };
const ARROWS = { N: '▲', E: '▶', S: '▼', W: '◀' };

const KEYS = {
  digits: [...'1234567890'],
  letters: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  dirs: [...'NESW'],
  colors: [...'RGBYWK'],
};
const DARK_TEXT = { W: true, Y: true };
const PER_ROW = { digits: 3, letters: 7, dirs: 4, colors: 3 };

/**
 * Returns {el, handleKey(e)}. onSubmit(code) is called when the slots are full or OK is pressed.
 * For colors the names of the colours are R G B Y W K; for dirs N E S W.
 */
export function codePad(type, len, onSubmit) {
  if (!KEYS[type]) type = 'digits';
  let typed = '';
  const slots = [];
  const slotRow = h('div', { class: 'cp-slots' });
  for (let i = 0; i < len; i++) {
    const s = h('div', { class: 'cp-slot' });
    slots.push(s);
    slotRow.append(s);
  }

  const refresh = () => {
    slots.forEach((s, i) => {
      const c = typed[i];
      s.textContent = '';
      s.style.background = '';
      if (c === undefined) return;
      if (type === 'colors') {
        // colour is never the only carrier: the name is written on it
        s.style.background = COLORS[c]; s.style.color = DARK_TEXT[c] ? '#111' : '#fff'; s.textContent = t('color_' + c);
      } else s.textContent = type === 'dirs' ? ARROWS[c] : c;
    });
  };

  const press = (c) => {
    if (typed.length >= len) return;
    typed += c;
    refresh();
    if (typed.length === len) onSubmit(typed);
  };

  const el = h('div', { class: 'codepad cp-' + type }, slotRow);
  const keys = KEYS[type];
  const per = PER_ROW[type];
  for (let i = 0; i < keys.length; i += per) {
    const row = h('div', { class: 'cp-row' });
    for (const c of keys.slice(i, i + per)) {
      const k = h('button', { type: 'button', class: 'cp-key', 'aria-label': type === 'dirs' ? ARROWS[c] : type === 'colors' ? t('color_' + c) : c, onclick: () => press(c) });
      if (type === 'colors') {
        k.style.background = COLORS[c]; k.style.color = DARK_TEXT[c] ? '#111' : '#fff'; k.textContent = t('color_' + c);
      } else k.textContent = type === 'dirs' ? ARROWS[c] : c;
      row.append(k);
    }
    el.append(row);
  }
  el.append(h('div', { class: 'cp-actions' },
    button('⌫', () => { if (typed) { typed = typed.slice(0, -1); refresh(); } }),
    button(t('ok'), () => { if (typed) onSubmit(typed); }),
  ));
  refresh();

  const dirKeys = { ArrowUp: 'N', ArrowRight: 'E', ArrowDown: 'S', ArrowLeft: 'W' };
  const handleKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Backspace') { if (typed) { typed = typed.slice(0, -1); refresh(); } return true; }
    if (e.key === 'Enter') { if (typed) onSubmit(typed); return true; }
    let c = e.key.length === 1 ? e.key.toUpperCase() : null;
    if (type === 'dirs' && dirKeys[e.key]) c = dirKeys[e.key];
    if (c && keys.includes(c)) { press(c); e.preventDefault(); return true; }
    return type === 'dirs' && !!dirKeys[e.key];
  };
  return { el, handleKey };
}
