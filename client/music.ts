/**
 * Sparse generative music with selectable styles. Four variants share one
 * plucked-string voice (pre-rendered Karplus-Strong) and one combat pulse,
 * and differ in what carries the mood between fights:
 *
 *  - drone     — the original: a low breathing drone under sparse plucks
 *  - strings   — no drone; the plucked phrases themselves carry the air
 *  - airs      — short pre-composed folk phrases over a swell that only
 *                breathes while a phrase is sounding
 *  - vigil     — slow chord swells (i–III–VI–VII) under occasional plucks
 *
 * The choice persists in localStorage and can be switched live from the
 * system menu — built for A/B listening. Sits well below the SFX in the mix,
 * routes through the shared master gain (so mute covers it), and obeys the
 * ambience/music toggle. Presentation only — Math.random here never touches
 * the sim.
 */

import { audioBus, isAmbienceMuted } from "./audio";

const MUSIC_GAIN = 0.07; // well under the SFX master level
const ROOT = 110; // A2 — the home key
// Aeolian degrees over the root, spread across two octaves, in Hz ratios.
const SCALE = [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5, 2, 12 / 5, 3];

export type MusicVariant = "drone" | "strings" | "airs" | "vigil";

export const MUSIC_VARIANTS: { id: MusicVariant; label: string }[] = [
  { id: "drone", label: "low drone" },
  { id: "strings", label: "wandering strings" },
  { id: "airs", label: "slow airs" },
  { id: "vigil", label: "chord vigil" },
];

const VARIANT_KEY = "barrow-music-variant";

let variant: MusicVariant = "strings";
try {
  const saved = localStorage.getItem(VARIANT_KEY);
  if (MUSIC_VARIANTS.some((v) => v.id === saved)) variant = saved as MusicVariant;
} catch {
  // no storage — the default plays
}

let started = false;
let ctxRef: AudioContext | null = null;
let gate: GainNode | null = null;
let pulseGain: GainNode | null = null;
let combat = false;
let lastCombatAt = 0;
let scaleIndex = 0;

// Everything a variant builds is tracked here so switching can tear it down.
let variantOut: GainNode | null = null;
const variantSources: (OscillatorNode | AudioBufferSourceNode)[] = [];
const variantTimers: number[] = [];

export function getMusicVariant(): MusicVariant {
  return variant;
}

export function setMusicVariant(v: MusicVariant): void {
  variant = v;
  try {
    localStorage.setItem(VARIANT_KEY, v);
  } catch {
    // no storage — the choice just doesn't persist
  }
  if (started && ctxRef) {
    teardownVariant();
    // Rebuild in "immediate" mode: a style switch must be audible at once.
    // Without this the new style waits out its normal gap (up to ~22s for
    // airs) and every style sounds identical — like nothing changed.
    buildVariant(ctxRef, true);
  }
}

function teardownVariant(): void {
  for (const t of variantTimers) clearTimeout(t);
  variantTimers.length = 0;
  for (const s of variantSources) {
    try {
      s.stop();
    } catch {
      // already stopped
    }
  }
  variantSources.length = 0;
  variantOut?.disconnect();
  variantOut = null;
}

/** setTimeout that the next teardown can cancel. */
function later(ms: number, fn: () => void): void {
  variantTimers.push(window.setTimeout(fn, ms));
}

/**
 * Karplus-Strong plucked string, pre-rendered into a buffer: one period of
 * softened noise, then each sample is the decayed average of the two samples
 * one period back. That averaging is a string's natural damping, so it reads
 * as a folk instrument — a lute or dulcimer — not an oscillator. Rendering in
 * JS (rather than a live feedback-delay loop) keeps it unconditionally stable:
 * a Web Audio feedback cycle can ring at its filter's resonance and squeal.
 */
const PLUCK_SECONDS = 2.4;

function pluckBuffer(ctx: AudioContext, freq: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const period = Math.max(2, Math.round(sr / freq));
  const len = Math.ceil(sr * PLUCK_SECONDS);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  // excitation: one period of lightly lowpassed noise — a soft fingertip pluck
  let lp = 0;
  for (let i = 0; i < period && i < len; i++) {
    lp = 0.6 * lp + 0.4 * (Math.random() * 2 - 1);
    out[i] = lp;
  }
  for (let i = period; i < len; i++) {
    const a = out[i - period]!;
    const b = i - period - 1 >= 0 ? out[i - period - 1]! : a;
    out[i] = 0.996 * 0.5 * (a + b);
  }
  return buf;
}

function pluck(ctx: AudioContext, dest: AudioNode, freq: number, at: number, gain: number): void {
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(ctx, freq);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  // the buffer decays naturally; this fade just prevents a truncation tick
  g.gain.setValueAtTime(gain, t0 + PLUCK_SECONDS - 0.3);
  g.gain.linearRampToValueAtTime(0, t0 + PLUCK_SECONDS);
  src.connect(g).connect(dest);
  src.start(t0);
  src.stop(t0 + PLUCK_SECONDS);
  // Tracked so a style switch can cut it off mid-ring, dropped once it ends —
  // a long session plays thousands of these.
  variantSources.push(src);
  src.onended = () => {
    const i = variantSources.indexOf(src);
    if (i >= 0) variantSources.splice(i, 1);
    g.disconnect();
  };
}

/** Advance the home-biased random walk and return the next scale index. */
function walkScale(): number {
  // mostly steps, the odd leap, always home-biased
  const step =
    Math.random() < 0.65
      ? (Math.random() < 0.5 ? -1 : 1)
      : Math.floor(Math.random() * 5) - 2;
  scaleIndex = Math.max(0, Math.min(SCALE.length - 1, scaleIndex + step));
  if (Math.random() < 0.15) scaleIndex = 0; // drift home now and then
  return scaleIndex;
}

const degreeFreq = (i: number): number => ROOT * SCALE[Math.max(0, Math.min(SCALE.length - 1, i))]!;

// ---------------------------------------------------------------- variants

/** The original bed: a low breathing drone, sparse random-walk plucks. */
function buildDrone(ctx: AudioContext, immediate: boolean): void {
  for (const [freq, g] of [
    [ROOT / 2, 0.5],
    [ROOT / 2 + 0.7, 0.3],
    [ROOT, 0.14],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const og = ctx.createGain();
    og.gain.value = g;
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.045;
    const tremGain = ctx.createGain();
    tremGain.gain.value = g * 0.3;
    trem.connect(tremGain).connect(og.gain);
    osc.connect(og).connect(variantOut!);
    osc.start();
    trem.start();
    variantSources.push(osc, trem);
  }
  let first = immediate;
  const motif = () => {
    const gapMs = first ? 250 : combat ? 2500 + Math.random() * 4000 : 6000 + Math.random() * 12000;
    first = false;
    later(gapMs, () => {
      pluck(ctx, variantOut!, degreeFreq(walkScale()), 0, 0.3);
      if (Math.random() < 0.45) pluck(ctx, variantOut!, degreeFreq(walkScale()), 0.35 + Math.random() * 0.4, 0.22);
      motif();
    });
  };
  motif();
}

/** No drone at all: the strings carry the air with fuller, more frequent
 * phrases, low root plucks as punctuation, and the odd open-fifth dyad. */
function buildStrings(ctx: AudioContext, immediate: boolean): void {
  let first = immediate;
  const phrase = () => {
    const gapMs = first ? 250 : combat ? 2500 + Math.random() * 3500 : 4500 + Math.random() * 7500;
    first = false;
    later(gapMs, () => {
      const notes = 2 + Math.floor(Math.random() * 4); // 2-5 notes
      let at = 0;
      for (let n = 0; n < notes; n++) {
        const idx = walkScale();
        pluck(ctx, variantOut!, degreeFreq(idx), at, n === 0 ? 0.3 : 0.2 + Math.random() * 0.08);
        // sometimes the last note blooms into an open fifth
        if (n === notes - 1 && Math.random() < 0.3) {
          pluck(ctx, variantOut!, degreeFreq(idx + 4), at + 0.04, 0.14);
        }
        at += 0.3 + Math.random() * 0.35;
      }
      // deep root punctuation, now and then, after the phrase settles
      if (Math.random() < 0.3) pluck(ctx, variantOut!, ROOT / 2, at + 0.6, 0.2);
      phrase();
    });
  };
  phrase();
}

/** Short composed folk phrases (scale degrees + beats), each over a soft
 * swell that breathes only while the phrase sounds — melody without a pedal. */
const AIRS: [number, number][][] = [
  // [degree, beats]
  [[0, 2], [2, 1], [3, 1], [4, 2], [3, 1], [2, 1], [0, 3]],
  [[4, 1], [5, 1], [4, 2], [2, 1], [3, 1], [2, 2], [0, 3]],
  [[0, 1], [2, 1], [4, 1], [7, 2], [5, 1], [4, 1], [2, 3]],
  [[7, 2], [5, 1], [4, 2], [5, 1], [4, 1], [2, 1], [0, 3]],
];

function buildAirs(ctx: AudioContext, immediate: boolean): void {
  const beat = 0.42;
  let first = immediate;
  const play = () => {
    const gapMs = first ? 200 : combat ? 6000 + Math.random() * 6000 : 11000 + Math.random() * 11000;
    first = false;
    later(gapMs, () => {
      const air = AIRS[Math.floor(Math.random() * AIRS.length)]!;
      const up = Math.random() < 0.3 ? 2 : 1; // sometimes an octave higher
      let at = 0.8; // the swell leads, the melody follows
      let total = 0;
      for (const [, beats] of air) total += beats;
      // the swell under the phrase: a quiet root sine that rises and falls once
      const swell = ctx.createOscillator();
      swell.frequency.value = ROOT / 2;
      const sg = ctx.createGain();
      const t0 = ctx.currentTime;
      const dur = total * beat + 2.5;
      sg.gain.setValueAtTime(0.0001, t0);
      sg.gain.exponentialRampToValueAtTime(0.12, t0 + dur * 0.35);
      sg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      swell.connect(sg).connect(variantOut!);
      swell.start(t0);
      swell.stop(t0 + dur + 0.1);
      variantSources.push(swell);
      for (const [deg, beats] of air) {
        pluck(ctx, variantOut!, degreeFreq(deg) * up, at, 0.26);
        at += beats * beat * (0.95 + Math.random() * 0.1);
      }
      play();
    });
  };
  play();
}

/** Slow chord swells — i, III, VI, VII over the low root — with sparse plucks.
 * Each chord's oscillators live only for that swell, so nothing is constant. */
const CHORDS: number[][] = [
  [1, 1.2, 1.5], // i
  [1.2, 1.5, 1.8], // III
  [1.6, 2, 2.4], // VI
  [1.8, 2.25, 2.7], // VII
];

function buildVigil(ctx: AudioContext, immediate: boolean): void {
  let chordIndex = 0;
  const swellChord = () => {
    const ratios = CHORDS[chordIndex]!;
    // wander the progression: forward mostly, home sometimes
    chordIndex = Math.random() < 0.3 ? 0 : (chordIndex + 1 + Math.floor(Math.random() * 2)) % CHORDS.length;
    const t0 = ctx.currentTime;
    const dur = 12 + Math.random() * 6;
    for (const r of ratios) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = (ROOT / 2) * r;
      osc.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.09, t0 + dur * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(variantOut!);
      osc.start(t0);
      osc.stop(t0 + dur + 0.1);
      variantSources.push(osc);
    }
    later((dur - 4 + Math.random() * 3) * 1000, swellChord); // overlap the tails
  };
  swellChord();
  let first = immediate;
  const motif = () => {
    const gapMs = first ? 500 : 8000 + Math.random() * 9000;
    first = false;
    later(gapMs, () => {
      pluck(ctx, variantOut!, degreeFreq(walkScale()), 0, 0.24);
      if (Math.random() < 0.35) pluck(ctx, variantOut!, degreeFreq(walkScale()), 0.5, 0.16);
      motif();
    });
  };
  motif();
}

const BUILDERS: Record<MusicVariant, (ctx: AudioContext, immediate: boolean) => void> = {
  drone: buildDrone,
  strings: buildStrings,
  airs: buildAirs,
  vigil: buildVigil,
};

/**
 * Rough loudness match between styles, measured off the master bus: the
 * pluck-only styles peak far quieter than the ones with a sustained bed, and
 * an unmatched A/B just tells you which style is louder.
 */
const VARIANT_TRIM: Record<MusicVariant, number> = {
  drone: 1,
  strings: 2.4,
  airs: 1.5,
  vigil: 1.6,
};

function buildVariant(ctx: AudioContext, immediate = false): void {
  variantOut = ctx.createGain();
  variantOut.gain.value = VARIANT_TRIM[variant];
  variantOut.connect(gate!);
  BUILDERS[variant](ctx, immediate);
}

// ------------------------------------------------------------------ engine

/** ~2.8s airy impulse — a wider, softer space than the SFX's stone hall, so
 * the strings hang in the air the way the wind bed suggests they should. */
function airImpulse(ctx: AudioContext): AudioBuffer {
  const seconds = 2.8;
  const len = Math.ceil(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const decay = Math.pow(1 - i / len, 2.2);
      lp += 0.22 * (Math.random() * 2 - 1 - lp);
      data[i] = lp * decay;
    }
  }
  return buf;
}

function startLayers(ctx: AudioContext, master: GainNode): void {
  gate = ctx.createGain();
  gate.gain.value = isAmbienceMuted() ? 0 : 1;
  const level = ctx.createGain();
  level.gain.value = MUSIC_GAIN;
  gate.connect(level).connect(master);

  // reverb branch: dry through `level`, wet through the convolver alongside it
  const send = ctx.createGain();
  send.gain.value = 0.55; // strings live mostly in the space, not in front of it
  const verb = ctx.createConvolver();
  verb.buffer = airImpulse(ctx);
  const wetLevel = ctx.createGain();
  wetLevel.gain.value = MUSIC_GAIN;
  gate.connect(send).connect(verb).connect(wetLevel).connect(master);

  // Combat pulse: a low square ticking at heartbeat rate, gated to silence
  // until combat raises it. Shared by every variant.
  pulseGain = ctx.createGain();
  pulseGain.gain.value = 0;
  const pulse = ctx.createOscillator();
  pulse.type = "square";
  pulse.frequency.value = ROOT / 4;
  // The heartbeat lives in a series gain, so pulseGain at 0 is true silence.
  const throb = ctx.createGain();
  throb.gain.value = 0.5;
  const beat = ctx.createOscillator();
  beat.frequency.value = 1.9;
  const beatGain = ctx.createGain();
  beatGain.gain.value = 0.45;
  beat.connect(beatGain).connect(throb.gain);
  pulse.connect(throb).connect(pulseGain).connect(gate);
  pulse.start();
  beat.start();

  buildVariant(ctx);
}

/**
 * Call every frame with whether any monster is hunting the local player.
 * Starts the layers lazily once the AudioContext is unlocked; raises the
 * pulse while hunted and lets it decay ~4s after the chase breaks off.
 */
export function updateMusic(inCombat: boolean): void {
  const bus = audioBus();
  if (!bus || bus.ctx.state !== "running") return;
  if (!started) {
    started = true;
    ctxRef = bus.ctx;
    startLayers(bus.ctx, bus.master);
  }
  if (gate) gate.gain.value = isAmbienceMuted() ? 0 : 1;
  const now = performance.now();
  if (inCombat) lastCombatAt = now;
  const want = inCombat || now - lastCombatAt < 4000;
  if (want !== combat && pulseGain) {
    combat = want;
    const t = bus.ctx.currentTime;
    pulseGain.gain.cancelScheduledValues(t);
    pulseGain.gain.setValueAtTime(pulseGain.gain.value, t);
    pulseGain.gain.linearRampToValueAtTime(combat ? 0.16 : 0, t + (combat ? 1 : 4));
  }
}

/** Test/HMR hygiene: stop every variant voice and pending timer. */
export function stopMusic(): void {
  teardownVariant();
  started = false;
}
