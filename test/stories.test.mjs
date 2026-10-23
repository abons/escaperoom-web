// Mirror of StoriesTest.kt: content rules and the solver, over every story found.
// Directory: $STORIES_DIR, else ../escaperoom/app/src/main/assets/stories, else ./stories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStory, Progress, Side, Input, Zone, Difficulty, CondKind, ExitAsk, Saves, MAX_FORMAT, doorLocked, aside } from '../js/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function storiesDir() {
  const candidates = [
    process.env.STORIES_DIR,
    path.join(root, '..', 'escaperoom', 'app', 'src', 'main', 'assets', 'stories'),
    path.join(root, 'stories'),
  ].filter(Boolean);
  for (const d of candidates) {
    if (!fs.existsSync(d)) continue;
    const has = fs.readdirSync(d, { withFileTypes: true })
      .some((e) => e.isDirectory() && fs.existsSync(path.join(d, e.name, 'story.json')));
    if (has) return d;
  }
  throw new Error(`no stories found in: ${candidates.join(', ')}`);
}

const dir = storiesDir();
const stories = fs.readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'story.json')))
  .map((e) => e.name).sort()
  .map((name) => parseStory(name, fs.readFileSync(path.join(dir, name, 'story.json'), 'utf8')));

const plateExists = (base) => ['png', 'webp', 'jpg'].some((ext) => fs.existsSync(`${base}.${ext}`));
const blank = (s) => s === null || s === undefined || String(s).trim() === '';

/** A code must fit its input type: only allowed tokens, and exactly len of them. */
function checkLock(who, code, input, len) {
  assert.ok(Input.known(input), `${who}: unknown input '${input}'`);
  if (code === null) return;
  const t = Input.parse(input);
  assert.ok(!blank(code), `${who}: code blank`);
  assert.ok(t.valid(code), `${who}: code '${code}' has tokens outside ${t.key}`);
  assert.equal(t.normalise(code).length, len, `${who}: code '${code}' is not len ${len}`);
}

/**
 * Keys on a close-up (keys): only on a thing with a code and a closeup, one key per token, only tokens of the
 * input set, every token of the code reachable, zones inside the plate and not overlapping.
 */
function checkKeys(who, t) {
  const keys = t.keys || [];
  if (keys.length === 0) return;
  assert.ok(t.code !== null && t.code !== undefined, `${who}: keys need a code`);
  assert.ok(t.closeup, `${who}: keys need a closeup (the plate is the panel)`);
  const type = Input.parse(t.input);
  const seen = new Set();
  for (const k of keys) {
    const z = k.zone;
    assert.ok(type.tokens.has(k.token), `${who}: key '${k.token}' is not a ${type.key} token`);
    assert.ok(!seen.has(k.token), `${who}: key '${k.token}' twice`);
    seen.add(k.token);
    assert.ok(z.x >= 0 && z.y >= 0 && z.w > 0 && z.h > 0 && z.x + z.w <= 1 && z.y + z.h <= 1, `${who}: key '${k.token}' zone outside the plate`);
  }
  for (const c of type.normalise(t.code)) assert.ok(seen.has(c), `${who}: code token '${c}' has no key`);
  keys.forEach((a, i) => {
    for (const b of keys.slice(i + 1)) {
      const z = a.zone; const y = b.zone;
      assert.ok(z.x + z.w <= y.x || y.x + y.w <= z.x || z.y + z.h <= y.y || y.y + y.h <= z.y, `${who}: keys '${a.token}' and '${b.token}' overlap`);
    }
  });
}

test('keyCheckRejectsBadKeys', () => {
  const kz = (token, x, y, w, h) => ({ token, zone: { x, y, w, h } });
  const base = { id: 'k', code: 'NS', input: 'dirs', closeup: 'c', keys: [kz('N', 0.1, 0.1, 0.2, 0.2), kz('S', 0.1, 0.5, 0.2, 0.2)] };
  checkKeys('ok', base);
  const bad = [
    { ...base, keys: [kz('N', 0.1, 0.1, 0.2, 0.2), kz('S', 0.2, 0.2, 0.2, 0.2)] },
    { ...base, keys: [...base.keys, kz('X', 0.6, 0.6, 0.1, 0.1)] },
    { ...base, keys: base.keys.slice(0, 1) },
    { ...base, code: null },
    { ...base, closeup: null },
    { ...base, keys: [...base.keys, kz('E', 0.9, 0.9, 0.2, 0.2)] },
    { ...base, keys: [...base.keys, kz('N', 0.6, 0.1, 0.1, 0.1)] },
  ];
  bad.forEach((t, i) => assert.throws(() => checkKeys(`bad${i}`, t), undefined, `bad keys ${i} should fail`));
});

/**
 * The pad's look (pad): only 'wheels' is known (no field = keys); wheels need a code and a closeup (the pad opens
 * under the plate), not letters (26 stops), and not keys (then the plate is the panel).
 */
function checkPad(who, t) {
  if (t.pad === null || t.pad === undefined) return;
  assert.equal(t.pad, 'wheels', `${who}: pad '${t.pad}' unknown`);
  assert.ok(t.code !== null && t.code !== undefined, `${who}: wheels need a code`);
  assert.ok(t.closeup, `${who}: wheels need a closeup`);
  assert.notEqual(t.input, 'letters', `${who}: no wheels for letters`);
  assert.equal((t.keys || []).length, 0, `${who}: wheels and keys both`);
}

test('padCheckRejectsBadWheels', () => {
  const base = { id: 'o', code: '180', input: 'digits', closeup: 'c', keys: [], pad: 'wheels' };
  checkPad('ok', base);
  const bad = [
    { ...base, pad: 'dials' }, { ...base, code: null }, { ...base, closeup: null },
    { ...base, code: 'ABC', input: 'letters' },
    { ...base, keys: [{ token: '1', zone: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }] },
  ];
  bad.forEach((t, i) => assert.throws(() => checkPad(`bad${i}`, t), undefined, `bad pad ${i} should fail`));
});

/** A fill-in conclusion: one ___ per answer word, every answer word in the bank, no word twice, at least one decoy. */
function checkAsk(who, a) {
  if (!a) return;
  assert.ok(!blank(a.text), `${who}: ask text`);
  assert.ok(a.answer.length > 0, `${who}: ask needs an answer`);
  assert.equal(a.gaps, a.answer.length, `${who}: ask has ${a.gaps} gaps for ${a.answer.length} answer words`);
  assert.equal(new Set(a.words).size, a.words.length, `${who}: ask words repeat`);
  // the view takes a word out of the bank once it sits in a gap
  assert.equal(new Set(a.answer).size, a.answer.length, `${who}: ask answer repeats a word`);
  for (const w of a.answer) assert.ok(a.words.includes(w), `${who}: answer '${w}' not in the words`);
  assert.ok(a.words.length > new Set(a.answer).size, `${who}: ask words need a decoy`);
  a.words.forEach((w) => assert.ok(!blank(w), `${who}: blank ask word`));
}

test('askCheckRejectsBadAsks', () => {
  const ask = (text, words, answer) => ({ text, words, answer, gaps: text.split('___').length - 1 });
  checkAsk('good', ask('Wie? ___. Waarom? ___.', ['a', 'b', 'c'], ['a', 'c']));
  const bad = [
    ask('Wie? ___.', ['a', 'b'], ['a', 'b']), // gaps != answer
    ask('Wie? ___.', ['a', 'b'], ['x']), // answer not in the bank
    ask('Wie? ___.', ['a'], ['a']), // no decoy
    ask('Wie? ___.', ['a', 'a', 'b'], ['a']), // word twice
    ask('Wie? ___ en ___.', ['a', 'b'], ['a', 'a']), // answer repeats a word
  ];
  bad.forEach((a, i) => assert.throws(() => checkAsk(`bad${i}`, a), undefined, `bad ask ${i} should fail`));
});

test('sequenceLockIsCheckedLikeTheRest', () => {
  checkLock('fixture', 'SMHT', 'sequence', 4);
  assert.throws(() => checkLock('fixture', 'SMX', 'sequence', 3));
  assert.throws(() => checkLock('fixture', 'SMH', 'sequence', 4));
});

test('there are stories', () => {
  assert.ok(stories.length > 0, `no stories in ${dir}`);
});

test('rulesHoldForEveryStory', () => {
  for (const s of stories) {
    const n = s.id;
    assert.ok(!blank(s.title), `${n}: title`);
    assert.ok(!blank(s.intro), `${n}: intro`);
    assert.ok(!blank(s.outro), `${n}: outro`);
    assert.ok(s.rooms.length > 0, `${n}: no rooms`);
    assert.ok(s.format >= 1 && s.format <= MAX_FORMAT, `${n}: format ${s.format}`);
    const doorsUsed = s.rooms.some((r) => r.doors.length > 0 || r.exits.some((e) => e.to !== null || e.arrive !== null));
    assert.equal(doorsUsed, s.format === 2, `${n}: doors (exits/to/arrive) need format 2, and format 2 needs doors`);
    assert.ok(s.difficulty >= 1 && s.difficulty <= 5, `${n}: difficulty ${s.difficulty}`);
    const ids = new Set();
    const roomIds = new Set();
    const given = new Set();
    const thingIds = new Set(s.rooms.flatMap((r) => r.things).map((t) => t.id));
    const stats = Difficulty.analyse(s);
    for (const r of s.rooms) {
      assert.ok(!roomIds.has(r.id), `${n}: room id ${r.id} twice`);
      roomIds.add(r.id);
      assert.ok(!blank(r.task), `${n}/${r.id}: task`);
      for (const side of Side.values) assert.ok(!blank(r.captions[side]), `${n}/${r.id}: caption ${side}`);
      // Items given anywhere in this room count for its things and its exit.
      r.things.forEach((t) => { if (t.gives) given.add(t.gives.id); });
      r.combos.forEach((c) => given.add(c.gives.id));
      assert.ok(r.difficulty >= 1 && r.difficulty <= 5, `${n}/${r.id}: difficulty ${r.difficulty}`);
      assert.ok(r.hints.length >= 2, `${n}/${r.id}: needs at least 2 hints`);
      r.hints.forEach((h, i) => assert.ok(!blank(h), `${n}/${r.id}: hint ${i} blank`));
      const st = stats.find((x) => x.roomId === r.id);
      const band = Difficulty.band(r.difficulty);
      assert.ok(band.contains(st.estMinutes),
        `${n}/${r.id}: est ${st.estMinutes} min outside band ${band.min}..${band.max} of difficulty ${r.difficulty}`);
      for (const t of r.things.filter((x) => x.search.length > 0)) {
        assert.ok(t.closeup, `${n}/${t.id}: search needs a closeup`);
        assert.ok(t.search.length >= 2, `${n}/${t.id}: search needs at least 2 targets`);
        assert.equal(new Set(t.search.map((a) => a.id)).size, t.search.length, `${n}/${t.id}: search ids not unique`);
        t.search.forEach((a, i) => {
          const z = a.zone;
          assert.ok(!blank(a.name), `${n}/${t.id}/${a.id}: name blank`);
          assert.ok(z.x >= 0 && z.y >= 0 && z.w > 0 && z.h > 0 && z.x + z.w <= 1 && z.y + z.h <= 1, `${n}/${t.id}/${a.id}: zone outside the plate`);
          for (const b of t.search.slice(i + 1)) {
            const y = b.zone;
            assert.ok(z.x + z.w <= y.x || y.x + y.w <= z.x || z.y + z.h <= y.y || y.y + y.h <= z.y, `${n}/${t.id}: ${a.id} overlaps ${b.id}`);
          }
        });
      }
      for (const c of r.combos) {
        assert.ok(!blank(c.text), `${n}/${r.id}: combo ${c.a}+${c.b} text`);
        assert.ok(!blank(c.gives.name), `${n}/${r.id}: combo item name`);
        assert.ok(!ids.has(c.gives.id), `${n}: combo item id ${c.gives.id} not unique`);
        ids.add(c.gives.id);
        assert.ok(given.has(c.a), `${n}/${r.id}: combo input ${c.a} unknown`);
        assert.ok(given.has(c.b), `${n}/${r.id}: combo input ${c.b} unknown`);
      }
      for (const t of r.things) {
        assert.ok(!ids.has(t.id), `${n}: id ${t.id} not unique`);
        ids.add(t.id);
        assert.ok(Zone.inUnitSquare(t.zone), `${n}/${t.id}: zone`);
        assert.ok(!blank(t.text), `${n}/${t.id}: text`);
        assert.equal(t.needs.length > 0, t.stuck !== null, `${n}/${t.id}: needs goes with stuck`);
        if (t.needs.length > 0) {
          assert.equal(new Set(t.needs).size, t.needs.length, `${n}/${t.id}: needs repeats an item`);
          for (const need of t.needs) assert.ok(given.has(need), `${n}/${t.id}: needs ${need} not given earlier`);
          assert.ok(!blank(t.stuck), `${n}/${t.id}: stuck blank`);
        }
        checkLock(`${n}/${t.id}`, t.code, t.input, t.len);
        checkKeys(`${n}/${t.id}`, t);
        checkPad(`${n}/${t.id}`, t);
        checkAsk(`${n}/${t.id}`, t.ask);
        if (t.code === null) assert.equal(t.input, 'digits', `${n}/${t.id}: input/len without code`);
        if (t.closeup !== null && !plateExists(path.join(dir, n, r.id, t.closeup))) {
          console.log(`WARNING ${n}/${t.id}: closeup file ${n}/${r.id}/${t.closeup}.png missing`);
        }
        if (t.gives) {
          assert.ok(!ids.has(t.gives.id), `${n}: item id ${t.gives.id} not unique`);
          ids.add(t.gives.id);
          assert.ok(!blank(t.gives.name), `${n}: item name ${t.gives.id}`);
        }
      }
      const checkCond = (who, c) => {
        if (!c) return;
        const ok = c.kind === CondKind.FOUND
          ? thingIds.has(c.id)
          : given.has(c.id) || s.rooms.some((rr) => rr.things.some((t) => t.gives && t.gives.id === c.id)
            || rr.combos.some((cc) => cc.gives.id === c.id));
        assert.ok(ok, `${n}/${who}: condition ${c.kind}:${c.id} refers to nothing`);
      };
      r.things.forEach((t) => checkCond(t.id, t.visibleWhen));
      r.exits.forEach((e) => checkCond(`${r.id}/${e.id}`, e.visibleWhen));
      for (const v of r.variants) {
        checkCond(`${r.id}/variant ${v.image}`, v.when);
        assert.ok(!blank(v.image), `${n}/${r.id}: variant image blank`);
        if (!plateExists(path.join(dir, n, r.id, v.image))) {
          console.log(`WARNING ${n}/${r.id}: variant file ${v.image}.png missing`);
        }
      }
      // Zones on one wall must not overlap, doors included.
      for (const side of Side.values) {
        const zones = r.things.filter((t) => t.side === side).map((t) => [t.id, t.zone]);
        for (const e of r.exits) if (e.side === side) zones.push([`door ${e.id}`, e.zone]);
        for (let i = 0; i < zones.length; i++) {
          for (let j = i + 1; j < zones.length; j++) {
            assert.ok(!Zone.overlap(zones[i][1], zones[j][1]), `${n}/${r.id}: ${zones[i][0]} overlaps ${zones[j][0]}`);
          }
        }
      }
      const doorIds = new Set();
      for (const e of r.exits) {
        const d = `${n}/${r.id}/${e.id}`;
        assert.ok(!doorIds.has(e.id), `${d}: door id twice in the room`);
        doorIds.add(e.id);
        assert.ok(Zone.inUnitSquare(e.zone), `${d}: exit zone`);
        assert.ok(!blank(e.text), `${d}: exit text`);
        assert.ok(doorLocked(e) || e.to !== null, `${d}: exit needs a code or needs (an open passage needs a \`to\`)`);
        // the main door must lock: an open passage never counts as solving the room (roomLeft), so no reward or memento
        if (e === r.exit) assert.ok(doorLocked(e), `${d}: the main door is an open passage`);
        if (e.to !== null) {
          assert.ok(s.rooms.some((x) => x.id === e.to), `${d}: to '${e.to}' is no room`);
          assert.notEqual(e.to, r.id, `${d}: a door to its own room`);
        }
        assert.equal(e.needs.length > 0, e.stuck !== null, `${d}: exit needs goes with stuck`);
        assert.equal(new Set(e.needs).size, e.needs.length, `${d}: exit needs repeats an item`);
        for (const need of e.needs) assert.ok(given.has(need), `${d}: exit needs ${need} not given`);
        checkLock(d, e.code, e.input, e.len);
        checkAsk(d, e.ask);
      }
      assert.equal(r.exit.id, 'exit', `${n}/${r.id}: the main door keeps the id \`exit\``);
    }
  }
});

test('itemPlatesWarnWhenMissing', () => {
  for (const s of stories) {
    const ids = new Set();
    for (const r of s.rooms) {
      r.things.forEach((t) => { if (t.gives) ids.add(t.gives.id); });
      r.combos.forEach((c) => ids.add(c.gives.id));
    }
    for (const id of ids) {
      if (!plateExists(path.join(dir, s.id, 'items', id))) console.log(`WARNING ${s.id}: item plate items/${id}.png missing`);
    }
  }
});

/** Mirror of everyItemIsUsedSomewhere: no decoys, every given item is needed, combined or a held/selected condition. */
function unusedItems(s) {
  const given = new Set();
  const used = new Set();
  const cond = (c) => { if (c && c.kind !== CondKind.FOUND) used.add(c.id); };
  for (const r of s.rooms) {
    for (const t of r.things) { if (t.gives) given.add(t.gives.id); t.needs.forEach((x) => used.add(x)); cond(t.visibleWhen); }
    for (const c of r.combos) { given.add(c.gives.id); used.add(c.a); used.add(c.b); }
    for (const e of r.exits) { e.needs.forEach((x) => used.add(x)); cond(e.visibleWhen); }
    r.variants.forEach((v) => cond(v.when));
  }
  return [...given].filter((x) => !used.has(x));
}

test('everyItemIsUsedSomewhere', () => {
  for (const s of stories) assert.deepEqual(unusedItems(s), [], `${s.id}: items given but never used`);
});

/** Mirror of StoriesTest.forced: the exit's needs, transitively what the thing or combo giving each one needs. A code forces nothing. */
function forced(r) {
  const out = new Set();
  const todo = [...r.exit.needs];
  while (todo.length) {
    const id = todo.shift();
    if (out.has(id)) continue;
    out.add(id);
    for (const t of r.things) {
      if (t.gives?.id !== id) continue;
      todo.push(...t.needs);
      if (t.visibleWhen && t.visibleWhen.kind !== CondKind.FOUND) todo.push(t.visibleWhen.id);
    }
    for (const c of r.combos) if (c.gives.id === id) todo.push(c.a, c.b);
  }
  return out;
}

function usedIn(r) {
  const used = new Set();
  const cond = (c) => { if (c && c.kind !== CondKind.FOUND) used.add(c.id); };
  for (const t of r.things) { t.needs.forEach((x) => used.add(x)); cond(t.visibleWhen); }
  for (const c of r.combos) { used.add(c.a); used.add(c.b); }
  for (const e of r.exits) { e.needs.forEach((x) => used.add(x)); cond(e.visibleWhen); }
  r.variants.forEach((v) => cond(v.when));
  return used;
}

/** Mirror of StoriesTest.walkBack: rooms reachable from room j through open passages and the main doors of earlier rooms. */
function walkBack(s, j) {
  const out = new Set([j]);
  const todo = [j];
  while (todo.length) {
    const i = todo.shift();
    const r = s.rooms[i];
    for (const e of r.exits) {
      const free = !doorLocked(e) || (e.id === r.exit.id && i < j);
      if (!free) continue;
      const to = e.to !== null ? s.rooms.findIndex((x) => x.id === e.to) : i + 1;
      if (to >= 0 && to < s.rooms.length && !out.has(to)) { out.add(to); todo.push(to); }
    }
  }
  return out;
}

/** Mirror of laterNeedsAreForcedByTheExit: a later room's item is forced by its own room's exit, or an open door leads back. */
test('laterNeedsAreForcedByTheExit', () => {
  for (const s of stories) {
    s.rooms.forEach((r, i) => {
      const f = forced(r);
      const gives = [...r.things.filter((t) => t.gives).map((t) => t.gives.id), ...r.combos.map((c) => c.gives.id)];
      for (let j = i + 1; j < s.rooms.length; j++) {
        const used = usedIn(s.rooms[j]);
        for (const g of gives) {
          if (used.has(g)) assert.ok(f.has(g) || walkBack(s, j).has(i),
            `${s.id}/${r.id}/${g}: needed in ${s.rooms[j].id} but the exit lets you leave without it, and no open door leads back`);
        }
      }
    });
  }
});

const appliedCount =(p) => [...p.applied.values()].reduce((a, v) => a + v.size, 0);

/** Play one thing as far as it goes now: apply held needs one by one, enter its code from the data. */
function work(p, t) {
  let guard = 0;
  while (!p.found.has(t.id) && guard++ < 20) {
    const done = p.applied.get(t.id) ?? new Set();
    const rest = t.needs.filter((x) => !done.has(x));
    const pick = rest.find((x) => p.items.has(x)) ?? null;
    if (rest.length > 0 && pick === null) return; // not reachable yet
    p.select(null);
    if (!p.visible(t)) {
      // Hidden: try every held item as the selection (held/found conds change by themselves).
      let show = null;
      for (const id of [...p.items.keys()]) { p.select(id); if (p.visible(t)) { show = id; break; } }
      if (show === null) { p.select(null); return; } // not reachable yet
      // An item needed on it as well cannot be selected at once: that case is not solvable.
      if (pick !== null && pick !== show) { p.select(null); return; }
    } else if (pick !== null) p.select(pick);
    const o = p.tap(t);
    switch (o.kind) {
      case 'applied': p.select(null); break;
      case 'needsCode': {
        // keys on the plate: the code is what tapping the centre of each key's zone gives
        const keys = t.keys || [];
        const code = keys.length === 0 ? o.thing.code : [...Input.parse(t.input).normalise(t.code)].map((c) => {
          const kz = keys.find((k) => k.token === c).zone;
          const k = p.keyAt(t, kz.x + kz.w / 2, kz.y + kz.h / 2);
          assert.equal(k?.token, c, `${t.id}: key '${c}' not under its own zone`);
          return k.token;
        }).join('');
        assert.deepEqual(p.tryCode(t, `${code}x`), { kind: 'wrong' }, `${t.id}: wrong code accepted`);
        assert.equal(p.tryCode(t, code).kind, 'said', `${t.id}: code rejected`);
        break;
      }
      case 'needsAsk': {
        const a = o.thing.ask;
        assert.deepEqual(p.tryAsk(t, [...a.answer].reverse().concat('x')), { kind: 'wrong' }, `${t.id}: wrong conclusion accepted`);
        const r = p.tryAsk(t, a.answer);
        // a code after the conclusion: the next round of the loop taps it again and gets needsCode
        assert.ok(['said', 'needsCode'].includes(r.kind), `${t.id}: conclusion rejected: ${JSON.stringify(r)}`);
        break;
      }
      case 'search': {
        for (const a of o.thing.search) {
          const zz = a.zone;
          assert.equal(p.searchTap(t, zz.x - 0.001, zz.y - 0.001).kind, 'miss', `${t.id}: ${a.id} is a miss in its own zone`);
          assert.ok(['hit', 'done'].includes(p.searchTap(t, zz.x + zz.w / 2, zz.y + zz.h / 2).kind), `${t.id}: ${a.id} not found`);
        }
        assert.ok(p.found.has(t.id), `${t.id}: search did not open it`);
        break;
      }
      case 'said': break;
      default: throw new assert.AssertionError({ message: `${t.id}: solver got ${JSON.stringify(o)}` });
    }
    p.select(null);
  }
}

/** Mirror of StoriesTest.tryDoor: open door e with what is held; true when open now, false when it stays shut. */
function tryDoor(p, e) {
  const s = p.story;
  let step = 0;
  for (;;) {
    assert.ok(step++ < 20, `${s.id}/${p.room.id}/${e.id}: door loops`);
    if (p.isOpened(e)) return p.exitVisible(e);
    const done = p.applied.get(p.doorKey(e)) ?? new Set();
    const rest = e.needs.filter((x) => !done.has(x));
    const pick = rest.find((x) => p.items.has(x)) ?? null;
    if (rest.length > 0 && pick === null) return false;
    p.select(null);
    if (!p.exitVisible(e)) {
      let show = null;
      for (const id of [...p.items.keys()]) { p.select(id); if (p.exitVisible(e)) { show = id; break; } }
      if (show === null) { p.select(null); return false; }
      if (pick !== null) assert.equal(show, pick, `${s.id}/${p.room.id}: hidden door needs ${pick} but ${show} must be selected`);
    } else if (pick !== null) p.select(pick);
    const ask = p.tapExit(e);
    if (ask === ExitAsk.PARTIAL) { p.select(null); continue; }
    if (ask === ExitAsk.ASK) {
      assert.equal(p.checkAsk([...e.ask.answer].reverse().concat('x'), e), false, `${s.id}: wrong conclusion accepted`);
      assert.equal(p.checkAsk(e.ask.answer, e), true, `${s.id}/${p.room.id}/${e.id}: conclusion rejected`);
      continue;
    }
    if (ask === ExitAsk.ENTER_CODE) {
      assert.equal(p.checkCode(`${e.code}x`, e), false, `${s.id}: wrong code accepted`);
      assert.equal(p.checkCode(e.code, e), true, `${s.id}/${p.room.id}: code rejected`);
    } else if (ask === ExitAsk.BLOCKED || ask === ExitAsk.WRONG) return false;
    return true;
  }
}

/**
 * Mirror of everyStoryCanBePlayedOut: the solver over the door graph. Play the room out, go once through each further
 * door that opens, then through the main door, which must open. Every room entered, every door opened.
 */
function playOut(s) {
  const p = new Progress(s);
  let guard = 0;
  const combined = new Set();
  const walked = new Set();
  const entered = new Set();
  while (!p.finished) {
    assert.ok(guard++ < 100, `${s.id}: solver loops`);
    entered.add(p.roomIndex);
    let changed = true;
    while (changed) {
        changed = false;
        for (const t of p.room.things) {
          if (aside(t)) continue; // hidden coins and the secret are no part of the puzzle
          const before = [p.items.size, p.found.size, appliedCount(p)].join();
          work(p, t);
          if (before !== [p.items.size, p.found.size, appliedCount(p)].join()) changed = true;
        }
        for (const c of p.room.combos) {
          if (!combined.has(c) && p.items.has(c.a) && p.items.has(c.b)) {
            assert.equal(p.combine(c.a, c.b).kind, 'said', `${s.id}: combo ${c.a}+${c.b} failed`);
            combined.add(c);
            changed = true;
          }
        }
      }
      for (const c of p.room.combos) assert.ok(combined.has(c), `${s.id}/${p.room.id}: combo ${c.a}+${c.b} unreachable`);
      const side = p.room.doors.find((d) => !walked.has(p.doorKey(d)) && tryDoor(p, d));
      if (side) {
        walked.add(p.doorKey(side));
        const from = p.roomIndex;
        p.leave(side);
        assert.equal(p.roomIndex, p.doorTo(side, from), `${s.id}: door ${side.id} went elsewhere`);
        assert.equal(p.side, side.arrive || Side.NORTH, `${s.id}: arrive`);
        continue;
      }
      const e = p.room.exit;
      assert.ok(tryDoor(p, e), `${s.id}/${p.room.id}: exit blocked, needs ${e.needs}`);
      p.leave(e);
  }
  assert.equal(p.finished, true);
  for (const r of s.rooms) for (const e of r.exits) assert.ok(p.opened.has(p.doorKey(e, r)), `${s.id}/${r.id}/${e.id}: door never opened`);
  s.rooms.forEach((_, i) => assert.ok(entered.has(i), `${s.id}: room ${i} never reached`));
  return p;
}

test('everyStoryCanBePlayedOut', () => {
  for (const s of stories) playOut(s);
});

test('every story survives a save/load at each room', () => {
  for (const s of stories) {
    const p = new Progress(s);
    const q = Progress.fromJson(s, p.toJson());
    assert.equal(q.roomIndex, 0);
    assert.equal(q.room.id, s.rooms[0].id);
  }
});

// Mirror of StoriesTest.touringOpensEverythingAndMeasuresNothing: looking round after the end.
test('touringOpensEverythingAndMeasuresNothing', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  for (const s of stories) {
    const real = Progress.fromJson(s, { room: s.rooms.length - 1, finished: true, playMs: { [s.rooms[0].id]: 60000 } });
    Saves.save(real, storage);
    const before = [...mem.entries()].join('|');
    for (let i = 0; i < s.rooms.length; i++) {
      let now = 0;
      const p = Progress.tour(s, i);
      p.clock = () => now;
      assert.ok(p.touring && p.finished);
      assert.equal(p.roomIndex, i);
      p.resume();
      for (const t of p.room.things) {
        p.select(null);
        if (!p.visible(t)) [...p.items.keys()].find((id) => { p.select(id); return p.visible(t); });
        now += 30000;
        const o = p.tap(t);
        assert.ok(o.kind === 'said' && o.text === (t.again ?? t.text), `${s.id}/${p.room.id}/${t.id}: tour got ${o.kind}`);
      }
      p.select(null);
      for (const e of p.room.exits) {
        assert.equal(p.exitAsk(e), ExitAsk.OPEN, `${s.id}/${p.room.id}/${e.id}: door not open`);
        assert.equal(p.tapExit(e), ExitAsk.OPEN);
      }
      const ids = [...p.items.keys()];
      if (ids.length >= 2) p.combine(ids[0], ids[1]);
      p.pause();
      assert.ok([...p.playMs.values()].every((v) => v === 0), `${s.id}: tour measured play time`);
      assert.equal(p.mistakes.size, 0, `${s.id}: tour counted mistakes`);
      Saves.save(p, storage); // skipped: a tour is never saved
      p.leave();
      assert.ok(p.finished);
      assert.equal(p.roomIndex, i === s.rooms.length - 1 ? i : i + 1);
    }
    assert.equal([...mem.entries()].join('|'), before, `${s.id}: touring changed the real save`);
  }
});

// One secret per story at most, with its outro paragraph; mementos have a name and, when they name one, a plate.
test('secretAndMementosAreWellFormed', () => {
  for (const s of stories) {
    const secrets = s.rooms.flatMap((r) => r.things).filter((t) => t.secret);
    assert.ok(secrets.length <= 1, `${s.id}: more than one secret`);
    assert.equal(secrets.length > 0, !!s.outroSecret.trim(), `${s.id}: a secret goes with outroSecret`);
    for (const t of secrets) {
      assert.ok(!t.gives && t.needs.length === 0 && t.code === null && t.search.length === 0 && t.keys.length === 0 &&
        t.closeup === null && t.visibleWhen === null && !t.coin, `${s.id}/${t.id}: a secret is no puzzle`);
    }
    const ids = new Set();
    for (const r of s.rooms) {
      const m = r.memento;
      if (!m) continue;
      assert.ok(!ids.has(m.id), `${s.id}/${r.id}: memento id ${m.id} twice`);
      ids.add(m.id);
      assert.ok(m.name.trim(), `${s.id}/${r.id}: memento name`);
      if (m.plate) {
        assert.ok(['webp', 'png', 'jpg'].some((x) => fs.existsSync(path.join(dir, s.id, 'items', `${m.plate}.${x}`))),
          `${s.id}/${r.id}: memento plate ${m.plate} missing`);
      }
    }
  }
});
