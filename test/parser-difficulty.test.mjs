// Mirror of ParserDifficultyTest.kt
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, parseCond, Difficulty, Input, Side, CondKind } from '../js/engine.js';

const room = `{"id":"a","title":"A","task":"t","walls":{"north":"n","east":"e","south":"s","west":"w"},
  "difficulty":3,"hints":["h1","h2"],
  "things":[
    {"id":"k","wall":"north","x":0.1,"y":0.1,"w":0.1,"h":0.1,"text":"t","gives":{"id":"key","name":"Key"}},
    {"id":"c","wall":"north","x":0.5,"y":0.1,"w":0.1,"h":0.1,"text":"t","gives":{"id":"coin","name":"Coin"}},
    {"id":"l","wall":"east","x":0.1,"y":0.1,"w":0.1,"h":0.1,"text":"t","needs":"both","stuck":"s","consumes":true,"gives":{"id":"z","name":"Z"}}],
  "combos":[{"a":"key","b":"coin","gives":{"id":"both","name":"Both"},"text":"x"}],
  "exit":{"wall":"south","x":0.1,"y":0.1,"w":0.1,"h":0.1,"needs":"z","stuck":"s","text":"out"}}`;

const story = (extra = '') => parseStory('s', `{"title":"T",${extra}"rooms":[${room}]}`);

test('defaultsAndFields', () => {
  const s = story();
  assert.equal(s.format, 1);
  assert.equal(s.difficulty, 1);
  const r = s.rooms[0];
  assert.equal(r.difficulty, 3);
  assert.deepEqual(r.hints, ['h1', 'h2']);
  assert.deepEqual(r.combos[0], { a: 'key', b: 'coin', gives: { id: 'both', name: 'Both' }, text: 'x', consumes: true });
  assert.equal(r.things[2].consumes, true);
  assert.equal(r.things[0].consumes, false);
  assert.equal(r.captions.north, 'n');
  assert.equal(r.things[0].side, 'north');
  assert.deepEqual(r.things[0].zone, { x: 0.1, y: 0.1, w: 0.1, h: 0.1 });
});

test('needsStringOrArrayAndOwnLocks', () => {
  const r = parseStory('s', `{"title":"T","rooms":[{"id":"a","title":"A","task":"t","walls":{},
    "things":[
      {"id":"s","wall":"north","x":0.1,"y":0.1,"w":0.1,"h":0.1,"text":"t","needs":"a","stuck":"x"},
      {"id":"m","wall":"north","x":0.3,"y":0.1,"w":0.1,"h":0.1,"text":"t","needs":["a","b"],"stuck":"x",
       "code":"NESW","input":"dirs","closeup":"lock"},
      {"id":"n","wall":"north","x":0.5,"y":0.1,"w":0.1,"h":0.1,"text":"t","code":1234}],
    "exit":{"wall":"south","x":0.1,"y":0.1,"w":0.1,"h":0.1,"needs":["a","b"],"code":"rgb","input":"colors","len":3,"consumes":true,"stuck":"x","text":"o"}}]}`).rooms[0];
  assert.deepEqual(r.things[0].needs, ['a']);
  assert.deepEqual(r.things[1].needs, ['a', 'b']);
  assert.deepEqual(r.things[2].needs, []);
  assert.equal(r.things[1].input, 'dirs');
  assert.equal(r.things[1].inputType, Input.DIRS);
  assert.equal(r.things[1].len, 4);
  assert.equal(r.things[1].closeup, 'lock');
  assert.equal(r.things[2].input, 'digits');
  assert.equal(r.things[2].len, 4);
  assert.equal(r.things[2].code, '1234');
  assert.deepEqual(r.exit.needs, ['a', 'b']);
  assert.equal(r.exit.inputType, Input.COLORS);
  assert.equal(r.exit.consumes, true);
  assert.equal(r.exit.len, 3);
  // analyse: a, b, a, b needed on things (1 + 2) plus two on the exit
  assert.equal(Difficulty.analyse({ id: 's', rooms: [r] })[0].locks, 5);
});

test('readsStoryFields', () => {
  assert.equal(story('"format":1,"difficulty":4,').difficulty, 4);
});

test('newerFormatRejected', () => {
  assert.throws(() => story('"format":2,'), /format 2 not supported/);
});

test('analyseChain', () => {
  const st = Difficulty.analyse(story())[0];
  // exit <- z <- l(needs both) <- combo(key,coin) <- plain givers: 1 + 1 + 1 = 3
  assert.equal(st.chain, 3);
  assert.equal(st.things, 3);
  assert.equal(st.locks, 2);
  // ceil(1.8 + 3 + 0.5 + 1 + 0.8) = 8
  assert.equal(st.estMinutes, 8);
  assert.equal(Difficulty.storyMinutes(story()), 8);
  assert.ok(Difficulty.band(3).contains(st.estMinutes));
});

test('bands', () => {
  assert.deepEqual([Difficulty.band(1).min, Difficulty.band(1).max], [2, 6]);
  assert.deepEqual([Difficulty.band(5).min, Difficulty.band(5).max], [12, 25]);
  assert.deepEqual([Difficulty.band(0).min, Difficulty.band(9).max], [2, 25]);
});

test('parsesConditionsAndVariants', () => {
  const r = parseStory('s', `{"title":"T","rooms":[{"id":"a","title":"A","task":"t","walls":{},
    "variants":[{"wall":"north","when":{"selected":"uvlamp"},"image":"north-uv"},{"wall":"east","when":{"found":"x"},"image":"e"}],
    "things":[{"id":"m","wall":"north","x":0.1,"y":0.1,"w":0.1,"h":0.1,"text":"t","visible":{"held":"uvlamp"},"code":"1234"}],
    "exit":{"wall":"south","x":0.1,"y":0.1,"w":0.1,"h":0.1,"code":"1","text":"o","visible":{"found":"m"}}}]}`).rooms[0];
  assert.equal(r.variants[0].side, Side.NORTH);
  assert.deepEqual(r.variants[0].when, { kind: CondKind.SELECTED, id: 'uvlamp' });
  assert.equal(r.variants[0].image, 'north-uv');
  assert.deepEqual(r.variants[1].when, { kind: CondKind.FOUND, id: 'x' });
  assert.deepEqual(r.things[0].visibleWhen, { kind: CondKind.HELD, id: 'uvlamp' });
  assert.deepEqual(r.exit.visibleWhen, { kind: CondKind.FOUND, id: 'm' });
  assert.deepEqual(story().rooms[0].variants, []);
});

test('conditionNeedsExactlyOneKey', () => {
  assert.throws(() => parseCond({ held: 'a', found: 'b' }));
  assert.throws(() => parseCond({}));
  assert.throws(() => parseCond({ held: 'a', extra: 1 }));
});

test('analyseCountsCodesHiddenAndVariants', () => {
  const base = story().rooms[0];
  const t = { ...base.things[0], code: '12', visibleWhen: { kind: CondKind.HELD, id: 'key' } };
  const r = {
    ...base, things: [t, ...base.things.slice(1)],
    variants: [{ side: Side.NORTH, when: { kind: CondKind.HELD, id: 'key' }, image: 'n' }],
  };
  // 1.8 + 3 + 0.5 + 1 + 0.8 + 1.0 + 0.5 + 0.3 = 8.9 -> 9
  assert.equal(Difficulty.analyse({ id: 's', rooms: [r] })[0].estMinutes, 9);
});
