// Generates small two-staff piano MusicXML test scores into public/scores/.
// Both pieces are public domain; the arrangements are simple piano reductions.
// Usage: npm run score
import { writeFileSync } from 'node:fs';

const PIECES = [
  {
    file: 'minuet-in-g.musicxml',
    title: 'Minuet in G',
    composer: 'after C. Petzold (BWV Anh. 114)',
    tempo: 116,
    fifths: 1,
    time: [3, 4],
    beamBeats: 3, // eighths beam across the whole bar
    treble: [
      'D5:4 G4:8 A4:8 B4:8 C5:8', 'D5:4 G4:4 G4:4', 'E5:4 C5:8 D5:8 E5:8 F#5:8', 'G5:4 G4:4 G4:4',
      'C5:4 D5:8 C5:8 B4:8 A4:8', 'B4:4 C5:8 B4:8 A4:8 G4:8', 'F#4:4 G4:8 A4:8 B4:8 G4:8', 'A4:2.',
      'D5:4 G4:8 A4:8 B4:8 C5:8', 'D5:4 G4:4 G4:4', 'E5:4 C5:8 D5:8 E5:8 F#5:8', 'G5:4 G4:4 G4:4',
      'C5:4 D5:8 C5:8 B4:8 A4:8', 'B4:4 C5:8 B4:8 A4:8 G4:8', 'A4:4 B4:8 A4:8 G4:8 F#4:8', 'G4:2.',
    ],
    bass: [
      'G3+B3+D4:2 A3:4', 'B3:2.', 'C4:2.', 'B3:2.',
      'A3:2.', 'G3:2.', 'D4:4 B3:4 G3:4', 'D4:4 D3:8 C4:8 B3:8 A3:8',
      'B3:2 A3:4', 'G3:4 B3:4 G3:4', 'C4:2.', 'B3:8 C4:8 B3:8 A3:8 G3:4',
      'A3:2 F#3:4', 'G3:2 B3:4', 'C4:4 D4:4 D3:4', 'G3:2 G2:4',
    ],
  },
  (() => {
    // Pachelbel's ground in the common piano arrangement: note values doubled, so the
    // eight chords D A Bm F#m G D G A take four bars, two chords per bar. The layout of
    // variations (11 passes of the ground, then a final chord) follows the rhythm of the
    // reference recording so the score can be aligned to it (scripts/align.py).
    const chords = ['D', 'A', 'Bm', 'Fsm', 'G', 'D', 'G', 'A'];
    // Left hand, per chord: eighth-note arpeggios, later doubled into sixteenths.
    const arp8 = {
      D: 'D3:8 A3:8 D4:8 F#4:8', A: 'A2:8 E3:8 A3:8 C#4:8', Bm: 'B2:8 F#3:8 B3:8 D4:8',
      Fsm: 'F#2:8 C#3:8 F#3:8 A3:8', G: 'G2:8 D3:8 G3:8 B3:8',
    };
    const arp16 = {
      D: 'D3:16 A3:16 D4:16 F#4:16 A4:16 F#4:16 D4:16 A3:16', A: 'A2:16 E3:16 A3:16 C#4:16 E4:16 C#4:16 A3:16 E3:16',
      Bm: 'B2:16 F#3:16 B3:16 D4:16 F#4:16 D4:16 B3:16 F#3:16', Fsm: 'F#2:16 C#3:16 F#3:16 A3:16 C#4:16 A3:16 F#3:16 C#3:16',
      G: 'G2:16 D3:16 G3:16 B3:16 D4:16 B3:16 G3:16 D3:16',
    };
    const ground = (arp) => [0, 2, 4, 6].map((i) => `${arp[chords[i]]} ${arp[chords[i + 1]]}`);

    // Pachelbel's own lines
    const entry = ['F#5:2 E5:2', 'D5:2 C#5:2', 'B4:2 A4:2', 'B4:2 C#5:2'];
    const second = ['D5:2 C#5:2', 'B4:2 A4:2', 'G4:2 F#4:2', 'G4:2 E4:2'];
    const broken = ['D5:4 F#5:4 A5:4 G5:4', 'F#5:4 D5:4 F#5:4 E5:4', 'D5:4 B4:4 D5:4 A5:4', 'G5:4 B5:4 A5:4 G5:4'];
    const running = [
      'F#5:4 D5:8 E5:8 F#5:4 D5:8 E5:8', 'F#5:8 A4:8 B4:8 C#5:8 D5:8 E5:8 F#5:8 G5:8',
      'F#5:4 D5:8 E5:8 F#5:4 F#4:8 G4:8', 'A4:8 B4:8 A4:8 G4:8 A4:8 F#4:8 G4:8 A4:8',
      'G4:4 B4:8 A4:8 G4:4 F#4:8 E4:8', 'F#4:8 E4:8 D4:8 E4:8 F#4:8 G4:8 A4:8 B4:8',
      'G4:4 B4:8 A4:8 B4:4 C#5:8 D5:8', 'A4:8 B4:8 C#5:8 D5:8 E5:8 F#5:8 G5:8 A5:8',
    ];
    // Simple figurations over the ground
    const repeated = ['F#5:4 F#5:4 E5:4 E5:4', 'D5:4 D5:4 C#5:4 C#5:4', 'B4:4 B4:4 A4:4 A4:4', 'B4:4 B4:4 C#5:4 C#5:4'];
    const dotted = [
      'D5:4 F#5:8 E5:8 D5:4 C#5:8 E5:8', 'B4:4 D5:8 C#5:8 B4:4 A4:8 C#5:8',
      'B4:4 D5:8 C#5:8 A4:4 F#4:8 A4:8', 'B4:4 D5:8 C#5:8 C#5:4 E5:8 A5:8',
    ];
    const arpUp = [
      'D5:8 F#5:8 A5:8 D6:8 C#5:8 E5:8 A5:8 C#6:8', 'B4:8 D5:8 F#5:8 B5:8 A4:8 C#5:8 F#5:8 A5:8',
      'B4:8 D5:8 G5:8 B5:8 A4:8 D5:8 F#5:8 A5:8', 'B4:8 D5:8 G5:8 B5:8 C#5:8 E5:8 A5:8 C#6:8',
    ];
    // Inner treble voice (drawn as a second layer, so it gets its own ball)
    const inner = ['F#4:2 E4:2', 'D4:2 C#4:2', 'B3:2 A3:2', 'B3:2 C#4:2'];
    const pedal = ['A4:2 A4:2', 'F#4:2 F#4:2', 'D4:2 D4:2', 'D4:2 E4:2'];
    const none = [null, null, null, null];

    return {
      file: 'canon-in-d.musicxml',
      title: 'Canon in D',
      composer: 'J. Pachelbel (piano arrangement)',
      tempo: 65,
      fifths: 2,
      time: [4, 4],
      beamBeats: 2,
      treble: [
        ...entry, ...second, ...broken, ...running, // passes 0-4
        ...broken, ...repeated, ...dotted, // 5-7
        ...running, ...arpUp, // 8-10
        'A4:4 C#5:4 E5:4 G5:4', 'A5:2 G5:2', // cadence (the recording slows down here)
        'D5+F#5+A5+D6:1',
      ],
      treble2: [...none, ...none, ...none, ...none, ...none, ...inner, ...pedal, ...none, ...none, ...none, ...none, null, null, null],
      bass: [
        ...Array.from({ length: 6 }, () => ground(arp8)).flat(),
        ...Array.from({ length: 5 }, () => ground(arp16)).flat(),
        'A1+A2:1', 'A1+A2:1',
        'D2+D3:1',
      ],
    };
  })(),
];

const DIVISIONS = 4; // per quarter note
const TYPES = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th' };

function parseEvent(tok) {
  const [pitchPart, durPart] = tok.split(':');
  const dotted = durPart.endsWith('.');
  const den = parseInt(durPart, 10);
  let duration = (4 / den) * DIVISIONS;
  if (dotted) duration *= 1.5;
  const pitches = pitchPart === 'R' ? [] : pitchPart.split('+').map(parsePitch);
  return { pitches, duration, type: TYPES[den], dotted, den };
}

function parsePitch(p) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(p);
  if (!m) throw new Error(`Bad pitch ${p}`);
  return { step: m[1], alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: +m[3] };
}

/**
 * Beams runs of eighths/sixteenths: notes group within a beat, and all-eighth beats merge
 * within `beamBeats`. Returns per-event {1: state, 2: state} beam values.
 */
function computeBeams(events, beamBeats) {
  const beams = events.map(() => ({}));
  let start = 0;
  const groups = [];
  let cur = null;
  events.forEach((ev, i) => {
    const beamable = ev.den >= 8 && ev.pitches.length;
    const beat = Math.floor(start / DIVISIONS);
    if (beamable && cur && cur.beat === beat) cur.idx.push(i);
    else if (beamable) groups.push((cur = { beat, idx: [i] }));
    else cur = null;
    start += ev.duration;
  });
  // Merge consecutive all-eighth beat groups that sit in the same beamBeats window.
  const merged = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    const eighthsOnly = (grp) => grp.idx.every((i) => events[i].den === 8);
    const contiguous = prev && prev.idx[prev.idx.length - 1] === g.idx[0] - 1 && prev.lastBeat === g.beat - 1;
    if (contiguous && eighthsOnly(prev) && eighthsOnly(g) && Math.floor(prev.beat / beamBeats) === Math.floor(g.beat / beamBeats)) {
      prev.idx.push(...g.idx);
      prev.lastBeat = g.beat;
    } else {
      merged.push({ ...g, lastBeat: g.beat });
    }
  }
  for (const { idx } of merged) {
    if (idx.length < 2) continue;
    idx.forEach((i, k) => (beams[i][1] = k === 0 ? 'begin' : k === idx.length - 1 ? 'end' : 'continue'));
    // Secondary beam over runs of sixteenths; a lone sixteenth gets a hook.
    for (let k = 0; k < idx.length; ) {
      if (events[idx[k]].den !== 16) { k++; continue; }
      let j = k;
      while (j + 1 < idx.length && events[idx[j + 1]].den === 16) j++;
      if (j === k) beams[idx[k]][2] = k === 0 ? 'forward hook' : 'backward hook';
      else for (let m = k; m <= j; m++) beams[idx[m]][2] = m === k ? 'begin' : m === j ? 'end' : 'continue';
      k = j + 1;
    }
  }
  return beams;
}

function measureXml(src, staff, voice, beamBeats) {
  const events = src.split(/\s+/).map(parseEvent);
  const beams = computeBeams(events, beamBeats);
  let xml = '';
  let total = 0;
  events.forEach((ev, idx) => {
    total += ev.duration;
    const beamXml = Object.entries(beams[idx]).map(([n, v]) => `<beam number="${n}">${v}</beam>`).join('');
    const body = (pitchXml, chord) =>
      `<note>${chord ? '<chord/>' : ''}${pitchXml}<duration>${ev.duration}</duration><voice>${voice}</voice>` +
      `<type>${ev.type}</type>${ev.dotted ? '<dot/>' : ''}<staff>${staff}</staff>${chord ? '' : beamXml}</note>`;
    if (!ev.pitches.length) {
      xml += body(ev.den === 1 ? '<rest measure="yes"/>' : '<rest/>', false);
      return;
    }
    ev.pitches.forEach((p, pi) => {
      const pitch = `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
      xml += body(pitch, pi > 0);
    });
  });
  return { xml, total };
}

function pieceXml(piece) {
  const [beats, beatType] = piece.time;
  const barLength = (beats * 4 * DIVISIONS) / beatType;
  if (piece.treble.length !== piece.bass.length) throw new Error(`${piece.title}: staves differ in length`);
  if (piece.treble2 && piece.treble2.length !== piece.treble.length) throw new Error(`${piece.title}: treble2 length differs`);
  let measures = '';
  for (let m = 0; m < piece.treble.length; m++) {
    const rh = measureXml(piece.treble[m], 1, 1, piece.beamBeats);
    const rh2 = piece.treble2?.[m] ? measureXml(piece.treble2[m], 1, 2, piece.beamBeats) : null;
    const lh = measureXml(piece.bass[m], 2, 5, piece.beamBeats);
    if (rh.total !== barLength || lh.total !== barLength || (rh2 && rh2.total !== barLength)) {
      throw new Error(`${piece.title}: measure ${m + 1} has wrong length`);
    }
    let attrs = '';
    let direction = '';
    if (m === 0) {
      attrs = `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${piece.fifths}</fifths></key>` +
        `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves>` +
        `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;
      direction =
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${piece.tempo}</per-minute></metronome></direction-type>` +
        `<staff>1</staff><sound tempo="${piece.tempo}"/></direction>` +
        `<direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type><staff>1</staff></direction>`;
    }
    const barline = m === piece.treble.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : '';
    measures += `<measure number="${m + 1}">${attrs}${direction}${rh.xml}${rh2 ? `<backup><duration>${barLength}</duration></backup>${rh2.xml}` : ''}<backup><duration>${barLength}</duration></backup>${lh.xml}${barline}</measure>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${piece.title}</work-title></work>
<identification><creator type="composer">${piece.composer}</creator></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name><score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-program>1</midi-program></midi-instrument></score-part></part-list>
<part id="P1">
${measures}</part>
</score-partwise>
`;
}

for (const piece of PIECES) {
  const out = new URL(`../public/scores/${piece.file}`, import.meta.url);
  writeFileSync(out, pieceXml(piece));
  console.log(`Wrote ${out.pathname}`);
}
