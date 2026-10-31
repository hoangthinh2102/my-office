// The neon sign: the Gamota logo (public/assets/gamota-logo.png, white on clear) glowing pink.
import * as THREE from 'three';
import { scene } from '../../scene/renderer.js';
import { canvasTex, mat, put, rbox } from '../../scene/blocks.js';
import { LAY } from '../layout.js';
import { nightHooks } from './trinkets.js';

const LOGO = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/assets/gamota-logo.png`;
let neonTex;
export const neonG = new THREE.Group();
export let neonM;

// the logo fitted in the middle of the canvas, drawn twice for a wide pink glow and a tighter bright one
function drawLogo(g, w, h, img) {
  g.clearRect(0, 0, w, h);
  const s = Math.min((w * 0.9) / img.naturalWidth, (h * 0.86) / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  const x = (w - dw) / 2, y = (h - dh) / 2;
  g.shadowColor = '#FF4FA3'; g.shadowBlur = 40; g.drawImage(img, x, y, dw, dh);
  g.shadowColor = '#FFB3D9'; g.shadowBlur = 12; g.drawImage(img, x, y, dw, dh);
}

export function setup() {
  /* neon sign above the library */
  neonTex = canvasTex(1024, 256, () => {});
  const img = new Image(); img.decoding = 'async';
  img.onload = () => { const c = neonTex.image; drawLogo(c.getContext('2d'), c.width, c.height, img); neonTex.needsUpdate = true; };
  img.src = LOGO;
   neonG.position.set(LAY.neon[0], LAY.neon[1], LAY.neon[2]);
   neonG.rotation.y = LAY.neon[3];
   scene.add(neonG);
  put(neonG, rbox(2.6, 0.72, 0.05, mat('#1C1F26', { roughness: 0.6 }), 0.03), 0, 0, 0);
  neonM = new THREE.MeshBasicMaterial({ map: neonTex, transparent: true });
  put(neonG, new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.62), neonM), 0, 0, 0.03);
  nightHooks.push((on) => neonM.color.setScalar(on ? 2.6 : 1.15));
}
