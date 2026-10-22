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
let chipIds = new Set(); // item ids the bar already shows, so only a tile that just arrived pops in

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
  // Play time runs only while the room screen is up; leaving it saves what was counted.
  if (screen === 'room' && name !== 'room' && progress) { progress.pause(); saves.save(progress); }
  if (name === 'room' && progress) progress.resume();
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
    h('p', { class: 'meta small' }, p.finished ? finishedTag(p.hintsUsed()) : t('room_of', p.roomIndex + 1, story.rooms.length)),
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
    next ? () => play(next) : goMenu, null, plate(story.id, 'outro'));
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

  ui = { wall, found, coins, msg, sel, chips };
  setScreen(h('div', { class: 'room' }, top, stage, msgBox, sel, bottom), 'room');
  chipIds = new Set(p.items.keys()); // a rebuilt bar does not pop
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
    if (!chipIds.has(item.id)) chip.classList.add('new'); // css pops it in, unless prefers-reduced-motion
    ui.chips.append(chip);
  }
  chipIds = new Set(p.items.keys());
  chipEdges(ui.chips);
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
    case 'search': showSearch(p, o.thing); break;
    case 'blocked': say(o.text); break;
    case 'wrong': buzz(40); say(t('wrong_use')); break;
    case 'applied': say(t('applied', itemName(p, o.item))); break;
    case 'needsCode':
      refreshStatus();
    {
      const type = o.thing.input || 'digits';
      const len = o.thing.len || (o.thing.code || '').length;
      const onCode = (code) => {
        const r = p.tryCode(th, code);
        if (r.kind === 'wrong') { buzz(40); say(t('code_wrong')); return false; }
        outcome(p, th, r);
        saves.save(p);
        return true;
      };
      if (th.closeup) showCloseup(p, th, th.label || '', { type, len, onCode }); else askCode(type, len, onCode);
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

/** code {type, len, onCode}: a button swaps the text for the code pad, under the plate (which shrinks). */
function showCloseup(p, th, msg, code) {
  const src = plate(p.story.id, `${p.room.id}/${th.closeup}`);
  const visual = src
    ? h('img', { class: 'closeup-img', src, alt: th.label || '' })
    : h('div', { class: 'closeup-label' }, th.label || '');
  // scale open from the zone of the thing that was tapped (and close back into it)
  const wr = ui.wall && ui.wall.el.getBoundingClientRect();
  const z = th.zone;
  const animateFrom = wr && wr.width > 0 && z
    ? { x: wr.left + z.x * wr.width, y: wr.top + z.y * wr.height, w: z.w * wr.width, h: z.h * wr.height }
    : undefined;
  const said = h('div', { class: 'closeup-text' }, msg);
  let pad = null;
  let m = null;
  const enterCode = () => {
    pad = codePad(code.type, code.len, (typed) => {
      const ok = code.onCode(typed);
      // a right code removes the close-up at once: the outcome may open the next one itself
      if (ok) { m.close(); m.box.parentElement?.remove(); }
      return ok;
    });
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
    const cost = Coins.hintCost(shown.length, p.room.hints.length);
    buttons.unshift({
      label: cost === 0 ? t('hint_next_free') : cost === 1 ? t('hint_next', cost) : t('hint_next_many', cost),
      primary: true,
      onClick: () => {
        if (wallet.spend(cost)) {
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
