// 3D models of your own in the office: glTF / GLB files (made with an image-to-3D model such as NVIDIA's on Hugging
// Face, TRELLIS, Hunyuan3D, or bought, or from Blender) dropped into public/assets/models/ and listed in
// public/assets/models/manifest.json. Each entry places one model:
//
//   { "file": "sofa.glb", "at": [8.2, 0, 4.1], "rotY": 90, "scale": 1, "fit": 1.8, "layout": "pro", "shadow": true }
//
//   at      metres on the floor plan (x, y, z); y 0 is the floor
//   rotY    degrees round the vertical axis
//   scale   a factor; or `fit`: scale it so its longest side is that many metres (generated models come in any size)
//   layout  'pro', 'cozy', 'hq' or 'all' (default)
//
// No manifest: nothing happens (the office is all built in code, as before). Models load after the office has started,
// so a big file never holds up the first frame; they are kept out of the static-mesh merge (core/optimize.js).
// See docs/3D-ASSETS.md for making models and keeping them light.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LAYOUT, STATIC } from '../core/env.js';
import { scene } from '../scene/renderer.js';
import { TOKEN } from '../net/live.js';
import { DEMO } from '../demo/demo.js';

const BASE = `${process.env.NEXT_PUBLIC_SITE_ROOT || ''}/assets/models/`;
const MAX_FILES = 40;
export const loaded = [];   // { entry, root } for the ones in the scene

function place(entry, gltf) {
  const root = gltf.scene || gltf.scenes?.[0]; if (!root) return null;
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  let k = Number(entry.scale) || 1;
  if (entry.fit) { const longest = Math.max(size.x, size.y, size.z) || 1; k = Number(entry.fit) / longest; }
  // stand it on the floor, centred on its spot
  const centre = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  root.position.set(-centre.x, -box.min.y, -centre.z);
  holder.add(root);
  holder.scale.setScalar(k);
  const [x = 0, y = 0, z = 0] = Array.isArray(entry.at) ? entry.at.map(Number) : [];
  holder.position.set(x, y, z);
  holder.rotation.y = ((Number(entry.rotY) || 0) * Math.PI) / 180;
  holder.userData.noMerge = true; holder.userData.noCollide = true; holder.userData.model = entry.file;
  holder.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.noMerge = true;
    o.castShadow = entry.shadow !== false; o.receiveShadow = true;
    // generated models often come with one huge texture: keep mipmaps and anisotropy sane
    for (const m of [].concat(o.material || [])) for (const t of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[t]) { m[t].anisotropy = 4; m[t].needsUpdate = true; }
  });
  scene.add(holder);
  return holder;
}

export async function loadModels() {
  if (STATIC || DEMO) return;
  let list;
  try {
    const r = await fetch(`/api/models${TOKEN ? `?k=${encodeURIComponent(TOKEN)}` : ''}`, { cache: 'no-store' });   // (the server reads the manifest)
    if (!r.ok) return;
    list = await r.json();
  } catch { return; }
  const entries = (Array.isArray(list) ? list : list?.models || []).filter((e) => e && typeof e.file === 'string' && /^[\w./-]+\.(glb|gltf)$/i.test(e.file) && !e.file.includes('..'))
    .filter((e) => !e.layout || e.layout === 'all' || e.layout === LAYOUT).slice(0, MAX_FILES);
  if (!entries.length) return;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);   // (files squeezed with gltf-transform's meshopt)
  for (const entry of entries) {
    try {
      const gltf = await loader.loadAsync(BASE + entry.file);
      const root = place(entry, gltf);
      if (root) loaded.push({ entry, root });
    } catch (err) { console.warn('[my-office] model', entry.file, err?.message || err); }
  }
}

export function setup() {
  // after the office has drawn its first frames (and merged its static meshes)
  setTimeout(() => { loadModels(); }, 1500);
}
