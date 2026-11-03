import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS_PER_FLOOR, floorsOf, headcount, latest, stateOf } from '../../src/shared/team-floors.js';

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
  assert.equal(stateOf(room(1, { mode: 'weird' })), 'closed');
  assert.equal(stateOf(null), 'offline');
});

test('headcount and latest event', () => {
  assert.equal(headcount(room(1, { counts: { work: 2, wait: 1, rest: 3 } })), 6);
  assert.equal(headcount(room(1)), 0);
  assert.equal(latest(room(1)), null);
  assert.deepEqual(latest(room(1, { events: [{ type: 'read' }, { type: 'edit' }] })), { type: 'edit' });
});
