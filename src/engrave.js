// Milestone 1: engrave MusicXML with Verovio into one continuous system,
// plus the timemap (note id -> onset/offset in ms) and a MIDI rendering.

let toolkitPromise = null;

function getToolkit() {
  toolkitPromise ??= (async () => {
    const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
      import('verovio/wasm'),
      import('verovio/esm'),
    ]);
    const module = await createVerovioModule();
    return new VerovioToolkit(module);
  })();
  return toolkitPromise;
}

/**
 * @param {string | ArrayBuffer} data MusicXML text, or the bytes of a MusicXML / compressed .mxl file
 * @returns {Promise<{svg: string, notes: Map<string, {on: number, off: number}>, timemap: object[], midi: string, durationMs: number}>}
 */
export async function engrave(data) {
  const tk = await getToolkit();
  tk.setOptions({
    breaks: 'none', // single horizontal system
    adjustPageWidth: true,
    adjustPageHeight: true,
    header: 'none',
    footer: 'none',
    scale: 100,
    pageMarginLeft: 150,
    pageMarginRight: 150,
    // Tag staves and layers with their @n so each voice gets its own colour and ball.
    svgAdditionalAttribute: ['staff@n', 'layer@n'],
  });

  let ok;
  if (typeof data === 'string') {
    ok = tk.loadData(data);
  } else if (isZip(data)) {
    ok = tk.loadZipDataBuffer(data);
  } else {
    ok = tk.loadData(new TextDecoder().decode(data));
  }
  if (!ok) throw new Error('Verovio could not read this file.');

  const svg = tk.renderToSVG(1);
  const timemap = tk.renderToTimemap({});
  const midi = tk.renderToMIDI();

  // Collapse the event list into per-note onset/offset times.
  const notes = new Map();
  for (const ev of timemap) {
    for (const id of ev.on ?? []) notes.set(id, { on: ev.tstamp, off: Infinity });
    for (const id of ev.off ?? []) {
      const n = notes.get(id);
      if (n) n.off = ev.tstamp;
    }
  }
  const durationMs = timemap.length ? timemap[timemap.length - 1].tstamp : 0;
  for (const n of notes.values()) if (n.off === Infinity) n.off = durationMs;

  return { svg, notes, timemap, midi, durationMs };
}

function isZip(buf) {
  const b = new Uint8Array(buf, 0, 2);
  return b[0] === 0x50 && b[1] === 0x4b; // "PK"
}
