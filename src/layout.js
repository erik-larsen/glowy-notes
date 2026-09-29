// Milestones 3 & 4: rasterize the engraved SVG into texture tiles, and measure where
// every notehead sits (in raster pixels) by laying the same SVG out in a hidden DOM node.

const TARGET_HEIGHT_PX = 1400; // raster height of the whole system; width follows the aspect ratio

/**
 * @param {string} svgText Verovio SVG output
 * @param {HTMLElement} host hidden container used for measurement
 * @param {number} maxTileWidth widest texture the GPU accepts
 */
export async function layoutScore(svgText, host, maxTileWidth) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  const srcW = parseFloat(root.getAttribute('width'));
  const srcH = parseFloat(root.getAttribute('height'));
  const scale = TARGET_HEIGHT_PX / srcH;
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);
  // The inner <svg class="definition-scale" viewBox> stretches to whatever size the root has.
  root.setAttribute('width', `${width}px`);
  root.setAttribute('height', `${height}px`);
  const svg = new XMLSerializer().serializeToString(root);

  const [notes, tiles] = await Promise.all([
    measureNotes(svg, host, width, height),
    rasterize(svg, width, height, maxTileWidth),
  ]);
  return { width, height, notes, tiles };
}

/** Returns Map<noteId, {x, y, w, h, staff, layer}> in raster pixels (notehead centre + size). */
function measureNotes(svg, host, width, height) {
  host.innerHTML = svg;
  const root = host.querySelector('svg');
  const origin = root.getBoundingClientRect();
  const sx = width / origin.width;
  const sy = height / origin.height;
  const notes = new Map();
  for (const el of root.querySelectorAll('g.note[id]')) {
    const head = el.querySelector(':scope > g.notehead') ?? el;
    const r = head.getBoundingClientRect();
    if (!r.width) continue;
    notes.set(el.id, {
      x: (r.left + r.width / 2 - origin.left) * sx,
      y: (r.top + r.height / 2 - origin.top) * sy,
      w: r.width * sx,
      h: r.height * sy,
      staff: parseInt(el.closest('g.staff')?.dataset.n ?? '1', 10),
      layer: parseInt(el.closest('g.layer')?.dataset.n ?? '1', 10),
    });
  }
  host.innerHTML = '';
  return notes;
}

/** Draws the SVG into canvases no wider than maxTileWidth: [{canvas, x, width}]. */
async function rasterize(svg, width, height, maxTileWidth) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const tiles = [];
    for (let x = 0; x < width; x += maxTileWidth) {
      const w = Math.min(maxTileWidth, width - x);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, x, 0, w, height, 0, 0, w, height);
      tiles.push({ canvas, x, width: w });
    }
    return tiles;
  } finally {
    URL.revokeObjectURL(url);
  }
}
