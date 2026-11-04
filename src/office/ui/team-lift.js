// Team mode's lift (headquarters plan only; markup: src/components/office/Stage.tsx #tw-lift, #tw-card): the buttons
// down the stage's right edge that choose what you look at in the building (world/team-tower.js): the whole building,
// a floor, or your own floor. A click on someone in another room opens a card about them: view only, nothing to do.
// Things on the floor you are on (a plant, a lamp, the coffee machine) react to a click on your screen only. The lift
// in the building is another way round it: a click on its doors offers every floor, and the car takes you there.
import { state } from '../core/state.js';
import { $, HQ, el } from '../core/env.js';
import { icon, TYPE_ICON } from './icons.js';
import { goTower, onViewHooks, pickTower, syncTower, towerFloors, towerRoom, view } from '../world/team-tower.js';
import { stateOf } from '../../shared/team-floors.js';
import { knockBlock } from './team-access.js';
import { setHoverProp } from '../interact/props.js';
import { PALETTE, hash } from '../people/workers.js';
import { drS } from './session-drawer.js';
import { queueUi } from './activity.js';
import { sfx } from '../audio/sfx.js';
import { t as tr } from '../../i18n/index.js';

let lift, card, hint, shown = false, restored = false, cardAt = 0;
const VIEW_KEY = 'office-tower', HINT_KEY = 'office-tower-hint';
const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: nothing remembered */ } };

/** The relay's state (from ui/team.js onTeam): the building and the lift follow it. */
export function syncLift(t) {
  if (!HQ || !lift) return;
  syncTower(t);
  const n = towerFloors();
  shown = !!t?.inTeam && n > 0;
  lift.hidden = !shown;
  if (!shown) { closeCard(); closeHint(); return; }
  // the first time there are floors on this page: back to what you last looked at (the whole building, a floor)
  if (!restored) {
    restored = true;
    const last = load(VIEW_KEY), f = Number(last);
    setTimeout(() => { if (last === 'all') goTower('all'); else if (f >= 1 && f <= towerFloors()) goTower(f); }, 0);   // (after the office has finished starting: the camera)
    if (!load(HINT_KEY)) showHint();
  }
  render();
}
function showHint() { if (!hint) return; hint.hidden = false; setTimeout(closeHint, 15000); }
function closeHint() { if (!hint || hint.hidden) return; hint.hidden = true; save(HINT_KEY, 'seen'); }

function render() {
  const n = towerFloors(), rows = [];
  rows.push(btn('all', [icon('building'), el('span', 'tw-lift-l', tr('team.lift.allShort'))], tr('team.lift.all'), view.mode === 'all'));
  for (let f = n; f >= 1; f--) {
    const inRoom = [0, 1, 2, 3].map((i) => towerRoom(f, i)).filter(Boolean), on = inRoom.filter((r) => stateOf(r) !== 'offline').length;
    const b = btn(String(f), document.createTextNode(String(f)), tr('team.floor', { n: f }), view.mode === 'floor' && view.floor === f);
    if (on) b.append(el('i', 'tw-lift-dot'));
    b.title = `${tr('team.floor', { n: f })}: ${inRoom.length ? inRoom.map((r) => r.member.name).join(', ') : tr('team.lift.emptyFloor')}`;
    rows.push(b);
  }
  rows.push(btn('mine', [icon('home'), el('span', 'tw-lift-l', tr('team.lift.mineShort'))], tr('team.lift.mine'), view.mode === 'mine'));
  lift.replaceChildren(...rows);
}
function btn(to, inner, label, sel) {
  const b = el('button', `tw-lift-b${sel ? ' is-sel' : ''}`);
  b.type = 'button'; b.dataset.to = to; b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', String(sel)); b.title = label;
  b.append(...[].concat(inner));
  return b;
}

/* ---------- a click in the building ---------- */
/** Called by ui/whiteboard.js with the click's ray: true when it landed in the building (and was handled here). */
export function towerClick(ray, ev) {
  const hit = pickTower(ray);
  if (!hit) { closeCard(); return false; }
  if (hit.kind === 'floor') { closeCard(); goTower(hit.floor); return true; }
  if (hit.kind === 'prop' && hit.prop.kind === 'lift') { openLiftCard(ev); return true; }
  if (hit.kind === 'prop') { closeCard(); hit.prop.act(); return true; }
  if (hit.kind === 'none') { closeCard(); return true; }
  const r = towerRoom(hit.floor, hit.i);
  if (!r) { closeCard(); return true; }
  openCard(hit, r, ev);
  return true;
}
/** Hover: is the pointer over something in the building? A thing to click gets its outline and name, as on your floor. */
export function towerHover(ray, ev) {
  const hit = pickTower(ray);
  setHoverProp(hit?.prop || null, ev);
  return !!hit;
}

function openCard(hit, r, ev) {
  const st = stateOf(r), p = hit.kind === 'person' ? (r.people || []).find((x) => x.id === hit.person) : null;
  const head = el('header', 'tw-card-h');
  const ava = el('span', 'team-ava', [...(r.member.name || '?')][0].toUpperCase()); ava.style.background = PALETTE[hash(r.member.id) % PALETTE.length];
  const names = el('div', 'team-room-names');
  names.append(el('b', null, tr('team.card.room', { name: r.member.name })), el('small', null, tr('team.floor', { n: hit.floor })));
  const x = el('button', 'dir-x tw-card-x'); x.type = 'button'; x.setAttribute('aria-label', tr('common.close')); x.append(icon('x')); x.addEventListener('click', closeCard);
  head.append(ava, names, x);
  const body = el('div', 'tw-card-b');
  if (p) {
    body.append(el('b', null, [p.role, p.project].filter(Boolean).join(' · ') || tr('common.session')));
    const what = el('p', `tw-card-act is-${p.status}`);
    if (p.act && p.status !== 'rest') what.append(icon(TYPE_ICON[p.act] || 'sparkle'), document.createTextNode(p.label ? `${act(p.act)}: ${p.label}` : act(p.act)));
    else what.textContent = tr(`team.status.${p.status}`);
    body.append(what);
    if (p.subs) body.append(el('p', 'tw-card-sub', tr('team.subs', { n: p.subs })));
  } else if (st === 'closed') body.append(el('p', 'tw-card-sub', `${tr('team.closedNote')} · ${tr('team.counts', { work: r.counts?.work || 0, wait: r.counts?.wait || 0, rest: r.counts?.rest || 0 })}`));
  else if (st === 'offline') body.append(el('p', 'tw-card-sub', tr('team.offline')));
  else body.append(el('p', 'tw-card-sub', tr('team.counts', { work: r.counts?.work || 0, wait: r.counts?.wait || 0, rest: r.counts?.rest || 0 })));
  if (!p) { const access = knockBlock(r, st); if (access) body.append(access); }
  body.append(el('p', 'tw-card-ro', tr('team.card.readOnly')));
  card.replaceChildren(head, body);
  showCard(ev);
}
// the lift's doors were clicked: the floors (as the lift down the right edge has them), the building, your own floor
function openLiftCard(ev) {
  const head = el('header', 'tw-card-h');
  const ava = el('span', 'team-ava tw-pick-ic'); ava.append(icon('building'));
  const names = el('div', 'team-room-names');
  names.append(el('b', null, tr('team.tower.props.lift.name')), el('small', null, tr('team.lift.here', { n: view.floor })));
  const x = el('button', 'dir-x tw-card-x'); x.type = 'button'; x.setAttribute('aria-label', tr('common.close')); x.append(icon('x')); x.addEventListener('click', closeCard);
  head.append(ava, names, x);
  const grid = el('div', 'tw-pick');
  for (let f = towerFloors(); f >= 1; f--) {
    const inRoom = [0, 1, 2, 3].map((i) => towerRoom(f, i)).filter(Boolean), on = inRoom.some((r) => stateOf(r) !== 'offline');
    const b = pickBtn(String(f), String(f), view.floor === f); b.setAttribute('aria-label', tr('team.floor', { n: f }));
    b.title = `${tr('team.floor', { n: f })}: ${inRoom.length ? inRoom.map((r) => r.member.name).join(', ') : tr('team.lift.emptyFloor')}`;
    if (on) b.append(el('i', 'tw-lift-dot'));
    grid.append(b);
  }
  const ends = el('div', 'tw-pick-ends');
  ends.append(pickBtn('all', tr('team.lift.allShort'), false, 'building'), pickBtn('mine', tr('team.lift.mineShort'), false, 'home'));
  const body = el('div', 'tw-card-b');
  body.append(grid, ends, el('p', 'tw-card-ro', tr('team.tower.local')));
  card.replaceChildren(head, body);
  showCard(ev);
  sfx.play('click');
}
function pickBtn(to, label, sel, ic) {
  const b = el('button', `tw-pick-b${sel ? ' is-sel' : ''}`); b.type = 'button'; b.dataset.to = to; b.setAttribute('aria-pressed', String(sel));
  if (ic) b.append(icon(ic));
  b.append(el('span', null, label));
  if (sel) b.disabled = true;   // (you are here)
  return b;
}
function showCard(ev) {
  card.hidden = false; cardAt = performance.now();
  // next to the click, inside the stage, left of the lift
  const box = card.parentElement.getBoundingClientRect(), w = card.offsetWidth || 280, h = card.offsetHeight || 160;
  const left = Math.min(box.width - w - (lift.offsetWidth + 28), Math.max(12, (ev?.clientX ?? box.left + box.width / 2) - box.left + 14));   // (never over the lift)
  const top = Math.min(box.height - h - 12, Math.max(12, (ev?.clientY ?? box.top + box.height / 2) - box.top - h / 2));
  card.style.left = `${left}px`; card.style.top = `${top}px`;
}
const act = (type) => (tr(`team.act.${type}`) === `team.act.${type}` ? tr('team.act.other') : tr(`team.act.${type}`));
function closeCard() { if (card) card.hidden = true; }
// a choice from the lift's card or the lift down the right edge: there (your own sessions live on your own floor)
function go(to) {
  closeCard(); closeHint();
  if (to !== 'mine' && state.selectedId) { state.selectedId = null; state.subView = null; drS.hidden = true; queueUi(); }
  goTower(to === 'mine' || to === 'all' ? to : Number(to));
}

export function setup() {
  lift = $('tw-lift'); card = $('tw-card'); hint = $('tw-hint');
  hint?.querySelector('[data-close]')?.addEventListener('click', closeHint);
  if (!lift || !HQ) return;
  lift.addEventListener('click', (e) => { const b = e.target.closest('[data-to]'); if (b) go(b.dataset.to); });
  // (a tap's own click comes a moment after the card opens under the finger on a narrow screen: not a choice)
  card?.addEventListener('click', (e) => { const b = e.target.closest('.tw-pick-b[data-to]'); if (b && !b.disabled && performance.now() - cardAt > 400) go(b.dataset.to); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });
  // while you look at the building, your own office's labels (names, bubbles, place chips) stay out of the way
  onViewHooks.push((v) => {
    closeCard(); setHoverProp(null); $('stage-wrap')?.classList.toggle('is-tower', v.mode !== 'mine');
    if (restored && towerFloors()) save(VIEW_KEY, v.mode === 'floor' ? String(v.floor) : v.mode);   // (remembered for the next visit; not when the floors are gone for a while, offline)
    if (shown) render();
  });
}
