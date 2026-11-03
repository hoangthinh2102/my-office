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
