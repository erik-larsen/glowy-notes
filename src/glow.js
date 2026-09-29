// Milestone 5: emissive glows at note positions, fading in at onset and out after offset.
// Glows are flat quads lying on the paper (so they foreshorten with the page), drawn
// additively with HDR colours that UnrealBloomPass picks up. A few sparks drift up on onsets.
import * as THREE from 'three';

// Linear-space HDR base colours per staff (1 = treble, 2 = bass, ...).
const STAFF_COLORS = [
  new THREE.Color(1.0, 0.3, 0.05), // orange
  new THREE.Color(0.12, 0.38, 1.0), // blue
  new THREE.Color(1.0, 0.3, 0.75), // pink
  new THREE.Color(0.35, 1.0, 0.55), // green
];
const WHITE = new THREE.Color(1, 1, 1);

const ATTACK_MS = 25;
const FLASH_MS = 220; // onset flash decays over this
const RELEASE_MS = 800; // fade after the note ends
const SUSTAIN = 0.85;
const FLASH = 0.6;

const MAX_SPARKS = 256;

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

function envelope(t, on, off) {
  if (t < on) return 0;
  const level = (dt) => Math.min(1, dt / ATTACK_MS) * (SUSTAIN + FLASH * Math.exp(-dt / FLASH_MS));
  if (t <= off) return level(t - on);
  const released = t - off;
  if (released > RELEASE_MS * 6) return 0;
  return level(off - on) * Math.exp(-released / RELEASE_MS);
}

export class Glow {
  /**
   * @param {{id: string, on: number, off: number, x: number, z: number, w: number, d: number, staff: number}[]} notes
   *   world-space notehead centre (x, z) and footprint (w, d)
   */
  constructor(notes) {
    this.notes = notes;
    this.group = new THREE.Group();
    this.baseColors = notes.map((n) => STAFF_COLORS[(n.staff - 1) % STAFF_COLORS.length]);

    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const material = (map) =>
      new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

    // Wide soft halo + tight hot core per note.
    this.halo = new THREE.InstancedMesh(flat, material(radialTexture([[0, 0.9], [0.25, 0.45], [1, 0]])), notes.length);
    this.core = new THREE.InstancedMesh(flat, material(radialTexture([[0, 1], [0.45, 0.9], [0.75, 0.25], [1, 0]])), notes.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    notes.forEach((n, i) => {
      m.compose(new THREE.Vector3(n.x, 0.004, n.z), q, new THREE.Vector3(n.w * 3.2, 1, n.d * 3.4));
      this.halo.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(n.x, 0.006, n.z), q, new THREE.Vector3(n.w * 1.35, 1, n.d * 1.4));
      this.core.setMatrixAt(i, m);
      this.halo.setColorAt(i, new THREE.Color(0, 0, 0));
      this.core.setColorAt(i, new THREE.Color(0, 0, 0));
    });
    for (const mesh of [this.halo, this.core]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }

    this._initSparks();
  }

  _initSparks() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    this.sparkPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.07,
        map: radialTexture([[0, 1], [0.3, 0.8], [1, 0]]),
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.sparkPoints.frustumCulled = false;
    this.sparkPoints.renderOrder = 3;
    this.group.add(this.sparkPoints);
    this.sparks = Array.from({ length: MAX_SPARKS }, () => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      color: new THREE.Color(),
      age: 0,
      life: 0,
    }));
    this.nextSpark = 0;
  }

  _spawnSpark(n, color) {
    const s = this.sparks[this.nextSpark];
    this.nextSpark = (this.nextSpark + 1) % MAX_SPARKS;
    s.pos.set(n.x + (Math.random() - 0.5) * n.w, 0.02, n.z + (Math.random() - 0.5) * n.d);
    s.vel.set((Math.random() - 0.5) * 0.08, 0.18 + Math.random() * 0.25, (Math.random() - 0.5) * 0.08);
    s.color.copy(color).lerp(WHITE, 0.3);
    s.age = 0;
    s.life = 1.2 + Math.random() * 1.4;
  }

  /**
   * @param {number} t score time (ms)
   * @param {number} prevT score time on the previous frame (ms)
   * @param {number} dt wall-clock frame delta (s)
   */
  update(t, prevT, dt) {
    const c = new THREE.Color();
    // Only spawn sparks for continuous playback, not when scrubbing.
    const advancing = t > prevT && t - prevT < 250;
    this.notes.forEach((n, i) => {
      const base = this.baseColors[i];
      const e = envelope(t, n.on, n.off);
      this.halo.setColorAt(i, c.copy(base).multiplyScalar(e * 1.2));
      this.core.setColorAt(i, c.copy(base).lerp(WHITE, 0.06).multiplyScalar(e * 1.5));
      if (advancing && prevT < n.on && n.on <= t && Math.random() < 0.55) this._spawnSpark(n, base);
    });
    this.halo.instanceColor.needsUpdate = true;
    this.core.instanceColor.needsUpdate = true;

    const pos = this.sparkPoints.geometry.attributes.position;
    const col = this.sparkPoints.geometry.attributes.color;
    this.sparks.forEach((s, i) => {
      if (s.age < s.life) {
        s.age += dt;
        s.vel.y *= Math.exp(-dt * 0.6);
        s.pos.addScaledVector(s.vel, dt);
      }
      const k = s.age < s.life ? Math.sin(Math.PI * Math.min(1, s.age / s.life)) ** 0.6 * 3 : 0;
      pos.setXYZ(i, s.pos.x, s.pos.y, s.pos.z);
      col.setXYZ(i, s.color.r * k, s.color.g * k, s.color.b * k);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    });
  }
}
