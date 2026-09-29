// Exports a score's notes (onset/offset in score ms, MIDI pitch) as JSON, using the same
// Verovio settings and timing as the app. Input for scripts/align.py.
// Usage: node scripts/export-score-notes.mjs public/scores/canon-in-d.musicxml out.json
import { readFileSync, writeFileSync } from 'node:fs';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import midiPkg from '@tonejs/midi';

const { Midi } = midiPkg;
const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/export-score-notes.mjs <score.musicxml> <out.json>');
  process.exit(1);
}

const tk = new VerovioToolkit(await createVerovioModule());
tk.setOptions({ breaks: 'none' });
if (!tk.loadData(readFileSync(input, 'utf8'))) throw new Error(`Verovio could not read ${input}`);
const midi = new Midi(Buffer.from(tk.renderToMIDI(), 'base64'));
const notes = midi.tracks
  .flatMap((tr) => tr.notes.map((n) => ({ on: Math.round(n.time * 1000), off: Math.round((n.time + n.duration) * 1000), pitch: n.midi })))
  .sort((a, b) => a.on - b.on || a.pitch - b.pitch);
writeFileSync(output, JSON.stringify({ notes }));
console.log(`Wrote ${notes.length} notes to ${output}`);
