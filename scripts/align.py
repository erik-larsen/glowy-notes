"""Align a score to a real recording and write a score-time -> audio-time map.

1. Coarse: dynamic time warping between chroma computed from the score's notes and chroma
   of the recording (harmony lines up even where the voicing differs).
2. Fine: each score onset is snapped to the strongest audio onset within a small window
   around its coarse position, then the map is forced to be strictly increasing.

Usage:
  node scripts/export-score-notes.mjs public/scores/canon-in-d.musicxml /tmp/canon-notes.json
  .venv/bin/python scripts/align.py /tmp/canon-notes.json public/media/canon-in-d.m4a \
      public/media/canon-in-d.align.json
"""

import argparse
import json
import sys

import librosa
import numpy as np

SR = 22050
DTW_HOP = 2048  # ~93 ms frames for the coarse alignment
FINE_HOP = 256  # ~12 ms frames for onset snapping
SNAP_WINDOW_S = 0.09
OUTLIER_S = 0.1  # offsets this far from their neighbours are re-snapped
TRACK_DRIFT_S = 3.0  # tracker predictions further than this from the DTW estimate are reset
NOTE_DECAY_S = 1.0  # piano-like decay when synthesising score chroma


def score_chroma(notes, n_frames, hop):
    frame_s = hop / SR
    chroma = np.zeros((12, n_frames))
    for n in notes:
        on, off = n["on"] / 1000, n["off"] / 1000
        f0 = int(on / frame_s)
        f1 = min(n_frames, int((off + 0.3) / frame_s) + 1)
        if f0 >= n_frames:
            continue
        t = np.arange(f0, f1) * frame_s - on
        chroma[n["pitch"] % 12, f0:f1] += np.exp(-np.maximum(t, 0) / NOTE_DECAY_S)
    return chroma


def normalise(c):
    c = np.log1p(10 * c)
    return c / (np.linalg.norm(c, axis=0, keepdims=True) + 1e-9)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("notes", help="score notes JSON from export-score-notes.mjs")
    ap.add_argument("audio", help="recording (any format ffmpeg can decode)")
    ap.add_argument("out", help="output alignment JSON")
    args = ap.parse_args()

    notes = json.load(open(args.notes))["notes"]
    y, _ = librosa.load(args.audio, sr=SR, mono=True)
    audio_dur = len(y) / SR
    # DTW pins both ends of the path, so align only the audible span of the recording.
    _, (lead, tail) = librosa.effects.trim(y, top_db=35)
    y = y[lead:tail]
    offset = lead / SR
    score_dur = max(n["off"] for n in notes) / 1000

    # Coarse DTW on chroma.
    a_chroma = normalise(librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=DTW_HOP))
    s_chroma = normalise(score_chroma(notes, int(score_dur * SR / DTW_HOP) + 2, DTW_HOP))
    _, wp = librosa.sequence.dtw(X=s_chroma, Y=a_chroma, metric="cosine")
    wp = wp[::-1]
    frame_s = DTW_HOP / SR
    path_score = wp[:, 0] * frame_s
    path_audio = wp[:, 1] * frame_s
    # One audio time per score frame (mean over the path), for interpolation.
    uniq = np.unique(path_score)
    coarse_audio = np.array([path_audio[path_score == s].mean() for s in uniq])

    def coarse(score_s):
        return np.interp(score_s, uniq, coarse_audio)

    # Fine: snap onsets to audio onset peaks near their coarse position.
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=FINE_HOP)
    env_t = librosa.times_like(env, sr=SR, hop_length=FINE_HOP)
    peaks = librosa.util.peak_pick(env, pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=0.1, wait=3)
    peak_t = env_t[peaks]
    peak_v = env[peaks]

    min_strength = 0.35 * np.median(peak_v)

    def snap(center, window, after=-np.inf):
        """Strongest audio onset near `center` (closer is better) and later than `after`, or None."""
        idx = np.flatnonzero((np.abs(peak_t - center) <= window) & (peak_v >= min_strength) & (peak_t > after))
        if not len(idx):
            return None
        score = peak_v[idx] * (1 - 0.5 * np.abs(peak_t[idx] - center) / window)
        return float(peak_t[idx[np.argmax(score)]])

    onsets = np.array(sorted({n["on"] for n in notes})) / 1000

    # Track onsets in order: predict each from the local tempo of the last few matched notes,
    # search a window that scales with the gap (so ritardandos are followed), and fall back
    # to the DTW estimate when the prediction strays too far from it.
    coarse_t = coarse(onsets)
    times = np.empty_like(onsets)
    times[0] = snap(coarse_t[0], SNAP_WINDOW_S) or coarse_t[0]
    for i in range(1, len(onsets)):
        ds = onsets[i] - onsets[i - 1]
        lo = max(1, i - 4)
        if i > 1:
            ratios = (times[lo:i] - times[lo - 1 : i - 1]) / (onsets[lo:i] - onsets[lo - 1 : i - 1])
            ratio = float(np.clip(np.median(ratios), 0.5, 2.5))
        else:
            ratio = 1.0
        pred = times[i - 1] + ds * ratio
        if abs(pred - coarse_t[i]) > TRACK_DRIFT_S:
            pred = coarse_t[i]
        window = max(SNAP_WINDOW_S, 0.45 * ds * ratio)
        earliest = times[i - 1] + max(0.03, 0.35 * ds * ratio)  # rolled chords can't absorb several notes
        times[i] = snap(pred, window, after=earliest) or max(pred, earliest)

    # Reject isolated jumps: compare each offset (audio - score) with the median of its
    # neighbours (window shrinks symmetrically at the edges so a final ritardando survives),
    # then re-snap rejected points around the corrected position.
    offsets = times - onsets
    radius = 4
    fixed = 0
    for i in range(len(onsets)):
        r = min(radius, i, len(onsets) - 1 - i)
        med = float(np.median(offsets[i - r : i + r + 1]))
        if abs(offsets[i] - med) > OUTLIER_S:
            center = onsets[i] + med
            times[i] = snap(center, SNAP_WINDOW_S * 0.7, after=times[i - 1] if i else -np.inf) or center
            fixed += 1
    snapped = sum(1 for t in times if np.min(np.abs(peak_t - t)) < 1e-6)
    points = [[s * 1000, (t + offset) * 1000] for s, t in zip(onsets, times)]
    print(f"re-snapped {fixed} outliers")

    # Strictly increasing audio times.
    for i in range(1, len(points)):
        points[i][1] = max(points[i][1], points[i - 1][1] + 5)
    end_ms = score_dur * 1000
    points.append([end_ms, (float(coarse(score_dur)) + offset) * 1000])
    points = [[round(s), round(a, 1)] for s, a in points]

    # Report: how far the map strays from a straight tempo line (useful sanity check).
    s = np.array([p[0] for p in points]) / 1000
    a = np.array([p[1] for p in points]) / 1000
    slope, icept = np.polyfit(s, a, 1)
    resid = a - (slope * s + icept)
    print(f"onsets: {len(onsets)}, snapped to audio onsets: {snapped} ({100 * snapped / len(onsets):.0f}%)")
    print(f"first note at {a[0]:.2f}s, score {score_dur:.1f}s -> audio {audio_dur:.1f}s, tempo ratio {1 / slope:.3f}")
    print(f"deviation from straight tempo: median {1000 * np.median(np.abs(resid)):.0f} ms, max {1000 * np.max(np.abs(resid)):.0f} ms")

    json.dump({"audio": args.audio.split("/")[-1], "points": points}, open(args.out, "w"))
    worst = np.argsort(-np.abs(resid))[:5]
    print("largest deviations (score s -> ms):", ", ".join(f"{s[i]:.1f}->{1000 * resid[i]:+.0f}" for i in worst))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    sys.exit(main())
