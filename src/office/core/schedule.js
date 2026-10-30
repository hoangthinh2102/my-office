// Office hours, set by the director (the director's office → Office hours; kept by the server, server/company.mjs) and
// lived by everyone: arriving in the morning, breakfast at the pantry until work starts, lunch, the midday nap, the
// afternoon coffee, packing up and going home when work ends. Work that is still running keeps a person at their desk
// (overtime); a day off (not one of `days`) they stay home unless there is work.
import { officeNow } from './env.js';

export const DEFAULT_SCHEDULE = Object.freeze({ arrive: '08:00', start: '08:30', breakfast: '08:00', lunch: '11:45', napStart: '12:30', napEnd: '13:30', coffee: '15:00', end: '18:00', days: [1, 2, 3, 4, 5] });
export const SCHEDULE = { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] };
const listeners = new Set();

export const mins = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const at = (key) => mins(SCHEDULE[key]);
export const nowMin = (d = officeNow()) => d.getHours() * 60 + d.getMinutes();
export const workday = (d = officeNow()) => SCHEDULE.days.includes(d.getDay());
/** within working hours today (a working day, between start and end) */
export const inHours = (d = officeNow()) => workday(d) && nowMin(d) >= at('start') && nowMin(d) < at('end');

/** what part of the day it is: 'off' (a day off), 'night', 'arrive', 'work', 'lunch', 'nap', 'evening' */
export function dayPart(d = officeNow()) {
  if (!workday(d)) return 'off';
  const m = nowMin(d);
  if (m < at('arrive')) return 'night';
  if (m < at('start')) return 'arrive';
  if (m >= at('lunch') && m < at('napStart')) return 'lunch';
  if (m >= at('napStart') && m < at('napEnd')) return 'nap';
  if (m < at('end')) return 'work';
  return 'evening';
}

/** from the server (the live snapshot, or the director changing it) */
export function setSchedule(s) {
  if (!s || typeof s !== 'object') return;
  for (const k of Object.keys(DEFAULT_SCHEDULE)) if (k in s) SCHEDULE[k] = k === 'days' ? [...s.days] : s[k];
  for (const f of listeners) f(SCHEDULE);
}
export const onSchedule = (f) => { listeners.add(f); return () => listeners.delete(f); };
