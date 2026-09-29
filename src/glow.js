// Milestone 5: emissive glows at note positions. A note lights up when its ball lands on it
// (the onset) with a brief flash, then stays lit. Glows are flat quads lying on the paper
// (so they foreshorten with the page), drawn additively with HDR colours for the bloom pass.
import * as THREE from 'three';

// Linear-space base colours per voice: [staff][layer], falling back by staff.
const VOICE_COLORS = [
  [new THREE.Color(1.0, 0.3, 0.05), new THREE.Color(1.0, 0.22, 0.55)], // treble: orange, pink
  [new THREE.Color(0.07, 0.26, 1.0), new THREE.Color(0.15, 0.65, 1.0)], // bass: blue, cyan
  [new THREE.Color(0.35, 1.0, 0.45), new THREE.Color(0.9, 0.85, 0.2)],
];

/** Base colour for a voice (staff and layer numbers are 1-based). */
export function voiceColor(staff, layer) {
  const byStaff = VOICE_COLORS[(staff - 1) % VOICE_COLORS.length];
  return byStaff[(layer - 1) % byStaff.length];
}

const WHITE = new THREE.Color(1, 1, 1);
const ATTACK_MS = 20;
const FLASH_MS = 300; // landing flash decays over this
const FLASH = 1.4;
const LIT = 1.0; // steady level once played

function radialTexture(stops) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, alpha] of stops) g.addColorStop(at, `rgba(255,255,255,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function envelope(t, on) {
  if (t < on) return 0;
  const dt = t - on;
  return Math.min(1, dt / ATTACK_MS) * (LIT + FLASH * Math.exp(-dt / FLASH_MS));
}

export class Glow {
  /**
   * @param {{id: string, on: number, x: number, z: number, w: number, d: number, staff: number, layer: number}[]} notes
   *   world-space notehead centre (x, z) and footprint (w, d)
   */
  constructor(notes) {
    this.notes = notes;
    this.group = new THREE.Group();
    this.baseColors = notes.map((n) => voiceColor(n.staff, n.layer));

    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const material = (map) =>
      new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

    // Soft halo + tight hot core per note.
    this.halo = new THREE.InstancedMesh(flat, material(radialTexture([[0, 0.9], [0.3, 0.4], [1, 0]])), notes.length);
    this.core = new THREE.InstancedMesh(flat, material(radialTexture([[0, 1], [0.5, 0.95], [0.75, 0.3], [1, 0]])), notes.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const black = new THREE.Color(0, 0, 0);
    notes.forEach((n, i) => {
      m.compose(new THREE.Vector3(n.x, 0.004, n.z), q, new THREE.Vector3(n.w * 2.4, 1, n.d * 2.6));
      this.halo.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(n.x, 0.006, n.z), q, new THREE.Vector3(n.w * 1.3, 1, n.d * 1.35));
      this.core.setMatrixAt(i, m);
      this.halo.setColorAt(i, black);
      this.core.setColorAt(i, black);
    });
    for (const mesh of [this.halo, this.core]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }

  /** @param {number} t score time (ms) */
  update(t) {
    const c = new THREE.Color();
    this.notes.forEach((n, i) => {
      const base = this.baseColors[i];
      const e = envelope(t, n.on);
      this.halo.setColorAt(i, c.copy(base).multiplyScalar(e * 0.7));
      this.core.setColorAt(i, c.copy(base).lerp(WHITE, 0.1).multiplyScalar(e * 1.25));
    });
    this.halo.instanceColor.needsUpdate = true;
    this.core.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    });
  }
}
