// Escape Room engine: a faithful port of the pure Kotlin layer
// (Story.kt, Progress.kt, Coins.kt, Difficulty.kt, Saves.kt). No DOM. ES module.

// ---------------------------------------------------------------- Side

const SIDE_KEYS = ['north', 'east', 'south', 'west'];

/** The four walls, clockwise: turning right from north looks east. A Side is its key string. */
export const Side = Object.freeze({
  NORTH: 'north',
  EAST: 'east',
  SOUTH: 'south',
  WEST: 'west',
  values: SIDE_KEYS,
  turn(side, step) {
    return SIDE_KEYS[(SIDE_KEYS.indexOf(side) + step + 4 * 100) % 4];
  },
  of(key) {
    if (!SIDE_KEYS.includes(key)) throw new Error(`unknown wall: ${key}`);
    return key;
  },
  known(key) { return SIDE_KEYS.includes(key); },
});

// ---------------------------------------------------------------- Zone

const f = Math.fround; // zones are Float in Kotlin; the rules are checked in the same precision

/** A rectangle in fractions of the wall picture (0..1). Plain objects {x,y,w,h}. */
export const Zone = Object.freeze({
  contains(z, px, py) { return px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h; },
  inUnitSquare(z) {
    const x = f(z.x), y = f(z.y), w = f(z.w), h = f(z.h);
    return x >= 0 && y >= 0 && w > 0 && h > 0 && f(x + w) <= 1 && f(y + h) <= 1;
  },
  overlap(a, b) {
    const ax = f(a.x), ay = f(a.y), aw = f(a.w), ah = f(a.h);
    const bx = f(b.x), by = f(b.y), bw = f(b.w), bh = f(b.h);
    return ax < f(bx + bw) && bx < f(ax + aw) && ay < f(by + bh) && by < f(ay + ah);
  },
});

// ---------------------------------------------------------------- Cond

export const CondKind = Object.freeze({ HELD: 'held', SELECTED: 'selected', FOUND: 'found' });
const COND_KEYS = Object.values(CondKind);

// ---------------------------------------------------------------- Input

function makeInput(key, tokens) {
  const tokenSet = new Set(tokens);
  const self = {
    key,
    tokens: tokenSet,
    /** Trimmed, and upper-cased where case does not matter (everything but digits). */
    normalise(s) {
      const t = String(s).trim();
      return key === 'digits' ? t : t.toUpperCase();
    },
    /** True when code (normalised) holds only allowed tokens. */
    valid(code) { return [...self.normalise(code)].every((c) => tokenSet.has(c)); },
  };
  return Object.freeze(self);
}

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
const INPUTS = [
  makeInput('digits', '0123456789'),
  makeInput('letters', LETTERS),
  makeInput('dirs', 'NESW'),
  makeInput('colors', 'RGBYWK'),
];

/** Kinds of own lock. Every code is a string of single-character tokens. */
export const Input = Object.freeze({
  DIGITS: INPUTS[0],
  LETTERS: INPUTS[1],
  DIRS: INPUTS[2],
  COLORS: INPUTS[3],
  values: INPUTS,
  /** Unknown keys fall back to DIGITS. */
  parse(key) { return INPUTS.find((i) => i.key === key) || INPUTS[0]; },
  known(key) { return INPUTS.some((i) => i.key === key); },
});

// ---------------------------------------------------------------- Parser

/** Highest story format this build understands. */
export const MAX_FORMAT = 1;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function req(o, key) {
  if (!isObj(o) || !has(o, key) || o[key] === null) throw new Error(`missing "${key}"`);
  return o[key];
}
const reqStr = (o, key) => String(req(o, key));
const reqNum = (o, key) => {
  const n = Number(req(o, key));
  if (Number.isNaN(n)) throw new Error(`"${key}" is not a number`);
  return n;
};
const optStr = (o, key, def = '') => (has(o, key) && o[key] !== null ? String(o[key]) : def);
const optInt = (o, key, def) => {
  if (!has(o, key) || o[key] === null) return def;
  const n = Math.trunc(Number(o[key]));
  return Number.isNaN(n) ? def : n;
};
const optBool = (o, key, def) => {
  if (!has(o, key) || o[key] === null) return def;
  const v = o[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true' ? true : v.toLowerCase() === 'false' ? false : def;
  return def;
};
/** Like Kotlin str(): any present non-null value as a string, else null. */
const strOrNull = (o, key) => (has(o, key) && o[key] !== null ? String(o[key]) : null);
/** needs is a string or an array of strings; absent is empty. */
function list(o, key) {
  const v = o[key];
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v === undefined || v === null) return [];
  return [String(v)];
}
const item = (o) => ({ id: reqStr(o, 'id'), name: reqStr(o, 'name') });
const zone = (o) => ({ x: reqNum(o, 'x'), y: reqNum(o, 'y'), w: reqNum(o, 'w'), h: reqNum(o, 'h') });

/** `{"selected":"uvlamp"}`: exactly one key out of held / selected / found. */
export function parseCond(o) {
  const kinds = isObj(o) ? COND_KEYS.filter((k) => has(o, k)) : [];
  if (kinds.length !== 1 || Object.keys(o).length !== 1) {
    throw new Error(`condition needs exactly one of held/selected/found: ${JSON.stringify(o)}`);
  }
  return { kind: kinds[0], id: reqStr(o, kinds[0]) };
}
const condOf = (o, key) => (isObj(o[key]) ? parseCond(o[key]) : null);

function withInputType(obj) {
  Object.defineProperty(obj, 'inputType', { get() { return Input.parse(this.input); }, enumerable: false });
  return obj;
}

function parseThing(o) {
  const code = strOrNull(o, 'code');
  const side = Side.of(reqStr(o, 'wall'));
  return withInputType({
    id: reqStr(o, 'id'), side, wall: side, zone: zone(o),
    label: optStr(o, 'label'), text: reqStr(o, 'text'),
    needs: list(o, 'needs'), stuck: strOrNull(o, 'stuck'),
    gives: isObj(o.gives) ? item(o.gives) : null,
    consumes: optBool(o, 'consumes', false),
    code, input: optStr(o, 'input', 'digits'), len: optInt(o, 'len', code === null ? 0 : code.length),
    closeup: strOrNull(o, 'closeup'), visibleWhen: condOf(o, 'visible'),
  });
}

function parseExit(o) {
  const code = strOrNull(o, 'code');
  const side = Side.of(reqStr(o, 'wall'));
  return withInputType({
    side, wall: side, zone: zone(o), code,
    needs: list(o, 'needs'), stuck: strOrNull(o, 'stuck'), text: reqStr(o, 'text'),
    consumes: optBool(o, 'consumes', false),
    input: optStr(o, 'input', 'digits'), len: optInt(o, 'len', code === null ? 0 : code.length),
    visibleWhen: condOf(o, 'visible'),
  });
}

function parseCombo(o) {
  return {
    a: reqStr(o, 'a'), b: reqStr(o, 'b'), gives: item(req(o, 'gives')),
    text: reqStr(o, 'text'), consumes: optBool(o, 'consumes', true),
  };
}

function parseVariant(o) {
  const side = Side.of(reqStr(o, 'wall'));
  return { side, wall: side, when: parseCond(req(o, 'when')), image: reqStr(o, 'image') };
}

function parseRoom(o) {
  const walls = req(o, 'walls');
  const captions = {};
  for (const s of SIDE_KEYS) captions[s] = optStr(walls, s);
  const arr = (key, fn) => (Array.isArray(o[key]) ? o[key].map(fn) : []);
  return {
    id: reqStr(o, 'id'), title: reqStr(o, 'title'), task: reqStr(o, 'task'),
    intro: optStr(o, 'intro'), captions,
    things: arr('things', parseThing),
    exit: parseExit(req(o, 'exit')),
    difficulty: optInt(o, 'difficulty', 1),
    hints: arr('hints', (h) => String(h)),
    combos: arr('combos', parseCombo),
    variants: arr('variants', parseVariant),
  };
}

/** Parse a story.json (text or already-parsed object). Throws on a newer format or a broken file. */
export function parseStory(id, json) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  const format = optInt(o, 'format', 1);
  if (format > MAX_FORMAT) throw new Error(`story format ${format} not supported`);
  const rooms = req(o, 'rooms');
  if (!Array.isArray(rooms)) throw new Error('"rooms" is not an array');
  if (rooms.length === 0) throw new Error('story has no rooms');
  return {
    id, lang: optStr(o, 'lang', 'en'), title: reqStr(o, 'title'),
    blurb: optStr(o, 'blurb'), intro: optStr(o, 'intro'), outro: optStr(o, 'outro'),
    rooms: rooms.map(parseRoom), format, difficulty: optInt(o, 'difficulty', 1),
  };
}

// ---------------------------------------------------------------- Outcome / ExitAsk

/** What tapping a thing did. Plain objects with a `kind`. */
export const Outcome = Object.freeze({
  said(text, gained = null) { return gained ? { kind: 'said', text, gained } : { kind: 'said', text }; },
  blocked(text) { return { kind: 'blocked', text }; },
  wrong() { return { kind: 'wrong' }; },
  applied(item, remaining) { return { kind: 'applied', item, remaining }; },
  needsCode(thing) { return { kind: 'needsCode', thing }; },
});

export const ExitAsk = Object.freeze({
  ENTER_CODE: 'ENTER_CODE', BLOCKED: 'BLOCKED', OPEN: 'OPEN', WRONG: 'WRONG', PARTIAL: 'PARTIAL',
});

// ---------------------------------------------------------------- Progress

/** The player's place in one story: pure, saved as JSON. */
export class Progress {
  constructor(story) {
    this.story = story;
    this.roomIndex = 0;
    this.finished = false;
    /** @type {Map<string,{id:string,name:string}>} */
    this.items = new Map();
    /** @type {Set<string>} */
    this.found = new Set();
    /** Needed items already applied, per key: a thing id or `exit:<roomId>`. Saved. */
    this.applied = new Map();
    /** The item chosen in the inventory, or null. Not saved. */
    this.selected = null;
    /** The wall the player is looking at; saved. */
    this.side = Side.NORTH;
    this.hintCounts = new Map();
  }

  get room() { return this.story.rooms[this.roomIndex]; }
  get started() { return this.finished || this.roomIndex > 0 || this.found.size > 0; }

  look(s) { this.side = s; }

  /** Select an item you hold; the same id again deselects; null clears. Items not held are ignored. */
  select(id) {
    if (id === null || id === undefined) this.selected = null;
    else if (id === this.selected) this.selected = null;
    else if (this.items.has(id)) this.selected = id;
  }

  #remaining(key, needs) {
    const done = this.applied.get(key);
    return done ? needs.filter((n) => !done.has(n)) : needs;
  }

  /** Apply the selected item to key. Null when it cannot be; else {item, left}. */
  #applySelected(key, rest, consumes) {
    const sel = this.selected;
    if (sel === null) return null;
    if (!rest.includes(sel) || !this.items.has(sel)) return null;
    if (!this.applied.has(key)) this.applied.set(key, new Set());
    this.applied.get(key).add(sel);
    if (consumes) { this.items.delete(sel); this.selected = null; }
    return { item: sel, left: rest.length - 1 };
  }

  /** Does cond hold in the current state? Derived, never saved. */
  holds(c) {
    switch (c.kind) {
      case CondKind.HELD: return this.items.has(c.id);
      case CondKind.SELECTED: return this.selected === c.id && this.items.has(c.id);
      case CondKind.FOUND: return this.found.has(c.id);
      default: return false;
    }
  }

  visible(thing) { return thing.visibleWhen ? this.holds(thing.visibleWhen) : true; }
  exitVisible() { const c = this.room.exit.visibleWhen; return c ? this.holds(c) : true; }

  /** The visible things on side s of the current room. */
  thingsOnSide(s) { return this.room.things.filter((t) => t.side === s && this.visible(t)); }

  /** Plate name of the first variant of s whose condition holds, else null. */
  variantImage(s) {
    const v = this.room.variants.find((x) => x.side === s && this.holds(x.when));
    return v ? v.image : null;
  }

  #thing(t) { return typeof t === 'string' ? this.room.things.find((x) => x.id === t) : t; }

  tap(thingOrId) {
    const thing = this.#thing(thingOrId);
    if (!thing || !this.visible(thing)) return Outcome.wrong();
    if (this.found.has(thing.id)) return Outcome.said(thing.text);
    const rest = this.#remaining(thing.id, thing.needs);
    if (rest.length > 0) {
      if (this.selected === null) return Outcome.blocked(thing.stuck ?? '');
      const r = this.#applySelected(thing.id, rest, thing.consumes);
      if (!r) return Outcome.wrong();
      if (r.left > 0) return Outcome.applied(r.item, r.left);
    }
    if (thing.code !== null) return Outcome.needsCode(thing);
    return this.#open(thing);
  }

  /** Try the own lock of thing: right opens it, wrong is Outcome.wrong. */
  tryCode(thingOrId, code) {
    const thing = this.#thing(thingOrId);
    if (!thing || !this.visible(thing)) return Outcome.wrong();
    if (this.found.has(thing.id)) return Outcome.said(thing.text);
    const c = thing.code;
    if (c === null || c === undefined) return Outcome.wrong();
    if (this.#remaining(thing.id, thing.needs).length > 0) return Outcome.blocked(thing.stuck ?? '');
    const t = Input.parse(thing.input);
    if (t.normalise(code) !== t.normalise(c)) return Outcome.wrong();
    return this.#open(thing);
  }

  #open(thing) {
    this.found.add(thing.id);
    let gained = null;
    if (thing.gives && !this.items.has(thing.gives.id)) {
      gained = thing.gives;
      this.items.set(gained.id, gained);
    }
    return Outcome.said(thing.text, gained);
  }

  /** Combine two held items with a combo of the current room, either order. */
  combine(a, b) {
    if (!this.items.has(a) || !this.items.has(b)) return Outcome.wrong();
    const c = this.room.combos.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (!c) return Outcome.wrong();
    if (c.consumes) { this.items.delete(a); this.items.delete(b); }
    this.items.set(c.gives.id, c.gives);
    this.selected = null;
    return Outcome.said(c.text, c.gives);
  }

  #exitKey() { return `exit:${this.room.id}`; }

  /** Pure question: what would tapping the exit mean now? Changes nothing. */
  exitAsk() {
    const e = this.room.exit;
    const rest = this.#remaining(this.#exitKey(), e.needs);
    const sel = this.selected;
    if (!this.exitVisible()) return ExitAsk.WRONG;
    if (rest.length === 0) return e.code !== null ? ExitAsk.ENTER_CODE : ExitAsk.OPEN;
    if (sel === null) return ExitAsk.BLOCKED;
    if (!rest.includes(sel) || !this.items.has(sel)) return ExitAsk.WRONG;
    if (rest.length > 1) return ExitAsk.PARTIAL;
    return e.code !== null ? ExitAsk.ENTER_CODE : ExitAsk.OPEN;
  }

  /** Tap the exit: applies the selected needed item and says what is next. */
  tapExit() {
    const e = this.room.exit;
    if (!this.exitVisible()) return ExitAsk.WRONG;
    const rest = this.#remaining(this.#exitKey(), e.needs);
    if (rest.length > 0) {
      if (this.selected === null) return ExitAsk.BLOCKED;
      const r = this.#applySelected(this.#exitKey(), rest, e.consumes);
      if (!r) return ExitAsk.WRONG;
      if (r.left > 0) return ExitAsk.PARTIAL;
    }
    return e.code !== null ? ExitAsk.ENTER_CODE : ExitAsk.OPEN;
  }

  checkCode(code) {
    const e = this.room.exit;
    if (e.code === null || e.code === undefined) return false;
    const t = Input.parse(e.input);
    return t.normalise(e.code) === t.normalise(code);
  }

  /** Go through the exit; returns its text. The last room sets finished instead of advancing. */
  leave() {
    const text = this.room.exit.text;
    if (this.roomIndex === this.story.rooms.length - 1) this.finished = true;
    else this.roomIndex++;
    this.selected = null;
    this.side = Side.NORTH;
    return text;
  }

  /** Texts of what the player has opened in the current room, in the order of the room's things. */
  notes() { return this.room.things.filter((t) => this.found.has(t.id)).map((t) => t.text); }

  /**
   * Notes of every room reached (all rooms once finished); rooms without notes are left out.
   * Each entry is [room, texts] (also reachable as .room / .notes).
   */
  allNotes() {
    const last = this.finished ? this.story.rooms.length - 1 : this.roomIndex;
    const out = [];
    for (let i = 0; i <= last; i++) {
      const r = this.story.rooms[i];
      const texts = r.things.filter((t) => this.found.has(t.id)).map((t) => t.text);
      if (texts.length > 0) {
        const pair = [r, texts];
        pair.room = r;
        pair.notes = texts;
        out.push(pair);
      }
    }
    return out;
  }

  foundInRoom() { return this.room.things.filter((t) => this.found.has(t.id)).length; }
  thingsInRoom() { return this.room.things.length; }

  hintsShown() { return this.room.hints.slice(0, this.hintCounts.get(this.room.id) ?? 0); }
  hintAvailable() { return (this.hintCounts.get(this.room.id) ?? 0) < this.room.hints.length; }

  /** Reveal the next hint of this room; null when none is left. Charging coins is the caller's job. */
  revealHint() {
    const n = this.hintCounts.get(this.room.id) ?? 0;
    if (n >= this.room.hints.length) return null;
    this.hintCounts.set(this.room.id, n + 1);
    return this.room.hints[n];
  }

  hintsUsed() { let s = 0; for (const v of this.hintCounts.values()) s += v; return s; }

  /** Coins the revealed hints cost, derived from the counts (nothing extra is saved). */
  hintCoinsSpent() {
    let s = 0;
    for (const r of this.story.rooms) s += Coins.hintsCost(this.hintCounts.get(r.id) ?? 0, r.hints.length);
    return s;
  }

  /** Same shape as the Kotlin save: {room, finished, items, found, applied, side, hints} as a string. */
  toJson() {
    const applied = {};
    for (const [k, v] of this.applied) applied[k] = [...v];
    const hints = {};
    for (const [k, v] of this.hintCounts) hints[k] = v;
    return JSON.stringify({
      room: this.roomIndex,
      finished: this.finished,
      items: [...this.items.values()].map((i) => ({ id: i.id, name: i.name })),
      found: [...this.found],
      applied,
      side: this.side,
      hints,
    });
  }

  static fromJson(story, json) {
    const p = new Progress(story);
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    if (!isObj(o)) throw new Error('save is not an object');
    const room = optInt(o, 'room', 0);
    p.roomIndex = Math.min(Math.max(room, 0), story.rooms.length - 1);
    p.finished = optBool(o, 'finished', false);
    if (Array.isArray(o.items)) for (const i of o.items) p.items.set(String(req(i, 'id')), { id: String(i.id), name: String(req(i, 'name')) });
    if (Array.isArray(o.found)) for (const f2 of o.found) p.found.add(String(f2));
    if (isObj(o.applied)) {
      for (const [k, arr] of Object.entries(o.applied)) {
        if (Array.isArray(arr)) p.applied.set(k, new Set(arr.map((x) => String(x))));
      }
    }
    p.side = Side.known(o.side) ? o.side : Side.NORTH;
    if (isObj(o.hints)) for (const [k, v] of Object.entries(o.hints)) p.hintCounts.set(k, optInt(o.hints, k, 0));
    return p;
  }
}

// ---------------------------------------------------------------- Coins / Wallet

/** Family rule: a coin buys hints and nothing else. */
export const Coins = Object.freeze({
  START: 5,
  DAILY: 1,
  /** Price of the last hint layer of a room (user decides after playing; the middle layers cost 1). */
  LAST_LAYER_COST: 2,
  /** Cost of hint layer `index` (0-based) of `total`: first free, last LAST_LAYER_COST, between 1. First rule wins. */
  hintCost(index, total) {
    if (index <= 0) return 0;
    if (index >= total - 1) return Coins.LAST_LAYER_COST;
    return 1;
  },
  /** Coins spent on the first `n` layers of a room with `total` layers. */
  hintsCost(n, total) { let s = 0; for (let i = 0; i < Math.min(n, total); i++) s += Coins.hintCost(i, total); return s; },
  /** Reward for solving a room: its difficulty, 1..5. */
  reward(difficulty) { return Math.min(5, Math.max(1, Math.trunc(difficulty))); },
  /** Strict `<` on yyyyMMdd, so setting the clock back opens nothing. */
  shouldEarnDaily(lastDay, today) { return lastDay < today; },
  /** Spending clamps at zero. */
  balanceAfterSpend(balance, n) { return Math.max(0, balance - n); },
});

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch { /* blocked storage */ }
  return memoryStorage();
}

const pad = (n) => String(n).padStart(2, '0');
/** Today as yyyyMMdd in local time. */
export function todayKey(d = new Date()) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }

const COINS_KEY = 'escaperoom.coins';

/** The purse, in its own storage key so wiping a save never takes coins along. */
export class Wallet {
  /** @param storage localStorage-like; @param today () => 'yyyyMMdd' (injectable for tests) */
  constructor(storage = defaultStorage(), today = todayKey) {
    this.storage = storage;
    this.today = today;
  }

  #read() {
    try {
      const raw = this.storage.getItem(COINS_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (isObj(o)) return o;
      }
    } catch { /* unreadable: treat as a fresh purse */ }
    return {};
  }

  #write(o) { try { this.storage.setItem(COINS_KEY, JSON.stringify(o)); } catch { /* full or blocked */ } }

  balance() {
    const b = this.#read().balance;
    return Number.isInteger(b) ? b : Coins.START;
  }

  /** Grants today's daily coin if not yet given; a fresh purse gets only START. Returns the balance. */
  claimDaily() {
    const o = this.#read();
    const today = this.today();
    if (!Number.isInteger(o.balance)) {
      this.#write({ ...o, balance: Coins.START, lastDay: today });
      return Coins.START;
    }
    if (!Coins.shouldEarnDaily(typeof o.lastDay === 'string' ? o.lastDay : '', today)) return o.balance;
    const next = o.balance + Coins.DAILY;
    this.#write({ ...o, balance: next, lastDay: today });
    return next;
  }

  /** False, and nothing deducted, when the balance is too low. */
  spend(n) {
    const o = this.#read();
    const b = this.balance();
    if (n < 0 || b < n) return false;
    this.#write({ ...o, balance: Coins.balanceAfterSpend(b, n) });
    return true;
  }

  /** Pays reward once per story/room, ever. Returns the amount paid, 0 if already paid. */
  claimRoomReward(storyId, roomId, difficulty) {
    const o = this.#read();
    const key = `${storyId}_${roomId}`;
    const paid = isObj(o.paid) ? o.paid : {};
    if (paid[key]) return 0;
    const amount = Coins.reward(difficulty);
    this.#write({ ...o, paid: { ...paid, [key]: true }, balance: this.balance() + amount });
    return amount;
  }
}

// ---------------------------------------------------------------- Difficulty

/** Pure estimate of how long a room takes, to hold the authored difficulty against. */
export const Difficulty = Object.freeze({
  /** [{roomId, things, chain, locks, estMinutes}] per room. */
  analyse(story) {
    return story.rooms.map((r) => {
      // Depth of getting an item: 0 for one from an earlier room, else 1 + what its source needs.
      const itemDepth = (id, seen) => {
        if (seen.has(id)) return 0;
        const next = new Set(seen).add(id);
        const t = r.things.find((x) => x.gives && x.gives.id === id);
        if (t) return t.needs.reduce((m, n) => Math.max(m, 1 + itemDepth(n, next)), 0);
        const c = r.combos.find((x) => x.gives.id === id);
        if (!c) return 0;
        return 1 + Math.max(itemDepth(c.a, next), itemDepth(c.b, next));
      };
      const none = new Set();
      const maxNeeds = (needs) => needs.reduce((m, n) => Math.max(m, 1 + itemDepth(n, none)), 0);
      const chain = Math.max(r.things.reduce((m, t) => Math.max(m, maxNeeds(t.needs)), 0), maxNeeds(r.exit.needs));
      const locks = r.things.reduce((s, t) => s + t.needs.length, 0) + Math.max(1, r.exit.needs.length);
      const est = Math.ceil(
        r.things.length * 0.6 + chain * 1.0 + (r.exit.code !== null ? 1.5 : 0.5) + 1 + r.combos.length * 0.8
        + r.things.filter((t) => t.code !== null).length * 1.0
        + r.things.filter((t) => t.visibleWhen).length * 0.5
        + r.variants.length * 0.3,
      );
      return { roomId: r.id, things: r.things.length, chain, locks, estMinutes: est };
    });
  },

  /** Expected minutes for a difficulty 1..5, as {min, max, contains(n)} (inclusive). */
  band(d) {
    const k = Math.min(5, Math.max(1, Math.trunc(d)));
    const [min, max] = { 1: [2, 6], 2: [4, 9], 3: [6, 12], 4: [9, 16], 5: [12, 25] }[k];
    return { min, max, start: min, endInclusive: max, contains: (n) => n >= min && n <= max };
  },

  storyMinutes(story) { return Difficulty.analyse(story).reduce((s, r) => s + r.estMinutes, 0); },
  storyDifficulty(story) { return story.difficulty; },
});

// ---------------------------------------------------------------- Saves

const saveKey = (story) => `escaperoom.progress.${story.id}`;

/** Progress per story in localStorage 'escaperoom.progress.<id>'. */
export const Saves = Object.freeze({
  load(story, storage = defaultStorage()) {
    try {
      const json = storage.getItem(saveKey(story));
      if (json) return Progress.fromJson(story, json);
    } catch (e) {
      console.warn(`Escape Room: save of '${story.id}' unreadable: ${e.message}`);
    }
    return new Progress(story);
  },
  save(progress, storage = defaultStorage()) {
    try { storage.setItem(saveKey(progress.story), progress.toJson()); } catch { /* full or blocked */ }
  },
  clear(story, storage = defaultStorage()) {
    try { storage.removeItem(saveKey(story)); } catch { /* blocked */ }
  },
});
