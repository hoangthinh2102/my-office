import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BREAK_SEATS, FLOOR_THEMES, MIN_FLOORS, ROOMS_PER_FLOOR, floorsOf, padFloors, headcount, latest, seatPeople, stateOf, themeOf } from '../../src/shared/team-floors.js';

const room = (i, over = {}) => ({ member: { id: `m${i}`, name: `Member ${i}` }, online: true, mode: 'closed', ...over });

test('rooms fill floors of four in the hub order', () => {
  assert.equal(ROOMS_PER_FLOOR, 4);
  const floors = floorsOf(Array.from({ length: 9 }, (_, i) => room(i)));
  assert.deepEqual(floors.map((f) => f.n), [1, 2, 3]);
  assert.deepEqual(floors.map((f) => f.rooms.length), [4, 4, 1]);
  assert.deepEqual(floors.flatMap((f) => f.rooms.map((r) => r.member.id)), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
});

test('nobody changes floor when a room opens, closes or goes offline', () => {
  const rooms = Array.from({ length: 6 }, (_, i) => room(i));
  const before = floorsOf(rooms).map((f) => f.rooms.map((r) => r.member.id));
  rooms[1] = { ...rooms[1], mode: 'open' };
  rooms[4] = { ...rooms[4], online: false };
  assert.deepEqual(floorsOf(rooms).map((f) => f.rooms.map((r) => r.member.id)), before);
});

test('no rooms, bad input and rooms without a member make no floors', () => {
  assert.deepEqual(floorsOf([]), []);
  assert.deepEqual(floorsOf(null), []);
  assert.deepEqual(floorsOf([null, {}, { member: {} }]), []);
  assert.equal(floorsOf([room(1), { member: {} }, room(2)])[0].rooms.length, 2);
  assert.deepEqual(floorsOf(Array.from({ length: 5 }, (_, i) => room(i)), 2).map((f) => f.rooms.length), [2, 2, 1]);
});

test('a room card shows offline, open or closed', () => {
  assert.equal(stateOf(room(1, { online: false, mode: 'open' })), 'offline');
  assert.equal(stateOf(room(1, { mode: 'open' })), 'open');
  assert.equal(stateOf(room(1, { mode: 'closed' })), 'closed');
  assert.equal(stateOf(room(1, { mode: 'closed', access: { until: null } })), 'shared');   // (closed, but you were let in)
  assert.equal(stateOf(room(1, { mode: 'open', access: { until: null } })), 'open');
  assert.equal(stateOf(room(1, { mode: 'weird' })), 'closed');
  assert.equal(stateOf(null), 'offline');
});

test('headcount and latest event', () => {
  assert.equal(headcount(room(1, { counts: { work: 2, wait: 1, rest: 3 } })), 6);
  assert.equal(headcount(room(1)), 0);
  assert.equal(latest(room(1)), null);
  assert.deepEqual(latest(room(1, { events: [{ type: 'read' }, { type: 'edit' }] })), { type: 'edit' });
});

test('floors take the three looks in turn, the same for everyone', () => {
  assert.deepEqual(FLOOR_THEMES, ['studio', 'garden', 'library']);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(themeOf), ['studio', 'garden', 'library', 'studio', 'garden', 'library', 'studio']);
  // anything odd counts as floor 1
  for (const n of [0, -2, null, undefined, 'x', NaN]) assert.equal(themeOf(n), 'studio');
  assert.equal(themeOf('2'), 'garden');
});

test('the break corner seats whoever rests, keeping their seat, never more than it has', () => {
  const rest = (ids) => ids.map((id) => ({ id }));
  const a = seatPeople(rest(['p1', 'p2', 'p3']), new Map(), BREAK_SEATS);
  assert.deepEqual([...a.seats], [['p1', 0], ['p2', 1]]);
  assert.equal(a.extra, 1);
  // p1 goes back to work: p2 keeps the seat, p3 takes the free one
  const b = seatPeople(rest(['p2', 'p3']), a.seats, BREAK_SEATS);
  assert.deepEqual([...b.seats], [['p2', 1], ['p3', 0]]);
  assert.equal(b.extra, 0);
});

test('the building always has at least five floors, free ones on top', () => {
  assert.equal(MIN_FLOORS, 5);
  // nobody else yet: five floors of free rooms
  assert.deepEqual(padFloors([]).map((f) => [f.n, f.rooms.length]), [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
  assert.equal(padFloors(null).length, 5);
  // six people: floors 1 and 2 have them, 3 to 5 are free
  const six = padFloors(floorsOf(Array.from({ length: 6 }, (_, i) => room(i))));
  assert.deepEqual(six.map((f) => f.rooms.length), [4, 2, 0, 0, 0]);
  // a bigger team gets as many floors as it needs
  assert.equal(padFloors(floorsOf(Array.from({ length: 25 }, (_, i) => room(i)))).length, 7);
});
