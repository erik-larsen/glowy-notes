import { engrave } from './engrave.js';
import { layoutScore } from './layout.js';
import { Player } from './audio.js';
import { Stage } from './scene.js';

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
  file: $('file'),
  measureHost: $('measure-host'),
};

const stage = new Stage($('stage'));
const player = new Player();
if (import.meta.env.DEV) Object.assign(window, { stage, player });
let durationMs = 0;
let scrubbing = false;

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

async function loadScore(data, name) {
  player.stop();
  syncPlayState();
  ui.play.disabled = ui.scrub.disabled = true;
  showMessage(`Engraving ${name}…`);
  try {
    const score = await engrave(data);
    const layout = await layoutScore(score.svg, ui.measureHost, stage.maxTextureSize);
    stage.setScore(layout, score);
    await audioReady;
    player.load(score.midi);
    durationMs = Math.max(score.durationMs, player.durationSec * 1000);
    ui.duration.textContent = fmt(durationMs);
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
  const res = await fetch(`/scores/${entry.id}.musicxml`);
  await loadScore(await res.text(), entry.name);
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
  player.seek(Math.min(durationMs, Math.max(0, player.timeMs + deltaMs)));
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
    player.seek(0);
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

let prevT = 0;
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const t = player.timeMs;
  stage.render(t, prevT, dt, now / 1000);
  prevT = t;

  ui.time.textContent = fmt(t);
  if (!scrubbing && durationMs) ui.scrub.value = String(Math.min(1, t / durationMs));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Boot --------------------------------------------------------------------

const audioReady = player.init();
syncPlayState();
await loadBundled(new URLSearchParams(location.search).get('score'));
