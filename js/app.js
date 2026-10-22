// Escape Room (web): menu, panels and the room screen. The engine decides; this file mirrors it.
import { parseStory, Progress, Coins, Wallet, Difficulty, Saves, PALETTE_DEFAULT } from './engine.js';
import { lang, t } from './i18n.js';
import { h, button, modal, modalOpen, closeAllModals, toast, shake, reducedMotion } from './ui.js';
import { Wall, FLASH_MS } from './wall.js';
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
let chipIds = new Set(); // item ids the bar already shows, so only a tile that just arrived pops in
let chipKey = null; // what the bar was last built from (ids + selection): an unchanged refresh keeps the tiles and their animations
let tiles = new Map(); // item id -> its tile in the bar
let flyFrom = null; // client rect of the thing just tapped, so an item it gives flies from there to the bar
let held = null; // the item selected just before a tap, so a wrong use shakes its tile

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

/** The other walls (and variants) of the room, decoded ahead so the turn slide does not wait. Only this room's. */
let decoded = new Map();
function prefetchRoom(p) {
  decoded = new Map(); // the previous room's images go to the GC
  const names = [1, -1, 2].map((k) => turnSide(side, k)); // neighbours first
  for (const v of p.room.variants || []) if (v && v.image) names.push(v.image);
  for (const name of names) {
    const src = wallPlate(p, name);
    if (!src || decoded.has(src)) continue;
    const im = new Image();
    im.src = src;
    if (im.decode) im.decode().catch(() => {});
    decoded.set(src, im);
  }
}

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
  showMenu(true); // no help panel first: the first room teaches by doing (eerste-twee-minuten.md); help stays behind ?
}

// ---- help, behind the ? on the menu (no longer shown first: eerste-twee-minuten.md)
function showHelp() {
  try { localStorage.setItem('escaperoom.help_seen', '1'); } catch (e) { /* ignore */ }
  showPanel(t('help_title'), t('help_body'), t('ok'), () => showMenu(), { label: t('copy_stats'), onClick: copyStats });
}

// Play time and wrong tries per room of every started story, as JSON on the clipboard (scripts/calibratie.py in the Android repo).
async function copyStats() {
  const json = Progress.exportJson(stories.map((s) => saves.load(s)).filter((p) => p.started));
  try {
    await navigator.clipboard.writeText(json);
    toast(t('stats_copied'));
  } catch (e) {
    const ta = h('textarea', { class: 'stats-box', readonly: 'readonly', rows: '6' });
    ta.value = json;
    modal({ title: t('copy_stats'), content: ta, buttons: [{ label: t('ok'), primary: true }] });
    ta.select();
  }
}

// A tab in the background is not play time (the save is written here: the last action may be long ago).
document.addEventListener('visibilitychange', () => {
  if (screen !== 'room' || !progress) return;
  if (document.hidden) { progress.pause(); saves.save(progress); } else progress.resume();
});

// A short buzz for a wrong try or a tap beside every zone (no animation); silent where unsupported.
// A wrong try (40) plays a double "nope" like Android's REJECT; the key and right-code patterns live in codepad.js.
function buzz(ms) {
  const p = ms === 40 ? [30, 50, 60] : ms;
  try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ }
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
  // Play time runs only while the room screen is up; leaving it saves what was counted.
  if (screen === 'room' && name !== 'room' && progress) { progress.pause(); saves.save(progress); }
  if (name === 'room' && progress) progress.resume();
  screen = name;
  app.textContent = '';
  app.append(node);
  window.scrollTo(0, 0);
}

// ---- "Groot" (docs/besluiten/groot.md in the app repo): one switch per device, class `big` on <html>
function isBig() { try { return localStorage.getItem('escaperoom_big') === '1'; } catch (e) { return false; } }
function applyBig() { document.documentElement.classList.toggle('big', isBig()); }
applyBig();

/** "Aa" in the menu head, filled while on. */
function bigToggle() {
  const on = isBig();
  const b = button('Aa', () => {
    try { localStorage.setItem('escaperoom_big', on ? '0' : '1'); } catch (e) { /* ignore */ }
    applyBig();
    toast(t(on ? 'big_off' : 'big_on'));
    showMenu();
  }, !on, 'small');
  b.setAttribute('aria-label', t('big_text'));
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  return b;
}

// ---- menu
function showMenu(fromHistory) {
  if (fromHistory) pushed = false;
  closeAllModals();
  applyPalette(null);
  progress = null; ui = {};
  const col = h('div', { class: 'menu' },
    h('div', { class: 'menu-head' },
      h('h1', { class: 'title' }, 'Escape Room'),
      bigToggle(),
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
    cardHead(story),
    story.blurb ? h('p', { class: 'blurb' }, story.blurb) : null,
    h('p', { class: 'meta' }, t('stars_min', stars(story.difficulty), Difficulty.storyMinutes(story))),
    h('p', { class: 'meta small' }, p.finished ? finishedTag(p.hintsUsed()) : t('room_of', p.roomIndex + 1, story.rooms.length)),
    showcase(story, p),
    p.finished ? tourRow(story) : null,
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
  setPaletteVars(card, story.palette || PALETTE_DEFAULT); // the card in its story's colours; the menu stays default
  return card;
}

/** The card's plate: the first room's north wall, cropped 16:9, fading into the card colour, the title on it; a plain title without one. */
function cardHead(story) {
  const src = story.rooms.length ? plate(story.id, `${story.rooms[0].id}/north`) : null;
  if (!src) return h('h2', {}, story.title);
  return h('div', { class: 'card-cover' }, h('img', { src, alt: '', loading: 'lazy' }), h('h2', {}, story.title));
}

/** The showcase: 32 px tiles of every item plate this run has held, used-up ones too; only what was reached, no empty slots. */
function showcase(story, p) {
  if (!p.started) return null;
  const tiles = p.itemsEverHeld()
    .map((it) => ({ it, src: plate(story.id, `items/${it.id}`) }))
    .filter((x) => x.src)
    .map(({ it, src }) => h('img', { src, alt: it.name, title: it.name, loading: 'lazy' }));
  return tiles.length ? h('div', { class: 'showcase' }, ...tiles) : null;
}

// ---- looking round after the end (../escaperoom/docs/besluiten/rondkijken-na-afloop.md)

/** "Look round again" with one button per room, on the card of a finished story. */
function tourRow(story) {
  if (!story.rooms.length) return null;
  return h('div', { class: 'tour' },
    h('p', { class: 'meta small tour-title' }, t('tour_title')),
    h('div', { class: 'tour-rooms' }, ...story.rooms.map((r, i) => button(r.title, () => startTour(story, i), true, 'small'))));
}

/** Walk round room `index` with everything open: a fresh Progress.tour, never saved (Saves.save skips it), nothing measured. */
function startTour(story, index) {
  progress = Progress.tour(story, index);
  side = 'north';
  pushScreen();
  enterRoom(true);
}

/** Through a door on a tour: the next room, or after the last one its exit text and back to the menu. No coins. */
function leaveTour(p) {
  const last = p.roomIndex === p.story.rooms.length - 1;
  const text = p.leave();
  if (last) showPanel(t('tour_end'), text, t('to_menu'), goMenu);
  else { side = 'north'; enterRoom(true); }
}

// ---- text panel
const finishedTag = (n) => (n === 1 ? t('finished_hints_tag_one') : t('finished_hints_tag', n));

function showPanel(title, body, buttonText, onDone, extra, image) {
  const col = h('div', { class: 'panel' }, h('h1', { class: 'panel-title' }, title),
    image ? h('img', { class: 'panel-img', src: image, alt: '' }) : null,
    h('div', { class: 'panel-body' }, body));
  setScreen(h('div', { class: 'panel-wrap' },
    h('div', { class: 'scroll grow' }, col),
    h('div', { class: 'panel-btn' }, ...(extra ? [button(extra.label, extra.onClick, true)] : []), button(buttonText, onDone)),
  ), 'panel');
}

/** The end of a story: its optional plate (stories/<id>/outro.webp), its last words, then the next unfinished story or the menu. */
function showOutro(story) {
  const next = nextUnfinished(story);
  showPanel(t('finished_title'), story.outro, t(next ? 'next_story' : 'to_menu'),
    next ? () => play(next) : goMenu, { label: t('copy_stats'), onClick: copyStats }, plate(story.id, 'outro')); // the player hands the phone back here
}

/** The first story after `story` (wrapping round) that is not finished yet; null when all are. */
function nextUnfinished(story) {
  const i = stories.indexOf(story);
  for (let k = 1; k < stories.length; k++) {
    const s = stories[(i + k) % stories.length];
    if (!saves.load(s).finished) return s;
  }
  return null;
}

// ---- play
function play(story) {
  applyPalette(story.palette);
  const p = saves.load(story);
  progress = p;
  side = sideKey(p.side);
  pushScreen();
  if (p.finished) showOutro(story);
  else if (!p.started) showPanel(story.title, story.intro, t('begin'), () => enterRoom(true));
  else enterRoom(false);
}

/** Walls whose look line showed by itself this visit to the room screen; a miss shows it again any time. */
const looked = new Set();
const captionOf = (room, s) => (room.captions instanceof Map ? room.captions.get(s) : room.captions && room.captions[s]) || '';

/** Arriving at a wall: its caption as a look line, once per wall per visit. */
function lookFirst() {
  const p = progress;
  if (!p || !ui.wall || looked.has(side)) return;
  looked.add(side);
  ui.wall.look(captionOf(p.room, side));
}

function enterRoom(announce) {
  const p = progress;
  if (!p) return;
  message = announce ? p.room.intro || '' : '';
  if (announce && p.items.size > 0) message += '\n\n' + carryingLine(p);
  msgItem = null;
  showRoom();
  if (announce) fadeInRoom();
  if (announce) nudgeFirstRoom();
}

/** True while the very first room ever shows its "swipe, tap what lights up" line, until the first turn. */
let nudging = false;

/** The very first room ever (key escaperoom.nudged): one line under the intro until the first turn, and the ◎ flash by itself after 1,5 s. */
function nudgeFirstRoom() {
  try { if (localStorage.getItem('escaperoom.nudged') === '1') return; } catch (e) { return; }
  const p = progress;
  if (!p) return;
  nudging = true;
  message = [message, t('nudge_look')].filter((s) => s).join('\n\n');
  refreshStatus();
  const w = ui.wall;
  setTimeout(() => { if (w && ui.wall === w && screen === 'room') w.flashSpots(p.found); }, 1500);
}

/** The first turn ends the nudge for good: the line leaves the message strip. */
function endNudge() {
  if (!nudging) return;
  nudging = false;
  try { localStorage.setItem('escaperoom.nudged', '1'); } catch (e) { /* ignore */ }
  const line = t('nudge_look');
  if (message.endsWith(line)) { message = message.slice(0, -line.length).trimEnd(); refreshStatus(); }
}

/** A new room (after the intro or a door) comes up out of the dark in 300 ms; resuming mid-room stays a cut. Reduced motion: CSS drops it. */
function fadeInRoom() {
  const stage = ui.wall && ui.wall.el.closest('.stage');
  if (stage) stage.classList.add('room-in');
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
  const hint = smallBtn(t('hint_button'), showHints);
  hint.classList.add('hint');
  const coins = h('span', { class: 'coins' });
  const wall = new Wall();
  wall.onTurn = turn;
  wall.onThing = onThing;
  wall.onExit = onExit;
  wall.onMiss = onMiss;

  const top = h('div', { class: 'room-top' },
    h('div', { class: 'room-head' },
      h('button', { type: 'button', class: 'back', onclick: goMenu, 'aria-label': t('to_menu_short'), title: t('to_menu_short') }, '‹'),
      h('h1', { class: 'room-title' }, room.title + '  ' + stars(room.difficulty)),
    ),
    h('div', { class: 'task', onclick: () => say(room.task), title: room.task }, room.task), // one line; a tap shows it whole
    h('div', { class: 'bar' }, found, coins,
      smallBtn(t('spots_button'), spots, t('zones')),
      hint,
      smallBtn(t('notes'), showNotes),
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
  const chips = h('div', { class: 'chips', onscroll: () => chipEdges(chips) });
  const bottom = h('div', { class: 'bottom' }, chips);

  if (p.touring) { // looking round: no hints, no coins, and a line that says so
    hint.style.display = 'none'; coins.style.display = 'none';
    top.append(h('div', { class: 'tour-tag' }, t('tour_tag')));
  }
  ui = { wall, found, coins, msg, sel, chips, hint };
  hintWasFree = p.hintFreeByWaiting(); // only a change seen live is announced
  setScreen(h('div', { class: 'room' }, top, stage, msgBox, sel, bottom), 'room');
  chipIds = new Set(p.items.keys()); // a rebuilt bar does not pop
  chipKey = null;
  refreshStatus();
  prefetchRoom(p);
  looked.clear();
  lookFirst();
}

function turn(step) {
  const p = progress;
  if (!p || screen !== 'room') return;
  side = turnSide(side, step);
  p.look(side);
  saves.save(p);
  refreshWall();
  lookFirst();
  endNudge();
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
    caption: captionOf(room, side),
  });
}

function refreshStatus() {
  const p = progress;
  if (!p || !ui.wall) return;
  refreshWall();
  ui.msg.textContent = '';
  ui.msg.parentElement.hidden = !message; // the note card is only there when it says something
  if (message) {
    const img = msgItem ? itemPlate(p, msgItem.id) : null;
    if (img) ui.msg.append(h('img', { class: 'msg-item', src: img, alt: '' }));
    ui.msg.append(h('span', {}, message));
  }
  ui.found.textContent = t('found_progress', p.foundInRoom(), p.thingsInRoom());
  ui.coins.textContent = '● ' + wallet.balance();
  const sel = p.selected ? p.items.get(p.selected) : null;
  ui.sel.textContent = sel ? t('selected_item', sel.name) : '';
  sentenceLine(p, sel);
  ui.sel.hidden = !ui.sel.textContent; // empty chrome goes (13-ui-chrome voorstel 3)
  const key = [...p.items.keys()].join(',') + '|' + p.selected;
  if (key === chipKey) return;
  chipKey = key;
  ui.chips.textContent = '';
  tiles = new Map();
  for (const item of p.items.values()) {
    const on = item.id === p.selected;
    const img = itemPlate(p, item.id);
    const chip = h('button', {
      type: 'button', class: 'chip' + (on ? ' on' : ''), title: item.name, 'aria-label': item.name,
      'aria-pressed': on ? 'true' : 'false', onclick: () => onItem(item.id),
    }, img ? h('img', { src: img, alt: item.name, draggable: 'false' }) : h('span', {}, item.name));
    longPress(chip, () => showItem(p, item));
    if (!chipIds.has(item.id)) {
      // css pops it in (0 -> 1.15 -> 1) and rings it, unless prefers-reduced-motion; first it flies in from the thing
      if (img && flyFrom && !reducedMotion()) { chip.style.setProperty('--pop-delay', (FLY_MS - 80) + 'ms'); fly(img, flyFrom, chip); }
      chip.classList.add('new');
    }
    tiles.set(item.id, chip);
    ui.chips.append(chip);
  }
  chipIds = new Set(p.items.keys());
  chipEdges(ui.chips);
}

const FLY_MS = 450;

/** The item's plate travels from rect `from` (client px) to `chip` in an arc, then is removed. */
function fly(src, from, chip) {
  requestAnimationFrame(() => {
    const to = chip.getBoundingClientRect();
    if (!to.width || !document.body.animate) return;
    const s0 = 72;
    const x0 = from.x + from.w / 2 - s0 / 2; const y0 = from.y + from.h / 2 - s0 / 2;
    const k = to.width / s0;
    const x1 = to.left + to.width / 2 - s0 / 2; const y1 = to.top + to.height / 2 - s0 / 2;
    const el = h('img', { class: 'fly', src, alt: '', style: { width: s0 + 'px', height: s0 + 'px' } });
    document.body.append(el);
    const at = (f, s, o) => ({ transform: `translate(${x0 + (x1 - x0) * f}px, ${y0 + (y1 - y0) * f - 48 * Math.sin(Math.PI * f)}px) scale(${s})`, opacity: o });
    const a = el.animate([at(0, 1, 1), at(0.5, (1 + k) / 2, 1), at(0.85, 0.15 + 0.85 * k, 1), at(1, k, 0)],
      { duration: FLY_MS, easing: 'ease-in-out' });
    a.onfinish = () => el.remove();
    setTimeout(() => el.remove(), FLY_MS + 200); // in case onfinish never fires (hidden tab)
  });
}

/**
 * A hidden coin was found (thing.coin): pay it once ever via the wallet, a gold coin flies from the spot to the counter,
 * which pops; a coin paid in an earlier run says so and pays nothing (munten-verstopt.md).
 */
function foundCoin(p, th, text) {
  const paid = wallet.claimCoin(p.story.id, th.id);
  const from = flyFrom;
  say(text + '\n' + t(paid > 0 ? 'coin_found' : 'coin_found_before'));
  const to = ui.coins;
  if (!to || paid === 0) return;
  buzz(20);
  const pop = () => { to.classList.remove('coin-pop'); void to.offsetWidth; to.classList.add('coin-pop'); };
  if (!from || reducedMotion() || !document.body.animate) { pop(); return; }
  requestAnimationFrame(() => {
    const r = to.getBoundingClientRect();
    const s0 = 56; const s1 = 20;
    const x0 = from.x + from.w / 2 - s0 / 2; const y0 = from.y + from.h / 2 - s0 / 2;
    const x1 = r.left + r.width / 2 - s0 / 2; const y1 = r.top + r.height / 2 - s0 / 2;
    const el = h('div', { class: 'coin-fly', style: { width: s0 + 'px', height: s0 + 'px' } });
    document.body.append(el);
    const at = (f) => ({ transform: `translate(${x0 + (x1 - x0) * f}px, ${y0 + (y1 - y0) * f - 64 * Math.sin(Math.PI * f)}px) scale(${(s0 + (s1 - s0) * f) / s0})` });
    const a = el.animate([at(0), at(0.25), at(0.5), at(0.75), at(1)], { duration: FLY_MS + 150, easing: 'ease-in-out' });
    const done = () => { if (el.isConnected) { el.remove(); pop(); } };
    a.onfinish = done;
    setTimeout(done, FLY_MS + 350); // in case onfinish never fires (hidden tab)
  });
}

/** A wrong item: "That does not fit." plus what the thing wants (its stuck text), else the plain line. */
function wrongItem(stuck) {
  return stuck ? t('wrong_item', stuck) : t('wrong_use');
}

/** Long-press (or right-click) on a tile: the item's plate large, with its name. Looking only; the selection stays. */
function showItem(p, item) {
  const img = itemPlate(p, item.id);
  modal({
    title: item.name,
    content: img ? h('img', { class: 'item-view', src: img, alt: item.name, draggable: 'false' }) : null,
    buttons: [{ label: t('close'), primary: true }],
  });
}

/** Calls onLong after a 500 ms hold on `chip` (the click that ends the hold is swallowed), or on right-click. */
function longPress(chip, onLong) {
  let timer = null; let fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  chip.addEventListener('pointerdown', () => { fired = false; cancel(); timer = setTimeout(() => { fired = true; timer = null; onLong(); }, 500); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) chip.addEventListener(ev, cancel);
  chip.addEventListener('click', (e) => { if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  chip.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) { cancel(); onLong(); } });
}

/** Shake the tiles of these item ids, after the refreshes of this tap have settled. */
function shakeTile(...ids) {
  setTimeout(() => { for (const id of ids) if (id && tiles.get(id)) shake(tiles.get(id)); }, 0);
}

/** Fades the bar's edge on the side where more tiles are scrolled out of view. */
function chipEdges(el) {
  el.classList.toggle('more-l', el.scrollLeft > 1);
  el.classList.toggle('more-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
}

function gainedMessage(text, g) {
  msgItem = g;
  return text + '\n' + t('took', g.name);
}

// ---- the Hint button: counts down to a free layer, fills up while it does, pulses once it is free
let hintWasFree = false;
const clockText = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function refreshHint() {
  const b = ui.hint, p = progress;
  if (!b || !p || screen !== 'room') return;
  const left = p.hintFreeInMs();
  const free = p.hintFreeByWaiting();
  const layer = `${p.hintsRevealed() + 1}/${p.hintsTotal()}`; // which layer is next
  b.textContent = !p.hintAvailable() ? t('hint_button')
    : free ? t('hint_button_free', layer)
    : left > 0 ? t('hint_button_wait', clockText(left), layer)
    : p.nextHintCost() === 0 ? t('hint_button_free', layer) // free by price: label only, no fill
    : t('hint_button_layer', layer);
  const wait = Coins.hintWaitMs(p.room.difficulty);
  b.style.setProperty('--fill', (free ? 100 : left > 0 ? Math.round((wait - left) * 100 / wait) : 0) + '%');
  b.classList.toggle('free', free);
  if (free && !hintWasFree) say(t('hint_now_free'));
  hintWasFree = free;
}
setInterval(refreshHint, 1000);

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
    useLine(itemName(p, sel), itemName(p, id), 'use_with');
    const o = p.combine(sel, id);
    if (o.kind === 'said') say(o.gained ? gainedMessage(o.text, o.gained) : o.text);
    else if (o.kind === 'wrong') { buzz(40); say(t('wrong_combine')); shakeTile(sel, id); }
    else if (o.kind === 'blocked') say(o.text);
    refreshStatus();
    saves.save(p);
  } else {
    if (p.items.size >= 2) { try { localStorage.setItem(TIP_COMBINE, '1'); } catch (e) { /* ignore */ } } // the tip did its job
    p.select(id);
    refreshStatus();
  }
}

// ---- the sentence line (SCUMM): "Use key on …", for a second "Use key on Cupboard" (docs/besluiten/zinregel.md in the app repo)

const SENTENCE_MS = 1000;
const TIP_COMBINE = 'escaperoom.tip_combine';
/** The full sentence of the last use, [text, bold parts]; null = the normal line. */
let sentence = null;
let sentenceTimer = 0;

/** "Use item on target" (or `verb`) in the line for a second, before the outcome's refresh shows it. */
function useLine(item, target, verb = 'use_on') {
  sentence = [t(verb, item, target), item, target];
  clearTimeout(sentenceTimer);
  sentenceTimer = setTimeout(() => { sentence = null; refreshStatus(); }, SENTENCE_MS);
}

/** Over the plain line: the held item in bold, the running sentence, or once the combine tip (two items, none held). */
function sentenceLine(p, sel) {
  const el = ui.sel;
  if (!el) return;
  let tipSeen = true;
  try { tipSeen = localStorage.getItem(TIP_COMBINE) === '1'; } catch (e) { /* ignore */ }
  if (sentence) boldIn(el, ...sentence);
  else if (sel) boldIn(el, t('selected_item', sel.name), sel.name);
  else if (p.items.size >= 2 && !tipSeen) el.textContent = t('combine_tip');
}

/** `s` into `el` with each of `parts` (in order) in <b>. */
function boldIn(el, s, ...parts) {
  el.textContent = '';
  let from = 0;
  for (const part of parts) {
    const i = part ? s.indexOf(part, from) : -1;
    if (i < 0) continue;
    if (i > from) el.append(s.slice(from, i));
    el.append(h('b', {}, part));
    from = i + part.length;
  }
  el.append(s.slice(from));
}

/** "You still have with you: UV lamp, stair key." under a new room's intro. */
const carryingLine = (p) => t('carrying', [...p.items.values()].map((it) => it.name).join(', '));

const itemName = (p, id) => (p.items.get(id) && p.items.get(id).name) || names[id] || id;
const rememberNames = (p) => { names = {}; for (const it of p.items.values()) names[it.id] = it.name; };

/** A tap beside every zone is not silent: the wall's caption comes back as the look line (none written: the ring alone). */
function onMiss() {
  buzz(10);
  if (dryMiss()) return;
  const room = progress && progress.room;
  if (room && ui.wall) ui.wall.look(captionOf(room, side));
}

/** Which dry line the next third miss says; rotates, so the joke does not repeat at once. */
let dryIndex = 0;

/** The third miss on one wall in one visit says a dry line instead of the caption, once. Not a fault. */
function dryMiss() {
  const w = ui.wall;
  if (!w || w.missesHere !== 3) return false;
  const s = t('miss_dry_' + (1 + (dryIndex++ % 3)));
  if (w.src) w.look(s); else say(s);
  return true;
}

/** The ◎: opened things thin, the rest bold; when this wall holds nothing more, say so after the flash. */
function spots() {
  const p = progress;
  const w = ui.wall;
  if (!p || !w) return;
  w.flashSpots(p.found);
  if (!p.foundOnSide(side)) return;
  const here = side;
  setTimeout(() => { if (ui.wall === w && side === here) say(t('spots_all_seen')); }, FLASH_MS);
}

function onThing(th) {
  const p = progress;
  if (!p || modalOpen()) return;
  rememberNames(p);
  held = p.selected;
  if (held && th.needs && th.needs.length > 0 && !p.found.has(th.id)) useLine(itemName(p, held), th.label || '');
  const wr = ui.wall && ui.wall.el.getBoundingClientRect();
  const z = th.zone;
  flyFrom = wr && wr.width > 0 && z ? { x: wr.left + z.x * wr.width, y: wr.top + z.y * wr.height, w: z.w * wr.width, h: z.h * wr.height } : null;
  try { outcome(p, th, p.tap(th)); } finally { flyFrom = null; }
  saves.save(p);
}

function outcome(p, th, o) {
  switch (o.kind) {
    case 'said': {
      if (o.coin) { foundCoin(p, th, o.text); break; }
      const msg = o.gained ? gainedMessage(o.text, o.gained) : o.text;
      say(msg);
      if (th.closeup) showCloseup(p, th, msg);
      break;
    }
    case 'search': showSearch(p, o.thing); break;
    case 'blocked': say(o.text); break;
    case 'wrong': buzz(40); say(wrongItem(th.stuck)); shakeTile(held); break;
    case 'applied': say(t('applied', itemName(p, o.item))); break;
    case 'needsCode':
      refreshStatus();
    {
      const type = o.thing.input || 'digits';
      const len = o.thing.len || (o.thing.code || '').length;
      // false for a wrong code; a right one is saved at once, its outcome runs after the pad's green flash
      const onCode = (code) => {
        const r = p.tryCode(th, code);
        if (r.kind === 'wrong') { buzz(40); say(t('code_wrong')); return false; }
        saves.save(p);
        return () => { outcome(p, th, r); saves.save(p); };
      };
      if (th.closeup && th.keys && th.keys.length > 0) showKeyPlate(p, th, { type, len, onCode });
      else if (th.closeup) showCloseup(p, th, th.label || '', { type, len, onCode }); else askCode(type, len, onCode);
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
  if (appliedItem && e.needs && e.needs.length > 0) useLine(itemName(p, appliedItem), t('the_exit'));
  switch (p.tapExit()) {
    case 'ENTER_CODE':
      askCode(e.input || 'digits', e.len || (e.code || '').length, (code) => {
        const right = p.checkCode(code);
        saves.save(p);
        if (!right) { buzz(40); say(t('code_wrong')); return false; }
        return () => leave(p);
      });
      break;
    case 'BLOCKED': say(e.stuck || ''); break;
    case 'WRONG': buzz(40); say(wrongItem(e.stuck)); shakeTile(appliedItem); break;
    case 'OPEN': leave(p); break;
    case 'PARTIAL': say(t('applied', appliedItem ? itemName(p, appliedItem) : '')); break;
    default: break;
  }
  saves.save(p);
}

function askCode(type, len, onCode) {
  let m = null;
  // onCode returns false for a wrong code, else the next step: only then the pad closes (after its green flash)
  const pad = codePad(type, len, (code) => {
    const next = onCode(code);
    if (next === false) return false;
    return () => { m.close(); if (typeof next === 'function') next(); };
  });
  m = modal({
    title: t('code_title'), content: pad.el, className: 'code-modal',
    buttons: [{ label: t('cancel') }],
    onKey: (e) => pad.handleKey(e),
  });
}

/** code {type, len, onCode}: a button swaps the text for the code pad, under the plate (which shrinks). */
function showCloseup(p, th, msg, code) {
  const src = plate(p.story.id, `${p.room.id}/${th.closeup}`);
  let visual = src
    ? h('img', { class: 'closeup-img', src, alt: th.label || '' })
    : h('div', { class: 'closeup-label' }, th.label || '');
  // scale open from the zone of the thing that was tapped (and close back into it)
  const wr = ui.wall && ui.wall.el.getBoundingClientRect();
  const z = th.zone;
  const animateFrom = wr && wr.width > 0 && z
    ? { x: wr.left + z.x * wr.width, y: wr.top + z.y * wr.height, w: z.w * wr.width, h: z.h * wr.height }
    : undefined;
  const said = h('div', { class: 'closeup-text' }, msg);
  if (th.look && th.look.length > 0) visual = lookPlate(p, th, src, said, msg);
  let pad = null;
  let m = null;
  const enterCode = () => {
    pad = codePad(code.type, code.len, (typed) => {
      const next = code.onCode(typed);
      if (next === false) return false;
      // after the green flash a right code removes the close-up at once: the outcome may open the next one itself
      return () => { m.close(); m.box.parentElement?.remove(); if (typeof next === 'function') next(); };
    }, { wheels: th.pad === 'wheels' });
    said.replaceWith(pad.el);
    m.box.querySelector('.modal-buttons .btn')?.remove(); // the enter button itself
    return false;
  };
  m = modal({
    className: 'closeup',
    animateFrom,
    content: h('div', { class: 'closeup-col' }, visual, said),
    onKey: (e) => (pad ? pad.handleKey(e) : false),
    buttons: code
      ? [{ label: t('code_title'), primary: true, onClick: enterCode }, { label: t('close') }]
      : [{ label: t('close'), primary: true }],
  });
}

/**
 * A lock whose close-up is its own panel (th.keys): tap the keys drawn on the plate, the slots fill under it.
 * A pressed key lights up; a wrong code flashes the plate red and shakes it. Opens from the zone like a close-up.
 */
function showKeyPlate(p, th, code) {
  const src = plate(p.story.id, `${p.room.id}/${th.closeup}`);
  const img = src ? h('img', { class: 'search-img', src, alt: th.label || '', draggable: 'false' }) : h('div', { class: 'search-img search-blank' });
  const wrap = h('div', { class: 'search-wrap keyplate' }, img);
  // no plate yet: the keys are outlined so the lock stays playable before the art
  if (!src) for (const k of th.keys) wrap.append(markAt('key-outline', k.zone));
  const wr = ui.wall && ui.wall.el.getBoundingClientRect();
  const z = th.zone;
  const animateFrom = wr && wr.width > 0 && z
    ? { x: wr.left + z.x * wr.width, y: wr.top + z.y * wr.height, w: z.w * wr.width, h: z.h * wr.height }
    : undefined;
  let m = null;
  const pad = codePad(code.type, code.len, (typed) => {
    const next = code.onCode(typed);
    if (next === false) {
      wrap.classList.remove('key-wrong'); void wrap.offsetWidth; wrap.classList.add('key-wrong');
      return false;
    }
    return () => { m.close(); m.box.parentElement?.remove(); if (typeof next === 'function') next(); };
  }, { showKeys: false });
  wrap.addEventListener('click', (e) => {
    const r = wrap.getBoundingClientRect();
    const k = p.keyAt(th, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (!k) return;
    buzz(15);
    const lit = markAt('key-lit', k.zone);
    wrap.append(lit);
    lit.addEventListener('animationend', () => lit.remove());
    pad.press(k.token);
  });
  const said = h('div', { class: 'closeup-text' }, `${th.label || ''}\n${t('keys_on_plate')}`.trim());
  m = modal({
    className: 'closeup',
    animateFrom,
    content: h('div', { class: 'closeup-col' }, wrap, said, pad.el),
    onKey: (e) => pad.handleKey(e),
    buttons: [{ label: t('close'), primary: true }],
  });
}

/**
 * A close-up with details to look at (th.look): every detail marked (dashed while unread, a soft ring once read);
 * a tap lights it up and says its line in `said`, and the line goes to the notes (Progress.lookAt).
 */
function lookPlate(p, th, src, said, msg) {
  const img = src ? h('img', { class: 'search-img', src, alt: th.label || '', draggable: 'false' }) : h('div', { class: 'search-img search-blank' });
  const wrap = h('div', { class: 'search-wrap lookplate' }, img);
  const marks = new Map(th.look.map((d) => [d.id, markAt('look-mark' + (p.isSeen(th, d) ? ' seen' : ''), d.zone)]));
  for (const mk of marks.values()) wrap.append(mk);
  said.textContent = `${msg}\n${t('look_on_plate')}`;
  wrap.addEventListener('click', (e) => {
    const r = wrap.getBoundingClientRect();
    const d = p.lookAt(th, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (!d) return;
    buzz(15);
    marks.get(d.id)?.classList.add('seen');
    const lit = markAt('look-lit', d.zone);
    wrap.append(lit);
    setTimeout(() => lit.remove(), 600); // not animationend: with reduced motion there is no animation to end
    said.textContent = d.text;
    saves.save(p);
  });
  return wrap;
}

/** An absolutely placed box over zone z of a plate wrap (fractions). */
function markAt(cls, z) {
  const mk = h('div', { class: cls });
  mk.style.cssText = `left:${z.x * 100}%;top:${z.y * 100}%;width:${z.w * 100}%;height:${z.h * 100}%`;
  return mk;
}

/** The search plate of th: tap what is on the list; the last one found opens the thing. */
function showSearch(p, th) {
  const src = plate(p.story.id, `${p.room.id}/${th.closeup}`);
  const img = src ? h('img', { class: 'search-img', src, alt: th.label || '', draggable: 'false' }) : h('div', { class: 'search-img search-blank' });
  const wrap = h('div', { class: 'search-wrap' }, img);
  const left = h('div', { class: 'search-left' });
  const list = h('div', { class: 'search-list' });
  let m = null;
  const refresh = () => {
    list.replaceChildren(...th.search.map((s) => h('span', { class: 'search-name' + (p.isHit(th, s) ? ' found' : '') }, s.name)));
    left.textContent = t('search_left', p.searchLeft(th));
    wrap.querySelectorAll('.search-mark').forEach((n) => n.remove());
    for (const s of th.search) {
      if (!p.isHit(th, s)) continue;
      const z = s.zone;
      const mk = h('div', { class: 'search-mark' });
      mk.style.cssText = `left:${z.x * 100}%;top:${z.y * 100}%;width:${z.w * 100}%;height:${z.h * 100}%`;
      wrap.append(mk);
    }
  };
  wrap.addEventListener('click', (e) => {
    const r = wrap.getBoundingClientRect();
    const res = p.searchTap(th, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (res.kind === 'hit') { buzz(15); refresh(); }
    else if (res.kind === 'done') {
      const o = res.said;
      const msg = o.gained ? gainedMessage(o.text, o.gained) : o.text;
      m.close(); say(msg); refreshStatus();
    }
    saves.save(p);
  });
  refresh();
  m = modal({
    className: 'closeup search',
    content: h('div', { class: 'closeup-col' }, wrap, left, list),
    buttons: [{ label: t('close'), primary: true }],
  });
}

function leave(p) {
  if (p.touring) { leaveTour(p); return; }
  const story = p.story;
  const done = p.room, doneIndex = p.roomIndex;
  const stats = t('found_progress', p.foundInRoom(), p.thingsInRoom()) + '  ·  ' + t('room_done_hints', p.hintsShown().length);
  const paid = wallet.claimRoomReward(story.id, p.room.id, p.room.difficulty);
  const returned = p.leave() + (paid > 0 ? '\n\n' + t('coins_reward', paid) : '');
  saves.save(p);
  showRoomDone(p, done, doneIndex, returned, stats);
}

/** The breather between rooms: which room of how many, the exit text, found/hints/coins (no time, no score), then Continue. */
function showRoomDone(p, done, index, exitText, stats) {
  const story = p.story;
  const where = p.finished ? t('room_done_last') : t('room_done_of', index + 1, story.rooms.length);
  const next = p.finished ? '' : '\n\n' + t('room_done_next', p.room.title);
  showPanel(done.title, where + '\n\n' + exitText + '\n\n' + stats + next, t('room_done_continue'),
    () => { if (p.finished) showOutro(story); else { side = 'north'; enterRoom(true); } });
}

function showHints() {
  const p = progress;
  if (!p || modalOpen()) return;
  if (!p.hintsShown().length && p.hintAvailable() && p.nextHintCost() === 0) { // the first push without a click
    p.revealHint(); saves.save(p); refreshStatus(); refreshHint();
  }
  const shown = p.hintsShown();
  const list = shown.map((x, i) => `${i + 1}. ${x}`).join('\n\n');
  const available = p.hintAvailable();
  let msg;
  if (!shown.length && available) msg = t('hints_empty');
  else if (!shown.length) msg = t('hint_none');
  else if (available) msg = list;
  else msg = list + '\n\n' + t('hint_none');
  if (available) msg += '\n\n' + hintNextLine(p); // which layer comes next, right under the read ones
  const left = p.hintFreeInMs();
  if (available && p.hintFreeByWaiting()) msg += '\n\n' + t('hint_waited');
  else if (available && left > 0) msg += '\n\n' + t('hint_wait', clockText(left));
  if (available && wallet.balance() < p.nextHintCost()) msg += '\n\n' + t('hint_poor', Coins.reward(p.room.difficulty));
  const buttons = [{ label: t('ok') }];
  if (available) {
    const cost = p.nextHintCost();
    buttons.unshift({
      label: cost === 0 ? t('hint_next_free') : cost === 1 ? t('hint_next', cost) : t('hint_next_many', cost),
      primary: true,
      onClick: () => {
        if (wallet.spend(Math.min(cost, p.nextHintCost()))) { // waiting may have made it free meanwhile
          p.revealHint();
          saves.save(p);
          refreshStatus();
          refreshHint();
          setTimeout(showHints, 0);
        } else {
          say(t('hint_poor', Coins.reward(p.room.difficulty)));
        }
      },
    });
  }
  const title = p.hintsTotal() > 0 ? t('hints_title', p.hintsRevealed(), p.hintsTotal()) : t('hint_button');
  modal({ title, message: msg, buttons });
}

/** "Next: hint 3 of 4, the last one." plus, in a difficulty-1 room, that every layer is free. */
function hintNextLine(p) {
  const n = p.hintsRevealed() + 1;
  const next = t(n === p.hintsTotal() ? 'hint_next_is_last' : 'hint_next_is', n, p.hintsTotal());
  return Coins.hintsFree(p.room.difficulty) ? next + ' ' + t('hints_free_room') : next;
}

function showNotes() {
  const p = progress;
  if (!p || modalOpen()) return;
  // What you read stays (docs/besluiten/wat-je-las-blijft.md in the app repo): intros and exit texts in italics.
  const pages = p.journal();
  const intro = p.story.intro || '';
  const col = h('div', { class: 'notes' });
  if (intro) col.append(h('p', { class: 'read' }, intro));
  if (!pages.length && !intro) col.append(h('p', {}, t('notes_empty')));
  for (const pg of pages) {
    col.append(h('h3', {}, pg.room.title));
    if (pg.intro) col.append(h('p', { class: 'read' }, pg.intro));
    for (const n of pg.notes) col.append(h('p', {}, n));
    if (pg.exit) col.append(h('p', { class: 'read' }, pg.exit));
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

// ---- palette per story (docs/besluiten/palet-per-verhaal.md in the app repo)
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Luminance 299/587/114 over 160, as Ui.light in the app. */
function light(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 160;
}

/** The four roles and the shades the css derives from them, as custom properties on `el`. */
function setPaletteVars(el, pal) {
  const v = {
    '--bg': pal.bg, '--card': pal.card, '--ink': pal.ink, '--accent': pal.accent, '--modal': pal.card,
    '--line': rgba(pal.accent, 0.4), '--accent-soft': rgba(pal.accent, 0.2), '--accent-zone': rgba(pal.accent, 0.8),
    '--ink-dim': rgba(pal.ink, 0.6), '--scrim': rgba(pal.bg, 0.94), '--accent-fill': rgba(pal.accent, 0.33),
    '--cover-shadow': light(pal.card) ? rgba(pal.card, 0.9) : 'rgba(0, 0, 0, .8)',
  };
  for (const [k, x] of Object.entries(v)) el.style.setProperty(k, x);
}

/** The story's colours on the whole page (null = the default), and the browser bar with them. */
function applyPalette(pal) {
  const root = document.documentElement;
  if (pal) setPaletteVars(root, pal);
  else for (const k of ['--bg', '--card', '--ink', '--accent', '--modal', '--line', '--accent-soft', '--accent-zone', '--ink-dim', '--scrim', '--cover-shadow', '--accent-fill']) root.style.removeProperty(k);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', (pal || PALETTE_DEFAULT).bg);
}
