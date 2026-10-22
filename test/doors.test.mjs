// Mirror of DoorsTest.kt: doors with a destination (../escaperoom/docs/besluiten/deuren.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, Progress, Side, ExitAsk } from '../js/engine.js';

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
