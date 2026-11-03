import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_H, SEATS_PER_ROOM, TOWER_Y0, floorY, seatPeople, silhouettes } from '../../src/shared/team-floors.js';

const people = (...ids) => ids.map((id) => ({ id }));

test('newcomers take the lowest free seats', () => {
  const { seats, extra } = seatPeople(people('a', 'b', 'c'));
  assert.deepEqual([...seats], [['a', 0], ['b', 1], ['c', 2]]);
  assert.equal(extra, 0);
});

test('everyone keeps their seat when someone leaves or arrives', () => {
  const first = seatPeople(people('a', 'b', 'c')).seats;
  const after = seatPeople(people('c', 'd', 'a'), first).seats;   // b left, d came, the order changed
  assert.equal(after.get('a'), 0);
  assert.equal(after.get('c'), 2);
  assert.equal(after.get('d'), 1);   // b's old seat
});

test('a full room counts the rest', () => {
  const ids = Array.from({ length: 11 }, (_, i) => `p${i}`);
  const { seats, extra } = seatPeople(people(...ids));
  assert.equal(SEATS_PER_ROOM, 8);
  assert.equal(seats.size, 8);
  assert.equal(extra, 3);
  assert.deepEqual(new Set(seats.values()), new Set([0, 1, 2, 3, 4, 5, 6, 7]));
});

test('bad seats, duplicates and junk are ignored', () => {
  const prev = new Map([['a', 5], ['b', 5], ['c', 99], ['d', -1], ['e', 1.5]]);
  const { seats } = seatPeople([{ id: 'a' }, { id: 'b' }, { id: 'a' }, null, {}, { id: 'c' }, { id: 'd' }, { id: 'e' }], prev);
  assert.equal(seats.get('a'), 5);
  assert.notEqual(seats.get('b'), 5);
  assert.equal(seats.size, 5);
  assert.equal(new Set(seats.values()).size, 5);
  assert.deepEqual(seatPeople(null).seats.size, 0);
});

test('floors stack from the top of the wing', () => {
  assert.equal(floorY(1), TOWER_Y0);
  assert.equal(floorY(3), TOWER_Y0 + 2 * FLOOR_H);
  assert.equal(floorY(0), TOWER_Y0);
});

test('a closed room shows a shadow per person, at most a seat each', () => {
  assert.equal(silhouettes({ counts: { work: 2, wait: 1, rest: 0 } }), 3);
  assert.equal(silhouettes({ counts: { work: 20 } }), 8);
  assert.equal(silhouettes({}), 0);
});
