// Code pad: len slots and the keys of one input type (digits, letters, dirs, colors, sequence).
import { h, button, reducedMotion, shake } from './ui.js';
import { t } from './i18n.js';

const COLORS = { R: '#D64545', G: '#3FA34D', B: '#3D6FD6', Y: '#E6C229', W: '#F2F2F2', K: '#111111' };
const ARROWS = { N: '▲', E: '▶', S: '▼', W: '◀' };
const SYMBOLS = { S: '★', M: '☾', H: '♥', D: '◆', T: '▲', C: '●' };

const KEYS = {
  digits: [...'1234567890'],
  letters: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  dirs: [...'NESW'],
  colors: [...'RGBYWK'],
  sequence: [...'SMHDTC'],
};
const DARK_TEXT = { W: true, Y: true };
// the pad looks like the lock on the plate: arrows as a cross (spaces are empty cells), digits as a safe
const LAYOUT = { dirs: [' N ', 'W E', ' S '], digits: ['123', '456', '789'] };
// Android's KEYBOARD_TAP and CONFIRM; a wrong code buzzes in app.js. Silent where unsupported (Safari).
const vibrate = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } };
const TAP = 8;
const RIGHT = [20, 30, 20];
const PER_ROW = { digits: 3, letters: 7, dirs: 4, colors: 3, sequence: 3 };

/**
 * Returns {el, handleKey(e), press(c)}. With opts.showKeys false only the slots, backspace and OK are
 * drawn: the keys are on the close-up plate, which calls press. onSubmit(code) is called when the slots are full or OK is pressed. It returns false
 * for a wrong code (the slots turn red, the row shakes, then empty) or, for a right one, a function: the next step,
 * which runs after a short green flash of the slots (at once with reduced motion). `true` is a right code with no step.
 * For colors the names of the colours are R G B Y W K; for dirs N E S W.
 */
export function codePad(type, len, onSubmit, opts = {}) {
  const showKeys = opts.showKeys !== false;
  if (!KEYS[type]) type = 'digits';
  if (opts.wheels) return wheelPad(type, len, onSubmit);
  // what a token looks like on a key or in a slot
  const glyph = (c) => (type === 'dirs' ? ARROWS[c] : type === 'sequence' ? SYMBOLS[c] : c);
  let typed = '';
  let verdict = null; // 'right' | 'wrong' while the flash shows: keys do nothing then
  const slots = [];
  const slotRow = h('div', { class: 'cp-slots' });
  for (let i = 0; i < len; i++) {
    const s = h('div', { class: 'cp-slot' });
    slots.push(s);
    slotRow.append(s);
  }

  let refresh = () => {
    slots.forEach((s, i) => {
      const c = typed[i];
      s.textContent = '';
      s.style.background = '';
      if (c === undefined) return;
      if (type === 'colors') {
        // colour is never the only carrier: the name is written on it
        s.style.background = COLORS[c]; s.style.color = DARK_TEXT[c] ? '#111' : '#fff'; s.textContent = t('color_' + c);
      } else s.textContent = glyph(c);
    });
  };

  // A wrong code keeps the pad open: red and a shake, then empty slots for another try. A right one flashes green first.
  const submit = () => {
    if (verdict || !typed) return;
    const r = onSubmit(typed);
    const next = typeof r === 'function' ? r : () => {};
    if (r !== false) vibrate(RIGHT);
    if (reducedMotion()) {
      if (r === false) { typed = ''; refresh(); } else next();
      return;
    }
    verdict = r === false ? 'wrong' : 'right';
    slotRow.classList.add(verdict);
    if (r === false) {
      shake(slotRow);
      setTimeout(() => { verdict = null; slotRow.classList.remove('wrong'); typed = ''; refresh(); }, 360);
    } else {
      setTimeout(next, 280);
    }
  };
  const press = (c) => {
    if (verdict || typed.length >= len) return;
    typed += c;
    refresh();
    if (typed.length === len) submit();
  };

  const el = h('div', { class: 'codepad cp-' + type }, slotRow);
  const keys = KEYS[type];
  const per = PER_ROW[type];
  const mkKey = (c) => {
    const k = h('button', { type: 'button', class: 'cp-key', 'aria-label': type === 'colors' ? t('color_' + c) : glyph(c), onclick: () => { vibrate(TAP); press(c); } });
    if (type === 'colors') {
      k.style.background = COLORS[c]; k.style.color = DARK_TEXT[c] ? '#111' : '#fff'; k.textContent = t('color_' + c);
    } else k.textContent = glyph(c);
    return k;
  };
  const lines = LAYOUT[type] || [];
  for (let i = 0; showKeys && !LAYOUT[type] && i < keys.length; i += per) lines.push(keys.slice(i, i + per).join(''));
  for (const line of showKeys ? lines : []) {
    const row = h('div', { class: 'cp-row' });
    for (const c of line) row.append(c === ' ' ? h('div', { class: 'cp-gap' }) : mkKey(c));
    el.append(row);
  }
  // long press on backspace clears everything
  let pressTimer = null; let cleared = false;
  const back = button('⌫', () => {
    if (cleared) { cleared = false; return; }
    if (!verdict && typed) { typed = typed.slice(0, -1); refresh(); }
  });
  back.addEventListener('pointerdown', () => {
    cleared = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { if (verdict) return; cleared = true; typed = ''; refresh(); }, 500);
  });
  // the click after a long press may never come (Chrome drops it, or the finger slides off): don't swallow the next tap
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) back.addEventListener(ev, () => {
    clearTimeout(pressTimer);
    if (cleared) setTimeout(() => { cleared = false; }, 400);
  });
  back.addEventListener('click', () => vibrate(TAP));
  const ok = button(t('ok'), () => { vibrate(TAP); submit(); });
  // digits: ⌫ and OK left and right of the 0, the safe's bottom row; the other types keep them under the keys
  if (showKeys && type === 'digits') {
    back.classList.add('cp-key'); ok.classList.add('cp-key');
    el.append(h('div', { class: 'cp-row' }, back, mkKey('0'), ok));
  } else el.append(h('div', { class: 'cp-actions' }, back, ok));
  const refreshOk = () => { ok.disabled = !typed; };
  const baseRefresh = refresh;
  refresh = () => { baseRefresh(); refreshOk(); };
  refresh();

  const dirKeys = { ArrowUp: 'N', ArrowRight: 'E', ArrowDown: 'S', ArrowLeft: 'W' };
  const handleKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Backspace') { if (!verdict && typed) { typed = typed.slice(0, -1); refresh(); } return true; }
    if (e.key === 'Enter') { submit(); return true; }
    let c = e.key.length === 1 ? e.key.toUpperCase() : null;
    if (type === 'dirs' && dirKeys[e.key]) c = dirKeys[e.key];
    if (c && keys.includes(c)) { press(c); e.preventDefault(); return true; }
    return type === 'dirs' && !!dirKeys[e.key];
  };
  return { el, handleKey, press };
}

/**
 * The second look ("pad": "wheels", docs/besluiten/draaiwielen.md in the app repo): a row of combination wheels,
 * one per slot. A tap or ▲ turns one stop on, ▼ one back, a swipe up/down or the mouse wheel the same; OK checks.
 * Same contract as codePad (onSubmit, red/green flash, shake, vibrate); a wrong code keeps the wheels where they are.
 * Keyboard: ←/→ pick a wheel, ↑/↓ turn it, a token sets it and moves on, Enter checks.
 */
function wheelPad(type, len, onSubmit) {
  const stops = type === 'digits' ? [...'0123456789'] : KEYS[type];
  const glyph = (c) => (type === 'dirs' ? ARROWS[c] : type === 'sequence' ? SYMBOLS[c] : c);
  const pos = new Array(len).fill(0); // every wheel starts on its first stop
  let at = 0; // the wheel the keyboard turns
  let verdict = null;
  const discs = [];
  const row = h('div', { class: 'cp-slots cp-wheel-row' });
  const draw = (i) => {
    const d = discs[i]; const c = stops[pos[i]];
    d.style.background = ''; d.style.color = '';
    if (type === 'colors') { d.style.background = COLORS[c]; d.style.color = DARK_TEXT[c] ? '#111' : '#fff'; d.textContent = t('color_' + c); } else d.textContent = glyph(c);
    d.setAttribute('aria-valuetext', type === 'colors' ? t('color_' + c) : glyph(c));
    d.classList.toggle('cursor', i === at);
  };
  const drawAll = () => discs.forEach((_, i) => draw(i));
  const turn = (i, step) => {
    if (verdict) return;
    pos[i] = (pos[i] + step + stops.length) % stops.length;
    at = i;
    vibrate(TAP);
    drawAll();
    const d = discs[i];
    if (!reducedMotion()) { d.classList.remove('roll-up', 'roll-down'); void d.offsetWidth; d.classList.add(step > 0 ? 'roll-up' : 'roll-down'); }
  };
  for (let i = 0; i < len; i++) {
    const disc = h('div', { class: 'cp-slot cp-disc', role: 'spinbutton', tabindex: '0', 'aria-label': t('wheel_up') });
    let downY = null; let swiped = false;
    disc.addEventListener('pointerdown', (e) => { downY = e.clientY; swiped = false; disc.setPointerCapture?.(e.pointerId); });
    disc.addEventListener('pointermove', (e) => {
      if (downY === null) return;
      const dy = e.clientY - downY;
      if (Math.abs(dy) > 18) { turn(i, dy < 0 ? 1 : -1); downY = e.clientY; swiped = true; }
    });
    for (const ev of ['pointerup', 'pointercancel']) disc.addEventListener(ev, () => { downY = null; });
    disc.addEventListener('click', () => { if (swiped) { swiped = false; return; } turn(i, 1); }); // a tap turns one on (Rusty Lake)
    disc.addEventListener('wheel', (e) => { e.preventDefault(); turn(i, e.deltaY < 0 ? 1 : -1); }, { passive: false });
    // stopped here: the row's shake listens for its own animationend
    disc.addEventListener('animationend', (e) => { e.stopPropagation(); disc.classList.remove('roll-up', 'roll-down'); });
    discs.push(disc);
    row.append(h('div', { class: 'cp-wheel' },
      h('button', { type: 'button', class: 'cp-turn', 'aria-label': t('wheel_up'), onclick: () => turn(i, 1) }, '▲'),
      disc,
      h('button', { type: 'button', class: 'cp-turn', 'aria-label': t('wheel_down'), onclick: () => turn(i, -1) }, '▼')));
  }
  const code = () => pos.map((p) => stops[p]).join('');
  const submit = () => {
    if (verdict) return;
    const r = onSubmit(code());
    const next = typeof r === 'function' ? r : () => {};
    if (r !== false) vibrate(RIGHT);
    if (reducedMotion()) { if (r !== false) next(); return; }
    verdict = r === false ? 'wrong' : 'right';
    row.classList.add(verdict);
    if (r === false) {
      shake(row);
      setTimeout(() => { verdict = null; row.classList.remove('wrong'); }, 360);
    } else setTimeout(next, 280);
  };
  const ok = button(t('ok'), () => { vibrate(TAP); submit(); }, false, 'cp-wheel-ok');
  const el = h('div', { class: 'codepad cp-wheels cp-' + type }, row, h('div', { class: 'cp-actions' }, ok));
  drawAll();
  /** A token from outside (the keyboard): set the current wheel to it and move on. */
  const press = (c) => {
    const p = stops.indexOf(c);
    if (verdict || p < 0) return;
    pos[at] = p; at = Math.min(at + 1, len - 1); vibrate(TAP); drawAll();
  };
  const dirKeys = { ArrowUp: 1, ArrowDown: -1 };
  const handleKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Enter') { submit(); return true; }
    if (dirKeys[e.key]) { turn(at, dirKeys[e.key]); e.preventDefault(); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { at = Math.max(0, Math.min(len - 1, at + (e.key === 'ArrowLeft' ? -1 : 1))); drawAll(); e.preventDefault(); return true; }
    const c = e.key.length === 1 ? e.key.toUpperCase() : null;
    if (c && stops.includes(c)) { press(c); return true; }
    return false;
  };
  return { el, handleKey, press };
}

/**
 * A fill-in conclusion (../escaperoom/docs/besluiten/invul-conclusie.md): the sentence of ask with its gaps, a word bank
 * under it and a check button. Tap a word: it fills the first empty gap and leaves the bank; tap a filled gap: the word
 * goes back. Same contract as codePad: onSubmit(words) returns false for a wrong answer (the sentence turns red, shakes,
 * the gaps empty) or the next step, which runs after a short green flash. Returns {el, handleKey}. Mirrors AskView.kt.
 */
export function askPanel(ask, onSubmit) {
  const pieces = ask.text.split('___');
  const filled = new Array(pieces.length - 1).fill(null);
  let verdict = null; // 'right' | 'wrong' while the flash shows: taps do nothing then
  const sentence = h('p', { class: 'ask-text' });
  const bank = h('div', { class: 'ask-bank' });
  const words = new Map();
  const check = button(t('ask_check'), () => submit(), false, 'ask-check');
  for (const w of ask.words) {
    const b = button(w, () => { vibrate(TAP); put(w); }, true, 'ask-word');
    words.set(w, b);
    bank.append(b);
  }
  const put = (w) => {
    if (verdict || filled.includes(w)) return;
    const i = filled.indexOf(null);
    if (i < 0) return;
    filled[i] = w;
    refresh();
  };
  const clear = (i) => {
    if (verdict || filled[i] === null) return;
    vibrate(TAP);
    filled[i] = null;
    refresh();
  };
  const refresh = () => {
    sentence.textContent = '';
    pieces.forEach((p, i) => {
      sentence.append(p);
      if (i === pieces.length - 1) return;
      const w = filled[i];
      sentence.append(h('button', {
        type: 'button', class: 'ask-gap' + (w === null ? ' empty' : ''), 'aria-label': w ?? t('ask_gap'),
        onclick: () => clear(i),
      }, w ?? ' '));
    });
    sentence.classList.toggle('right', verdict === 'right');
    sentence.classList.toggle('wrong', verdict === 'wrong');
    for (const [w, b] of words) b.disabled = filled.includes(w) || !!verdict;
    check.disabled = filled.includes(null) || !!verdict;
  };
  const submit = () => {
    if (verdict || filled.includes(null)) return;
    const r = onSubmit([...filled]);
    const next = typeof r === 'function' ? r : () => {};
    if (r !== false) vibrate(RIGHT); // a wrong one buzzes REJECT in app.js
    if (reducedMotion()) {
      if (r === false) { filled.fill(null); refresh(); } else next();
      return;
    }
    verdict = r === false ? 'wrong' : 'right';
    refresh();
    if (r === false) {
      shake(sentence);
      setTimeout(() => { verdict = null; filled.fill(null); refresh(); }, 560);
    } else {
      setTimeout(next, 500);
    }
  };
  const handleKey = (e) => {
    if (e.key === 'Enter') { submit(); return true; }
    if (e.key === 'Backspace') { const i = filled.findLastIndex((w) => w !== null); if (i >= 0) clear(i); return true; }
    return false;
  };
  refresh();
  const el = h('div', { class: 'ask' }, sentence, h('p', { class: 'ask-how' }, t('ask_how')), bank, check);
  return { el, handleKey };
}
