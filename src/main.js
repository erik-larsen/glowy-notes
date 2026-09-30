import { engrave } from './engrave.js';
import { layoutScore } from './layout.js';
import { Player, PREROLL_MS } from './audio.js';
import { Stage } from './scene.js';
import { createWarp } from './warp.js';

// Site base path ('/' in dev, './' in the build) so the app also works from a subpath like GitHub Pages.
const BASE = import.meta.env.BASE_URL;

const SCORES = [
  { id: 'canon-in-d', name: 'Canon in D' },
  { id: 'minuet-in-g', name: 'Minuet in G' },
];

const $ = (id) => document.getElementById(id);
const ui = {
  overlay: $('overlay'),
  overlayText: $('overlay-text'),
  play: $('play'),
  scrub: $('scrub'),
  time: $('time'),
  duration: $('duration'),
  scores: $('scores'),
  sound: $('sound'),
  file: $('file'),
  measureHost: $('measure-host'),
};

const stage = new Stage($('stage'));
const player = new Player();
if (import.meta.env.DEV) Object.assign(window, { stage, player });
let durationMs = 0;
let scrubbing = false;
let current = null; // { score, recording } for the loaded piece

function showMessage(text) {
  ui.overlayText.textContent = text;
  ui.overlay.classList.toggle('visible', Boolean(text));
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function syncPlayState() {
  document.body.classList.toggle('playing', player.playing);
  document.body.classList.toggle('paused', !player.playing);
  ui.play.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
}

/** Loads the audio for the current piece: the aligned recording if chosen, else the piano. */
async function loadAudio() {
  player.stop();
  syncPlayState();
  const useRecording = current.recording && ui.sound.value === 'recording';
  await player.load(current.score.midi, useRecording ? current.recording : null);
  durationMs = Math.max(current.score.durationMs, player.durationSec * 1000);
  ui.duration.textContent = fmt(durationMs);
}

/** Looks for public/media/<id>.align.json (from scripts/align.py) next to a bundled score. */
async function findRecording(id) {
  try {
    const res = await fetch(`${BASE}media/${id}.align.json`);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const align = await res.json();
    return { url: `${BASE}media/${align.audio}`, warp: createWarp(align.points), label: align.label ?? 'Recording' };
  } catch {
    return null;
  }
}

async function loadScore(data, name, recording = null) {
  player.stop();
  syncPlayState();
  ui.play.disabled = ui.scrub.disabled = true;
  showMessage(`Engraving ${name}…`);
  try {
    const score = await engrave(data);
    const layout = await layoutScore(score.svg, ui.measureHost, stage.maxTextureSize);
    stage.setScore(layout, score);
    await audioReady;
    current = { score, recording };
    ui.sound.hidden = !recording;
    if (recording) ui.sound.options[0].textContent = recording.label;
    showMessage(recording ? `Loading ${recording.label}…` : '');
    await loadAudio();
    ui.play.disabled = ui.scrub.disabled = false;
    showMessage('');
  } catch (err) {
    console.error(err);
    showMessage(`Couldn't load ${name}: ${err.message}`);
  }
}

async function loadBundled(id) {
  const entry = SCORES.find((s) => s.id === id) ?? SCORES[0];
  ui.scores.value = entry.id;
  const [res, recording] = await Promise.all([fetch(`${BASE}scores/${entry.id}.musicxml`), findRecording(entry.id)]);
  await loadScore(await res.text(), entry.name, recording);
}

async function loadFile(file) {
  const name = file.name.replace(/\.(musicxml|xml|mxl)$/i, '');
  let option = ui.scores.querySelector('option[value="file"]');
  if (!option) option = ui.scores.appendChild(new Option('', 'file'));
  option.textContent = name;
  ui.scores.value = 'file';
  await loadScore(await file.arrayBuffer(), name);
}

async function togglePlay() {
  if (ui.play.disabled) return;
  if (player.playing) player.pause();
  else await player.play();
  syncPlayState();
}

function seekBy(deltaMs) {
  player.seek(Math.min(durationMs, Math.max(-PREROLL_MS, player.timeMs + deltaMs)));
}

// --- UI wiring -------------------------------------------------------------

ui.play.addEventListener('click', togglePlay);
ui.scrub.addEventListener('input', () => {
  scrubbing = true;
  player.seek(ui.scrub.valueAsNumber * durationMs);
});
ui.scrub.addEventListener('change', () => (scrubbing = false));
for (const s of SCORES) ui.scores.add(new Option(s.name, s.id));
ui.scores.addEventListener('change', () => {
  if (ui.scores.value !== 'file') loadBundled(ui.scores.value);
  ui.scores.blur();
});
ui.sound.addEventListener('change', async () => {
  ui.sound.blur();
  if (!current) return;
  ui.play.disabled = true;
  await loadAudio();
  ui.play.disabled = false;
});
ui.file.addEventListener('change', () => ui.file.files[0] && loadFile(ui.file.files[0]));
player.onEnded = syncPlayState;

window.addEventListener('keydown', (e) => {
  // Focused controls already handle their own keys (space on the button, arrows on the slider).
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'ArrowLeft') {
    seekBy(-5000);
  } else if (e.code === 'ArrowRight') {
    seekBy(5000);
  } else if (e.code === 'Home') {
    player.seek(-PREROLL_MS); // back to before the fly-in
  }
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  ui.overlay.classList.add('dragging');
});
window.addEventListener('dragleave', () => ui.overlay.classList.remove('dragging'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  ui.overlay.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

// --- Render loop: the audio clock drives everything --------------------------

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = player.timeMs;
  stage.render(t, dt, now / 1000);

  ui.time.textContent = fmt(t);
  if (!scrubbing && durationMs) ui.scrub.value = String(Math.min(1, t / durationMs));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Boot --------------------------------------------------------------------

const audioReady = player.init();
syncPlayState();
const params = new URLSearchParams(location.search);
await loadBundled(params.get('score'));
// ?t=<seconds> opens the piece paused at that point (handy for links and screenshots).
if (params.has('t')) player.seek(Number(params.get('t')) * 1000);
