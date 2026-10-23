// Mirror of DoorsTest.kt: doors with a destination (../escaperoom/docs/besluiten/deuren.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, Progress, Side, ExitAsk, Difficulty } from '../js/engine.js';

const zone = (x, y, w, h) => ({ x, y, w, h });
const fixture = () => parseStory('d', {
  format: 2, title: 'D',
  rooms: [
    {
      id: 'a', title: 'A', task: 't', intro: 'binnen in a', walls: {},
      things: [{ id: 'bon', wall: 'west', ...zone(0.1, 0.1, 0.2, 0.2), text: 'twaalf gasten' }],
      exit: { wall: 'south', ...zone(0.1, 0.1, 0.2, 0.2), code: '12', text: 'naar b', arrive: 'east' },
    },
    {
      id: 'b', title: 'B', task: 't', intro: 'binnen in b', walls: {},
      exit: { wall: 'south', ...zone(0.1, 0.1, 0.2, 0.2), code: '60', text: 'uit' },
      exits: [{ id: 'terug', wall: 'east', ...zone(0.5, 0.5, 0.2, 0.2), to: 'a', arrive: 'west', text: 'je loopt terug' }],
    },
  ],
});

test('aDoorLeadsWhereItSaysAndYouFaceItsArrive', () => {
  const s = fixture();
  const back = s.rooms[1].doors[0];
  const p = new Progress(s);
  assert.equal(p.tapExit(), ExitAsk.ENTER_CODE);
  assert.ok(p.checkCode('12'));
  assert.equal(p.leave(), 'naar b');
  assert.equal(p.roomIndex, 1);
  assert.equal(p.side, Side.EAST);
  assert.deepEqual(p.moreDoors(), [back]);
  assert.equal(p.exitAsk(back), ExitAsk.OPEN);
  assert.equal(p.tapExit(back), ExitAsk.OPEN);
  assert.equal(p.leave(back), 'je loopt terug');
  assert.equal(p.roomIndex, 0);
  assert.equal(p.side, Side.WEST);
  assert.equal(p.finished, false);
  assert.equal(p.exitAsk(), ExitAsk.OPEN); // opened: no code again
  assert.equal(p.tapExit(), ExitAsk.OPEN);
  p.leave();
  assert.equal(p.tapExit(), ExitAsk.ENTER_CODE);
  assert.ok(p.checkCode('60'));
  p.leave();
  assert.ok(p.finished);
});

test('goingBackKeepsTheLaterRoomInNotesAndStats', () => {
  const s = fixture();
  const p = new Progress(s);
  p.tap(s.rooms[0].things[0]);
  p.checkCode('12'); p.leave();
  p.leave(s.rooms[1].doors[0]);
  assert.equal(p.roomIndex, 0);
  assert.ok(p.reached(1));
  assert.deepEqual(p.journal().map((pg) => pg.room.title), ['A', 'B']);
  assert.equal(p.journal()[0].exit, 'naar b');
  assert.equal(p.journal()[1].exit, null);
  const rooms = p.statsJson().rooms;
  assert.equal(rooms[0].done, true);
  assert.equal(rooms[1].done, false);
  assert.ok(p.started);
});

test('openedDoorsRoundTripAndOldSavesOpenTheDoorsBehindThem', () => {
  const s = fixture();
  const p = new Progress(s);
  p.checkCode('12'); p.leave(); p.leave(s.rooms[1].doors[0]);
  const q = Progress.fromJson(s, p.toJson());
  assert.deepEqual([...q.opened], [...p.opened]);
  assert.equal(q.exitAsk(), ExitAsk.OPEN);
  const old = Progress.fromJson(s, { room: 1, finished: false });
  assert.deepEqual([...old.opened], ['exit:a']);
  assert.ok(old.roomLeft(0));
  assert.ok(!old.roomLeft(1));
  assert.deepEqual([...Progress.fromJson(s, { room: 1, finished: true }).opened], ['exit:a', 'exit:b']);
});

test('parserReadsExitAndExits', () => {
  const r = fixture().rooms[1];
  assert.equal(r.exits.length, 2);
  assert.equal(r.exit.id, 'exit');
  assert.equal(r.doors[0].id, 'terug');
  assert.equal(r.doors[0].to, 'a');
  assert.equal(r.doors[0].arrive, Side.WEST);
  assert.equal(fixture().rooms[0].exit.arrive, Side.EAST);
});

test('tourOpensEveryDoor', () => {
  const s = fixture();
  const p = Progress.tour(s, 1);
  assert.equal(p.exitAsk(s.rooms[1].doors[0]), ExitAsk.OPEN);
  p.leave(s.rooms[1].doors[0]);
  assert.equal(p.roomIndex, 0);
});

test('anAskIsPerDoorAndAnOpenedDoorDoesNotAskAgain', () => {
  const s = fixture();
  const door = s.rooms[1].doors[0];
  door.code = '7'; door.len = 1;
  door.ask = { text: 'Wie? ___.', words: ['Teun', 'Fien'], answer: ['Teun'] };
  const p = new Progress(s);
  p.checkCode('12'); p.leave();
  assert.equal(p.tapExit(), ExitAsk.ENTER_CODE); // the main door of b has no ask
  assert.equal(p.tapExit(door), ExitAsk.ASK);
  assert.equal(p.checkAsk(['Fien'], door), false);
  assert.equal(p.checkAsk(['Teun'], door), true);
  assert.deepEqual([...p.asked], ['exit:b:terug']);
  assert.equal(p.tapExit(door), ExitAsk.ENTER_CODE);
  assert.ok(p.checkCode('7', door));
  p.leave(door);
  p.leave();
  assert.equal(p.tapExit(door), ExitAsk.OPEN);
  const q = Progress.fromJson(s, p.toJson());
  assert.deepEqual([...q.asked], [...p.asked]);
  assert.deepEqual([...q.opened], [...p.opened]);
  // the tour answers every ask and opens every door
  const t = Progress.tour(s, 1);
  assert.ok(t.asked.has('exit:b:terug'));
  assert.ok(t.isOpened(door));
});

test('aLockedSideDoorSolvesTheRoomWithoutTheMainDoorText', () => {
  const raw = (code) => ({
    format: 2, title: 'D',
    rooms: [
      { id: 'a', title: 'A', task: 't', intro: 'binnen in a', walls: {}, things: [],
        exit: { wall: 'south', ...zone(0.1, 0.1, 0.2, 0.2), code: '12', text: 'naar b' } },
      { id: 'b', title: 'B', task: 't', intro: 'binnen in b', walls: {}, things: [],
        exit: { wall: 'south', ...zone(0.1, 0.1, 0.2, 0.2), code: '60', text: 'uit' },
        exits: [{ id: 'terug', wall: 'east', ...zone(0.5, 0.5, 0.2, 0.2), to: 'a', text: 'terug', ...(code ? { code } : {}) }] },
    ],
  });
  const s = parseStory('d', raw('7'));
  const side = s.rooms[1].doors[0];
  const p = new Progress(s);
  p.checkCode('12'); p.leave();
  assert.equal(p.tapExit(side), ExitAsk.ENTER_CODE);
  assert.ok(p.checkCode('7', side));
  p.leave(side);
  assert.ok(p.roomLeft(1));
  assert.equal(p.journal()[1].exit, null); // 'uit' belongs to the main door, never gone through
  const est = (st) => Difficulty.analyse(st).find((x) => x.roomId === 'b').estMinutes;
  assert.ok(est(s) > est(parseStory('d', raw(null))), 'side lock adds to the estimate');
});
