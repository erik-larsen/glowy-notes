// One glowing ball per voice that hops from note to note, landing on each note exactly at
// its onset (which is when the note lights up). All balls share one horizontal position that
// follows the playhead, so they stay level with each other: a voice with longer notes makes
// taller, slower arcs spanning the whole gap. Each ball carries a small point light so it
// tints the paper and catches the ink around it. A ball is only on stage while its voice is
// playing: each phrase (notes separated by less than PHRASE_REST_MS of silence) starts with
// the ball swooping in and ends with it flying off.
import * as THREE from 'three';
import { voiceColor } from './glow.js';
import { PREROLL_MS } from './audio.js';

// Arc height (in staff spaces) grows with the time between landings, capped for long rests.
const HEIGHT_BASE = 0.2;
const HEIGHT_PER_MS = 1 / 450;
const HEIGHT_MAX = 5;
// Fly-in during the pre-roll: start this many staff spaces left of / above / in front of the entry point.
const FLY_FROM = { x: -30, y: 8, z: 12 };
// Mid-piece entries and exits move level with the playhead, dropping from / rising to this offset.
const SWOOP = { y: 16, z: 10 };
const ENTER_MS = 1500;
const EXIT_MS = 1200;
const LINGER_MS = 400; // stay on a phrase's last note at least this long
const PHRASE_REST_MS = 3000; // silence that ends a phrase
const SQUASH_MS = 90;

const smoothstep = (u) => u * u * (3 - 2 * u);
const easeIn = (u) => u ** 3;

export class Balls {
  /**
   * @param {{on: number, off: number, x: number, z: number, d: number, staff: number, layer: number}[]} notes
   *   world-space notes (see Stage.setScore)
   */
  constructor(notes) {
    this.group = new THREE.Group();
    const heads = notes.map((n) => n.d).sort((a, b) => a - b);
    this.unit = heads[heads.length >> 1] || 0.15; // ~ one staff space (notehead height)
    // Visible size (core plus its thin bloom halo) about half a notehead wide, as in the reference video.
    this.radius = this.unit * 0.22;

    // Group notes into voices, then one landing per distinct onset: the top note of a chord.
    const voices = new Map();
    for (const n of notes) {
      const key = `${n.staff}:${n.layer}`;
      if (!voices.has(key)) voices.set(key, { staff: n.staff, layer: n.layer, notes: [] });
      voices.get(key).notes.push(n);
    }
    const geometry = new THREE.SphereGeometry(this.radius, 20, 14);
    this.voices = [...voices.values()].map((v) => {
      v.notes.sort((a, b) => a.on - b.on || a.z - b.z);
      const landings = [];
      for (const n of v.notes) {
        const last = landings[landings.length - 1];
        if (last && last.t === n.on) {
          last.end = Math.max(last.end, n.off);
          continue;
        }
        landings.push({ t: n.on, end: n.off, x: n.x, z: n.z });
      }
      const color = voiceColor(v.staff, v.layer);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.15).multiplyScalar(1.6) }),
      );
      const light = new THREE.PointLight(color, 0, this.unit * 7, 2);
      this.group.add(mesh, light);
      // Phrases: runs of landings without a long silence between one note's end and the next.
      const phrases = [{ first: 0, last: 0 }];
      for (let i = 1; i < landings.length; i++) {
        if (landings[i].t - landings[i - 1].end > PHRASE_REST_MS) phrases.push({ first: i, last: i });
        else phrases[phrases.length - 1].last = i;
      }
      return { landings, phrases, mesh, light };
    });

    // Shared playhead: at every onset of any voice, the mean x of the notes landing then.
    const byTime = new Map();
    for (const v of this.voices) {
      for (const l of v.landings) {
        const k = byTime.get(l.t) ?? { t: l.t, sum: 0, n: 0 };
        k.sum += l.x;
        k.n += 1;
        byTime.set(l.t, k);
      }
    }
    this.playhead = [...byTime.values()].sort((a, b) => a.t - b.t).map((k) => ({ t: k.t, x: k.sum / k.n }));
    // How far each landing sits from the shared playhead, so balls still land dead on their notes.
    for (const v of this.voices) for (const l of v.landings) l.dx = l.x - this.playheadX(l.t);

    // Timing of each phrase's entry and exit.
    const t0 = this.playhead[0].t;
    for (const v of this.voices) {
      for (const p of v.phrases) {
        const first = v.landings[p.first];
        const last = v.landings[p.last];
        p.fromPreroll = first.t === t0; // enters during the pre-roll, from off to the left
        p.enterAt = first.t - (p.fromPreroll ? PREROLL_MS : ENTER_MS);
        p.exitAt = Math.max(last.end, last.t + LINGER_MS);
      }
    }
  }

  /** Peak height of an arc spanning `gapMs` between landings. */
  arcHeight(gapMs) {
    return this.unit * Math.min(HEIGHT_MAX, HEIGHT_BASE + gapMs * HEIGHT_PER_MS);
  }

  playheadX(t) {
    const p = this.playhead;
    const i = lastLandingAtOrBefore(p, t);
    const a = p[i];
    const b = p[i + 1];
    if (!b || t <= a.t) return a.x;
    return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t);
  }

  /** @param {number} t score time (ms) */
  update(t) {
    const r = this.radius;
    const u2 = this.unit;
    for (const v of this.voices) {
      const l = v.landings;
      // The latest phrase that has started entering (later phrases win if they overlap).
      let phrase = null;
      for (let k = v.phrases.length - 1; k >= 0; k--) {
        if (t >= v.phrases[k].enterAt || (k === 0 && v.phrases[k].fromPreroll)) {
          phrase = v.phrases[k];
          break;
        }
      }
      if (!phrase || t > phrase.exitAt + EXIT_MS) {
        v.mesh.visible = false;
        v.light.intensity = 0;
        continue;
      }

      const first = l[phrase.first];
      let x;
      let y = r;
      let z;
      let squash = 0;

      if (t < first.t) {
        // Keep moving the whole way: glide across while falling faster and faster, so the
        // ball lands on the first note with some speed exactly as it sounds (no hovering).
        const u = Math.min(1, Math.max(0, (t - phrase.enterAt) / (first.t - phrase.enterAt)));
        const glide = smoothstep(u);
        const fall = 1 - u * u;
        if (phrase.fromPreroll) {
          // In from off screen to the left while the playhead waits at the start.
          x = first.x + FLY_FROM.x * u2 * (1 - glide);
          y = r + FLY_FROM.y * u2 * fall;
          z = first.z + FLY_FROM.z * u2 * (1 - glide);
        } else {
          // Swoop down level with the other balls onto the first note.
          x = this.playheadX(t) + first.dx * glide;
          y = r + SWOOP.y * u2 * fall;
          z = first.z + SWOOP.z * u2 * (1 - glide);
        }
      } else {
        const i = Math.min(lastLandingAtOrBefore(l, t), phrase.last);
        const a = l[i];
        squash = Math.exp(-(t - a.t) / SQUASH_MS);
        x = a.x;
        z = a.z;
        if (i < phrase.last) {
          // One arc across the whole gap; x rides the shared playhead.
          const b = l[i + 1];
          const gap = b.t - a.t;
          const u = (t - a.t) / gap;
          x = this.playheadX(t) + a.dx + (b.dx - a.dx) * u;
          z = a.z + (b.z - a.z) * u;
          y = r + 4 * this.arcHeight(gap) * u * (1 - u);
        } else if (t > phrase.exitAt) {
          // Phrase over: rise away, drifting back level with the playhead.
          const e = easeIn(Math.min(1, (t - phrase.exitAt) / EXIT_MS));
          x = a.x + (this.playheadX(t) + a.dx - a.x) * e;
          y = r + SWOOP.y * u2 * e;
          z = a.z + SWOOP.z * u2 * e;
        }
      }

      const flat = 1 - 0.4 * squash; // squash on landing, bulge sideways
      v.mesh.visible = true;
      v.mesh.position.set(x, y * (1 - 0.35 * squash), z);
      v.mesh.scale.set(1 / Math.sqrt(flat), flat, 1 / Math.sqrt(flat));
      v.light.position.set(x, y + r, z);
      v.light.intensity = u2 * u2 * (5 + 8 * squash);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}

function lastLandingAtOrBefore(l, t) {
  let lo = 0;
  let hi = l.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (l[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
