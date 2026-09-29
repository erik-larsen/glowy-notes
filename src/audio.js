// Milestone 2: play Verovio's MIDI through Tone.js. The audio clock drives the visuals:
// everything on screen asks `player.timeMs` where the music is.
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';

const SALAMANDER_URL = 'https://tonejs.github.io/audio/salamander/';
const SALAMANDER_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3',
  'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'];

const TAIL_SECONDS = 1.5; // let the last notes ring (and fade) before stopping

export class Player {
  constructor() {
    this.transport = Tone.getTransport();
    this.part = null;
    this.durationSec = 0;
    this.onEnded = () => {};
    this.instrument = null;
    this._endEvent = null;
  }

  /** Loads the piano samples; falls back to a synth if they can't be fetched. */
  async init() {
    const reverb = new Tone.Reverb({ decay: 2.8, wet: 0.22 }).toDestination();
    try {
      this.instrument = await new Promise((resolve, reject) => {
        const urls = Object.fromEntries(SALAMANDER_NOTES.map((n) => [n, `${n.replace('#', 's')}.mp3`]));
        const sampler = new Tone.Sampler({
          urls,
          baseUrl: SALAMANDER_URL,
          release: 1.2,
          onload: () => resolve(sampler),
          onerror: reject,
        });
      });
    } catch (err) {
      console.warn('Piano samples unavailable, using a synth instead.', err);
      this.instrument = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.6, sustain: 0.2, release: 1.0 },
        volume: -10,
      });
    }
    this.instrument.connect(reverb);
  }

  /** @param {string} midiBase64 output of Verovio's renderToMIDI() */
  load(midiBase64) {
    this.stop();
    this.part?.dispose();
    if (this._endEvent !== null) this.transport.clear(this._endEvent);

    const bytes = Uint8Array.from(atob(midiBase64), (c) => c.charCodeAt(0));
    const midi = new Midi(bytes);
    const events = midi.tracks.flatMap((track) =>
      track.notes.map((n) => ({ time: n.time, name: n.name, duration: n.duration, velocity: n.velocity })),
    );
    this.durationSec = Math.max(0, ...events.map((e) => e.time + e.duration));

    this.part = new Tone.Part((time, ev) => {
      this.instrument.triggerAttackRelease(ev.name, ev.duration, time, ev.velocity);
    }, events).start(0);

    // schedule (not scheduleOnce) so it fires on every pass, not just the first playthrough.
    this._endEvent = this.transport.schedule((time) => {
      Tone.getDraw().schedule(() => {
        this.stop();
        this.onEnded();
      }, time);
    }, this.durationSec + TAIL_SECONDS);
  }

  get playing() {
    return this.transport.state === 'started';
  }

  async play() {
    await Tone.start();
    this.transport.start();
  }

  pause() {
    this.transport.pause();
    this.instrument?.releaseAll();
  }

  stop() {
    this.transport.stop();
    this.instrument?.releaseAll();
  }

  seek(ms) {
    this.instrument?.releaseAll();
    this.transport.seconds = Math.max(0, ms / 1000);
  }

  /**
   * Score time in ms of what is audible *right now*. Tone schedules ahead by `lookAhead`
   * and the hardware adds output latency, so read the transport at the un-shifted context
   * time and subtract the output latency.
   */
  get timeMs() {
    if (!this.playing) return this.transport.seconds * 1000;
    const ctx = Tone.getContext();
    const latency = ctx.rawContext.outputLatency || 0;
    const sec = this.transport.getSecondsAtTime(Tone.immediate()) - latency;
    return Math.max(0, sec) * 1000;
  }
}
