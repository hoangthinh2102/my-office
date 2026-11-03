// Team mode's building in 3D (headquarters plan only; docs/features/team-mode.md): every other member's room on a floor
// above the wing, four to a floor (src/shared/team-floors.js), the team's lift at the back. Nothing of it is drawn until
// you look: "your floor" is the office as it always was; "the building" shows every floor from outside (glass fronts lit
// where someone is in); a floor shows its rooms from above, the floors over it lifted away.
// Open rooms: their people at their desks, a character each (view only). Closed rooms: smart glass, only shadows, one
// per person. Offline: lights out, empty chairs. The lift (ui/team-lift.js) chooses what you look at. The floor you are
// on is furnished in full (world/tower-floor.js): its own look, things to click, people who go to the break corner.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { HQ, el } from '../core/env.js';
import { state } from '../core/state.js';
import { BASE_ZOOM, HOME, camera, controls, renderer, scene } from '../scene/renderer.js';
import { focusTarget } from '../core/loop.js';
import { night } from './room-update.js';
import { DEPTS, WING } from './layout.js';
import { applyChibiPose, chibiPose, makeChibi } from '../people/chibi-rig.js';
import { PALETTE, hash } from '../people/workers.js';
import { fitText } from '../scene/blocks.js';
import { gridTex, plankTex, speckTex } from './pro/pieces.js';
import { furnishFloor, pathTo, roomPlan } from './tower-floor.js';
import { BREAK_SEATS, FLOOR_H, TOWER_Y0, floorY, floorsOf, seatPeople, seesIn, silhouettes, stateOf, themeOf } from '../../shared/team-floors.js';
import { t as tr } from '../../i18n/index.js';

const X0 = -8, X1 = 14, Z0 = WING.z0, Z1 = WING.z1, CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;
const INNER = FLOOR_H - 0.3, GLASS_H = 2.5, SEATS = 8;
const HAIRS = ['#3B2618', '#1E1A17', '#5A3A22', '#8A5A2B', '#2B2B33', '#B07A3F'];
const PANTS = ['#3A4150', '#2F3B52', '#4A4036', '#26292E', '#55606E'];
const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
// each room's desks: the wing's two pods of four (as world/desks.js lays them), the chair 0.66 m out on its own side
const DESKS = DEPTS.map((d) => d.pods.flatMap(([cx, cz]) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => {
  const ry = sz > 0 ? Math.PI : 0, x = cx + sx * 0.76, z = cz + sz * 0.375;
  return { x, z, ry, cx: x - 0.66 * Math.sin(ry), cz: z - 0.66 * Math.cos(ry) };
})));
// which sides of each room are glass onto a corridor (the rest: a low wall to the next room, or the building's glass)
const ROOM_GLASS = [
  [[DEPTS[0].x0, DEPTS[0].z0, DEPTS[0].x1, DEPTS[0].z0], [DEPTS[0].x1, DEPTS[0].z0, DEPTS[0].x1, DEPTS[0].z1]],
  [[DEPTS[1].x0, DEPTS[1].z0, DEPTS[1].x1, DEPTS[1].z0], [DEPTS[1].x0, DEPTS[1].z0, DEPTS[1].x0, DEPTS[1].z1]],
  [[DEPTS[2].x1, DEPTS[2].z0, DEPTS[2].x1, DEPTS[2].z1]],
  [[DEPTS[3].x0, DEPTS[3].z0, DEPTS[3].x0, DEPTS[3].z1]],
];
// the building's glass on the two sides the camera looks through, per room (lit when someone is in) and corridor
const FRONTS = [
  [['x', X0, DEPTS[0].z0, DEPTS[0].z1]],
  [['x', X1, DEPTS[1].z0, DEPTS[1].z1]],
  [['x', X0, DEPTS[2].z0, DEPTS[2].z1], ['z', Z1, DEPTS[2].x0, DEPTS[2].x1]],
  [['x', X1, DEPTS[3].z0, DEPTS[3].z1], ['z', Z1, DEPTS[3].x0, DEPTS[3].x1]],
];
const LIFT = { x0: WING.corB[0], x1: WING.corB[1], z0: Z0 + 0.05, z1: WING.corA[1] - 0.05 };

let M = null;              // shared materials and geometry, made the first time the building is needed
let tower = null, roof = null, columns = null, cab = null;
let floors = [];           // [{ n, y, g, rooms: [RoomView|null], inst, hits, label, dir }]
let layoutKey = '';
const seatsOf = new Map(); // member id -> Map person id -> seat (kept across updates)
const breakOf = new Map(); // member id -> Map person id -> break-corner seat, for whoever is resting
let detail = null;         // the floor you are on, furnished: { F, D } (world/tower-floor.js)
const chars = new Map();   // `${member}/${person}` -> { root, P, anim, seed, seat, room, floor }
export const view = { mode: 'mine', floor: 0 };
let minZoom0 = 0, cabY = TOWER_Y0, nightShown = null;

/* ---------- pieces ---------- */
function materials() {
  if (M) return M;
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
  const glass = (color, opacity, o = {}) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.08, metalness: 0.1, depthWrite: false, ...o });
  M = {
    box: new THREE.BoxGeometry(1, 1, 1), plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    body: new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), head: new THREE.SphereGeometry(0.17, 14, 10),
    slab: std('#2E343C', { roughness: 0.6, metalness: 0.2 }), mull: std('#3A414B', { roughness: 0.4, metalness: 0.5 }),
    low: std('#E6E0D6', { roughness: 0.9 }), column: std('#C9C4BB', { roughness: 0.7 }),
    desk: std('#F4F0E8', { roughness: 0.45 }), ped: std('#D8D3CA', { roughness: 0.6 }), chair: std('#596170', { roughness: 0.9 }), mon: std('#1B1F26', { roughness: 0.4 }),
    screen: new THREE.MeshBasicMaterial({ color: '#FFFFFF' }), bean: std('#FFFFFF', { roughness: 0.85 }), skin: std('#F0C8A4', { roughness: 0.7 }),
    shade: new THREE.MeshBasicMaterial({ color: '#3E4752', transparent: true, opacity: 0.7, depthWrite: false }),
    far: glass('#9DB7C8', 0.42), clear: glass('#CFE6F2', 0.14), frost: glass('#EEF2F5', 0.64, { roughness: 0.9, metalness: 0 }),
    shaftGlass: glass('#BFD8E6', 0.2), cab: std('#C9CED6', { metalness: 0.6, roughness: 0.35 }), cabLight: new THREE.MeshBasicMaterial({ color: '#FFE7B8' }),
    hit: new THREE.MeshBasicMaterial({ visible: false }),
  };
  return M;
}
// the corridors' floor in each look, and the rooms' carpet (tinted with the member's colour), drawn once
const TEX = {};
function tiled(key, make, w, d, tile) {
  const base = (TEX[key] ||= make()), t = base.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / tile, d / tile); t.needsUpdate = true; return t;
}
const CORRIDOR = {
  studio: [() => gridTex('#D7D2CA', 'rgba(120,110,100,.25)', 2), 1.2],
  garden: [() => plankTex(32, 74, 22), 3],
  library: [() => plankTex(24, 46, 34), 3],
};
const corridorMat = (theme, w, d) => new THREE.MeshStandardMaterial({ map: tiled(theme, CORRIDOR[theme][0], w, d, CORRIDOR[theme][1]), roughness: 0.6 });
const put = (g, mesh, x, y, z) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };
const block = (g, m, w, h, d, x, y, z) => { const o = put(g, new THREE.Mesh(M.box, m), x, y, z); o.scale.set(w, h, d); return o; };
// a glass pane from (ax, az) to (bx, bz), standing on the floor
function pane(g, m, ax, az, bx, bz, h, y0 = 0) {
  const len = Math.hypot(bx - ax, bz - az), o = block(g, m, len, h, 0.03, (ax + bx) / 2, y0 + h / 2, (az + bz) / 2);
  o.rotation.y = -Math.atan2(bz - az, bx - ax); o.renderOrder = 2; return o;
}
// many boxes of one material as a single draw: [[w, h, d, x, y, z, ry?], …]
function boxes(g, m, list, colors = false) {
  const im = new THREE.InstancedMesh(M.box, m, Math.max(1, list.length)), o = new THREE.Object3D();
  list.forEach(([w, h, d, x, y, z, ry = 0], i) => { o.position.set(x, y, z); o.rotation.set(0, ry, 0); o.scale.set(w, h, d); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.count = list.length;
  if (colors) for (let i = 0; i < list.length; i++) im.setColorAt(i, new THREE.Color('#1B1F26'));
  g.add(im); return im;
}
function canvasPlate(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { c, g: c.getContext('2d'), tex };
}
const shirtOf = (mid, pid) => PALETTE[hash(`${mid}/${pid}`) % PALETTE.length];
const accentOf = (mid) => PALETTE[hash(mid) % PALETTE.length];
const stText = (st) => tr(st === 'open' ? 'team.roomOpen' : st === 'shared' ? 'team.roomShared' : st === 'closed' ? 'team.roomClosed' : 'team.offline');

/* ---------- one floor ---------- */
function buildFloor(f) {
  const y = floorY(f.n), g = new THREE.Group(); g.position.y = y; g.name = `team-floor-${f.n}`;
  // slab (its dark edge is the band between two floors' glass), corridors, the lift lobby's directory
  block(g, M.slab, X1 - X0 + 0.3, 0.3, Z1 - Z0 + 0.3, CX, -0.15, CZ);
  const theme = themeOf(f.n), aw = X1 - X0, ad = WING.corA[1] - WING.corA[0], bw = WING.corB[1] - WING.corB[0], bd = Z1 - WING.corA[1];
  const corA = put(g, new THREE.Mesh(M.plane, corridorMat(theme, aw, ad)), CX, 0.005, (WING.corA[0] + WING.corA[1]) / 2); corA.scale.set(aw, 1, ad);
  const corB = put(g, new THREE.Mesh(M.plane, corridorMat(theme, bw, bd)), (WING.corB[0] + WING.corB[1]) / 2, 0.005, (WING.corA[1] + Z1) / 2); corB.scale.set(bw, 1, bd);
  // the building's glass: tinted on the far sides, clear on the near ones (per room, below), mullions all round
  pane(g, M.far, X0, Z0, X1, Z0, INNER); pane(g, M.far, X0, Z0, X0, WING.corA[1], INNER);
  const near = [pane(g, M.clear, X1, Z0, X1, WING.corA[1], INNER), pane(g, M.clear, WING.corB[0], Z1, WING.corB[1], Z1, INNER)];
  // frameless glass: no mullions between the panes, only a post at each corner (the building's frame)
  const post = (x, z) => [0.16, INNER, 0.16, x, INNER / 2, z];
  boxes(g, M.mull, [post(X0, Z0)]); near.push(boxes(g, M.mull, [post(X1, Z0), post(X0, Z1), post(X1, Z1)]));
  // on the floor you are on, the two sides toward the camera are a low glass railing instead (nothing in the way)
  const rail = new THREE.Group(); rail.visible = false; g.add(rail);
  pane(rail, M.clear, X1, Z0, X1, Z1, 1.05); pane(rail, M.clear, X0, Z1, X1, Z1, 1.05);   // (frameless too)
  // low walls between the rooms, back to back
  boxes(g, M.low, [[DEPTS[0].x1 - DEPTS[0].x0, 1.3, 0.14, (DEPTS[0].x0 + DEPTS[0].x1) / 2, 0.65, WING.split], [DEPTS[1].x1 - DEPTS[1].x0, 1.3, 0.14, (DEPTS[1].x0 + DEPTS[1].x1) / 2, 0.65, WING.split]]);
  // the desks of all four rooms; screens, chairs, people and shadows as one draw each
  const all = DESKS.flat();
  const simple = [boxes(g, M.desk, all.map((d) => [1.5, 0.05, 0.74, d.x, 0.75, d.z, d.ry]))];
  simple.push(boxes(g, M.ped, all.map((d) => [0.4, 0.7, 0.55, d.x + 0.45 * Math.cos(d.ry), 0.35, d.z - 0.45 * Math.sin(d.ry) + 0.04 * Math.cos(d.ry), d.ry])));
  simple.push(boxes(g, M.mon, all.map((d) => [0.6, 0.38, 0.04, d.x, 1.02, d.z + 0.24 * Math.cos(d.ry), d.ry])));
  const screens = boxes(g, M.screen, all.map((d) => [0.54, 0.32, 0.01, d.x, 1.02, d.z + 0.215 * Math.cos(d.ry), d.ry]), true);
  simple.push(screens, boxes(g, M.chair, all.flatMap((d) => [[0.54, 0.09, 0.52, d.cx, 0.45, d.cz, d.ry], [0.5, 0.56, 0.09, d.cx - 0.27 * Math.sin(d.ry), 0.8, d.cz - 0.27 * Math.cos(d.ry), d.ry]])));
  const bodies = new THREE.InstancedMesh(M.body, M.bean, all.length), heads = new THREE.InstancedMesh(M.head, M.skin, all.length);
  const shades = new THREE.InstancedMesh(M.body, M.shade, all.length), hits = new THREE.InstancedMesh(M.box, M.hit, all.length);
  for (const im of [bodies, heads, shades, hits]) { im.count = 0; g.add(im); }
  bodies.setColorAt(0, new THREE.Color('#FFFFFF')); shades.renderOrder = 1;
  // what the room clicks land on (a closed room's glass lid, an open room's floor), and the whole floor from outside
  const roomHits = DEPTS.map((d, i) => { const m = put(g, new THREE.Mesh(M.plane, M.hit), (d.x0 + d.x1) / 2, 0.02, d.cz); m.scale.set(d.x1 - d.x0, 1, d.z1 - d.z0); m.userData.tw = { kind: 'room', floor: f.n, i }; return m; });
  const floorHit = block(g, M.hit, X1 - X0, FLOOR_H, Z1 - Z0, CX, FLOOR_H / 2 - 0.3, CZ); floorHit.userData.tw = { kind: 'floor', floor: f.n };
  // this floor's piece of the lift shaft: glass and four posts, slab to slab (a floor lifted away takes its piece along)
  { const sw = LIFT.x1 - LIFT.x0, sd = LIFT.z1 - LIFT.z0, scx = (LIFT.x0 + LIFT.x1) / 2, scz = (LIFT.z0 + LIFT.z1) / 2, h = INNER;
    boxes(g, M.mull, [[0.08, h, 0.08, LIFT.x0, h / 2, LIFT.z0], [0.08, h, 0.08, LIFT.x1, h / 2, LIFT.z0], [0.08, h, 0.08, LIFT.x0, h / 2, LIFT.z1], [0.08, h, 0.08, LIFT.x1, h / 2, LIFT.z1]]);
    block(g, M.shaftGlass, sw, h, sd, scx, h / 2, scz).renderOrder = 2; }
  // the floor's directory by the lift: "Floor n" and its four rooms
  const dir = canvasPlate(512, 360);
  const dirM = new THREE.MeshBasicMaterial({ map: dir.tex, toneMapped: false });
  block(g, M.mull, 1.0, 1.55, 0.08, LIFT.x1 + 0.9, 0.78, WING.corA[1] - 0.2);
  const face = put(g, new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.63), dirM), LIFT.x1 + 0.9, 1.15, WING.corA[1] - 0.155);
  face.userData.own = true;
  // the floor's name, seen from outside
  const lab = el('div', 'tw-floor-tag'); const label = new CSS2DObject(lab); label.position.set(X1 + 0.4, INNER * 0.55, Z1 + 0.4); g.add(label);
  // (the simple desks and chairs: what the floor shows until you are on it, when world/tower-floor.js furnishes it)
  const F = { n: f.n, y, g, theme, simple, near, rail, rooms: [], screens, bodies, heads, shades, hits, roomHits, floorHit, dir, dirM, face, label, lab, hitInfo: [] };
  F.rooms = DEPTS.map((d, i) => roomView(F, i));
  for (const R of F.rooms) near.push(...R.fronts);
  tower.add(g);
  return F;
}

// a room on a floor: its carpet, glass, smart-glass lid, its share of the building's front, its name tag
function roomView(F, i) {
  const d = DEPTS[i], g = F.g;
  const carpetM = new THREE.MeshStandardMaterial({ color: '#5E6B7D', map: tiled('carpet', () => speckTex('#F2F2F2', 3000, 0.08), d.x1 - d.x0, d.z1 - d.z0, 0.8), roughness: 0.95, emissive: '#FFD9A0', emissiveIntensity: 0 });
  const carpet = put(g, new THREE.Mesh(M.plane, carpetM), (d.x0 + d.x1) / 2, 0.004, d.cz); carpet.scale.set(d.x1 - d.x0, 1, d.z1 - d.z0);
  const glass = ROOM_GLASS[i].flatMap((seg) => withDoor(d, seg)).map(([ax, az, bx, bz]) => pane(g, M.clear, ax, az, bx, bz, GLASS_H));
  const lid = put(g, new THREE.Mesh(M.plane, M.frost), (d.x0 + d.x1) / 2, GLASS_H, d.cz); lid.scale.set(d.x1 - d.x0, 1, d.z1 - d.z0); lid.renderOrder = 3; lid.visible = false;
  const frontM = new THREE.MeshStandardMaterial({ color: '#BFD8E6', transparent: true, opacity: 0.18, roughness: 0.08, metalness: 0.1, depthWrite: false, emissive: '#FFD9A0', emissiveIntensity: 0 });
  const fronts = FRONTS[i].map(([ax, at, a0, a1]) => (ax === 'x' ? pane(g, frontM, at, a0, at, a1, INNER) : pane(g, frontM, a0, at, a1, at, INNER)));
  const tagEl = el('div', 'tw-tag'), tag = new CSS2DObject(tagEl); tag.position.set((d.x0 + d.x1) / 2, GLASS_H + 0.5, d.cz); g.add(tag);
  return { i, room: null, key: '', carpetM, glass, lid, frontM, fronts, tag, tagEl, extra: 0 };
}

// a room's glass side, with a doorway (1.2 m) where the room's door is on it
function withDoor(d, [ax, az, bx, bz]) {
  const { side, at } = d.door;
  const on = side === 'n' ? az === bz && az === d.z0 : ax === bx && ax === (side === 'e' ? d.x1 : d.x0);
  if (!on) return [[ax, az, bx, bz]];
  return az === bz ? [[Math.min(ax, bx), az, at - 0.6, az], [at + 0.6, az, Math.max(ax, bx), az]] : [[ax, Math.min(az, bz), ax, at - 0.6], [ax, at + 0.6, ax, Math.max(az, bz)]];
}

function buildShell(n) {
  // columns carrying the building over the wing's open sides (seen from outside only), the lift's cab, the roof
  const g = new THREE.Group(); g.name = 'team-shell'; tower.add(g);
  const cols = [[X1, Z0], [X1, CZ], [X1, Z1], [CX, Z1], [X0, Z1]].map(([x, z]) => [0.36, TOWER_Y0 - 0.3, 0.36, x, (TOWER_Y0 - 0.3) / 2, z]);
  columns = boxes(g, M.column, cols);
  const top = floorY(n + 1);
  const sw = LIFT.x1 - LIFT.x0, sd = LIFT.z1 - LIFT.z0, scx = (LIFT.x0 + LIFT.x1) / 2, scz = (LIFT.z0 + LIFT.z1) / 2;
  cab = new THREE.Group(); g.add(cab); cab.position.set(scx, cabY, scz);
  block(cab, M.cab, sw - 0.25, 0.08, sd - 0.2, 0, 0.04, 0); block(cab, M.cab, sw - 0.25, 0.08, sd - 0.2, 0, 2.36, 0);
  block(cab, M.cab, 0.06, 2.3, sd - 0.2, -(sw - 0.25) / 2, 1.2, 0); block(cab, M.cab, 0.06, 2.3, sd - 0.2, (sw - 0.25) / 2, 1.2, 0);
  block(cab, M.cabLight, sw - 0.5, 0.02, sd - 0.5, 0, 2.31, 0);
  // the roof: a parapet round it, the machines on it
  roof = new THREE.Group(); roof.position.y = top; g.add(roof);
  block(roof, M.slab, X1 - X0 + 0.3, 0.3, Z1 - Z0 + 0.3, CX, -0.15, CZ);
  boxes(roof, M.slab, [[X1 - X0 + 0.3, 0.6, 0.15, CX, 0.3, Z0 - 0.08], [X1 - X0 + 0.3, 0.6, 0.15, CX, 0.3, Z1 + 0.08], [0.15, 0.6, Z1 - Z0 + 0.3, X0 - 0.08, 0.3, CZ], [0.15, 0.6, Z1 - Z0 + 0.3, X1 + 0.08, 0.3, CZ]]);
  boxes(roof, M.column, [[2.4, 1.2, 1.6, X0 + 3, 0.6, Z0 + 2.5], [1.6, 0.9, 1.6, X0 + 6.5, 0.45, Z0 + 2.5], [sw + 0.4, 1.4, sd + 0.4, scx, 0.7, scz]]);
}

function dispose(o) {
  o.traverse((x) => {
    if (x.isCSS2DObject) x.element.remove();
    if (x.isInstancedMesh) x.dispose();
    if (x.isMesh && x.geometry !== M.box && x.geometry !== M.plane && x.geometry !== M.body && x.geometry !== M.head) x.geometry.dispose();
    for (const m of [].concat(x.material || [])) if (!Object.values(M).includes(m)) { m.map?.dispose(); m.dispose(); }
    for (const t of x.userData.disposeMe || []) t.dispose();
  });
}

/* ---------- filling it in ---------- */
function rebuild(fl) {
  clearChars(); dropDetail();
  if (tower) { dispose(tower); scene.remove(tower); }
  tower = new THREE.Group(); tower.name = 'team-tower'; tower.visible = view.mode !== 'mine'; tower.userData.noMerge = true;
  scene.add(tower);
  floors = fl.map(buildFloor);
  buildShell(fl.length);
  nightShown = null;
}

const screenColor = { work: new THREE.Color('#8FD3FF'), wait: new THREE.Color('#FFC861'), rest: new THREE.Color('#33404F'), none: new THREE.Color('#1B1F26') };
const _o = new THREE.Object3D(), _c = new THREE.Color();
function fillFloor(F) {
  let nb = 0, ns = 0, nh = 0;
  F.hitInfo = [];
  for (const R of F.rooms) {
    const r = R.room, st = r ? stateOf(r) : 'empty';
    R.carpetM.color.set(!r ? '#4A4F57' : st === 'offline' ? '#474C55' : accentOf(r.member.id)).multiplyScalar(st === 'offline' || !r ? 1 : 0.62);
    for (const p of R.glass) p.material = st === 'closed' ? M.frost : M.clear;
    R.lid.visible = st === 'closed';
    R.frontM.color.set(st === 'closed' ? '#E6ECF0' : '#BFD8E6'); R.frontM.opacity = st === 'closed' ? 0.7 : 0.18;
    R.lit = r && st !== 'offline';
    // name tag over the room
    R.tagEl.replaceChildren();
    if (r) {
      const dot = el('i'); dot.style.background = accentOf(r.member.id);
      R.tagEl.append(dot, el('b', null, r.member.name), el('span', `tw-st is-${st}`, stText(st)));
      if (seesIn(st) && R.extra) R.tagEl.append(el('span', 'tw-more', `+${R.extra}`));
    }
    // screens: what the person at each desk is doing; people at desks in rooms you can see into, shadows behind closed glass
    const seats = r && seesIn(st) ? seatsOf.get(r.member.id) || new Map() : new Map();
    const bySeat = new Map(); for (const p of (r?.people || [])) { const k = seats.get(p.id); if (k !== undefined) bySeat.set(k, p); }
    const shadows = st === 'closed' ? silhouettes(r) : 0;
    R.bySeat = bySeat; R.shadows = shadows;
    DESKS[R.i].forEach((dk, k) => {
      const idx = R.i * SEATS + k, p = bySeat.get(k);
      F.screens.setColorAt(idx, p ? screenColor[p.status] || screenColor.rest : k < shadows ? screenColor.rest : screenColor.none);
      if (p) {
        _o.position.set(dk.cx, 0.82, dk.cz); _o.rotation.set(0, dk.ry, 0); _o.scale.set(1, 1, 1); _o.updateMatrix();
        F.bodies.setMatrixAt(nb, _o.matrix); F.bodies.setColorAt(nb, _c.set(shirtOf(r.member.id, p.id)));
        _o.position.y = 1.32; _o.updateMatrix(); F.heads.setMatrixAt(nb, _o.matrix); nb++;
        _o.position.set(dk.cx, 0.9, dk.cz); _o.scale.set(0.5, 1.2, 0.5); _o.updateMatrix(); F.hits.setMatrixAt(nh, _o.matrix);
        F.hitInfo[nh++] = { kind: 'person', floor: F.n, i: R.i, member: r.member.id, person: p.id };
      } else if (k < shadows) {
        _o.position.set(dk.cx, 0.82, dk.cz); _o.rotation.set(0, dk.ry, 0); _o.scale.set(1, 1, 1); _o.updateMatrix(); F.shades.setMatrixAt(ns++, _o.matrix);
      }
    });
  }
  F.bodies.count = nb; F.heads.count = nb; F.shades.count = ns; F.hits.count = nh;
  for (const im of [F.bodies, F.heads, F.shades, F.hits]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere?.(); }
  F.screens.instanceColor.needsUpdate = true;
  drawDirectory(F);
  const names = F.rooms.filter((R) => R.room).map((R) => R.room.member.name);
  F.lab.replaceChildren(el('b', null, tr('team.floor', { n: F.n })), el('span', null, names.length ? names.join(' · ') : tr('team.lift.emptyFloor')));
  nightShown = null;
  showDetail(F);
}

function drawDirectory(F) {
  const { g, tex } = F.dir;
  g.fillStyle = '#1E232B'; g.fillRect(0, 0, 512, 360);
  g.fillStyle = '#F3EFE8'; g.font = `800 46px ${FONT}`; g.textBaseline = 'middle'; g.fillText(tr('team.floor', { n: F.n }), 28, 48);
  g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(28, 84, 456, 2);
  F.rooms.forEach((R, k) => {
    const y = 128 + k * 60, r = R.room;
    if (!r) { g.fillStyle = '#6B7380'; g.font = `600 28px ${FONT}`; g.fillText('—', 28, y); return; }
    const st = stateOf(r);
    g.fillStyle = accentOf(r.member.id); g.fillRect(28, y - 18, 8, 36);
    g.fillStyle = st === 'offline' ? '#8A93A0' : '#F3EFE8'; g.font = `700 32px ${FONT}`; fitText(g, r.member.name, 300); g.fillText(r.member.name, 50, y);
    g.font = `600 24px ${FONT}`; g.fillStyle = st === 'open' ? '#7FD69A' : st === 'shared' ? '#9CC8F0' : st === 'closed' ? '#C9D1DB' : '#7A828E';
    const s = stText(st);
    g.textAlign = 'right'; g.fillText(s, 484, y); g.textAlign = 'left';
  });
  tex.needsUpdate = true;
}

/** The relay's state (ui/team.js onTeam): builds the floors when who is on them changes, else just refills them. */
export function syncTower(t) {
  if (!HQ) return;
  const rooms = t?.inTeam ? t.rooms || [] : [];
  // in a team with nobody else in it yet: one floor of empty rooms, so there is a building to look at
  const theirs = floorsOf(rooms), fl = t?.inTeam && !theirs.length ? [{ n: 1, rooms: [] }] : theirs;
  if (!fl.length) { if (tower) { clearChars(); dropDetail(); dispose(tower); scene.remove(tower); tower = null; floors = []; layoutKey = ''; } if (view.mode !== 'mine') goTower('mine'); return; }
  materials();
  const key = fl.map((f) => f.rooms.map((r) => r.member.id).join(',')).join('|');
  if (key !== layoutKey) { layoutKey = key; rebuild(fl); }
  for (const f of fl) {
    const F = floors[f.n - 1];
    F.rooms.forEach((R, i) => {
      const r = f.rooms[i] || null; R.room = r;
      if (r && seesIn(stateOf(r))) {
        const s = seatPeople(r.people, seatsOf.get(r.member.id)); seatsOf.set(r.member.id, s.seats); R.extra = s.extra;
        // whoever is resting may go and sit in the room's break corner (on the floor you are on)
        const b = seatPeople((r.people || []).filter((p) => p.status === 'rest' && s.seats.has(p.id)), breakOf.get(r.member.id), BREAK_SEATS); breakOf.set(r.member.id, b.seats);
      } else R.extra = 0;
    });
    fillFloor(F);
  }
  if (view.mode === 'floor' && view.floor > floors.length) goTower('all');
  else applyView();
}
export const towerFloors = () => floors.length;
export const towerRoom = (floor, i) => floors[floor - 1]?.rooms[i]?.room || null;

/* ---------- the floor you are on, in full (world/tower-floor.js) ---------- */
function dropDetail() {
  if (!detail) return;
  detail.D.dispose(); for (const o of detail.F.simple) o.visible = true; detail = null;
}
function ensureDetail() {
  const F = view.mode === 'floor' ? floors[view.floor - 1] : null;
  if (detail && detail.F === F) return;
  dropDetail();
  if (!F) return;
  const accents = F.rooms.map((R) => (R.room ? accentOf(R.room.member.id) : null));
  detail = { F, D: furnishFloor(F, F.n, F.theme, DESKS, accents), plaques: [] };
  for (const o of F.simple) o.visible = false;
  showDetail(F);
}
// the furnished floor follows the rooms: door plaques, screens, lamps
function showDetail(F) {
  if (detail?.F !== F) return;
  for (const R of F.rooms) {
    const r = R.room, st = r ? stateOf(r) : 'empty', key = r ? `${r.member.name}|${st}` : 'empty', DR = detail.D.rooms[R.i];
    if (detail.plaques[R.i] !== key) {
      detail.plaques[R.i] = key;
      if (r) DR.plaque(r.member.name, stText(st), st === 'offline'); else DR.plaque(tr('team.tower.free'), tr('team.floor', { n: F.n }), true);
    }
    const mid = r?.member.id;
    detail.D.show(R.i, { lit: !!R.lit, bySeat: R.bySeat || new Map(), shadows: R.shadows || 0, atDesk: (p) => { const c = chars.get(`${mid}/${p.id}`); return !c || c.st === 'desk'; } });
  }
}

/* ---------- looking at it ---------- */
function clearChars() {
  for (const c of chars.values()) { c.root.removeFromParent(); dispose(c.root); }
  chars.clear();
}
const ANIM = { work: 'type', wait: 'hand', rest: 'coffee' };
// the people of the floor you are on, as characters (view only: nothing about them is a session of yours)
function syncChars() {
  const want = new Map(), F = view.mode === 'floor' ? floors[view.floor - 1] : null;
  if (F) for (const R of F.rooms) {
    const r = R.room; if (!r || !seesIn(stateOf(r))) continue;
    const seats = seatsOf.get(r.member.id) || new Map();
    const brk = breakOf.get(r.member.id) || new Map();
    for (const p of r.people || []) { const k = seats.get(p.id); if (k !== undefined) want.set(`${r.member.id}/${p.id}`, { R, r, p, k, b: detail?.F === F && p.status === 'rest' ? brk.get(p.id) : undefined }); }
  }
  for (const [key, c] of chars) if (!want.has(key) || want.get(key).k !== c.seat || c.floor !== view.floor) { c.root.removeFromParent(); dispose(c.root); chars.delete(key); }
  for (const [key, w] of want) {
    let c = chars.get(key);
    if (!c) {
      const h = hash(key), { root, P } = makeChibi({ name: key, shirt: shirtOf(w.r.member.id, w.p.id), hair: HAIRS[h % HAIRS.length], pants: PANTS[(h >> 3) % PANTS.length], look: state.LOOK }, 1);
      root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.userData.tw = { kind: 'person', floor: view.floor, i: w.R.i, member: w.r.member.id, person: w.p.id }; });
      // at their desk, or already in the break corner when you arrive while they rest
      const dk = DESKS[w.R.i][w.k], s = w.b !== undefined ? roomPlan(w.R.i).seats[w.b] : null;
      root.position.set(s ? s.x : dk.cx, 0, s ? s.z : dk.cz); root.rotation.y = s ? s.ry : dk.ry;
      F.g.add(root);
      c = { root, P, seat: w.k, i: w.R.i, floor: view.floor, seed: (h % 1000) / 100, anim: 'type', st: s ? 'break' : 'desk', brk: w.b, leaveAt: 0 };
      chars.set(key, c);
    }
    c.anim = ANIM[w.p.status] || 'type'; c.want = w.b;
  }
  // the simple figures stand in for whoever has a character now
  for (const G of floors) { G.bodies.visible = G.heads.visible = !(F && G === F); }
}

function applyView() {
  if (!tower) return;
  const m = view.mode;
  tower.visible = m !== 'mine';
  for (const F of floors) {
    F.g.visible = m === 'all' || (m === 'floor' && F.n <= view.floor);
    F.label.visible = m === 'all';
    for (const R of F.rooms) R.tag.visible = m === 'floor' && F.n === view.floor && !!R.room;
    const here = m === 'floor' && F.n === view.floor;
    F.face.visible = here; F.rail.visible = here;
    for (const o of F.near) o.visible = !here;
  }
  if (roof) roof.visible = m === 'all';
  if (columns) columns.visible = m === 'all';   // (inside a floor they only stick out)
  ensureDetail();
  syncChars();
}

/** 'mine' (your own office), 'all' (the whole building from outside) or a floor number. */
export function goTower(to) {
  if (!HQ) return;
  if (!minZoom0) minZoom0 = controls.minZoom;
  if (to === 'mine' || !floors.length) {
    view.mode = 'mine'; view.floor = 0; state.towerView = null;
    controls.minZoom = minZoom0; focusTarget.copy(HOME); state.zoomGoal = BASE_ZOOM;
  } else if (to === 'all') {
    view.mode = 'all'; view.floor = 0; state.towerView = 'all';
    const top = floorY(floors.length + 1) + 2;
    controls.minZoom = 0.1;
    focusTarget.set(CX + 1, top * 0.42, CZ - 1);
    state.zoomGoal = Math.max(0.12, Math.min(BASE_ZOOM, (2 * camera.top) / (top * 1.05 + 22)));
  } else {
    const n = Math.max(1, Math.min(floors.length, Number(to) || 1));
    view.mode = 'floor'; view.floor = n; state.towerView = n;
    controls.minZoom = Math.min(minZoom0, 0.3);
    focusTarget.set(CX, floorY(n) + 0.6, CZ + 0.6);
    state.zoomGoal = BASE_ZOOM * 1.45;
  }
  state.lastUserCam = performance.now();
  applyView();
  onViewHooks.forEach((f) => f(view));
}
export const onViewHooks = [];

/** What a click (ui/whiteboard.js's ray) lands on in the building: { kind: 'floor' | 'room' | 'person', floor, i, … }. */
export function pickTower(ray) {
  if (!tower || view.mode === 'mine') return null;
  if (view.mode === 'all') {
    const hit = ray.intersectObjects(floors.map((F) => F.floorHit), false)[0];
    return hit ? hit.object.userData.tw : null;
  }
  const F = floors[view.floor - 1]; if (!F) return null;
  // the people are characters on this floor (they may be in the break corner, not at their desk)
  const objs = [...F.roomHits];
  for (const c of chars.values()) objs.push(c.root);
  const hit = ray.intersectObjects(objs, true)[0], info = hit?.object.userData.tw || null;
  // something to click (a plant, the coffee machine), unless someone stands in front of it
  const pp = detail?.F === F ? detail.D.pick(ray.ray) : null;
  if (pp && (!info || info.kind === 'room' || pp.d < hit.distance - 0.3)) return { kind: 'prop', floor: F.n, prop: pp.prop };
  if (info) return info;
  // anywhere else on this floor (a corridor, a wall): still the building, not your own office under it
  const r = ray.ray, k = r.direction.y ? (F.y - r.origin.y) / r.direction.y : -1, x = r.origin.x + r.direction.x * k, z = r.origin.z + r.direction.z * k;
  return k > 0 && x > X0 && x < X1 && z > Z0 && z < Z1 ? { kind: 'none', floor: F.n } : null;
}

/* ---------- every frame ---------- */
const WALK = 1.15;   // m/s
const SIT_UP = { studio: 0.08, garden: -0.04, library: 0.06 };   // a sofa seat is higher than an office chair, a bean bag lower
// someone resting walks to the break corner after a moment, and back to the desk when they start again
function walk(c, dt, t) {
  const dk = DESKS[c.i][c.seat], seats = roomPlan(c.i).seats;
  if (c.st === 'desk') {
    if (c.want === undefined || !detail) { c.leaveAt = 0; return; }
    if (!c.leaveAt) { c.leaveAt = t + 1.5 + (c.seed % 6); return; }
    if (t < c.leaveAt) return;
    c.brk = c.want; c.path = pathTo(c.i, dk, seats[c.brk]); c.seg = 0; c.st = 'out'; c.leaveAt = 0;
  } else if (c.st === 'break') {
    if (c.want === c.brk) return;
    c.path = pathTo(c.i, dk, seats[c.brk]).reverse(); c.seg = 0; c.st = 'back';
  }
  let left = dt * WALK;
  while (left > 0 && c.seg < c.path.length - 1) {
    const [bx, bz] = c.path[c.seg + 1], dx = bx - c.root.position.x, dz = bz - c.root.position.z, dist = Math.hypot(dx, dz);
    if (dist > 1e-4) c.root.rotation.y = Math.atan2(dx, dz);
    if (dist <= left) { c.root.position.x = bx; c.root.position.z = bz; c.seg++; left -= dist; } else { c.root.position.x += (dx / dist) * left; c.root.position.z += (dz / dist) * left; left = 0; }
  }
  if (c.seg >= c.path.length - 1) {
    if (c.st === 'out') { c.st = 'break'; c.root.rotation.y = seats[c.brk].ry; } else { c.st = 'desk'; c.root.rotation.y = dk.ry; }
  }
}
export function updateTower(dt, t) {
  if (!tower || view.mode === 'mine') return;
  // your own office's things need your own floor: picking a session or walking in takes you back down
  if (state.selectedId || state.photo) { goTower('mine'); return; }
  for (const c of chars.values()) {
    walk(c, dt, t);
    const moving = c.st === 'out' || c.st === 'back', anim = moving ? 'walk' : c.st === 'break' ? 'coffee' : c.anim;
    const pose = chibiPose(c.P, anim, t + c.seed, { sit: !moving, blink: ((t + c.seed) % 4.2) < 0.12 });
    c.root.position.y = applyChibiPose(c.P, pose, dt) + (c.st === 'break' ? SIT_UP[detail?.F.theme] || 0 : 0);
  }
  if (detail) detail.D.update(dt, t);
  // the lift glides to the floor you are on (the ground: it waits at floor 1)
  const goal = floorY(view.mode === 'floor' ? view.floor : 1);
  if (cab && Math.abs(goal - cabY) > 0.005) { cabY += (goal - cabY) * Math.min(1, dt * 2.2); cab.position.y = cabY; }
  // lights: warm in every room someone is in, brighter after dark
  if (nightShown !== night) {
    nightShown = night;
    for (const F of floors) for (const R of F.rooms) {
      R.carpetM.emissiveIntensity = R.lit ? (night ? 0.22 : 0.04) : 0;
      R.frontM.emissiveIntensity = R.lit ? (night ? 0.9 : 0.12) : 0;
    }
  }
}

export function setup() {
  view.mode = 'mine';
  // ?debug: the tests' hooks (where a seat is on screen, what is drawn)
  if (HQ && new URLSearchParams(location.search).has('debug')) setTimeout(function hook() {
    if (!window.__office) { setTimeout(hook, 200); return; }
    window.__office.tower = {
      get view() { return { ...view }; }, get floors() { return floors.length; }, get chars() { return chars.size; },
      seatPoint(floor, i, k) {
        const dk = DESKS[i]?.[k]; if (!dk) return null;
        const v = new THREE.Vector3(dk.cx, floorY(floor) + 1.0, dk.cz).project(camera), r = document.getElementById('stage').getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      // the furnished floor: its look, what can be clicked (and where it is on screen), who is where, draw calls
      get detail() {
        if (!detail) return null;
        const r = document.getElementById('stage').getBoundingClientRect(), at = (p) => { const v = new THREE.Vector3(); p.box.getCenter(v); v.project(camera); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; };
        return { floor: detail.F.n, theme: detail.F.theme, props: detail.D.props.map((p) => ({ id: p.id, kind: p.kind, ...at(p) })), chars: [...chars.values()].map((c) => c.st), meshes: drawn(detail.D.g) };
      },
      prop(id) { detail?.D.props.find((p) => p.id === id)?.act(); },
    };
    const drawn = (root) => { let n = 0; root.traverseVisible((o) => { if (o.isMesh) n++; }); return n; };
    window.__office.tower.drawn = () => drawn(scene);
    window.__office.tower.memory = () => ({ ...renderer.info.memory });
  }, 0);
}
