// Mirror of ProgressTest.kt
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress, Coins, Side, ExitAsk, Outcome, Input, CondKind } from '../js/engine.js';
import { z, item, thing, exit, combo, room, story as mkStory, variant, cond } from './_helpers.mjs';

const key = item('k', 'sleutel');
const coin = item('c', 'munt');
const glue = item('g2', 'lijm');
const both = item('kc', 'sleutelmunt');
const giver = thing('g', Side.NORTH, z, 'g', 'je pakt een sleutel', [], null, key);
const coinGiver = thing('cg', Side.NORTH, z, 'cg', 'een munt', [], null, coin);
const locked = thing('l', Side.EAST, z, 'l', 'open', ['k'], 'dicht', null);
const usedUp = thing('u', Side.EAST, z, 'u', 'slot eraf', ['k'], 'dicht', null, { consumes: true });
const two = thing('two', Side.WEST, z, 'two', 'beide', ['k', 'c'], 'dicht', item('tw', 'prijs'));
const twoUsed = thing('tu', Side.WEST, z, 'tu', 'weg', ['k', 'c'], 'dicht', null, { consumes: true });
const safe = thing('safe', Side.WEST, z, 'safe', 'kluis open', [], null, item('gem', 'steen'), { code: 'abc', input: 'letters' });
const dials = thing('dials', Side.WEST, z, 'dials', 'klik', ['k'], 'dicht', null, { code: 'NESW', input: 'dirs' });
const theCombo = combo('k', 'c', both, 'samengevoegd');
const keepCombo = combo('k', 'g2', item('kg', 'x'), 'behouden', false);

const story = mkStory('t', 'nl', 'T', '', '', '', [
  room('a', 'A', 'taak', '', {}, [giver, coinGiver, locked, usedUp, two, twoUsed, safe, dials],
    exit(Side.SOUTH, z, '1234', [], null, 'naar b'),
    { difficulty: 2, hints: ['h1', 'h2'], combos: [theCombo, keepCombo] }),
  room('b', 'B', 'taak', '', {}, [], exit(Side.SOUTH, z, null, ['k'], 'dicht', 'uit'), { difficulty: 2, hints: ['x'] }),
]);
const exitStory = mkStory('e', 'nl', 'E', '', '', '', [
  room('x', 'X', 'taak', '', {}, [giver, coinGiver],
    exit(Side.SOUTH, z, 'RGB', ['k', 'c'], 'dicht', 'klaar', { consumes: true, input: 'colors' })),
]);

test('itemIsTakenOnce', () => {
  const p = new Progress(story);
  assert.deepEqual(p.tap(giver).gained, key);
  assert.equal(p.tap(giver).gained, undefined);
  assert.equal(p.items.size, 1);
});

test('blockedWithoutSelection', () => {
  const p = new Progress(story);
  p.tap(giver);
  const o = p.tap(locked);
  assert.equal(o.kind, 'blocked');
  assert.equal(o.text, 'dicht');
  assert.ok(!p.found.has('l'));
  p.select('k');
  assert.equal(p.tap(locked).kind, 'said');
  assert.ok(p.found.has('l'));
  assert.equal(p.selected, null); // hand empty after use, consumed or not
});

test('selectionClearsAfterUse', () => {
  const p = new Progress(story);
  p.tap(giver); p.tap(coinGiver); p.select('k');
  assert.equal(p.tap(locked).kind, 'said');
  assert.equal(p.selected, null);
  assert.ok(p.items.has('k')); // not consumed: still held, only the hand is empty
  // Tapping on: no hanging key, so this is blocked and not a measured fault.
  assert.equal(p.tap(two).kind, 'blocked');
  assert.equal(p.mistakes.get('a'), undefined);
  p.select('k');
  assert.equal(p.tap(two).kind, 'applied');
  assert.equal(p.selected, null);
});

test('blockedWithoutStuckSaysItsLabel', () => {
  const p = new Progress(story);
  const mute = thing('m', Side.EAST, z, 'Een kist met een pijlenslot.', 'open', ['k'], null, null);
  const empty = thing('e', Side.EAST, z, 'Een la', 'open', ['k'], '', null);
  assert.deepEqual(p.tap(mute), Outcome.blocked('Een kist met een pijlenslot.'));
  assert.deepEqual(p.tap(empty), Outcome.blocked('Een la'));
  assert.deepEqual(p.tap(locked), Outcome.blocked('dicht')); // a stuck text still wins
});

test('wrongItemIsWrong', () => {
  const p = new Progress(story);
  p.tap(giver); p.tap(coinGiver);
  p.select('c');
  assert.deepEqual(p.tap(locked), Outcome.wrong());
  assert.ok(!p.found.has('l'));
});

test('selectToggleAndOnlyHeld', () => {
  const p = new Progress(story);
  p.select('k');
  assert.equal(p.selected, null);
  p.tap(giver);
  p.select('k'); assert.equal(p.selected, 'k');
  p.select('k'); assert.equal(p.selected, null);
  p.select('k'); p.select(null); assert.equal(p.selected, null);
});

test('reopeningNeedsNoSelection', () => {
  const p = new Progress(story);
  p.tap(giver); p.select('k'); p.tap(locked); p.select(null);
  assert.equal(p.tap(locked).text, 'open');
});

test('noNeedsKeepsSelection', () => {
  const p = new Progress(story);
  p.tap(giver); p.select('k');
  p.tap(coinGiver);
  assert.equal(p.selected, 'k');
});

test('consumesUsesUpItem', () => {
  const p = new Progress(story);
  p.tap(giver); p.select('k');
  assert.equal(p.tap(usedUp).kind, 'said');
  assert.ok(!p.items.has('k'));
  assert.equal(p.selected, null);
});

test('combineKeepsOrderFree', () => {
  const p = new Progress(story);
  p.tap(giver); p.tap(coinGiver); p.select('k');
  const o = p.combine('c', 'k');
  assert.equal(o.kind, 'said');
  assert.deepEqual(o.gained, both);
  assert.equal(o.text, 'samengevoegd');
  assert.ok(!p.items.has('k')); assert.ok(!p.items.has('c'));
  assert.ok(p.items.has('kc'));
  assert.equal(p.selected, null);
});

test('combineWithoutConsumeKeepsInputs', () => {
  const p = new Progress(story);
  p.tap(giver);
  p.items.set('g2', glue);
  assert.equal(p.combine('k', 'g2').kind, 'said');
  assert.ok(p.items.has('k') && p.items.has('g2') && p.items.has('kg'));
});

test('combineWrong', () => {
  const p = new Progress(story);
  p.tap(giver);
  assert.deepEqual(p.combine('k', 'c'), Outcome.wrong()); // not held
  p.tap(coinGiver);
  p.items.set('g2', glue);
  assert.deepEqual(p.combine('c', 'g2'), Outcome.wrong()); // no such combo
  assert.equal(p.items.size, 3);
});

test('codeAndExit', () => {
  const p = new Progress(story);
  assert.equal(p.exitAsk(), ExitAsk.ENTER_CODE);
  assert.equal(p.checkCode('0000'), false);
  assert.equal(p.checkCode(' 1234 '), true);
  assert.equal(p.leave(), 'naar b');
  assert.equal(p.roomIndex, 1);
  assert.equal(p.exitAsk(), ExitAsk.BLOCKED);
});

test('exitNeedsSelectedItem', () => {
  const p = new Progress(story);
  p.tap(giver); p.tap(coinGiver);
  p.leave();
  assert.equal(p.exitAsk(), ExitAsk.BLOCKED);
  p.select('c');
  assert.equal(p.exitAsk(), ExitAsk.WRONG);
  p.select('k');
  assert.equal(p.exitAsk(), ExitAsk.OPEN);
});

test('finishedAfterLastRoom', () => {
  const p = new Progress(story);
  p.tap(giver);
  p.leave();
  p.select('k');
  assert.equal(p.finished, false);
  assert.equal(p.exitAsk(), ExitAsk.OPEN);
  assert.equal(p.leave(), 'uit');
  assert.equal(p.finished, true);
  assert.equal(p.roomIndex, 1);
});

test('leaveClearsSelectionAndSide', () => {
  const p = new Progress(story);
  p.tap(giver); p.select('k'); p.look(Side.WEST);
  p.leave();
  assert.equal(p.selected, null);
  assert.equal(p.side, Side.NORTH);
});

test('hintsRevealInOrderPerRoom', () => {
  const p = new Progress(story);
  assert.ok(p.hintAvailable());
  assert.deepEqual(p.hintsShown(), []);
  assert.equal(p.revealHint(), 'h1');
  assert.deepEqual(p.hintsShown(), ['h1']);
  assert.equal(p.revealHint(), 'h2');
  assert.equal(p.hintAvailable(), false);
  assert.equal(p.revealHint(), null);
  assert.equal(p.hintsUsed(), 2);
  assert.equal(p.hintCoinsSpent(), Coins.LAST_LAYER_COST);
  p.leave();
  assert.deepEqual(p.hintsShown(), []);
  assert.equal(p.revealHint(), 'x');
  assert.equal(p.hintsUsed(), 3);
  assert.equal(p.hintCoinsSpent(), Coins.LAST_LAYER_COST);
});

test('roomCounts', () => {
  const p = new Progress(story);
  assert.equal(p.thingsInRoom(), 8);
  assert.equal(p.foundInRoom(), 0);
  p.tap(giver);
  assert.equal(p.foundInRoom(), 1);
});

test('foundOnSide', () => {
  const p = new Progress(story);
  assert.equal(p.foundOnSide(Side.NORTH), false);
  p.tap(giver);
  assert.equal(p.foundOnSide(Side.NORTH), false); // coinGiver still shut
  p.tap(coinGiver);
  assert.equal(p.foundOnSide(Side.NORTH), true);
  assert.equal(p.foundOnSide(Side.EAST), false);
  assert.equal(p.foundOnSide(Side.SOUTH), true); // no things there, only the exit
});

test('startedFollowsFoundRoomAndFinished', () => {
  const p = new Progress(story);
  assert.equal(p.started, false);
  p.tap(giver);
  assert.equal(p.started, true);
});

test('jsonRoundTrip', () => {
  const p = new Progress(story);
  p.tap(giver);
  p.select('k');
  p.tap(locked);
  p.revealHint();
  p.look(Side.EAST);
  const q = Progress.fromJson(story, p.toJson());
  assert.equal(q.side, Side.EAST);
  assert.deepEqual(q.hintsShown(), ['h1']);
  assert.equal(q.hintsUsed(), 1);
  assert.equal(q.selected, null); // not saved
  assert.deepEqual([...q.found], [...p.found]);
  assert.deepEqual([...q.items.keys()], [...p.items.keys()]);
  assert.equal(q.items.get('k').name, 'sleutel');
  p.leave();
  const r = Progress.fromJson(story, p.toJson());
  assert.equal(r.roomIndex, 1);
  assert.equal(r.side, Side.NORTH);
  assert.equal(r.finished, false);
  r.select('k');
  r.leave();
  assert.equal(Progress.fromJson(story, r.toJson()).finished, true);
});

test('saveShapeEqualsKotlin', () => {
  const p = new Progress(story);
  p.tap(giver); p.select('c'); p.revealHint();
  const o = JSON.parse(p.toJson());
  assert.deepEqual(Object.keys(o), ['room', 'finished', 'items', 'found', 'hits', 'applied', 'side', 'hints', 'playMs', 'mistakes', 'stepMs']);
  assert.deepEqual(o, {
    room: 0, finished: false, items: [{ id: 'k', name: 'sleutel' }], found: ['g'], hits: [], applied: {}, side: 'north', hints: { a: 1 },
    playMs: {}, mistakes: {}, stepMs: { a: 0 }, // stepMs: playMs at the last step (opened, hint), here 0
  });
});

test('oldSaveStillLoads', () => {
  const old = '{"room":1,"finished":false,"items":[{"id":"k","name":"sleutel"}],"found":["g"]}';
  const p = Progress.fromJson(story, old);
  assert.equal(p.roomIndex, 1);
  assert.equal(p.side, Side.NORTH);
  assert.equal(p.hintsUsed(), 0);
  assert.ok(p.items.has('k'));
});

test('saveItemWithoutNameIsRejected', () => {
  assert.throws(() => Progress.fromJson(story, '{"room":0,"items":[{"id":"k"}]}'));
});

test('roomIndexIsClamped', () => {
  assert.equal(Progress.fromJson(story, '{"room":9}').roomIndex, 1);
  assert.equal(Progress.fromJson(story, '{"room":-3}').roomIndex, 0);
});

test('listNeedsAppliedOneByOneInAnyOrder', () => {
  const p = new Progress(story);
  p.tap(giver); p.tap(coinGiver);
  assert.deepEqual(p.tap(two), Outcome.blocked('dicht'));
  p.select('c');
  assert.deepEqual(p.tap(two), Outcome.applied('c', 1));
  assert.ok(!p.found.has('two'));
  assert.deepEqual(p.tap(two), Outcome.blocked('dicht')); // hand empty after use
  p.select('c');
  assert.deepEqual(p.tap(two), Outcome.wrong()); // c is already applied
  assert.ok(p.items.has('c')); // not consumed
  p.select('k');
  const o = p.tap(two);
  assert.equal(o.kind, 'said');
  assert.equal(o.gained.name, 'prijs');
  assert.ok(p.found.has('two'));
});

test('listNeedsWrongItemAndConsumes', () => {
  const p = new Progress(story);
  p.tap(giver); p.tap(coinGiver);
  p.items.set('g2', glue);
  p.select('g2');
  assert.deepEqual(p.tap(twoUsed), Outcome.wrong());
  p.select('k');
  assert.deepEqual(p.tap(twoUsed), Outcome.applied('k', 1));
  assert.ok(!p.items.has('k')); // consumed on application
  assert.equal(p.selected, null);
  p.select('c');
  assert.equal(p.tap(twoUsed).kind, 'said');
  assert.ok(!p.items.has('c'));
});

test('needsCodeAndTryCode', () => {
  const p = new Progress(story);
  const o = p.tap(safe);
  assert.deepEqual(o, Outcome.needsCode(safe));
  assert.ok(!p.found.has('safe'));
  assert.deepEqual(p.tryCode(safe, 'abd'), Outcome.wrong());
  assert.ok(!p.found.has('safe'));
  const ok = p.tryCode(safe, ' AbC '); // letters: case-insensitive
  assert.equal(ok.kind, 'said');
  assert.equal(ok.text, 'kluis open');
  assert.equal(ok.gained.name, 'steen');
  assert.ok(p.found.has('safe'));
  assert.equal(p.tap(safe).text, 'kluis open'); // found: no code again
});

test('codeAfterNeeds', () => {
  const p = new Progress(story);
  assert.deepEqual(p.tap(dials), Outcome.blocked('dicht'));
  p.tap(giver); p.select('k');
  assert.deepEqual(p.tap(dials), Outcome.needsCode(dials));
  assert.deepEqual(p.tap(dials), Outcome.needsCode(dials)); // already applied: asks the code again
  assert.deepEqual(p.tryCode(dials, 'NESN'), Outcome.wrong());
  assert.equal(p.tryCode(dials, 'nesw').kind, 'said');
});

test('exitWithListNeedsAndCode', () => {
  const p = new Progress(exitStory);
  p.tap(giver); p.tap(coinGiver);
  assert.equal(p.tapExit(), ExitAsk.BLOCKED);
  p.select('k');
  assert.equal(p.tapExit(), ExitAsk.PARTIAL);
  assert.ok(!p.items.has('k')); // exit consumes
  assert.equal(p.exitAsk(), ExitAsk.BLOCKED);
  p.select('k');
  assert.equal(p.exitAsk(), ExitAsk.BLOCKED); // not held any more
  p.select('c');
  assert.equal(p.exitAsk(), ExitAsk.ENTER_CODE); // pure question: nothing applied
  assert.ok(p.items.has('c'));
  assert.equal(p.tapExit(), ExitAsk.ENTER_CODE);
  assert.equal(p.checkCode('RGG'), false);
  assert.equal(p.checkCode('rgb'), true);
  assert.equal(p.exitAsk(), ExitAsk.ENTER_CODE);
});

test('exitNeedsKeepItemsWithoutConsumes', () => {
  const p = new Progress(story);
  p.tap(giver); p.tap(coinGiver);
  p.leave();
  p.select('c');
  assert.equal(p.tapExit(), ExitAsk.WRONG);
  p.select('k');
  assert.equal(p.tapExit(), ExitAsk.OPEN);
  assert.ok(p.items.has('k'));
  assert.equal(p.exitAsk(), ExitAsk.OPEN);
});

test('jsonRoundTripKeepsApplied', () => {
  const p = new Progress(exitStory);
  p.tap(giver); p.tap(coinGiver);
  p.select('k'); p.tapExit();
  const twoP = new Progress(story);
  twoP.tap(giver); twoP.tap(coinGiver); twoP.select('c'); twoP.tap(two);
  const q = Progress.fromJson(story, twoP.toJson());
  assert.deepEqual([...q.applied.get('two')], ['c']);
  q.tap(giver);
  q.select('k');
  assert.equal(q.tap(two).kind, 'said'); // only k was missing
  const r = Progress.fromJson(exitStory, p.toJson());
  assert.deepEqual([...r.applied.get('exit:x')], ['k']);
  r.select('c');
  assert.equal(r.tapExit(), ExitAsk.ENTER_CODE);
});

test('allNotesOverReachedRooms', () => {
  const p = new Progress(story);
  assert.equal(p.allNotes().length, 0);
  p.tap(giver);
  p.leave();
  const all = p.allNotes();
  assert.equal(all.length, 1); // room b has no notes
  assert.equal(all[0][0].id, 'a');
  assert.deepEqual(all[0][1], ['je pakt een sleutel']);
  assert.equal(all[0].room.id, 'a');
  p.select('k');
  p.leave();
  assert.equal(p.finished, true);
  assert.equal(p.allNotes().length, 1);
});

test('journalKeepsWhatWasRead', () => {
  const s = mkStory('j', 'nl', 'J', '', '', '', [
    room('a', 'A', 'taak', 'binnen in a', {}, [giver], exit(Side.SOUTH, z, null, [], null, 'weg uit a')),
    room('b', 'B', 'taak', 'binnen in b', {}, [], exit(Side.SOUTH, z, null, [], null, 'weg uit b')),
    room('c', 'C', 'taak', '', {}, [], exit(Side.SOUTH, z, null, [], null, '')),
  ]);
  const p = new Progress(s);
  const first = p.journal();
  assert.equal(first.length, 1); // only the room you are in
  assert.equal(first[0].intro, 'binnen in a');
  assert.deepEqual(first[0].notes, []);
  assert.equal(first[0].exit, null); // not read yet
  p.tap(giver);
  p.leave();
  const second = p.journal();
  assert.deepEqual(second.map((x) => x.room.id), ['a', 'b']);
  assert.deepEqual(second[0].notes, ['je pakt een sleutel']);
  assert.equal(second[0].exit, 'weg uit a');
  assert.equal(second[1].exit, null);
  p.leave();
  assert.equal(p.journal().length, 2); // c has no intro, notes or exit text
  p.leave();
  assert.equal(p.finished, true);
  assert.equal(p.journal()[1].exit, 'weg uit b');
});

test('sequenceInput', () => {
  assert.ok(Input.SEQUENCE.valid('smhdtc'));
  assert.ok(!Input.SEQUENCE.valid('SMX'));
  assert.equal(Input.parse('sequence'), Input.SEQUENCE);
  const seq = mkStory('q', 'nl', 'Q', '', '', '', [
    room('x', 'X', 'taak', '', {}, [], exit(Side.SOUTH, z, 'SMHT', [], null, 'klaar', { input: 'sequence' })),
  ]);
  const p = new Progress(seq);
  assert.equal(seq.rooms[0].exit.len, 4);
  assert.equal(p.checkCode('SMTH'), false); // same tokens, wrong order
  assert.equal(p.checkCode('SMH'), false);
  assert.equal(p.checkCode('smht'), true);
  assert.equal(p.checkCode(' SMHT '), true);
});

test('inputTypes', () => {
  assert.ok(Input.DIGITS.valid('0123'));
  assert.ok(!Input.DIGITS.valid('12a'));
  assert.ok(Input.LETTERS.valid('abz'));
  assert.ok(Input.DIRS.valid('nesw'));
  assert.ok(!Input.DIRS.valid('NX'));
  assert.ok(Input.COLORS.valid('rgbywk'));
  assert.ok(!Input.COLORS.valid('RGBX'));
  assert.equal(Input.parse('dirs'), Input.DIRS);
  assert.equal(Input.parse(null), Input.DIGITS);
  assert.equal(Input.parse('nonsense'), Input.DIGITS);
  assert.ok(Input.known('colors') && !Input.known('x'));
});

test('sideTurn', () => {
  assert.equal(Side.turn(Side.NORTH, 1), Side.EAST);
  assert.equal(Side.turn(Side.NORTH, -1), Side.WEST);
  assert.equal(Side.turn(Side.WEST, 1), Side.NORTH);
  assert.throws(() => Side.of('up'));
});

test('notesFollowRoomOrder', () => {
  const p = new Progress(story);
  p.tap(giver);
  p.select('k');
  p.tap(locked);
  assert.deepEqual(p.notes(), ['je pakt een sleutel', 'open']);
});

const uvMark = thing('mark', Side.NORTH, z, 'm', 'uv-cijfers', [], null, null, { visibleWhen: cond(CondKind.SELECTED, 'k') });
const heldMark = thing('hm', Side.NORTH, z, 'h', 'x', [], null, null, { visibleWhen: cond(CondKind.HELD, 'c') });
const foundMark = thing('fm', Side.NORTH, z, 'f', 'x', [], null, null, { visibleWhen: cond(CondKind.FOUND, 'g') });
const vStory = mkStory('v', 'nl', 'V', '', '', '', [
  room('a', 'A', 't', '', {}, [giver, coinGiver, uvMark, heldMark, foundMark],
    exit(Side.SOUTH, z, '1', [], null, 'o'),
    {
      variants: [
        variant(Side.NORTH, cond(CondKind.SELECTED, 'k'), 'north-uv'),
        variant(Side.NORTH, cond(CondKind.FOUND, 'g'), 'north-late'),
        variant(Side.EAST, cond(CondKind.HELD, 'c'), 'east-c'),
      ],
    }),
]);

test('visibilityFollowsSelectedHeldFound', () => {
  const p = new Progress(vStory);
  assert.deepEqual(p.thingsOnSide(Side.NORTH), [giver, coinGiver]);
  assert.deepEqual(p.tap(uvMark), Outcome.wrong());
  p.tap(giver);
  assert.ok(!p.visible(uvMark)); // held is not selected
  p.select('k');
  // giver is opened (found), so the found-mark shows too
  assert.deepEqual(p.thingsOnSide(Side.NORTH), [giver, coinGiver, uvMark, foundMark]);
  assert.equal(p.tap(uvMark).kind, 'said');
  p.select('k'); // deselect
  assert.ok(!p.visible(uvMark));
  assert.ok(!p.visible(heldMark));
  p.tap(coinGiver);
  assert.ok(p.visible(heldMark));
});

test('variantImagePicksFirstHolding', () => {
  const p = new Progress(vStory);
  assert.equal(p.variantImage(Side.NORTH), null);
  p.tap(giver);
  assert.equal(p.variantImage(Side.NORTH), 'north-late');
  p.select('k');
  assert.equal(p.variantImage(Side.NORTH), 'north-uv'); // first listed wins
  assert.equal(p.variantImage(Side.EAST), null);
  p.tap(coinGiver);
  assert.equal(p.variantImage(Side.EAST), 'east-c');
  assert.equal(p.variantImage(Side.SOUTH), null);
});

test('hiddenExitIsRefused', () => {
  const hidden = exit(Side.SOUTH, z, null, [], null, 'o', { visibleWhen: cond(CondKind.HELD, 'k') });
  const p = new Progress(mkStory('h', 'nl', 'H', '', '', '', [room('a', 'A', 't', '', {}, [giver], hidden)]));
  assert.equal(p.exitVisible(), false);
  assert.equal(p.tapExit(), ExitAsk.WRONG);
  p.tap(giver);
  assert.equal(p.tapExit(), ExitAsk.OPEN);
});

const rummage = thing('r', Side.NORTH, z, 'r', 'onder de rommel', [], null, item('rk', 'kistsleutel'), {
  closeup: 'r-zoek',
  search: [{ id: 'a', name: 'klomp', zone: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }, { id: 'b', name: 'theepot', zone: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } }],
});
const searchStory = () => new Progress(mkStory('s', 'nl', 'S', '', '', '', [
  room('a', 'A', 't', '', {}, [rummage], exit(Side.SOUTH, z, '1', [], null, 'uit')),
]));

test('searchPlateOpensOnlyWhenEverythingIsFound', () => {
  const p = searchStory();
  assert.deepEqual(p.tap(rummage), Outcome.search(rummage));
  assert.equal(p.searchTap(rummage, 0.9, 0.9).kind, 'miss');
  assert.equal(p.mistakes.size, 0); // a miss is no fault
  assert.equal(p.searchTap(rummage, 0.15, 0.15).kind, 'hit');
  assert.equal(p.searchTap(rummage, 0.15, 0.15).kind, 'again');
  assert.equal(p.searchLeft(rummage), 1);
  assert.ok(!p.found.has('r'));
  const done = p.searchTap(rummage, 0.55, 0.55);
  assert.equal(done.kind, 'done');
  assert.equal(done.said.text, 'onder de rommel');
  assert.ok(p.found.has('r') && p.items.has('rk'));
});

test('lastHitOnALockedSearchPlateDoesNotOpenIt', () => {
  const locked = { ...rummage, code: '42', text: 'deksel' };
  const p = new Progress(mkStory('s', 'nl', 'S', '', '', '', [
    room('a', 'A', 't', '', {}, [locked], exit(Side.SOUTH, z, '1', [], null, 'uit')),
  ]));
  p.searchTap(locked, 0.15, 0.15);
  const done = p.searchTap(locked, 0.55, 0.55);
  assert.equal(done.kind, 'done');
  assert.equal(done.said.text, 'deksel');
  assert.ok(!p.found.has('r') && !p.items.has('rk'));
  assert.equal(p.tap(locked).kind, 'needsCode');
  assert.equal(p.tryCode(locked, '42').kind, 'said');
  assert.ok(p.items.has('rk'));
});

test('searchHitsSurviveASave', () => {
  const p = searchStory();
  p.searchTap(rummage, 0.15, 0.15);
  const back = Progress.fromJson(p.story, p.toJson());
  assert.ok(back.isHit(rummage, rummage.search[0]));
  assert.equal(back.searchLeft(rummage), 1);
  assert.deepEqual(back.tap(rummage), Outcome.search(rummage));
});

// Keys on a close-up: keyAt finds the key under a tap; the code goes to tryCode like a typed one.
test('keysOnThePlateEnterTheCode', () => {
  const kist = thing('k', Side.NORTH, z, 'Kistje', 'open', [], null, item('b', 'brief'), {
    code: 'NE', input: 'dirs', closeup: 'kistje',
    keys: [{ token: 'N', zone: { x: 0.4, y: 0.1, w: 0.2, h: 0.2 } }, { token: 'E', zone: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }],
  });
  const p = new Progress(mkStory('s', 'nl', 'S', '', '', '', [
    room('a', 'A', 't', '', {}, [kist], exit(Side.SOUTH, z, '1', [], null, 'uit')),
  ]));
  assert.equal(p.tap(kist).kind, 'needsCode');
  assert.equal(p.keyAt(kist, 0.05, 0.05), null); // beside every key: nothing, and no fault
  const faults = () => [...p.mistakes.values()].reduce((a, b) => a + b, 0);
  assert.equal(faults(), 0);
  const code = [p.keyAt(kist, 0.5, 0.45), p.keyAt(kist, 0.5, 0.2)].map((k) => k.token).join('');
  assert.equal(code, 'EN');
  assert.equal(p.tryCode(kist, code).kind, 'wrong');
  assert.equal(faults(), 1);
  assert.equal(p.tryCode(kist, 'NE').kind, 'said');
  assert.ok(p.items.has('b'));
  assert.equal(p.keyAt(kist, 0.5, 0.2), null); // open: the keys are dead
});
