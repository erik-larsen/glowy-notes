// Milestone 6: the camera glides along the playhead with a slow hand-held drift.
// On top of that, the viewer can orbit (left-drag) and zoom (mouse wheel) around the
// playhead; double-click returns to the default view.
import * as THREE from 'three';

const FOLLOW_RATE = 2.2; // 1/s, exponential smoothing toward the playhead
const LEAD_MS = 1000 / FOLLOW_RATE; // look this far ahead so smoothing doesn't leave us lagging
const ORBIT_SPEED = 0.005; // radians per dragged pixel
const ZOOM_SPEED = 0.0015; // per wheel delta unit
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const POLAR_MIN = 0.12; // keep the camera above the paper and short of straight down
const POLAR_MAX = 1.45;
const VIEW_DAMPING = 10; // 1/s, how quickly the view catches up with the mouse

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.keyframes = [{ t: 0, x: 0 }];
    this.zCenter = 0;
    this.scale = 1;
    this.focusX = 0;
    this.focus = new THREE.Vector3();
    // Viewer adjustments relative to the automatic framing: target values and smoothed values.
    this.userTarget = { yaw: 0, pitch: 0, zoom: 1 };
    this.user = { yaw: 0, pitch: 0, zoom: 1 };
    this._offset = new THREE.Vector3();
    this._spherical = new THREE.Spherical();
  }

  /** Left-drag orbits, the wheel zooms, double-click resets. */
  attachControls(element) {
    let drag = null;
    element.style.cursor = 'grab';
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY };
      element.setPointerCapture(e.pointerId);
      element.style.cursor = 'grabbing';
    });
    element.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.userTarget.yaw -= (e.clientX - drag.x) * ORBIT_SPEED;
      this.userTarget.pitch -= (e.clientY - drag.y) * ORBIT_SPEED;
      drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => {
      drag = null;
      element.style.cursor = 'grab';
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const z = this.userTarget.zoom * Math.exp(e.deltaY * ZOOM_SPEED);
        this.userTarget.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
      },
      { passive: false },
    );
    element.addEventListener('dblclick', () => Object.assign(this.userTarget, { yaw: 0, pitch: 0, zoom: 1 }));
  }

  /**
   * @param {{t: number, x: number}[]} keyframes playhead x (world) at score times (ms), sorted by t
   * @param {number} zCenter world z the camera should centre on
   * @param {number} scale overall framing scale (world height of the system)
   */
  setPath(keyframes, zCenter, scale) {
    this.keyframes = keyframes;
    this.zCenter = zCenter;
    this.scale = scale;
    this.focusX = this.playheadX(0);
  }

  playheadX(t) {
    const k = this.keyframes;
    if (t <= k[0].t) return k[0].x;
    if (t >= k[k.length - 1].t) return k[k.length - 1].x;
    let lo = 0;
    let hi = k.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (k[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = k[lo];
    const b = k[hi];
    return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t);
  }

  /**
   * @param {number} t score time (ms)
   * @param {number} dt frame delta (s)
   * @param {number} elapsed wall-clock seconds, for drift
   */
  update(t, dt, elapsed) {
    const target = this.playheadX(t + LEAD_MS);
    this.focusX += (target - this.focusX) * (1 - Math.exp(-dt * FOLLOW_RATE));
    const s = this.scale;
    this.focus.set(this.focusX, 0, this.zCenter);

    const drift = new THREE.Vector3(
      Math.sin(elapsed * 0.13) * 0.06 + Math.sin(elapsed * 0.31) * 0.02,
      Math.sin(elapsed * 0.19 + 1.3) * 0.03,
      Math.cos(elapsed * 0.17) * 0.05,
    ).multiplyScalar(s);

    // Low and to the left of the playhead, looking along the staff into the dark.
    const lookAt = new THREE.Vector3(this.focusX + 0.45 * s, 0, this.zCenter - 0.2 * s);
    const position = new THREE.Vector3(this.focusX - 0.95 * s, 0.62 * s, this.zCenter + 1.0 * s).add(drift);

    // Apply the viewer's orbit and zoom around the look-at point.
    const k = 1 - Math.exp(-dt * VIEW_DAMPING);
    for (const key of ['yaw', 'pitch', 'zoom']) this.user[key] += (this.userTarget[key] - this.user[key]) * k;
    const sph = this._spherical.setFromVector3(this._offset.subVectors(position, lookAt));
    sph.theta += this.user.yaw;
    sph.phi = Math.min(POLAR_MAX, Math.max(POLAR_MIN, sph.phi + this.user.pitch));
    sph.radius *= this.user.zoom;
    this.camera.position.copy(lookAt).add(this._offset.setFromSpherical(sph));
    this.camera.lookAt(lookAt);
  }
}
