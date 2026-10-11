// Escape Room (web): menu, panels and the room screen. The engine decides; this file mirrors it.
import { parseStory, Progress, Coins, Wallet, Difficulty, Saves } from './engine.js';
import { lang, t } from './i18n.js';
import { h, button, modal, modalOpen, closeAllModals, toast } from './ui.js';
import { Wall } from './wall.js';
import { codePad } from './codepad.js';

document.documentElement.lang = lang;
const app = document.getElementById('app');

const SIDES = ['north', 'east', 'south', 'west'];
const sideKey = (s) => (typeof s === 'string' ? s : (s && (s.key || String(s).toLowerCase())) || 'north');
const turnSide = (s, step) => SIDES[(SIDES.indexOf(sideKey(s)) + step + 4) % 4];

const stars = (n) => {
  const k = Math.max(0, Math.min(5, n | 0));
  return '★'.repeat(k) + '☆'.repeat(5 - k);
};

// ---- state
let stories = [];
let files = new Map(); // storyId -> Set of paths relative to stories/
let wallet = null;
let saves = null;
let screen = 'menu';
let progress = null;
let side = 'north';
let message = '';
let msgItem = null;
let names = {};
let ui = {}; // refs of the room screen

// ---- plates
const EXTS = ['webp', 'png', 'jpg'];
function plate(storyId, name) {
  const set = files.get(storyId);
  if (!set) return null;
  for (const ext of EXTS) {
    const p = `${storyId}/${name}.${ext}`;
    if (set.has(p)) return `./stories/${p}`;
  }
  return null;
}
const wallPlate = (p, name) => plate(p.story.id, `${p.room.id}/${name}`);
const itemPlate = (p, id) => plate(p.story.id, `items/${id}`);

// ---- boot
async function boot() {
  saves = typeof Saves === 'function' ? new Saves() : Saves; // contract: object with load/save/clear
  wallet = new Wallet();
  const before = wallet.balance();
  if (wallet.claimDaily() > before) toast(t('coins_daily'));
  try {
    const idx = await (await fetch('./stories/index.json')).json();
    for (const s of idx.stories) {
      try {
        const text = await (await fetch(`./stories/${s.id}/story.json`)).text();
        const story = parseStory(s.id, text);
        files.set(s.id, new Set(s.files));
        stories.push(story);
      } catch (e) {
        console.warn(`Escape Room: story '${s.id}' skipped: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(e);
  }
  if (helpSeen()) showMenu(true); else showHelp();
}

// ---- first-time help (own key, so clearing a save never brings it back)
function helpSeen() {
  try { return localStorage.getItem('escaperoom.help_seen') === '1'; } catch (e) { return true; }
}
function showHelp() {
  try { localStorage.setItem('escaperoom.help_seen', '1'); } catch (e) { /* ignore */ }
  showPanel(t('help_title'), t('help_body'), t('ok'), () => showMenu());
}

// A short buzz for a wrong try or a tap beside every zone (no animation); silent where unsupported.
function buzz(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
}

// ---- history: the browser back button returns to the menu
let pushed = false;
function pushScreen() {
  if (!pushed) { try { history.pushState({ s: 1 }, ''); pushed = true; } catch (e) { /* ignore */ } }
}
window.addEventListener('popstate', () => { pushed = false; if (screen !== 'menu') showMenu(true); });
function goMenu() {
  if (pushed) { history.back(); } else showMenu(true);
}

function setScreen(node, name) {
  screen = name;
  app.textContent = '';
  app.append(node);
  window.scrollTo(0, 0);
}

// ---- menu
function showMenu(fromHistory) {
  if (fromHistory) pushed = false;
  closeAllModals();
  progress = null; ui = {};
  const col = h('div', { class: 'menu' },
    h('div', { class: 'menu-head' },
      h('h1', { class: 'title' }, 'Escape Room'),
      (() => { const b = button('?', showHelp, true, 'small'); b.setAttribute('aria-label', t('help_title')); return b; })(),
    ),
    h('p', { class: 'sub' }, t('start_sub')),
    h('p', { class: 'coins-line' }, '● ' + wallet.balance()),
  );
  if (!stories.length) col.append(h('p', {}, t('load_failed')));
  for (const story of stories) col.append(storyCard(story));
  setScreen(h('div', { class: 'scroll' }, col), 'menu');
}

function storyCard(story) {
  const p = saves.load(story);
  const card = h('div', { class: 'card' },
    h('h2', {}, story.title),
    story.blurb ? h('p', { class: 'blurb' }, story.blurb) : null,
    h('p', { class: 'meta' }, t('stars_min', stars(story.difficulty), Difficulty.storyMinutes(story))),
    h('p', { class: 'meta small' }, p.finished ? t('finished_tag') : t('room_of', p.roomIndex + 1, story.rooms.length)),
  );
  const row = h('div', { class: 'row' }, button(p.started ? t('start_continue') : t('start_new'), () => play(story)));
  if (p.started) {
    row.append(button(t('restart'), () => {
      modal({
        message: t('restart_ask', story.title),
        buttons: [
          { label: t('cancel') },
          { label: t('ok'), primary: true, onClick: () => { saves.clear(story); showMenu(); } },
        ],
      });
    }, true));
  }
  card.append(row);
  return card;
}

// ---- text panel
function showPanel(title, body, buttonText, onDone) {
  const col = h('div', { class: 'panel' }, h('h1', { class: 'panel-title' }, title), h('div', { class: 'panel-body' }, body));
  setScreen(h('div', { class: 'panel-wrap' },
    h('div', { class: 'scroll grow' }, col),
    h('div', { class: 'panel-btn' }, button(buttonText, onDone)),
  ), 'panel');
}

function showOutro(story) {
  showPanel(t('finished_title'), story.outro, t('to_menu'), goMenu);
}

// ---- play
function play(story) {
  const p = saves.load(story);
  progress = p;
  side = sideKey(p.side);
  pushScreen();
  if (p.finished) showOutro(story);
  else if (!p.started) showPanel(story.title, story.intro, t('begin'), () => enterRoom(true));
  else enterRoom(false);
}

function enterRoom(announce) {
  const p = progress;
  if (!p) return;
  message = announce ? p.room.intro || '' : '';
  msgItem = null;
  showRoom();
}

function smallBtn(label, onClick, title) {
  const b = button(label, onClick, true, 'small');
  if (title) { b.title = title; b.setAttribute('aria-label', title); }
  return b;
}

function showRoom() {
  const p = progress;
  const room = p.room;
  const found = h('span', { class: 'found' });
  const coins = h('span', { class: 'coins' });
  const wall = new Wall();
  wall.onTurn = turn;
  wall.onThing = onThing;
  wall.onExit = onExit;
  wall.onMiss = () => buzz(10);

  const top = h('div', { class: 'room-top' },
    h('div', { class: 'room-head' },
      h('button', { type: 'button', class: 'back', onclick: goMenu, 'aria-label': t('to_menu_short'), title: t('to_menu_short') }, '‹'),
      h('h1', { class: 'room-title' }, room.title + '  ' + stars(room.difficulty)),
    ),
    h('div', { class: 'task' }, room.task),
    h('div', { class: 'bar' }, found, coins,
      smallBtn('◎', () => wall.flashZones(), t('zones')),
      smallBtn(t('hint_button'), showHints),
    ),
  );

  const stage = h('div', { class: 'stage' },
    h('div', { class: 'stage-inner' }, wall.el),
    h('button', { type: 'button', class: 'arrow left', onclick: () => turn(-1), 'aria-label': t('turn_left') }, '‹'),
    h('button', { type: 'button', class: 'arrow right', onclick: () => turn(1), 'aria-label': t('turn_right') }, '›'),
  );

  const msg = h('div', { class: 'msg', 'aria-live': 'polite' });
  const msgBox = h('div', { class: 'msgbox' }, msg);
  const sel = h('div', { class: 'sel' });
  const chips = h('div', { class: 'chips' });
  const bottom = h('div', { class: 'bottom' }, chips, button(t('notes'), showNotes, true, 'small'));

  ui = { wall, found, coins, msg, sel, chips };
  setScreen(h('div', { class: 'room' }, top, stage, msgBox, sel, bottom), 'room');
  refreshStatus();
}

function turn(step) {
  const p = progress;
  if (!p || screen !== 'room') return;
  side = turnSide(side, step);
  p.look(side);
  saves.save(p);
  refreshWall();
}

function refreshWall() {
  const p = progress;
  if (!p || !ui.wall) return;
  const room = p.room;
  const variant = p.variantImage(side);
  const base = wallPlate(p, side);
  const src = (variant ? wallPlate(p, variant) : null) || base;
  ui.wall.show({
    room, side, src,
    things: p.thingsOnSide(side),
    exitVisible: p.exitVisible(),
    wallName: t('wall_' + side),
    caption: (room.captions instanceof Map ? room.captions.get(side) : room.captions && room.captions[side]) || '',
  });
}

function refreshStatus() {
  const p = progress;
  if (!p || !ui.wall) return;
  refreshWall();
  ui.msg.textContent = '';
  if (message) {
    const img = msgItem ? itemPlate(p, msgItem.id) : null;
    if (img) ui.msg.append(h('img', { class: 'msg-item', src: img, alt: '' }));
    ui.msg.append(h('span', {}, message));
  }
  ui.found.textContent = t('found_progress', p.foundInRoom(), p.thingsInRoom());
  ui.coins.textContent = '● ' + wallet.balance();
  const sel = p.selected ? p.items.get(p.selected) : null;
  ui.sel.textContent = sel ? t('selected_item', sel.name) : (p.items.size === 0 ? t('items_none') : '');
  ui.chips.textContent = '';
  for (const item of p.items.values()) {
    const on = item.id === p.selected;
    const img = itemPlate(p, item.id);
    const chip = h('button', {
      type: 'button', class: 'chip' + (on ? ' on' : ''), title: item.name, 'aria-label': item.name,
      'aria-pressed': on ? 'true' : 'false', onclick: () => onItem(item.id),
    }, img ? h('img', { src: img, alt: item.name, draggable: 'false' }) : h('span', {}, item.name));
    ui.chips.append(chip);
  }
}

function gainedMessage(text, g) {
  msgItem = g;
  return text + '\n' + t('took', g.name);
}

function say(s) {
  if (!msgItem || !s.includes(t('took', msgItem.name))) msgItem = null;
  message = s;
  refreshStatus();
}

function onItem(id) {
  const p = progress;
  if (!p) return;
  const sel = p.selected;
  if (sel && sel !== id) {
    const o = p.combine(sel, id);
    if (o.kind === 'said') say(o.gained ? gainedMessage(o.text, o.gained) : o.text);
    else if (o.kind === 'wrong') { buzz(40); say(t('wrong_combine')); }
    else if (o.kind === 'blocked') say(o.text);
    refreshStatus();
    saves.save(p);
  } else {
    p.select(id);
    refreshStatus();
  }
}

const itemName = (p, id) => (p.items.get(id) && p.items.get(id).name) || names[id] || id;
const rememberNames = (p) => { names = {}; for (const it of p.items.values()) names[it.id] = it.name; };

function onThing(th) {
  const p = progress;
  if (!p || modalOpen()) return;
  rememberNames(p);
  outcome(p, th, p.tap(th));
  saves.save(p);
}

function outcome(p, th, o) {
  switch (o.kind) {
    case 'said': {
      const msg = o.gained ? gainedMessage(o.text, o.gained) : o.text;
      say(msg);
      if (th.closeup) showCloseup(p, th, msg);
      break;
    }
    case 'blocked': say(o.text); break;
    case 'wrong': buzz(40); say(t('wrong_use')); break;
    case 'applied': say(t('applied', itemName(p, o.item))); break;
    case 'needsCode':
      refreshStatus();
    {
      const ask = () => askCode(o.thing.input || 'digits', o.thing.len || (o.thing.code || '').length, (code) => {
        const r = p.tryCode(th, code);
        if (r.kind === 'wrong') { buzz(40); say(t('code_wrong')); return false; }
        outcome(p, th, r);
        saves.save(p);
        return true;
      });
      if (th.closeup) showCloseup(p, th, th.label || '', ask); else ask();
      break;
    }
    default: break;
  }
}

function onExit() {
  const p = progress;
  if (!p || modalOpen()) return;
  const e = p.room.exit;
  rememberNames(p);
  const appliedItem = p.selected;
  switch (p.tapExit()) {
    case 'ENTER_CODE':
      askCode(e.input || 'digits', e.len || (e.code || '').length, (code) => {
        const right = p.checkCode(code);
        if (right) leave(p); else { buzz(40); say(t('code_wrong')); }
        saves.save(p);
        return right;
      });
      break;
    case 'BLOCKED': say(e.stuck || ''); break;
    case 'WRONG': buzz(40); say(t('wrong_use')); break;
    case 'OPEN': leave(p); break;
    case 'PARTIAL': say(t('applied', appliedItem ? itemName(p, appliedItem) : '')); break;
    default: break;
  }
  saves.save(p);
}

function askCode(type, len, onCode) {
  let m = null;
  // onCode returns true for a right code: only then the pad closes
  const pad = codePad(type, len, (code) => {
    const ok = onCode(code);
    if (ok) m.close();
    return ok;
  });
  m = modal({
    title: t('code_title'), content: pad.el, className: 'code-modal',
    buttons: [{ label: t('cancel') }],
    onKey: (e) => pad.handleKey(e),
  });
}

function showCloseup(p, th, msg, enterCode) {
  const src = plate(p.story.id, `${p.room.id}/${th.closeup}`);
  const visual = src
    ? h('img', { class: 'closeup-img', src, alt: th.label || '' })
    : h('div', { class: 'closeup-label' }, th.label || '');
  modal({
    className: 'closeup',
    content: h('div', { class: 'closeup-col' }, visual, h('div', { class: 'closeup-text' }, msg)),
    buttons: enterCode
      ? [{ label: t('code_title'), primary: true, onClick: enterCode }, { label: t('close') }]
      : [{ label: t('close'), primary: true }],
  });
}

function leave(p) {
  const story = p.story;
  const paid = wallet.claimRoomReward(story.id, p.room.id, p.room.difficulty);
  const returned = p.leave() + (paid > 0 ? '\n\n' + t('coins_reward', paid) : '');
  saves.save(p);
  modal({
    message: returned, cancelable: false,
    buttons: [{
      label: t('ok'), primary: true,
      onClick: () => { if (p.finished) showOutro(story); else { side = 'north'; enterRoom(true); } },
    }],
  });
}

function showHints() {
  const p = progress;
  if (!p || modalOpen()) return;
  const shown = p.hintsShown();
  const list = shown.map((x, i) => `${i + 1}. ${x}`).join('\n\n');
  const available = p.hintAvailable();
  let msg;
  if (!shown.length && available) msg = t('hints_empty');
  else if (!shown.length) msg = t('hint_none');
  else if (available) msg = list;
  else msg = list + '\n\n' + t('hint_none');
  const buttons = [{ label: t('ok') }];
  if (available) {
    buttons.unshift({
      label: t('hint_next', Coins.HINT_COST), primary: true,
      onClick: () => {
        if (wallet.spend(Coins.HINT_COST)) {
          p.revealHint();
          saves.save(p);
          refreshStatus();
          setTimeout(showHints, 0);
        } else {
          say(t('hint_poor'));
        }
      },
    });
  }
  modal({ title: t('hint_button'), message: msg, buttons });
}

function showNotes() {
  const p = progress;
  if (!p || modalOpen()) return;
  const groups = p.allNotes();
  const col = h('div', { class: 'notes' });
  if (!groups.length) col.append(h('p', {}, t('notes_empty')));
  for (const [room, notes] of groups) {
    col.append(h('h3', {}, room.title));
    for (const n of notes) col.append(h('p', {}, n));
  }
  modal({ title: t('notes'), content: col, buttons: [{ label: t('ok'), primary: true }] });
}

// keyboard: arrows turn the wall
document.addEventListener('keydown', (e) => {
  if (screen !== 'room' || modalOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'ArrowLeft') { turn(-1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { turn(1); e.preventDefault(); }
});

boot();
