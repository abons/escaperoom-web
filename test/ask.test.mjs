// Mirror of AskTest.kt: `ask`, a fill-in conclusion on a thing or the exit, asked after the needs and before the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, Progress, ExitAsk, Difficulty, askRight } from '../js/engine.js';

const json = JSON.stringify({
  title: 'T', rooms: [{ id: 'r', title: 'R', task: 't', walls: {},
    things: [
      { id: 'brief', wall: 'north', x: 0.1, y: 0.1, w: 0.2, h: 0.2, text: 'Open.',
        ask: { text: 'Wie? ___. Waarom? ___.', words: ['Rob', 'Fien', 'feest', 'ongeluk'], answer: ['Rob', 'feest'] } },
      { id: 'kist', wall: 'east', x: 0.1, y: 0.1, w: 0.2, h: 0.2, text: 'Kist open.', code: '12',
        ask: { text: 'Wat? ___.', words: ['a', 'b'], answer: ['b'] } },
    ],
    exit: { wall: 'south', x: 0.4, y: 0.4, w: 0.2, h: 0.2, code: '7', text: 'Weg.',
      ask: { text: 'Wie wacht? ___.', words: ['gasten', 'niemand'], answer: ['gasten'] } } }],
});
const story = () => parseStory('s', json);
const plain = () => parseStory('s', json.replaceAll('"ask"', '"_ask"'));

test('parsesAsk', () => {
  const r = story().rooms[0];
  const a = r.things[0].ask;
  assert.equal(a.gaps, 2);
  assert.deepEqual(a.words, ['Rob', 'Fien', 'feest', 'ongeluk']);
  assert.deepEqual(a.answer, ['Rob', 'feest']);
  assert.deepEqual(r.exit.ask.answer, ['gasten']);
  assert.ok(askRight(a, ['Rob', ' feest ']));
  assert.ok(!askRight(a, ['feest', 'Rob'])); // per gap, not as a set
  assert.ok(!askRight(a, ['Rob']));
  assert.equal(plain().rooms[0].things[0].ask, null);
});

test('wrongIsOneMistakeRightOpens', () => {
  const p = new Progress(story());
  const brief = p.room.things[0];
  assert.equal(p.tap(brief).kind, 'needsAsk');
  assert.deepEqual(p.tryAsk(brief, ['Fien', 'feest']), { kind: 'wrong' });
  assert.equal(p.mistakes.get('r'), 1);
  assert.ok(!p.found.has('brief'));
  const o = p.tryAsk(brief, ['Rob', 'feest']);
  assert.equal(o.kind, 'said');
  assert.equal(o.text, 'Open.');
  assert.ok(p.found.has('brief'));
  assert.equal(p.mistakes.get('r'), 1);
});

test('askComesBeforeTheCodeAndIsRemembered', () => {
  const p = new Progress(story());
  const kist = p.room.things[1];
  assert.equal(p.tap(kist).kind, 'needsAsk');
  assert.equal(p.tryAsk(kist, ['b']).kind, 'needsCode');
  assert.equal(p.tap(kist).kind, 'needsCode'); // answered: straight to the code
  const q = Progress.fromJson(story(), p.toJson());
  assert.equal(q.tap('kist').kind, 'needsCode'); // saved
  assert.equal(q.tryCode('kist', '12').kind, 'said');
});

test('exitAsksFirstThenTheCode', () => {
  const p = new Progress(story());
  assert.equal(p.exitAsk(), ExitAsk.ASK);
  assert.equal(p.tapExit(), ExitAsk.ASK);
  assert.equal(p.checkAsk(['niemand']), false);
  assert.equal(p.mistakes.get('r'), 1);
  assert.equal(p.checkAsk(['gasten']), true);
  assert.equal(p.tapExit(), ExitAsk.ENTER_CODE);
  assert.equal(Progress.fromJson(story(), p.toJson()).exitAsk(), ExitAsk.ENTER_CODE);
});

test('oldSaveWithoutAskedLoads', () => {
  const p = Progress.fromJson(story(), '{"room":0,"found":[]}');
  assert.equal(p.asked.size, 0);
  assert.equal(p.exitAsk(), ExitAsk.ASK);
});

test('tourHasEveryAskAnswered', () => {
  const p = Progress.tour(story(), 0);
  assert.equal(p.exitAsk(), ExitAsk.OPEN);
  assert.ok(p.asked.has('brief') && p.asked.has('exit:r'));
});

test('eachAskCountsAMinuteInTheEstimate', () => {
  // 2 things * 0.6 + 1.5 + 1 + 1.0 code = 4.7 -> 5; three asks add 3.0 -> 7.7 -> 8
  assert.equal(Difficulty.analyse(plain())[0].estMinutes, 5);
  assert.equal(Difficulty.analyse(story())[0].estMinutes, 8);
});
