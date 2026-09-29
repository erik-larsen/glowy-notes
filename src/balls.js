// One glowing ball per voice that hops from note to note, landing on each note exactly at
// its onset (which is when the note lights up). All balls share one horizontal position that
// follows the playhead, so they stay level with each other: a voice with longer notes makes
// slower arcs spanning the whole gap, all peaking at the same height. Each ball carries a small point light so it
// tints the paper and catches the ink around it. A ball is only on stage while its voice is
// playing: each phrase (notes separated by less than PHRASE_REST_MS of silence) starts with
// the ball swooping in and ends with it flying off.
import * as THREE from 'three';
import { voiceColor } from './glow.js';
import { PREROLL_MS } from './audio.js';

// Every hop peaks at the same height (in staff spaces), whatever the gap, as in the reference
// video: a long note is a slow, low glide rather than a tall arc.
const ARC_HEIGHT = 1.2;
// Fly-in during the pre-roll: start this many staff spaces left of / above / in front of the entry point.
const FLY_FROM = { x: -30, y: 8, z: 12 };
// Mid-piece entries and exits move level with the playhead, dropping from / rising to this offset.
const SWOOP = { y: 16, z: 10 };
const ENTER_MS = 1500;
const EXIT_MS = 2600;
// Exit: lift slowly off the last note, staying with the page (so it scrolls away right to
// left with the notes) and drifting a little further left, fading out near the end.
const EXIT_RISE = 7; // staff spaces
const EXIT_DRIFT = 3; // staff spaces, toward the start of the score
const LINGER_MS = 400; // stay on a phrase's last note at least this long
const PHRASE_REST_MS = 3000; // silence that ends a phrase
const SQUASH_MS = 90;
const HALO_SCALE = 5.5; // halo sprite diameter, in ball radii
const HALO_GAIN = 1.4; // halo brightness (additive, below the bloom threshold so its size is exact)

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
    this.haloTexture = haloTexture();
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
        // Hot, near-white core that just clears the bloom threshold for a faint rim.
        new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.45).multiplyScalar(2) }),
      );
      const light = new THREE.PointLight(color, 0, this.unit * 7, 2);
      // Soft glow in the voice colour, sized directly rather than left to the bloom pass.
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.haloTexture,
          color: color.clone().multiplyScalar(HALO_GAIN),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
      );
      halo.scale.setScalar(this.radius * HALO_SCALE);
      halo.renderOrder = 3;
      this.group.add(mesh, halo, light);
      // Phrases: runs of landings without a long silence between one note's end and the next.
      const phrases = [{ first: 0, last: 0 }];
      for (let i = 1; i < landings.length; i++) {
        if (landings[i].t - landings[i - 1].end > PHRASE_REST_MS) phrases.push({ first: i, last: i });
        else phrases[phrases.length - 1].last = i;
      }
      return { landings, phrases, mesh, halo, light };
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
        v.halo.visible = false;
        v.light.intensity = 0;
        continue;
      }

      const first = l[phrase.first];
      let x;
      let y = r;
      let z;
      let squash = 0;
      let fade = 1;

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
          y = r + 4 * ARC_HEIGHT * u2 * u * (1 - u);
        } else if (t > phrase.exitAt) {
          const u = Math.min(1, (t - phrase.exitAt) / EXIT_MS);
          x = a.x - EXIT_DRIFT * u2 * easeIn(u);
          y = r + EXIT_RISE * u2 * smoothstep(u);
          fade = 1 - smoothstep(Math.max(0, (u - 0.55) / 0.45));
        }
      }

      const flat = 1 - 0.4 * squash; // squash on landing, bulge sideways
      v.mesh.visible = true;
      v.halo.visible = true;
      v.mesh.position.set(x, y - 0.35 * squash * r, z); // dip into the landing without lowering the arc
      v.mesh.scale.set(fade / Math.sqrt(flat), fade * flat, fade / Math.sqrt(flat));
      v.halo.position.copy(v.mesh.position);
      v.halo.scale.setScalar(this.radius * HALO_SCALE * fade);
      v.light.position.set(x, y + r, z);
      v.light.intensity = fade * u2 * u2 * (5 + 8 * squash);
    }
  }

  dispose() {
    this.haloTexture.dispose();
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

/** Soft radial falloff for the ball halo. */
function haloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
