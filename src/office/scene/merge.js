// Static meshes merged into fewer draw calls (core/optimize.js for the office, world/tower-floor.js for a team floor):
// the meshes that share a kind of material become one mesh, every part keeping its colour as a vertex colour.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// roughness to the nearest quarter and metalness to the nearest half: a part at 0.4 and one at 0.6 look the same at
// this distance, and merging them saves a draw call per desk (and its shadow), 44 times over on the headquarters floor
const q = (v, step) => (typeof v === 'number' ? Math.round(v / step) * step : v);
const sig = (m) => { const x = m.material; return [x.type, q(x.roughness, 0.25), q(x.metalness, 0.5), x.map?.uuid, x.side, x.flatShading, x.emissive?.getHex(), x.emissiveIntensity, x.toneMapped, m.castShadow, m.receiveShadow].join('|'); };
const plain = (m) => m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh && m.visible && !Array.isArray(m.material) && m.material && !m.material.transparent
  && !m.children.length && !m.geometry.morphAttributes?.position;
const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();

/** Merges `meshes` into `container` (they must not move relative to it), leaving out any `keep(mesh)` says to keep.
 *  Returns [{ mesh, used }]: each new mesh and the meshes it now draws (taken out of the scene). */
export function mergeMeshes(meshes, container, keep = () => false) {
  container.updateMatrixWorld(true); inv.copy(container.matrixWorld).invert();
  const buckets = new Map();
  for (const m of meshes) if (plain(m) && !keep(m)) { const k = sig(m); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(m); }
  const made = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = [], used = [];
    for (const m of list) {
      rel.multiplyMatrices(inv, m.matrixWorld);
      if (rel.determinant() < 0) continue;   // mirrored parts would turn inside out
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(rel);
      const c = m.material.color || new THREE.Color(1, 1, 1), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geos.push(g); used.push(m);
    }
    if (used.length < 2) continue;
    const geo = mergeGeometries(geos, false); if (!geo) continue;
    const material = used[0].material.clone(); material.vertexColors = true; material.userData.own = true; if (material.color) material.color.setRGB(1, 1, 1);
    if (typeof material.roughness === 'number') { material.roughness = q(material.roughness, 0.25); material.metalness = q(material.metalness, 0.5); }
    const mesh = new THREE.Mesh(geo, material); mesh.castShadow = used[0].castShadow; mesh.receiveShadow = used[0].receiveShadow;
    container.add(mesh);
    for (const m of used) m.parent.remove(m);
    made.push({ mesh, used });
  }
  return made;
}
