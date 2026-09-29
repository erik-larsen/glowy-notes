// Renders a score to audio with a humanised performance, and writes the exact
// score-time -> audio-time map the app uses to drive the visuals. Because the map is the
// one the performance was generated with, the glow and balls match the audio exactly.
//
//   MusicXML --Verovio--> MIDI --humanise--> performance MIDI --FluidSynth + Salamander--> WAV
//            --ffmpeg--> public/media/<id>.rendered.m4a  +  public/media/<id>.align.json
//
// Usage: node scripts/render.mjs <score-id> [--seed N] [--pedal half|bar|none] [--dry]
//   <score-id> names public/scores/<score-id>.musicxml
// Needs: fluidsynth and ffmpeg on PATH, and the Salamander Grand Piano SF2 in vendor/salamander
// (or set SALAMANDER_SF2). Salamander Grand Piano by Alexander Holm, CC BY 3.0.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import midiPkg from '@tonejs/midi';

const { Midi } = midiPkg;

// Performance settings
const LEAD_IN_S = 0.5; // silence before the first note, so the attack isn't clipped
const RUBATO = 0.03; // +-3% smooth tempo drift
const JITTER_MS = 6; // per-onset timing looseness (chord notes stay together)
const FINAL_RIT_S = 4; // slow down over the last few seconds of the score...
const FINAL_RIT = 0.35; // ...to 35% slower at the very end
const PEDAL_LIFT_MS = 40; // re-press the pedal this long after a change
const SAMPLE_RATE = 48000;

function parseArgs(argv) {
  const args = { id: null, seed: 1, pedal: 'half', dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--pedal') args.pedal = argv[++i];
    else if (a === '--dry') args.dry = true;
    else args.id = a;
  }
  if (!args.id) {
    console.error('Usage: node scripts/render.mjs <score-id> [--seed N] [--pedal half|bar|none] [--dry]');
    process.exit(1);
  }
  return args;
}

/** Small seeded PRNG (mulberry32), so renders are reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function findSoundfont() {
  if (process.env.SALAMANDER_SF2) return process.env.SALAMANDER_SF2;
  const root = 'vendor/salamander';
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    const sf2 = readdirSync(join(root, dir)).find((f) => f.endsWith('.sf2'));
    if (sf2) return join(root, dir, sf2);
  }
  throw new Error('Salamander SF2 not found: put it in vendor/salamander or set SALAMANDER_SF2');
}

/**
 * Score time (s) -> performance time (s): a smooth tempo curve (two slow sine waves with
 * random phases) plus a final ritardando, integrated so time always moves forward.
 */
function tempoMap(scoreEnd, random) {
  const phases = [random() * Math.PI * 2, random() * Math.PI * 2];
  const slowness = (s) => {
    let k = 1 + RUBATO * (0.6 * Math.sin((2 * Math.PI * s) / 23 + phases[0]) + 0.4 * Math.sin((2 * Math.PI * s) / 9 + phases[1]));
    const rit = (s - (scoreEnd - FINAL_RIT_S)) / FINAL_RIT_S;
    if (rit > 0) k *= 1 + FINAL_RIT * Math.min(1, rit) ** 2;
    return k;
  };
  const step = 0.001;
  const n = Math.ceil(scoreEnd / step) + 2;
  const cum = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) cum[i] = cum[i - 1] + slowness((i - 0.5) * step) * step;
  return (s) => {
    const x = Math.max(0, s) / step;
    const i = Math.min(n - 1, Math.floor(x));
    return cum[i] + (cum[i + 1] - cum[i]) * (x - i) + Math.min(0, s);
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const random = rng(args.seed);
  const scorePath = `public/scores/${args.id}.musicxml`;
  const audioName = `${args.id}.rendered.m4a`;

  // 1. Score -> MIDI with exact score timing (same toolkit settings as the app).
  const tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions({ breaks: 'none' });
  if (!tk.loadData(readFileSync(scorePath, 'utf8'))) throw new Error(`Verovio could not read ${scorePath}`);
  const score = new Midi(Buffer.from(tk.renderToMIDI(), 'base64'));
  const measures = tk.renderToTimemap({ includeMeasures: true }).filter((e) => e.measureOn).map((e) => e.tstamp / 1000);

  const notes = score.tracks.flatMap((track, staff) =>
    track.notes.map((n) => ({ staff, pitch: n.midi, on: n.time, off: n.time + n.duration, velocity: n.velocity })),
  );
  const scoreEnd = Math.max(...notes.map((n) => n.off));
  const onsets = [...new Set(notes.map((n) => n.on))].sort((a, b) => a - b);

  // 2. Humanise timing: one tempo curve for everything, plus a little jitter per onset.
  const tempo = tempoMap(scoreEnd, random);
  const perfAt = new Map();
  let prev = -Infinity;
  for (const s of onsets) {
    const jitter = ((random() + random() + random()) / 3 - 0.5) * 2 * (JITTER_MS / 1000);
    const t = Math.max(prev + 0.01, LEAD_IN_S + tempo(s) + jitter);
    perfAt.set(s, t);
    prev = t;
  }
  const perf = (s) => perfAt.get(s) ?? LEAD_IN_S + tempo(s);

  // 3. Humanise dynamics: bring out the melody (top treble note), lean on downbeats.
  const topAt = new Map();
  for (const n of notes) if (n.staff === 0) topAt.set(n.on, Math.max(topAt.get(n.on) ?? 0, n.pitch));
  const isDownbeat = (s) => measures.some((m) => Math.abs(m - s) < 0.002);
  const velocityOf = (n) => {
    let v = n.velocity * 127;
    if (n.staff === 0) v += n.pitch === topAt.get(n.on) ? 10 : -8;
    else v -= 8;
    if (isDownbeat(n.on)) v += 5;
    v += (random() - 0.5) * 10;
    return Math.min(118, Math.max(24, Math.round(v))) / 127;
  };

  // 4. Sustain pedal, changed on each bar (and half bar in 4/4) - legato pedalling.
  const changes = [];
  const quarterS = 60 / (score.header.tempos[0]?.bpm ?? 120);
  if (args.pedal !== 'none') {
    for (let i = 0; i < measures.length; i++) {
      const start = measures[i];
      const end = measures[i + 1] ?? scoreEnd;
      changes.push(start);
      const quarters = (end - start) / quarterS;
      if (args.pedal === 'half' && Math.round(quarters) === 4) changes.push(start + (end - start) / 2);
    }
  }

  // 5. Build the performance MIDI.
  const out = new Midi();
  const track = out.addTrack();
  track.instrument.number = 0;
  for (const n of notes) {
    const on = perf(n.on);
    const off = Math.max(on + 0.03, LEAD_IN_S + tempo(n.off) - 0.01);
    track.addNote({ midi: n.pitch, time: on, duration: off - on, velocity: velocityOf(n) });
  }
  for (const s of changes) {
    const t = perf(s);
    track.addCC({ number: 64, value: 0, time: Math.max(0, t - 0.005) });
    track.addCC({ number: 64, value: 1, time: t + PEDAL_LIFT_MS / 1000 });
  }
  const perfEnd = LEAD_IN_S + tempo(scoreEnd);
  track.addCC({ number: 64, value: 0, time: perfEnd + 0.2 });

  // 6. The exact time map the performance used: one point per onset, plus the end.
  const points = onsets.map((s) => [Math.round(s * 1000), Math.round(perf(s) * 10000) / 10]);
  points.push([Math.round(scoreEnd * 1000), Math.round(perfEnd * 10000) / 10]);

  console.log(`${args.id}: ${notes.length} notes, ${onsets.length} onsets, ${changes.length} pedal changes`);
  console.log(`score ${scoreEnd.toFixed(1)} s -> performance ${perfEnd.toFixed(1)} s`);
  if (args.dry) return;

  // 7. Render with FluidSynth + Salamander, then normalise and encode with ffmpeg.
  const tmp = mkdtempSync(join(tmpdir(), 'glowy-render-'));
  try {
    const midPath = join(tmp, 'performance.mid');
    const wavPath = join(tmp, 'performance.wav');
    writeFileSync(midPath, Buffer.from(out.toArray()));
    execFileSync('fluidsynth', [
      '-ni', '-q', '-r', String(SAMPLE_RATE), '-g', '0.5',
      '-o', 'synth.polyphony=256',
      '-o', 'synth.reverb.active=1', '-o', 'synth.reverb.room-size=0.55', '-o', 'synth.reverb.damp=0.35',
      '-o', 'synth.reverb.width=0.9', '-o', 'synth.reverb.level=0.35',
      '-o', 'synth.chorus.active=0',
      '-F', wavPath, findSoundfont(), midPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-i', wavPath,
      '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11,apad=pad_dur=0.5',
      '-ar', String(SAMPLE_RATE), '-c:a', 'aac', '-b:a', '256k', `public/media/${audioName}`,
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  writeFileSync(`public/media/${args.id}.align.json`, JSON.stringify({
    audio: audioName,
    label: 'Salamander Grand',
    source: 'rendered',
    credit: 'Salamander Grand Piano by Alexander Holm (CC BY 3.0)',
    seed: args.seed,
    points,
  }));
  console.log(`wrote public/media/${audioName} and public/media/${args.id}.align.json`);
}

await main();
