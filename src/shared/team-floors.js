// The team building (team mode, docs/features/team-mode.md): every other member's room on a floor of
// ROOMS_PER_FLOOR, the four department rooms of the headquarters' wing. Rooms keep the order the hub gave them (the
// order people joined), so nobody changes floor when someone opens, closes or goes offline.
export const ROOMS_PER_FLOOR = 4;

/** [{ n: 1, rooms: [...] }, …] from the rooms the hub sent. */
export function floorsOf(rooms, per = ROOMS_PER_FLOOR) {
  const list = Array.isArray(rooms) ? rooms.filter((r) => r?.member?.id) : [];
  const floors = [];
  for (let i = 0; i < list.length; i += per) floors.push({ n: floors.length + 1, rooms: list.slice(i, i + per) });
  return floors;
}

/** 'offline', 'open' or 'closed': what a room's card shows. */
export const stateOf = (room) => (!room?.online ? 'offline' : room.mode === 'open' ? 'open' : 'closed');

/** How many people a room has in it now (working, waiting or resting). */
export const headcount = (room) => { const c = room?.counts || {}; return (c.work || 0) + (c.wait || 0) + (c.rest || 0); };

/** A room's latest event, or null. */
export const latest = (room) => (Array.isArray(room?.events) && room.events.length ? room.events[room.events.length - 1] : null);

/* ---------- the 3D building (src/office/world/team-tower.js, headquarters plan) ----------
   The team's floors stand on the wing: floor 1's slab is just above the wing's walls, each floor FLOOR_H higher. */
export const SEATS_PER_ROOM = 8;   // a department room: two pods of four desks
export const TOWER_Y0 = 4.5, FLOOR_H = 3.4;
/** The height of floor n's floor (n from 1). */
export const floorY = (n) => TOWER_Y0 + (Math.max(1, n) - 1) * FLOOR_H;

/** Who sits where in a room: everyone keeps the seat they had (prev: Map id -> seat), newcomers take the lowest free
 *  seat, and whoever doesn't fit is counted in `extra`. Returns { seats: Map id -> seat, extra }. */
export function seatPeople(people, prev = new Map(), n = SEATS_PER_ROOM) {
  const ids = [...new Set((Array.isArray(people) ? people : []).map((p) => p?.id).filter(Boolean))];
  const seats = new Map(), used = new Set();
  for (const id of ids) {
    const k = prev.get(id);
    if (Number.isInteger(k) && k >= 0 && k < n && !used.has(k)) { seats.set(id, k); used.add(k); }
  }
  let extra = 0;
  for (const id of ids) {
    if (seats.has(id)) continue;
    let k = 0; while (used.has(k)) k++;
    if (k >= n) { extra++; continue; }
    seats.set(id, k); used.add(k);
  }
  return { seats, extra };
}

/** A room's shadows behind smart glass (a closed room): how many, at most a seat each. */
export const silhouettes = (room, n = SEATS_PER_ROOM) => Math.min(n, headcount(room));
