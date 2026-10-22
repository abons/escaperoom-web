// Mirror of CoinsTest.kt, plus the Wallet and Saves on an in-memory storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coins, Wallet, Saves, Progress, parseStory } from '../js/engine.js';

function mem() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

test('rewardIsDifficultyClamped', () => {
  assert.equal(Coins.reward(1), 1);
  assert.equal(Coins.reward(3), 3);
  assert.equal(Coins.reward(5), 5);
  assert.equal(Coins.reward(0), 1);
  assert.equal(Coins.reward(9), 5);
});

test('dailyIsStrict', () => {
  assert.equal(Coins.shouldEarnDaily('20261010', '20261011'), true);
  assert.equal(Coins.shouldEarnDaily('20261011', '20261011'), false);
  assert.equal(Coins.shouldEarnDaily('20261012', '20261011'), false); // clock set back
  assert.equal(Coins.shouldEarnDaily('', '20261011'), true);
});

test('spendClampsAtZero', () => {
  assert.equal(Coins.balanceAfterSpend(5, 1), 4);
  assert.equal(Coins.balanceAfterSpend(1, 3), 0);
  assert.equal(Coins.balanceAfterSpend(0, 1), 0);
});

test('constants', () => {
  assert.equal(Coins.START, 8); // 5 until 2026-10-22: munten-dag-1.md
  assert.equal(Coins.DAILY, 1);
  assert.equal(Coins.LAST_LAYER_COST, 2);
});

test('hintCostPerLayer', () => {
  const L = Coins.LAST_LAYER_COST;
  assert.deepEqual([0, 1, 2].map((i) => Coins.hintCost(i, 3)), [0, 1, L]);
  assert.deepEqual([0, 1, 2, 3].map((i) => Coins.hintCost(i, 4)), [0, 1, 1, L]);
  assert.deepEqual([0, 1].map((i) => Coins.hintCost(i, 2)), [0, L]);
  assert.equal(Coins.hintCost(0, 1), 0);
  assert.equal(Coins.hintsCost(0, 3), 0);
  assert.equal(Coins.hintsCost(2, 3), 1);
  assert.equal(Coins.hintsCost(3, 3), 1 + L);
  assert.equal(Coins.hintsCost(5, 3), 1 + L); // more hints in the save than layers now: no extra charge
});

test('walletFreshPurseGetsOnlyStart', () => {
  let day = '20261011';
  const w = new Wallet(mem(), () => day);
  const S = Coins.START;
  assert.equal(w.balance(), S);
  assert.equal(w.claimDaily(), S);
  assert.equal(w.claimDaily(), S); // same day: nothing more
  day = '20261012';
  assert.equal(w.claimDaily(), S + 1);
  assert.equal(w.claimDaily(), S + 1);
  day = '20261001'; // clock set back
  assert.equal(w.claimDaily(), S + 1);
});

test('walletSpend', () => {
  const w = new Wallet(mem(), () => '20261011');
  const S = Coins.START;
  assert.equal(w.spend(2), true);
  assert.equal(w.balance(), S - 2);
  assert.equal(w.spend(S - 1), false); // too low: nothing deducted
  assert.equal(w.balance(), S - 2);
  assert.equal(w.spend(-1), false);
  assert.equal(w.spend(S - 2), true);
  assert.equal(w.balance(), 0);
});

test('walletRoomRewardOnlyOnce', () => {
  const st = mem();
  const w = new Wallet(st, () => '20261011');
  assert.equal(w.claimRoomReward('archief', 'kelder', 3), 3);
  assert.equal(w.balance(), Coins.START + 3);
  assert.equal(w.claimRoomReward('archief', 'kelder', 3), 0);
  assert.equal(w.claimRoomReward('archief', 'kantoor', 9), 5);
  assert.equal(w.balance(), Coins.START + 8);
  assert.equal(new Wallet(st, () => '20261011').balance(), Coins.START + 8); // persisted
  assert.ok(st.map.has('escaperoom.coins'));
});

test('walletSurvivesGarbage', () => {
  const st = mem();
  st.setItem('escaperoom.coins', '{not json');
  assert.equal(new Wallet(st).balance(), Coins.START);
});

const tiny = parseStory('tiny', JSON.stringify({
  title: 'T', rooms: [{
    id: 'a', title: 'A', task: 't', walls: {},
    things: [{ id: 'g', wall: 'north', x: 0.1, y: 0.1, w: 0.1, h: 0.1, text: 't', gives: { id: 'k', name: 'Key' } }],
    exit: { wall: 'south', x: 0.1, y: 0.1, w: 0.1, h: 0.1, code: '1', text: 'o' },
  }],
}));

test('savesRoundTripAndClear', () => {
  const st = mem();
  const p = new Progress(tiny);
  p.tap('g');
  Saves.save(p, st);
  assert.ok(st.map.has('escaperoom.progress.tiny'));
  const q = Saves.load(tiny, st);
  assert.ok(q.found.has('g') && q.items.has('k'));
  Saves.clear(tiny, st);
  assert.equal(Saves.load(tiny, st).started, false);
});

test('restartKeepsTheMeasurementInStats', () => {
  const st = mem();
  const p = new Progress(tiny);
  p.tap('g'); p.playMs.set('a', 5000);
  Saves.save(p, st);
  Saves.clear(tiny, st);
  assert.equal(Saves.load(tiny, st).started, false);
  const runs = JSON.parse(Saves.history(tiny, st));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].rooms[0].playMs, 5000);
  Saves.clear(tiny, st); // a second Restart of an unstarted story adds no run
  assert.equal(JSON.parse(Saves.history(tiny, st)).length, 1);
});

test('savesUnreadableGivesFreshProgress', () => {
  const st = mem();
  st.setItem('escaperoom.progress.tiny', 'garbage{');
  const origWarn = console.warn;
  console.warn = () => {};
  try { assert.equal(Saves.load(tiny, st).started, false); } finally { console.warn = origWarn; }
});

test('walletHiddenCoinOnlyOnce', () => {
  const st = mem();
  const w = new Wallet(st, () => '20261011');
  assert.equal(w.claimCoin('bakker', 'munt_hout'), 1);
  assert.equal(w.balance(), Coins.START + 1);
  assert.equal(w.claimCoin('bakker', 'munt_hout'), 0); // replaying the story cannot farm it
  assert.equal(w.claimCoin('archief', 'munt_briefje'), 1);
  assert.equal(new Wallet(st, () => '20261011').balance(), Coins.START + 2);
  assert.equal(w.claimRoomReward('bakker', 'munt_hout', 2), 2); // separate from the room rewards
});
