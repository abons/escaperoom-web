// Mirror of StoriesTest.kt: content rules and the solver, over every story found.
// Directory: $STORIES_DIR, else ../escaperoom/app/src/main/assets/stories, else ./stories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStory, Progress, Side, Input, Zone, Difficulty, CondKind, ExitAsk } from '../js/engine.js';

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
    assert.equal(s.format, 1, `${n}: format`);
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
      checkCond(`${r.id}/exit`, r.exit.visibleWhen);
      for (const v of r.variants) {
        checkCond(`${r.id}/variant ${v.image}`, v.when);
        assert.ok(!blank(v.image), `${n}/${r.id}: variant image blank`);
        if (!plateExists(path.join(dir, n, r.id, v.image))) {
          console.log(`WARNING ${n}/${r.id}: variant file ${v.image}.png missing`);
        }
      }
      // Zones on one wall must not overlap, exit included.
      for (const side of Side.values) {
        const zones = r.things.filter((t) => t.side === side).map((t) => [t.id, t.zone]);
        if (r.exit.side === side) zones.push(['exit', r.exit.zone]);
        for (let i = 0; i < zones.length; i++) {
          for (let j = i + 1; j < zones.length; j++) {
            assert.ok(!Zone.overlap(zones[i][1], zones[j][1]), `${n}/${r.id}: ${zones[i][0]} overlaps ${zones[j][0]}`);
          }
        }
      }
      const e = r.exit;
      assert.ok(Zone.inUnitSquare(e.zone), `${n}/${r.id}: exit zone`);
      assert.ok(!blank(e.text), `${n}/${r.id}: exit text`);
      assert.ok(e.code !== null || e.needs.length > 0, `${n}/${r.id}: exit needs a code or needs`);
      assert.equal(e.needs.length > 0, e.stuck !== null, `${n}/${r.id}: exit needs goes with stuck`);
      assert.equal(new Set(e.needs).size, e.needs.length, `${n}/${r.id}: exit needs repeats an item`);
      for (const need of e.needs) assert.ok(given.has(need), `${n}/${r.id}: exit needs ${need} not given`);
      checkLock(`${n}/${r.id}/exit`, e.code, e.input, e.len);
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
    r.exit.needs.forEach((x) => used.add(x)); cond(r.exit.visibleWhen);
    r.variants.forEach((v) => cond(v.when));
  }
  return [...given].filter((x) => !used.has(x));
}

test('everyItemIsUsedSomewhere', () => {
  for (const s of stories) assert.deepEqual(unusedItems(s), [], `${s.id}: items given but never used`);
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
        const code = o.thing.code;
        assert.deepEqual(p.tryCode(t, `${code}x`), { kind: 'wrong' }, `${t.id}: wrong code accepted`);
        assert.equal(p.tryCode(t, code).kind, 'said', `${t.id}: code rejected`);
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

test('everyStoryCanBePlayedOut', () => {
  for (const s of stories) {
    const p = new Progress(s);
    let guard = 0;
    while (!p.finished) {
      assert.ok(guard++ < 100, `${s.id}: solver loops`);
      let changed = true;
      const combined = new Set();
      while (changed) {
        changed = false;
        for (const t of p.room.things) {
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
      const e = p.room.exit;
      let step = 0;
      for (;;) {
        assert.ok(step++ < 20, `${s.id}/${p.room.id}: exit loops`);
        const done = p.applied.get(`exit:${p.room.id}`) ?? new Set();
        const rest = e.needs.filter((x) => !done.has(x));
        const pick = rest.find((x) => p.items.has(x)) ?? null;
        if (rest.length > 0 && pick === null) assert.fail(`${s.id}/${p.room.id}: exit needs ${rest}, not held`);
        p.select(null);
        if (!p.exitVisible()) {
          let show = null;
          for (const id of [...p.items.keys()]) { p.select(id); if (p.exitVisible()) { show = id; break; } }
          assert.ok(show !== null, `${s.id}/${p.room.id}: hidden exit never becomes visible`);
          if (pick !== null) assert.equal(show, pick, `${s.id}/${p.room.id}: hidden exit needs ${pick} but ${show} must be selected`);
        } else if (pick !== null) p.select(pick);
        const ask = p.tapExit();
        if (ask === ExitAsk.PARTIAL) { p.select(null); continue; }
        if (ask === ExitAsk.ENTER_CODE) {
          assert.equal(p.checkCode(`${e.code}x`), false, `${s.id}: wrong code accepted`);
          assert.equal(p.checkCode(e.code), true, `${s.id}/${p.room.id}: code rejected`);
        } else if (ask === ExitAsk.BLOCKED || ask === ExitAsk.WRONG) {
          assert.fail(`${s.id}/${p.room.id}: exit blocked, needs ${e.needs}`);
        }
        break;
      }
      p.leave();
    }
    assert.equal(p.finished, true);
  }
});

test('every story survives a save/load at each room', () => {
  for (const s of stories) {
    const p = new Progress(s);
    const q = Progress.fromJson(s, p.toJson());
    assert.equal(q.roomIndex, 0);
    assert.equal(q.room.id, s.rooms[0].id);
  }
});
