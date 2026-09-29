// Milestone 7: a piecewise-linear map between score time and recording time, built from
// alignment points [[scoreMs, audioMs], ...] (see scripts/align.py). Outside the aligned
// range both directions continue at tempo 1:1.

function interpolate(points, from, to, value) {
  const n = points.length;
  if (value <= points[0][from]) return points[0][to] + (value - points[0][from]);
  if (value >= points[n - 1][from]) return points[n - 1][to] + (value - points[n - 1][from]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][from] <= value) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  return a[to] + ((b[to] - a[to]) * (value - a[from])) / (b[from] - a[from]);
}

/** @param {[number, number][]} points strictly increasing in both score and audio time */
export function createWarp(points) {
  return {
    toAudio: (scoreMs) => interpolate(points, 0, 1, scoreMs),
    toScore: (audioMs) => interpolate(points, 1, 0, audioMs),
  };
}
