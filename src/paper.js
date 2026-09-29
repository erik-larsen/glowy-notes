// Procedural, tileable paper texture: fine grain plus soft blotchy stains.
import * as THREE from 'three';

const SIZE = 1024;

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Value noise on a lattice of `cells` that wraps at the texture edge. */
function tileableNoise(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (i) => ((i % cells) + cells) % cells;
  const a = hash(w(x0), w(y0), seed);
  const b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed);
  const d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u, v, baseCells, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileableNoise(u, v, baseCells << o, seed + o);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Returns { map, bumpMap } canvas textures (RepeatWrapping). */
export function createPaperTextures() {
  const color = document.createElement('canvas');
  const bump = document.createElement('canvas');
  color.width = bump.width = SIZE;
  color.height = bump.height = SIZE;
  const cctx = color.getContext('2d');
  const bctx = bump.getContext('2d');
  const cimg = cctx.createImageData(SIZE, SIZE);
  const bimg = bctx.createImageData(SIZE, SIZE);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      const stains = fbm(u, v, 3, 4, 11); // large, soft blotches
      const mottling = fbm(u, v, 16, 3, 29); // medium mottling
      const grain = hash(x, y, 7); // per-pixel fibre grain
      const blot = Math.max(0, stains - 0.55) * 2.2;
      const tone = 0.82 - blot * 0.18 - (mottling - 0.5) * 0.06 + (grain - 0.5) * 0.06;
      const i = (y * SIZE + x) * 4;
      cimg.data[i] = 255 * tone * 0.97;
      cimg.data[i + 1] = 255 * tone * 0.95;
      cimg.data[i + 2] = 255 * tone * 0.92;
      cimg.data[i + 3] = 255;
      const b = 255 * (0.5 + (grain - 0.5) * 0.6 + (mottling - 0.5) * 0.4);
      bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = b;
      bimg.data[i + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  bctx.putImageData(bimg, 0, 0);

  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(bump);
  for (const t of [map, bumpMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, bumpMap };
}
