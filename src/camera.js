// Milestone 6: the camera glides along the playhead with a slow hand-held drift.
import * as THREE from 'three';

const FOLLOW_RATE = 2.2; // 1/s, exponential smoothing toward the playhead
const LEAD_MS = 1000 / FOLLOW_RATE; // look this far ahead so smoothing doesn't leave us lagging

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.keyframes = [{ t: 0, x: 0 }];
    this.zCenter = 0;
    this.scale = 1;
    this.focusX = 0;
    this.focus = new THREE.Vector3();
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
    this.camera.position.set(this.focusX - 0.95 * s, 0.62 * s, this.zCenter + 1.0 * s).add(drift);
    this.camera.lookAt(this.focusX + 0.45 * s, 0, this.zCenter - 0.2 * s);
  }
}
