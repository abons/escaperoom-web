// Mirror of LookAgainTest.kt: `look` (details on a close-up) and `again` (a second text on a found thing).
// Story rules run over $STORIES_DIR, else ../escaperoom/app/src/main/assets/stories, else ./stories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStory, Progress } from '../js/engine.js';

const json = JSON.stringify({
  title: 'T', rooms: [{ id: 'r', title: 'R', task: 't', walls: {},
    things: [
      { id: 'bord', wall: 'north', x: 0.1, y: 0.1, w: 0.2, h: 0.2, text: 'Een prikbord.',
        again: 'Nog steeds een prikbord.', closeup: 'c',
        look: [{ id: 'geel', x: 0.1, y: 0.1, w: 0.2, h: 0.2, text: 'Een geel briefje.' },
          { id: 'roze', x: 0.5, y: 0.5, w: 0.2, h: 0.2, text: 'Een roze briefje.' }] },
      { id: 'kast', wall: 'east', x: 0.1, y: 0.1, w: 0.2, h: 0.2, text: 'Een kast.' },
    ],
    exit: { wall: 'south', x: 0.4, y: 0.4, w: 0.2, h: 0.2, text: 'Weg.' } }],
});
const story = () => parseStory('s', json);

test('parsesLookAndAgain', () => {
  const [t, k] = story().rooms[0].things;
  assert.deepEqual(t.look.map((d) => d.id), ['geel', 'roze']);
  assert.deepEqual(t.look[1].zone, { x: 0.5, y: 0.5, w: 0.2, h: 0.2 });
  assert.equal(t.again, 'Nog steeds een prikbord.');
  assert.deepEqual(k.look, []);
  assert.equal(k.again, null);
});

test('againIsSaidOnTheSecondTap', () => {
  const p = new Progress(story());
  const [bord, kast] = p.room.things;
  assert.equal(p.tap(bord).text, 'Een prikbord.');
  assert.equal(p.tap(bord).text, 'Nog steeds een prikbord.');
  assert.equal(p.tap(bord).text, 'Nog steeds een prikbord.');
  p.tap(kast);
  assert.equal(p.tap(kast).text, 'Een kast.');
  assert.deepEqual(p.notes(), ['Een prikbord.', 'Een kast.']);
});

test('lookTapMarksSeenAndFillsTheNotes', () => {
  const p = new Progress(story());
  const bord = p.room.things[0];
  p.tap(bord);
  assert.equal(p.lookAt(bord, 0.9, 0.9), null);
  assert.equal(p.lookAt(bord, 0.15, 0.15)?.id, 'geel');
  assert.ok(p.isSeen(bord, bord.look[0]));
  assert.ok(!p.isSeen(bord, bord.look[1]));
  assert.deepEqual(p.notes(), ['Een prikbord.', 'Een geel briefje.']);
  assert.deepEqual(p.journal()[0].notes, ['Een prikbord.', 'Een geel briefje.']);
  assert.deepEqual(p.allNotes()[0].notes, ['Een prikbord.', 'Een geel briefje.']);
  assert.equal(p.mistakes.get('r') ?? 0, 0);
  p.lookAt(bord, 0.15, 0.15);
  assert.equal(p.notes().length, 2);
});

test('seenSurvivesTheSaveAndOldSavesLoad', () => {
  const p = new Progress(story());
  const bord = p.room.things[0];
  p.tap(bord); p.lookAt(bord, 0.55, 0.55);
  assert.deepEqual([...Progress.fromJson(story(), p.toJson()).seen], ['bord/roze']);
  assert.equal(Progress.fromJson(story(), '{"room":0,"found":["bord"]}').seen.size, 0);
});

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inUnit = (z) => z.x >= 0 && z.y >= 0 && z.w > 0 && z.h > 0 && z.x + z.w <= 1 && z.y + z.h <= 1;

function checkLook(who, t) {
  const look = t.look || [];
  if (look.length === 0) return;
  assert.ok(t.closeup, `${who}: look needs a closeup`);
  assert.equal(new Set(look.map((d) => d.id)).size, look.length, `${who}: look ids not unique`);
  look.forEach((d, i) => {
    assert.ok(d.text.trim(), `${who}: look ${d.id} has no text`);
    assert.ok(inUnit(d.zone), `${who}: look ${d.id} zone outside the plate`);
    for (const e of look.slice(i + 1)) assert.ok(!overlap(d.zone, e.zone), `${who}: look ${d.id} and ${e.id} overlap`);
    for (const k of t.keys || []) assert.ok(!overlap(k.zone, d.zone), `${who}: key ${k.token} overlaps look ${d.id}`);
  });
}

test('lookCheckRejectsOverlapAndMissingCloseup', () => {
  const base = story().rooms[0].things[0];
  checkLook('ok', base);
  const bad = [
    { ...base, closeup: null },
    { ...base, look: [...base.look, { id: 'x', text: 'x', zone: { x: 0.15, y: 0.15, w: 0.1, h: 0.1 } }] },
    { ...base, look: [...base.look, { id: 'geel', text: 'x', zone: { x: 0.8, y: 0.8, w: 0.1, h: 0.1 } }] },
    { ...base, look: [...base.look, { id: 'y', text: 'x', zone: { x: 0.9, y: 0.9, w: 0.2, h: 0.2 } }] },
  ];
  bad.forEach((t, i) => assert.throws(() => checkLook(`bad${i}`, t), undefined, `bad look ${i} should fail`));
});

test('lookRulesHoldForEveryStory', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = [process.env.STORIES_DIR, path.join(root, '..', 'escaperoom', 'app', 'src', 'main', 'assets', 'stories'), path.join(root, 'stories')]
    .filter(Boolean).find((d) => fs.existsSync(d));
  assert.ok(dir, 'no stories found');
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name, 'story.json');
    if (!e.isDirectory() || !fs.existsSync(f)) continue;
    const s = parseStory(e.name, fs.readFileSync(f, 'utf8'));
    for (const r of s.rooms) for (const t of r.things) {
      checkLook(`${s.id}/${t.id}`, t);
      if (t.again !== null) assert.ok(t.again.trim(), `${s.id}/${t.id}: again blank`);
    }
  }
});
