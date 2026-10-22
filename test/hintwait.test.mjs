// Mirror of CoinsTest.waitingMakesTheLayerFree and the "waiting makes the next hint layer free" tests in ProgressTest.kt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coins, Progress, Side } from '../js/engine.js';
import { z, item, thing, exit, combo, room, story as mkStory } from './_helpers.mjs';

const key = item('k', 'sleutel');
const coin = item('c', 'munt');
const giver = thing('g', Side.NORTH, z, 'g', 'je pakt een sleutel', [], null, key);
const coinGiver = thing('cg', Side.NORTH, z, 'cg', 'een munt', [], null, coin);
const locked = thing('l', Side.EAST, z, 'l', 'open', ['k'], 'dicht', null);
const story = mkStory('t', 'nl', 'T', '', '', '', [
  room('a', 'A', 'taak', '', {}, [giver, coinGiver, locked], exit(Side.SOUTH, z, '1234', [], null, 'naar b'),
    { difficulty: 2, hints: ['h1', 'h2'], combos: [combo('k', 'c', item('kc', 'sleutelmunt'), 'samengevoegd')] }),
  room('b', 'B', 'taak', '', {}, [], exit(Side.SOUTH, z, null, ['k'], 'dicht', 'uit'), { difficulty: 2, hints: ['x'] }),
]);
const WAIT = Coins.hintWaitMs(2); // room a is difficulty 2: 4 min (difficulty 1 gives every layer free)

function timed() {
  const clock = { t: 0 };
  const p = new Progress(story);
  p.clock = () => clock.t;
  return [p, clock];
}

test('waitingMakesTheLayerFree', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((d) => Coins.hintWaitMs(d)), [3, 4, 6, 8, 12].map((m) => m * 60000));
  assert.equal(Coins.hintWaitMs(0), Coins.hintWaitMs(1));
  const wait = Coins.hintWaitMs(2);
  assert.equal(Coins.hintCost(1, 4, wait - 1, 2), 1);
  assert.equal(Coins.hintCost(1, 4, wait, 2), 0);
  assert.equal(Coins.hintCost(3, 4, 0, 2), Coins.LAST_LAYER_COST);
  assert.equal(Coins.hintCost(3, 4, wait, 2), 0);
  assert.equal(Coins.hintCost(0, 4, 0, 2), 0);
  assert.equal(Coins.hintCost(3, 4), Coins.LAST_LAYER_COST); // two arguments: the list price
});

test('waitingWithoutStepMakesNextHintFree', () => {
  const [p, c] = timed();
  p.resume();
  assert.equal(p.nextHintCost(), 0);
  assert.equal(p.hintFreeInMs(), 0);
  p.revealHint();
  assert.equal(p.nextHintCost(), Coins.LAST_LAYER_COST);
  assert.equal(p.hintFreeInMs(), WAIT);
  c.t = 60000; p.look(Side.EAST);
  c.t = 120000; p.look(Side.WEST);
  assert.equal(p.hintFreeInMs(), WAIT - 120000);
  assert.equal(p.hintFreeByWaiting(), false);
  c.t = WAIT;
  assert.equal(p.nextHintCost(), 0);
  assert.equal(p.hintFreeInMs(), 0);
  assert.equal(p.hintFreeByWaiting(), true);
  p.revealHint();
  assert.equal(p.hintAvailable(), false);
  assert.equal(p.nextHintCost(), 0);
  assert.equal(p.hintFreeByWaiting(), false);
});

test('aStepRestartsTheWait', () => {
  const [p, c] = timed();
  p.resume(); p.revealHint();
  c.t = 150000; p.tap(giver);
  assert.equal(p.hintFreeInMs(), WAIT);
  c.t = 200000; p.tap(locked);
  c.t = 250000; p.select('c');
  assert.equal(p.hintFreeInMs(), WAIT - 100000);
  p.tap(coinGiver); p.select('k');
  c.t = 260000; p.combine('k', 'c');
  assert.equal(p.hintFreeInMs(), WAIT);
  c.t = 270000; p.combine('kc', 'kc');
  assert.equal(p.hintFreeInMs(), WAIT - 10000);
});

test('walkingAwayDoesNotCount', () => {
  const [p, c] = timed();
  p.resume(); p.revealHint();
  c.t = 60 * 60000;
  assert.equal(p.hintFreeInMs(), WAIT - Progress.IDLE_MS);
  p.pause();
  c.t = 2 * 60 * 60000;
  assert.equal(p.hintFreeInMs(), WAIT - Progress.IDLE_MS);
});

test('waitRoundTripsAndOldSavesWaitFromTheRoomStart', () => {
  const [p, c] = timed();
  p.resume(); c.t = 100000; p.revealHint(); c.t = 130000; p.pause();
  const back = Progress.fromJson(story, p.toJson());
  assert.equal(back.stepMs.get('a'), 100000);
  assert.equal(back.hintFreeInMs(), WAIT - 30000);
  const old = JSON.parse(p.toJson()); delete old.stepMs;
  assert.equal(Progress.fromJson(story, JSON.stringify(old)).hintFreeInMs(), WAIT - 130000);
});

test('newRoomStartsItsOwnWait', () => {
  const [p, c] = timed();
  p.resume(); p.revealHint(); c.t = 170000; p.leave();
  assert.equal(p.nextHintCost(), 0);
  assert.equal(p.waitedMs(), 0);
});

// ---- difficulty 1: every hint layer is free (mirror of CoinsTest.easyRoomsGiveEveryLayerFree, ProgressTest.easyRoomHintsAreFreeWithoutCountdown)

test('easyRoomsGiveEveryLayerFree', () => {
  assert.equal(Coins.hintsFree(1), true);
  assert.equal(Coins.hintsFree(0), true);
  assert.equal(Coins.hintsFree(2), false);
  assert.deepEqual([0, 1, 2, 3].map((i) => Coins.hintCost(i, 4, undefined, 1)), [0, 0, 0, 0]);
  assert.deepEqual([0, 1, 2, 3].map((i) => Coins.hintCost(i, 4, undefined, 2)), [0, 1, 1, Coins.LAST_LAYER_COST]);
  assert.equal(Coins.hintCost(3, 4, 0, 1), 0);
  assert.equal(Coins.hintsCost(4, 4, 1), 0);
  assert.equal(Coins.hintsCost(4, 4, 3), 2 + Coins.LAST_LAYER_COST);
  assert.equal(Coins.hintsCost(4, 4), 2 + Coins.LAST_LAYER_COST); // without difficulty: the list price
});

test('easyRoomHintsAreFreeWithoutCountdown', () => {
  const easy = mkStory('e', 'nl', 'E', '', '', '', [
    room('a', 'A', 'taak', '', {}, [giver], exit(Side.SOUTH, z, '1', [], null, 'uit'), { difficulty: 1, hints: ['h1', 'h2', 'h3'] }),
  ]);
  const c = { t: 0 };
  const p = new Progress(easy);
  p.clock = () => c.t;
  p.resume();
  for (let i = 0; i < 3; i++) {
    assert.equal(p.nextHintCost(), 0);
    assert.equal(p.hintFreeInMs(), 0);         // no countdown: it is free anyway
    assert.equal(p.hintFreeByWaiting(), false); // and no "free by waiting" pulse
    c.t += 60000; p.revealHint();
  }
  assert.equal(p.hintsRevealed(), 3);
  assert.equal(p.hintsTotal(), 3);
  assert.equal(p.hintCoinsSpent(), 0);
});
