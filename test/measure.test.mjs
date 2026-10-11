// Mirror of the "measuring" tests in ProgressTest.kt: play time and wrong tries per room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress, Side } from '../js/engine.js';
import { z, item, thing, exit, combo, room, story as mkStory } from './_helpers.mjs';

const key = item('k', 'sleutel');
const coin = item('c', 'munt');
const glue = item('g2', 'lijm');
const giver = thing('g', Side.NORTH, z, 'g', 'je pakt een sleutel', [], null, key);
const coinGiver = thing('cg', Side.NORTH, z, 'cg', 'een munt', [], null, coin);
const locked = thing('l', Side.EAST, z, 'l', 'open', ['k'], 'dicht', null);
const dials = thing('dials', Side.WEST, z, 'dials', 'klik', ['k'], 'dicht', null, { code: 'NESW', input: 'dirs' });
const story = mkStory('t', 'nl', 'T', '', '', '', [
  room('a', 'A', 'taak', '', {}, [giver, coinGiver, locked, dials], exit(Side.SOUTH, z, '1234', [], null, 'naar b'),
    { combos: [combo('k', 'c', item('kc', 'sleutelmunt'), 'samengevoegd')] }),
  room('b', 'B', 'taak', '', {}, [], exit(Side.SOUTH, z, null, ['k'], 'dicht', 'uit')),
]);

function timed() {
  const clock = { t: 0 };
  const p = new Progress(story);
  p.clock = () => clock.t;
  return [p, clock];
}

test('timeCountsOnlyWhileRunning', () => {
  const [p, c] = timed();
  c.t = 5000; p.tap(giver); // not running
  assert.equal(p.playMs.get('a') ?? 0, 0);
  p.resume();
  c.t = 15000; p.tap(coinGiver);
  assert.equal(p.playMs.get('a'), 10000);
  c.t = 20000; p.pause();
  assert.equal(p.playMs.get('a'), 15000);
  c.t = 900000; p.tap(locked); // paused: background time is not counted
  assert.equal(p.playMs.get('a'), 15000);
  p.resume(); p.resume(); // a second resume does not reset the start
  c.t = 901000; p.look(Side.EAST);
  assert.equal(p.playMs.get('a'), 16000);
});

test('idleGapIsCapped', () => {
  const [p, c] = timed();
  p.resume();
  c.t = 10 * 60000; p.tap(giver);
  assert.equal(p.playMs.get('a'), Progress.IDLE_MS);
});

test('timeGoesToTheRoomYouLeave', () => {
  const [p, c] = timed();
  p.resume();
  c.t = 30000; p.leave();
  c.t = 40000; p.tap(giver);
  assert.equal(p.playMs.get('a'), 30000);
  assert.equal(p.playMs.get('b'), 10000);
});

test('backwardsClockCountsNothing', () => {
  const [p, c] = timed();
  c.t = 50000; p.resume();
  c.t = 10000; p.tap(giver);
  assert.equal(p.playMs.get('a'), 0);
});

test('wrongTriesAreCounted', () => {
  const p = new Progress(story);
  p.tap(giver); p.tap(coinGiver);
  p.select('c'); p.tap(locked); // wrong item on a thing
  assert.equal(p.mistakes.get('a'), 1);
  p.select('c'); p.select('k');
  p.tap(dials);
  p.tryCode(dials, 'N'); // wrong code
  p.checkCode('0000'); // wrong exit code
  assert.equal(p.mistakes.get('a'), 3);
  p.tryCode(dials, 'NESW'); p.checkCode('1234'); // right: not counted
  p.select('k'); p.combine('k', 'c'); // a real combo: not counted
  assert.equal(p.mistakes.get('a'), 3);
});

test('wrongCombineCountsBlockedAndNotHeldDoNot', () => {
  const p = new Progress(story);
  p.tap(giver); p.tap(coinGiver);
  p.items.set('g2', glue);
  p.combine('c', 'g2'); // both held, no combo
  assert.equal(p.mistakes.get('a'), 1);
  p.combine('c', 'missing');
  p.select(null); p.tap(locked); // blocked
  assert.equal(p.mistakes.get('a'), 1);
});

test('measuresRoundTripAndOldSavesLoad', () => {
  const [p, c] = timed();
  p.resume(); c.t = 7000; p.tap(giver); p.pause();
  const m = new Progress(story); m.mistakes.set('a', 2);
  assert.equal(Progress.fromJson(story, p.toJson()).playMs.get('a'), 7000);
  assert.equal(Progress.fromJson(story, m.toJson()).mistakes.get('a'), 2);
  const old = JSON.parse(p.toJson()); delete old.playMs; delete old.mistakes;
  const loaded = Progress.fromJson(story, JSON.stringify(old));
  assert.equal(loaded.playMs.size, 0);
  assert.equal(loaded.mistakes.size, 0);
  assert.equal(loaded.items.size, 1);
});

test('statsExportListsEveryRoom', () => {
  const [p, c] = timed();
  p.resume(); c.t = 9000; p.leave(); p.pause();
  const o = JSON.parse(Progress.exportJson([p]))[0];
  assert.equal(o.story, 't');
  assert.equal(o.rooms.length, 2);
  assert.equal(o.rooms[0].id, 'a');
  assert.equal(o.rooms[0].done, true);
  assert.equal(o.rooms[0].playMs, 9000);
  assert.equal(o.rooms[1].done, false);
});
