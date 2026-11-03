// A team floor in full (team mode, headquarters plan; docs/features/team-mode.md). The floor you are on in
// world/team-tower.js gets what your own wing has: real desks whose screens show what each person is doing, door
// plaques, sprint boards, cabinets, plants, and a break corner in each room. Each floor has one of three looks
// (src/shared/team-floors.js themeOf): studio (sofas, cabinets), garden (bean bags, planters, a moss wall), library
// (armchairs, low bookshelves, an aquarium). The floor is built when you go to it, merged into a few draw calls, and
// thrown away when you leave. Clicking something (a plant, a lamp, the coffee machine) only plays on your screen and
// sends nothing.
import * as THREE from 'three';
import { rand, reduceMotion } from '../core/env.js';
import { scene } from '../scene/renderer.js';
import { canvasTex, cyl, fitText, mat, put, rbox, rug } from '../scene/blocks.js';
import { mergeMeshes } from '../scene/merge.js';
import { BULB_OFF, BULB_ON, metal, potPlant, woodDark, woodMid } from './terrace.js';
import { makeShelf, makeSofa } from './furniture/room-pieces.js';
import { floorLamp } from './furniture/plants-lamps.js';
import { armchair } from './pro/pieces.js';
import { credenza, doorPlaque, sprintBoard } from './pro/wing.js';
import { CHAIR_IDLE, deskPieces, officeChair } from './desks.js';
import { prPick, trinket } from './props/trinkets.js';
import { kindOfAct, offTexture, updateScreen } from './screens.js';
import { night, particles, puffGeo } from './room-update.js';
import { DEPTS, WING } from './layout.js';
import { sfx } from '../audio/sfx.js';
import { t as tr } from '../../i18n/index.js';

const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
const SOFAS = [['#4F6D8F', ['#F2B33D', '#E8742A']], ['#6B4F3A', ['#BDE0FE', '#E2B04A']], ['#5C6B7F', ['#E8742A', '#FFD166']], ['#46553F', ['#F2B33D', '#BDE0FE']]];
const BAGS = ['#E8742A', '#3F7CC4', '#F2B33D', '#8C4FA8', '#5E7A3A', '#C8553D', '#2A9D8F', '#E8A0B4'];
const CHAIRS = ['#7A4E3A', '#3D5A80', '#6A8042', '#8C4FA8'];
const TRINKETS = ['duck', 'cactus', 'frame', 'can', 'robot', 'donut', 'books'];
const SCREEN0 = 1000;   // world/screens.js keeps each desk's own scrolling copy by index: the team floor's start here

/** Where things stand in room i (DEPTS order). A back room's break corner is by the corridor and faces the room; a
 *  front room's is at the window end and faces along it. The board and cabinet stand against the low wall between the
 *  rooms. People walk from their chair to the aisle on the break corner's side (through the gap between the two pods
 *  when they sit on the other side), then to their seat. */
const PLANS = [];
export function roomPlan(i) {
  if (PLANS[i]) return PLANS[i];
  const d = DEPTS[i], back = i < 2, [pl, pr] = d.pods.map((p) => p[0]);
  const aisleL = back ? d.z0 + 2.15 : d.z1 - 2.15, aisleW = back ? d.z1 - 2.15 : d.z0 + 2.15;
  const corner = back ? { x: pl, z: d.z0 + 0.55, ry: 0 } : { x: d.x0 + 0.55, z: d.z1 - 1.05, ry: Math.PI / 2 };
  const seats = [-0.45, 0.45].map((o) => (back
    ? { x: pl + o, z: d.z0 + 0.62, ry: 0, via: [[pl + o, aisleL]] }
    : { x: d.x0 + 0.62, z: d.z1 - 1.05 + o, ry: Math.PI / 2, via: [[d.x0 + 1.6, aisleL], [d.x0 + 1.6, d.z1 - 1.05 + o]] }));
  const table = back ? [pl, d.z0 + 1.35] : [d.x0 + 1.35, d.z1 - 1.05];
  const cabinet = back ? { x: d.cx, z: d.z1 - 0.35, ry: Math.PI } : { x: pl, z: d.z0 + 0.4, ry: 0 };
  const board = back ? { x: pr + 0.5, y: 1.3, z: d.z0 + 0.45, stand: true } : { x: pr, y: 0.78, z: d.z0 + 0.1, stand: false };
  const corners = back ? [[d.x0 + 0.45, d.z0 + 0.45], [d.x1 - 0.45, d.z0 + 0.45], [d.x0 + 0.45, d.z1 - 0.45], [d.x1 - 0.45, d.z1 - 0.45]]
    : [[d.x1 - 0.45, d.z1 - 0.45], [d.x1 - 0.45, d.z0 + 0.5], [d.x0 + 0.45, d.z0 + 0.5]];
  // the low wall's face on this room's side (a moss panel hangs there in the garden look)
  const wall = back ? { z: d.z1 - 0.08, ry: Math.PI } : { z: d.z0 + 0.08, ry: 0 };
  return (PLANS[i] = { d, back, pl, pr, aisleL, aisleW, corner, seats, table, cabinet, board, corners, wall });
}

/** The way from chair (cx, cz) of a desk in room i to break seat s: [[x, z], …], the chair first and the seat last. */
export function pathTo(i, chair, s) {
  const P = roomPlan(i), lounge = P.back ? -1 : 1, side = Math.sign(chair.cz - P.d.cz) || 1;
  const pts = [[chair.cx, chair.cz]];
  if (side === lounge) pts.push([chair.cx, P.aisleL]);
  else pts.push([chair.cx, P.aisleW], [P.d.cx, P.aisleW], [P.d.cx, P.aisleL]);
  pts.push(...s.via, [s.x, s.z]);
  return pts;
}

/* ---------- small pieces of its own ---------- */
const group = (parent, x, z, ry = 0, y = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g); return g; };
const live = (m) => { m.userData.live = true; return m; };

function coffeeTable(parent, x, z) {
  const g = group(parent, x, z);
  put(g, cyl(0.28, 0.28, 0.05, woodMid, 24), 0, 0.42, 0);
  put(g, cyl(0.05, 0.07, 0.4, woodDark, 10), 0, 0.2, 0);
  put(g, cyl(0.045, 0.04, 0.09, '#FFFFFF'), 0.1, 0.49, 0.05);
  put(g, rbox(0.24, 0.04, 0.17, prPick(['#3D5A80', '#C8553D', '#2A9D8F']), 0.01), -0.07, 0.465, -0.04).rotation.y = 0.5;
  return g;
}
function beanBag(parent, x, z, ry, color) {
  const g = group(parent, x, z, ry), m = mat(color, { roughness: 0.95 });
  put(g, new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 12).scale(1, 0.62, 1), m), 0, 0.25, 0);
  put(g, new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10).scale(1, 0.75, 0.6), m), 0, 0.42, -0.2);
  return g;
}
function planterBox(parent, x, z, ry, w, kinds) {
  const g = group(parent, x, z, ry);
  put(g, rbox(w, 0.42, 0.42, woodMid, 0.03), 0, 0.21, 0);
  put(g, rbox(w - 0.08, 0.03, 0.34, '#4A3527', 0.01), 0, 0.42, 0);
  kinds.forEach((k, j) => potPlant(-w / 2 + (w / kinds.length) * (j + 0.5), 0, k === 'tree' ? 0.55 : 0.6, k, 0.2, g));
  return g;
}
function bench(parent, x, z) {
  const g = group(parent, x, z);
  put(g, rbox(1.6, 0.07, 0.42, woodMid, 0.02), 0, 0.45, 0);
  for (const sx of [-0.65, 0.65]) put(g, rbox(0.06, 0.42, 0.36, metal, 0.01), sx, 0.21, 0);
  trinket('books', 0.4, 0.485, 0.02, 0.3, g);
  return g;
}
function waterCooler(parent, x, z) {
  const g = group(parent, x, z);
  put(g, rbox(0.36, 0.95, 0.36, mat('#ECEFF2', { roughness: 0.5 }), 0.03), 0, 0.475, 0);
  put(g, rbox(0.2, 0.08, 0.04, '#8D96A3', 0.01), 0, 0.82, 0.19);
  put(g, cyl(0.15, 0.15, 0.42, mat('#9CCBE8', { roughness: 0.1, metalness: 0.1 }), 18), 0, 1.17, 0);
  put(g, cyl(0.05, 0.15, 0.06, mat('#9CCBE8', { roughness: 0.1 }), 18), 0, 0.97, 0);
  for (let k = 0; k < 3; k++) put(g, cyl(0.03, 0.025, 0.07, '#FFFFFF', 8), 0.24, 0.5 + k * 0.08, 0.05);
  return g;
}
function coffeeBar(parent, x, z) {
  const g = group(parent, x, z);
  put(g, rbox(1.7, 0.9, 0.55, mat('#E6E1D8', { roughness: 0.7 }), 0.03), 0, 0.45, 0);
  for (const sx of [-0.56, 0, 0.56]) put(g, rbox(0.52, 0.7, 0.02, mat('#D9D2C6', { roughness: 0.7 }), 0.01), sx, 0.46, 0.28);
  put(g, rbox(1.78, 0.06, 0.62, mat('#3B3F46', { roughness: 0.35 }), 0.02), 0, 0.93, 0);
  put(g, rbox(0.46, 0.56, 0.4, mat('#24282F', { roughness: 0.35, metalness: 0.4 }), 0.05), -0.45, 1.24, -0.04);
  put(g, rbox(0.26, 0.04, 0.12, metal, 0.02), -0.45, 1.1, 0.2);
  put(g, cyl(0.055, 0.055, 0.08, '#FFFFFF'), -0.45, 1.0, 0.19);
  const led = live(new THREE.MeshBasicMaterial({ color: '#5BE37D' }));
  put(g, new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), led), -0.29, 1.42, 0.17);
  for (let k = 0; k < 3; k++) put(g, cyl(0.06, 0.055, 0.12, ['#FFFFFF', '#FFE787', '#BFDDF7'][k]), 0.08 + k * 0.18, 1.02, 0.08);
  potPlant(0.68, 0, 0.32, 'snake', 0.96, g);
  return { g, led, steam: new THREE.Vector3(-0.45, 1.1, 0.19) };
}
function aquarium(parent, x, z) {
  const g = group(parent, x, z);
  put(g, rbox(1.6, 0.75, 0.5, mat('#2F3640', { roughness: 0.6 }), 0.03), 0, 0.375, 0);
  put(g, rbox(1.5, 0.04, 0.42, '#D9C9A3', 0.01), 0, 0.79, 0);
  const water = live(new THREE.MeshStandardMaterial({ color: '#5FB6E0', transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false }));
  put(g, new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.56, 0.42), water), 0, 1.05, 0).renderOrder = 2;
  put(g, rbox(1.54, 0.05, 0.46, '#2F3640', 0.01), 0, 1.35, 0);
  for (const sx of [-0.55, -0.2, 0.4]) put(g, new THREE.Mesh(new THREE.ConeGeometry(0.04, rand(0.25, 0.4), 5), mat('#4F8A4A')), sx, 0.95, rand(-0.1, 0.1));
  const fish = [];
  for (let k = 0; k < 5; k++) {
    const f = live(new THREE.Group()); f.position.set(rand(-0.6, 0.6), rand(0.9, 1.22), rand(-0.12, 0.12)); g.add(f);
    const c = mat(['#FF8A3D', '#FFD166', '#E63946', '#4CC9F0', '#F28AB2'][k], { roughness: 0.5 });
    put(f, new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8).scale(1.5, 1, 0.6), c), 0, 0, 0);
    put(f, new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 6).rotateZ(Math.PI / 2), c), -0.08, 0, 0);
    fish.push({ f, dir: Math.random() < 0.5 ? -1 : 1, v: rand(0.08, 0.16), ph: rand(0, 6) });
  }
  return { g, fish };
}
function mossPanel(parent, x, z, ry, w) {
  const tex = canvasTex(256, 96, (c, cw, ch) => {
    c.fillStyle = '#3F6B3A'; c.fillRect(0, 0, cw, ch);
    for (let k = 0; k < 900; k++) { c.fillStyle = ['#5E8C4A', '#77A35A', '#2F5530', '#8DB86A'][k % 4]; c.beginPath(); c.arc(Math.random() * cw, Math.random() * ch, rand(1.5, 4), 0, 7); c.fill(); }
  });
  const m = put(parent, new THREE.Mesh(new THREE.PlaneGeometry(w, 0.62), mat('#FFFFFF', { map: tex, roughness: 0.95 })), x, 0.84, z);
  m.rotation.y = ry; return m;
}
function floorSign(parent, n, theme) {
  const tex = canvasTex(512, 300, (g, w, h) => {
    g.fillStyle = '#2F4A3D'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#F3EFE8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 110px ${FONT}`; const t = tr('team.floor', { n }); fitText(g, t, w - 50); g.fillText(t, w / 2, 120);
    g.fillStyle = '#B9D6C4'; g.font = `600 44px ${FONT}`; const s = tr(`team.tower.theme.${theme}`); fitText(g, s, w - 50); g.fillText(s, w / 2, 230);
  });
  put(parent, rbox(0.04, 1.3, 1.2, mat('#24382F', { roughness: 0.9 }), 0.01), -7.9, 1.25, (WING.corA[0] + WING.corA[1]) / 2);
  const m = put(parent, new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.64), new THREE.MeshBasicMaterial({ map: tex })), -7.875, 1.45, (WING.corA[0] + WING.corA[1]) / 2);
  m.rotation.y = Math.PI / 2; m.userData.noMerge = true;
}

/* ---------- the floor ---------- */
/**
 * Furnishes floor F (world/team-tower.js) in its look. desks[i][k]: room i's desk k ({ x, z, ry, cx, cz }); accents[i]:
 * the room's member colour (or null when the room is free). Returns the floor's furniture:
 * { g, props, rooms: [{ seats, plaque(title, sub, dim) }], show(i, room), update(dt, t), pick(ray), dispose() }.
 */
export function furnishFloor(F, n, theme, desks, accents) {
  const g = new THREE.Group(); g.name = `team-floor-${n}-furniture`; F.g.add(g);
  const D = { g, n, theme, props: [], rooms: [], lamps: [], fx: { bounces: [], wiggles: [], coffee: null, fish: null, feedUntil: 0, brewUntil: 0 } };
  const propList = [];   // [id, group, kind, act]: registered once everything is built and merged
  const prop = (kind, grp, act, extra) => { propList.push([`${kind}${propList.length}`, grp, kind, act, extra]); return grp; };
  const plant = (x, z, s, k, parent = g) => prop('plant', potPlant(x, z, s, k, 0, parent), 'wiggle');

  /* the rooms */
  DEPTS.forEach((d, i) => {
    const P = roomPlan(i), R = { seats: P.seats, screens: [], bulbs: [], lamps: [], show: null, view: null };
    D.rooms.push(R);
    // desks: the wing's, its screens this floor's own
    desks[i].forEach((dk, k) => {
      const dg = group(g, dk.x, dk.z, dk.ry);
      const scr = live(new THREE.MeshStandardMaterial({ color: '#FFFFFF', map: offTexture(), emissive: '#FFFFFF', emissiveMap: offTexture(), emissiveIntensity: 0.04, roughness: 0.3 }));
      scr.userData.keepMap = true;   // (the screens' pictures are world/screens.js's, shared)
      deskPieces(dg, k + 1, scr, true, R.bulbs);
      officeChair(dg, 0, -0.66, mat(CHAIR_IDLE, { roughness: 0.9 }));
      trinket(prPick(TRINKETS), 0.5, 0.8, -0.22, rand(-0.4, 0.4), dg);
      R.screens.push(scr);
      prop('desk', dg, 'bounce', { seat: { i, k } });   // (pointing says who sits there; a click opens their card: ui/team-lift.js)
    });
    for (const b of R.bulbs) live(b);
    // the door plaque, on the side of the glass the camera sees (as on the wing)
    const pl = i === 0 || i === 1 ? [d.door.at + 1.35, 1.62, d.z0 + 0.045, 0] : i === 2 ? [WING.corB[0] + 0.045, 1.62, d.door.at - 1.35, Math.PI / 2] : [WING.corB[1] + 0.045, 1.62, d.door.at + 1.35, Math.PI / 2];
    R.plaque = doorPlaque(accents[i] || '#6B7380', ...pl, g);
    // the board and the cabinet (or the look's own) by the low wall
    prop('board', sprintBoard(i, P.board.x, P.board.y, P.board.z, 0, 1.3, P.board.stand ? 0.8 : 0.72, P.board.stand, g), 'bounce');
    const [tx, tz] = P.table, c = P.corner;
    if (theme === 'garden') {
      prop('planter', planterBox(g, P.cabinet.x, P.cabinet.z, P.cabinet.ry, 1.8, ['snake', 'bush', 'snake']), 'wiggle');
      mossPanel(g, P.cabinet.x, P.wall.z, P.wall.ry, 1.9);
      rug(c.x + (P.back ? 0 : 0.5), c.z + (P.back ? 0.35 : 0), P.back ? 2.2 : 1.7, P.back ? 1.5 : 2.1, '#8DB86A', 0.6, g);
      prop('beanbag', (() => { const bg = group(g, c.x, c.z); P.seats.forEach((s, k) => beanBag(bg, s.x - c.x, s.z - c.z, s.ry, BAGS[(i * 2 + k) % BAGS.length])); return bg; })(), 'bounce');
      plant(...P.corners[0], 0.8, 'tree'); plant(...P.corners[1], 1.0, 'monstera');
      for (const xz of P.corners.slice(2)) plant(...xz, 0.9, 'bush');
      // more green along the outer glass
      const ox = i % 2 === 0 ? d.x0 + 0.4 : d.x1 - 0.4;
      plant(ox, d.cz - 1.2, 0.85, 'snake'); plant(ox, d.cz + 1.2, 0.85, 'monstera');
    } else if (theme === 'library') {
      // (its back panel stops at the low wall's face: through it, it would show in the room on the other side)
      const sh = makeShelf(P.cabinet.x, P.cabinet.z + (P.back ? -0.05 : 0), P.cabinet.ry, 1.8, false, g); sh.scale.y = 0.5;
      prop('shelf', sh, 'bounce');
      rug(c.x + (P.back ? 0 : 0.5), c.z + (P.back ? 0.35 : 0), P.back ? 2.3 : 1.6, P.back ? 1.5 : 2.2, '#7A2E2A', 0.2, g);
      prop('armchair', (() => {
        const ag = group(g, c.x, c.z), o = (k) => (k ? 0.08 : -0.08);   // (a little apart: the chairs are wider than a sofa seat)
        P.seats.forEach((s, k) => armchair(s.x - c.x + (P.back ? o(k) : 0), s.z - c.z + (P.back ? 0 : o(k)), s.ry, CHAIRS[(i + k) % CHAIRS.length], ag));
        return ag;
      })(), 'bounce');
      // a reading lamp beside the chairs, and a side table with books
      const lx = P.back ? c.x - 1.1 : c.x, lz = P.back ? c.z : c.z - 1.1;
      const lamp = floorLamp(lx, lz, 1.6, g, R.lamps); live(lamp.userData.bulbM);
      const L = { g: lamp, bulb: lamp.userData.bulbM, on: null, room: i };
      D.lamps.push(L); prop('lamp', lamp, () => { L.on = !lampOn(L); paintLamp(L); sfx.play('click'); });
      prop('table', (() => { const t = coffeeTable(g, tx, tz); trinket('books', -0.05, 0.445, 0.08, 0.4, t); return t; })(), 'bounce');
      plant(...P.corners[0], 0.9, 'snake'); plant(...P.corners[1], 0.95, 'monstera');
    } else {
      prop('cabinet', credenza(P.cabinet.x, P.cabinet.z, P.cabinet.ry, g), 'bounce');
      const [col, pil] = SOFAS[i];
      prop('sofa', makeSofa(c.x, c.z, 1.9, c.ry, col, pil, g), 'bounce');
      prop('table', coffeeTable(g, tx, tz), 'bounce');
      const kinds = ['monstera', 'snake', 'bush', 'snake'];
      P.corners.forEach((xz, k) => plant(...xz, 0.9, kinds[k]));
    }
  });

  /* the corridors: the floor's sign, a coffee corner and water by the lift, the look's own piece, plants */
  floorSign(g, n, theme);
  const cz = WING.z0 + 0.38;
  const cof = coffeeBar(g, 9.6, cz); D.fx.coffee = cof;
  prop('coffee', cof.g, () => {
    sfx.play('brew'); D.fx.brewUntil = performance.now() + 2600;
    const at = cof.g.localToWorld(cof.steam.clone());
    for (let k = 0; k < 9; k++) setTimeout(() => steam(at), k * 220);
  });
  prop('cooler', waterCooler(g, 11.5, WING.z0 + 0.3), () => { sfx.play('water'); bounce(D, D.props.find((p) => p.kind === 'cooler')?.group); });
  if (theme === 'library') {
    const aq = aquarium(g, -4.4, cz); D.fx.fish = aq.fish;
    prop('aquarium', aq.g, () => { sfx.play('bloop'); D.fx.feedUntil = performance.now() + 6000; });
    plant(-6.4, cz, 0.85, 'snake'); plant(-2.6, cz, 0.85, 'bush');
  } else if (theme === 'garden') {
    prop('planter', planterBox(g, -3.9, cz + 0.02, 0, 4.2, ['tree', 'bush', 'monstera', 'snake', 'tree']), 'wiggle');
  } else {
    prop('bench', bench(g, -4.4, cz + 0.05), 'bounce');
    plant(-6.0, cz, 0.85, 'monstera'); plant(-2.8, cz, 0.85, 'snake');
  }
  plant(1.75, cz, 0.85, 'bush'); plant(13.55, cz + 0.05, 1.0, 'monstera'); plant(7.2, cz, 0.8, 'snake');
  plant(WING.corB[0] + 0.45, WING.z1 - 0.45, 0.9, 'bush'); plant(WING.corB[1] - 0.45, WING.z1 - 0.45, 0.9, 'snake');

  /* fewer draw calls: each thing you can click merged inside its own group, the rest into one */
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  F.g.updateWorldMatrix(true, true);
  const keep = (m) => { if (m.material?.userData.live) return true; for (let q = m; q && q !== g; q = q.parent) if (q.userData.live || q.userData.noMerge) return true; return false; };
  const meshesOf = (o) => { const out = []; o.traverse((m) => { if (m.isMesh) out.push(m); }); return out; };
  const inProp = new Set();
  for (const [id, grp, kind, act, extra] of propList) {
    const before = meshesOf(grp), boxes = before.map((m) => new THREE.Box3().setFromObject(m)), box = new THREE.Box3();
    for (const b of boxes) box.union(b);
    mergeMeshes(before, grp, keep);
    const p = { id, kind, group: grp, name: tr(`team.tower.props.${kind}.name`), hint: `${tr(`team.tower.props.${kind}.hint`)} · ${tr('team.tower.local')}`, meshes: meshesOf(grp), box, boxes };
    p.act = act === 'wiggle' ? () => wiggle(D, grp) : act === 'bounce' ? () => bounce(D, grp) : act;
    if (extra?.seat) {
      const { i, k } = extra.seat; p.seat = extra.seat; p.name = tr('team.tower.props.desk.name', { n: i * 8 + k + 1 });
      Object.defineProperty(p, 'hint', { get: () => deskHint(D.rooms[i].view, k) });
    }
    D.props.push(p); inProp.add(grp);
  }
  const rest = [];
  g.traverse((o) => { if (o.isMesh) { for (let q = o.parent; q && q !== g; q = q.parent) if (inProp.has(q)) return; rest.push(o); } });
  const still = new THREE.Group(); still.name = 'merged'; g.add(still);
  mergeMeshes(rest, still, keep);

  /* filling it in, every frame */
  D.show = (i, room) => { D.rooms[i].view = room; };
  D.update = (dt, t) => update(D, dt, t);
  D.pick = (ray) => pick(D, ray);
  D.dispose = () => dispose(D);
  return D;
}

/* ---------- what it does ---------- */
// what pointing at a desk says: who sits there and what they are doing, or why you can't see
function deskHint(v, k) {
  if (!v?.name) return tr('team.tower.free');
  if (v.st === 'offline') return tr('team.offline');
  if (v.st === 'closed') return tr('team.tower.props.desk.closed');
  const p = v.bySeat.get(k);
  if (!p) return tr('team.tower.props.desk.empty');
  const act = p.status === 'work' && p.act && tr(`team.act.${p.act}`) !== `team.act.${p.act}` ? tr(`team.act.${p.act}`) : tr(`team.status.${p.status}`);
  return tr('team.tower.props.desk.busy', { who: [p.role, p.project].filter(Boolean).join(' · ') || tr('common.session'), what: act });
}
const lampOn = (L) => (L.on == null ? night && !!L.lit : L.on);
function paintLamp(L) { L.bulb.color.copy(lampOn(L) ? BULB_ON : BULB_OFF); }
function bounce(D, grp) { if (!reduceMotion && grp && !D.fx.bounces.some((b) => b.g === grp)) D.fx.bounces.push({ g: grp, t: 0, base: grp.scale.clone() }); }
function wiggle(D, grp) { sfx.play('rustle'); if (!reduceMotion && !D.fx.wiggles.some((w) => w.g === grp)) D.fx.wiggles.push({ g: grp, t: 0, rx: grp.rotation.x, rz: grp.rotation.z }); }
function steam(at) {
  const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.5, depthWrite: false }));
  m.position.set(at.x + rand(-0.03, 0.03), at.y, at.z + rand(-0.03, 0.03)); m.scale.setScalar(0.3); scene.add(m);
  particles.push({ m, v: new THREE.Vector3(rand(-0.04, 0.04), 0.32, rand(-0.04, 0.04)), life: 1.8, max: 1.8, kind: 'steam' });
}

/** room.view: { name, st, lit, bySeat: Map seat -> person, shadows, atDesk(person) } (world/team-tower.js fills it). */
function update(D, dt, t) {
  D.rooms.forEach((R, i) => {
    const v = R.view || { lit: false, bySeat: new Map(), shadows: 0, atDesk: () => false };
    R.screens.forEach((scr, k) => {
      const p = v.bySeat.get(k), here = p && v.atDesk(p);
      const kind = !v.lit ? 'off' : p ? (p.status === 'wait' ? 'wait' : p.status === 'rest' ? 'sleep' : kindOfAct(p.act)) : k < v.shadows ? 'code' : 'off';
      const busy = !!here && p.status === 'work';
      updateScreen(SCREEN0 + i * 8 + k, scr, kind, dt, busy);
      let target = 0.04;
      if (v.lit && p) target = p.status === 'rest' ? 0.3 : busy ? 0.85 + Math.sin(t * 30 + k) * 0.06 : 0.55;
      else if (v.lit && k < v.shadows) target = 0.35;
      if (night) target *= 1.5;
      scr.emissiveIntensity += (target - scr.emissiveIntensity) * Math.min(1, dt * 8);
    });
    // desk lamps: on after dark in a room someone is in
    const on = night && v.lit;
    if (R.lampsOn !== on) { R.lampsOn = on; for (const b of R.bulbs) b.color.copy(on ? BULB_ON : BULB_OFF); }
  });
  for (const L of D.lamps) { const lit = !!D.rooms[L.room].view?.lit; if (L.lit !== lit || L.night !== night) { L.lit = lit; L.night = night; paintLamp(L); } }
  const fx = D.fx, now = performance.now();
  for (let k = fx.bounces.length - 1; k >= 0; k--) {
    const b = fx.bounces[k]; b.t += dt; const q = Math.min(1, b.t / 0.45), sy = 1 + 0.06 * Math.sin(q * Math.PI * 3) * (1 - q);
    b.g.scale.set(b.base.x * (1 - (sy - 1) * 0.5), b.base.y * sy, b.base.z * (1 - (sy - 1) * 0.5));
    if (q >= 1) { b.g.scale.copy(b.base); fx.bounces.splice(k, 1); }
  }
  for (let k = fx.wiggles.length - 1; k >= 0; k--) {
    const w = fx.wiggles[k]; w.t += dt; const a = Math.max(0, 1 - w.t / 0.9) * 0.14;
    w.g.rotation.x = w.rx + Math.sin(w.t * 22) * a; w.g.rotation.z = w.rz + Math.cos(w.t * 19) * a;
    if (w.t > 0.9) { w.g.rotation.x = w.rx; w.g.rotation.z = w.rz; fx.wiggles.splice(k, 1); }
  }
  if (fx.coffee) fx.coffee.led.color.set(fx.brewUntil > now ? (Math.floor(now / 160) % 2 ? '#FFD166' : '#5BE37D') : '#5BE37D');
  if (fx.fish) {
    const fed = fx.feedUntil > now;
    for (const f of fx.fish) {
      f.f.position.x += f.dir * f.v * (fed ? 3.2 : 1) * dt;
      if (f.f.position.x > 0.62) f.dir = -1; else if (f.f.position.x < -0.62) f.dir = 1;
      f.f.rotation.y = f.dir > 0 ? 0 : Math.PI;
      f.f.position.y += Math.sin(t * 2 + f.ph) * 0.02 * dt * (fed ? 4 : 1);
      if (fed) f.f.position.y += (1.24 - f.f.position.y) * Math.min(1, dt * 1.5);
    }
  }
}

// what a ray hits first among the things you can click: { prop, d } or null (boxes, like interact/props.js)
const _hit = new THREE.Vector3();
function pick(D, ray) {
  let best = null, bd = Infinity;
  for (const p of D.props) {
    if (!ray.intersectBox(p.box, _hit)) continue;
    for (const b of p.boxes) if (ray.intersectBox(b, _hit)) { const d = ray.origin.distanceTo(_hit); if (d < bd) { bd = d; best = p; } }
  }
  return best ? { prop: best, d: bd } : null;
}

// geometry, materials and textures go with the floor, except anything the rest of the scene still uses (shared
// materials such as the metal of the legs, the photo in the desk frames, the screens' pictures)
function dispose(D) {
  const used = new Set();
  D.g.removeFromParent();
  scene.traverse((o) => {
    if (o.geometry) used.add(o.geometry);
    for (const m of [].concat(o.material || [])) { used.add(m); if (m.map) used.add(m.map); if (m.emissiveMap) used.add(m.emissiveMap); }
  });
  const gone = new Set();
  D.g.traverse((o) => {
    if (o.geometry && !used.has(o.geometry) && o.geometry !== puffGeo) gone.add(o.geometry);
    for (const m of [].concat(o.material || [])) {
      if (used.has(m)) continue;
      gone.add(m);
      if (!m.userData.keepMap) for (const tx of [m.map, m.emissiveMap]) if (tx && !used.has(tx)) gone.add(tx);
    }
  });
  for (const x of gone) x.dispose();
}
