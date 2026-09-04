/**
 * Procedural sound: every effect is synthesized on the fly with Web Audio.
 * No samples, no assets. Call unlock() from a user gesture once.
 *
 * Design rules that keep this from reading as chiptune:
 *  - noise and texture carry the sounds; bare oscillators never appear dry
 *  - impacts are built as crack + body + sub layers (see `impact`)
 *  - creature vocals are amplitude-modulated saws through a formant filter
 *    bank (see `growl`) — throat, not beep
 *  - "treasure" cues are additive inharmonic partial stacks (see `metal`) —
 *    dull bells and coin clinks, never melodic arpeggios
 *  - everything low, slow, and wet: a long dark stone reverb hangs off the
 *    SFX bus, and a compressor glues the layers
 *
 * Routing:  layer -> [saturator] -> sfxBus -> compressor -> master
 *           sfxBus -> reverb send -> convolver -> compressor
 * Ambience/music connect to master directly and stay dry — continuous beds
 * through a convolver just turn to mud.
 */

import type { WeaponEdge } from "../sim/items/bases";

type SoundName =
  | "swing"
  | "hit"
  | "hurt"
  | "aggro"
  | "die"
  | "drop"
  | "drop_rare"
  | "pickup"
  | "potion"
  | "levelup"
  | "skillup"
  | "explode"
  | "warcry"
  | "leap"
  | "leapland"
  | "cleave"
  | "crush"
  | "spit"
  | "windup"
  | "coin"
  | "portal"
  | "nomana"
  | "equip"
  | "unequip";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let satIn: GainNode | null = null;
const lastPlayed = new Map<SoundName, number>();

const MASTER_GAIN = 0.4;
const REVERB_SEND = 0.14;
const MUTE_KEY = "barrow-muted";
const AMBIENCE_MUTE_KEY = "barrow-ambience-muted";

let muted = false;
let ambienceMuted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
  ambienceMuted = localStorage.getItem(AMBIENCE_MUTE_KEY) === "1";
} catch {
  // no storage (tests) — sound stays on
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    if (m) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // no storage — the choice just doesn't persist
  }
  if (master) master.gain.value = m ? 0 : MASTER_GAIN;
}

/** The ambience+music layers' own quiet switch; SFX stay on the master mute. */
export function isAmbienceMuted(): boolean {
  return ambienceMuted;
}

export function setAmbienceMuted(m: boolean): void {
  ambienceMuted = m;
  try {
    if (m) localStorage.setItem(AMBIENCE_MUTE_KEY, "1");
    else localStorage.removeItem(AMBIENCE_MUTE_KEY);
  } catch {
    // no storage — the choice just doesn't persist
  }
}

/** ~1.3s decaying noise impulse, heavily lowpass-tinted: a stone hall.
 * Kept modest — reverb is here to give the synthesized sounds a room, not a
 * cathedral; too much wash and every hit smears into the next. */
function stoneImpulse(c: AudioContext): AudioBuffer {
  const seconds = 1.3;
  const len = Math.ceil(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const decay = Math.pow(1 - i / len, 3);
      // one-pole lowpass on the noise darkens the tail
      lp += 0.16 * (Math.random() * 2 - 1 - lp);
      data[i] = lp * decay;
    }
  }
  return buf;
}

/** Soft-clip curve for the shared saturator — adds harmonics and weight. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.5 * x);
  }
  return curve;
}

function ensure(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);

    // glue compressor: lets impacts hit hard without clipping the bus
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.connect(master);

    sfxBus = ctx.createGain();
    sfxBus.connect(comp);

    // shared reverb send off the SFX bus
    const send = ctx.createGain();
    send.gain.value = REVERB_SEND;
    const verb = ctx.createConvolver();
    verb.buffer = stoneImpulse(ctx);
    sfxBus.connect(send).connect(verb).connect(comp);

    // shared saturator: impact and vocal layers route through here for grit
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = "2x";
    const satOut = ctx.createGain();
    satOut.gain.value = 0.7; // tanh output runs hot; pull it back into the mix
    satIn = ctx.createGain();
    satIn.connect(shaper).connect(satOut).connect(sfxBus);
  }
  return ctx;
}

export function unlock(): void {
  const c = ensure();
  if (c && c.state === "suspended") void c.resume();
}

/** The shared context and master gain, for the ambience and music layers.
 * Routing through `master` keeps every layer behind the one mute switch. */
export function audioBus(): { ctx: AudioContext; master: GainNode } | null {
  const c = ensure();
  if (!c || !master) return null;
  return { ctx: c, master };
}

/** A monster family's vocal character, fed to the growl synth.
 * pitch scales the fundamental; rough is the amplitude-modulation rate in Hz
 * (slow = moan/gurgle, fast = chitter/snarl); formants shift the filter bank. */
export interface Voice {
  pitch: number;
  rough: number;
  formants: number;
}

/** typeId -> family; families share a throat. */
const MONSTER_FAMILIES: Record<string, string> = {
  skitter: "skitter",
  cinder_shade: "skitter",
  tomb_bloat: "bloat",
  ember_hulk: "bloat",
  shambler: "shambler",
  cairn_wight: "wight",
  ash_revenant: "wight",
  crown_sentinel: "wight",
  barrow_lord: "wight",
  fen_howler: "howler",
  veil_screamer: "screamer",
  gravespit: "caster",
  bog_maw: "caster",
};

const FAMILY_VOICES: Record<string, Voice> = {
  skitter: { pitch: 2.0, rough: 85, formants: 1.5 }, // fast dry chitter
  bloat: { pitch: 0.7, rough: 16, formants: 0.8 }, // slow wet gurgle
  shambler: { pitch: 1.0, rough: 30, formants: 1.0 },
  wight: { pitch: 0.55, rough: 22, formants: 0.7 }, // hollow low moan
  howler: { pitch: 1.5, rough: 45, formants: 1.2 }, // ragged yelp
  screamer: { pitch: 2.1, rough: 60, formants: 1.6 }, // tearing shriek
  caster: { pitch: 1.2, rough: 38, formants: 1.1 },
};

const NEUTRAL_VOICE: Voice = { pitch: 1, rough: 32, formants: 1 };

/** The vocal character for a monster type, or undefined for the neutral voice. */
export function monsterVoice(typeId: string | undefined): Voice | undefined {
  if (!typeId) return undefined;
  const family = MONSTER_FAMILIES[typeId];
  return family ? FAMILY_VOICES[family] : undefined;
}

/** Random value in [lo, hi) — presentation-only jitter, never touches sim determinism. */
function rnd(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  filterFrom?: number;
  filterTo?: number;
  filterType?: BiquadFilterType;
  at?: number;
  q?: number;
  attack?: number;
  sat?: boolean;
}

function noise(
  c: AudioContext,
  {
    dur,
    gain = 0.4,
    filterFrom = 2000,
    filterTo,
    filterType = "bandpass",
    at = 0,
    q = 1,
    attack,
    sat,
  }: NoiseOpts,
): void {
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur + 0.05);
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFrom, t0);
  if (filterTo !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(1, filterTo), t0 + dur);
  filter.Q.value = q;
  const g = c.createGain();
  if (attack) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
  } else {
    g.gain.setValueAtTime(gain, t0);
  }
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(sat ? satIn! : sfxBus!);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

interface SubOpts {
  from: number;
  to: number;
  dur: number;
  gain?: number;
  at?: number;
}

/** Saturated sine thump. The pitch falls inside the first 35ms — fast enough
 * to read as a transient, never as an audible "boop" sweep. */
function sub(c: AudioContext, { from, to, dur, gain = 0.5, at = 0 }: SubOpts): void {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + Math.min(0.035, dur * 0.4));
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(satIn!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

interface ImpactOpts {
  /** overall size: scales sub weight, body length, rumble */
  size?: number;
  /** pitch factor for per-hit variation */
  p?: number;
  /** add a wet resonant squish layer (flesh) */
  flesh?: boolean;
  /** add a long low rumble tail (heavy landings, explosions) */
  rumble?: boolean;
  /** "blunt" mutes the crack and doubles down on the sub; sharp hits are
   * a different sound entirely — see `slash` */
  edge?: WeaponEdge;
  at?: number;
}

/** Layered impact: crack + noise body + sub thump [+ squish] [+ rumble].
 * Layer timings, presence, and levels all wobble per hit — repeated strikes
 * at a fixed attack cadence must never sound like a drum machine. */
function impact(c: AudioContext, { size = 1, p = 1, flesh, rumble, edge, at = 0 }: ImpactOpts = {}): void {
  // humanize: the whole hit lands a hair off the tick grid
  const t = at + rnd(0, 0.025);
  const blunt = edge === "blunt";
  // crack — the first 10ms of high-frequency snap; sometimes barely there.
  // A club lands with almost none.
  noise(c, {
    dur: 0.012,
    gain: rnd(0.1, 0.28) * size * (blunt ? 0.4 : 1),
    filterFrom: rnd(4200, 5600) * p * (blunt ? 0.75 : 1),
    filterType: "highpass",
    at: t,
    sat: true,
  });
  // body — the mid punch, sweeping down as the energy dissipates.
  // Blunt: longer, lower, fatter.
  noise(c, {
    dur: rnd(0.06, 0.13) * size * (blunt ? 1.5 : 1),
    gain: rnd(0.28, 0.42) * size * (blunt ? 1.2 : 1),
    filterFrom: rnd(750, 1050) * p * (blunt ? 0.6 : 1),
    filterTo: rnd(180, 260) * p * (blunt ? 0.6 : 1),
    q: rnd(0.7, 1.1) * (blunt ? 0.8 : 1),
    at: t + rnd(0, 0.006),
    sat: true,
  });
  // sub — the chest-weight thump, drifting a few ms behind the crack.
  // The whole point of a maul; an afterthought for a knife.
  sub(c, {
    from: rnd(125, 155) * p * (blunt ? 0.85 : 1),
    to: rnd(42, 54) * p * (blunt ? 0.8 : 1),
    dur: rnd(0.11, 0.19) * size * (blunt ? 1.6 : 1),
    gain: rnd(0.42, 0.62) * size * (blunt ? 1.3 : 1),
    at: t + rnd(0.002, 0.01),
  });
  if (blunt) {
    // the thud's aftermath: a dull, dark low-mid slump as the mass settles
    noise(c, {
      dur: rnd(0.14, 0.24) * size,
      gain: rnd(0.14, 0.22) * size,
      filterFrom: rnd(260, 360) * p,
      filterTo: rnd(70, 110) * p,
      filterType: "lowpass",
      at: t + rnd(0.01, 0.02),
      sat: true,
    });
  }
  if (flesh && Math.random() < 0.75) {
    // wet squish: high-Q resonant sweep through low mids; absent one hit in four
    noise(c, {
      dur: rnd(0.05, 0.11),
      gain: rnd(0.1, 0.2) * size,
      filterFrom: rnd(600, 900) * p,
      filterTo: rnd(110, 170) * p,
      q: rnd(5, 9),
      at: t + rnd(0.006, 0.014),
      sat: true,
    });
  }
  if (rumble) {
    noise(c, {
      dur: rnd(0.5, 0.7) * size,
      gain: 0.18 * size,
      filterFrom: 220,
      filterTo: 45,
      filterType: "lowpass",
      at: t + 0.02,
    });
  }
}

/** A blade landing: no thump at all. The sound is the cut — a bright,
 * narrow band tearing down through the top end, a wet ripping squish
 * underneath it, a snap of steel biting, and a short edge-ring as it
 * pulls free. Reads as "sliced", never "clubbed". */
function slash(c: AudioContext, p = 1, at = 0): void {
  const t = at + rnd(0, 0.02);
  // bite — a bright, longer snap than a thump's crack: steel meeting meat
  noise(c, {
    dur: rnd(0.02, 0.03),
    gain: rnd(0.22, 0.34),
    filterFrom: rnd(5000, 6800) * p,
    filterType: "highpass",
    at: t,
    sat: true,
  });
  // the cut — the dominant layer, a resonant band sweeping fast from high to mid
  noise(c, {
    dur: rnd(0.09, 0.15),
    gain: rnd(0.34, 0.48),
    filterFrom: rnd(3600, 4800) * p,
    filterTo: rnd(700, 1100) * p,
    q: rnd(3, 5),
    at: t + rnd(0.002, 0.006),
    sat: true,
  });
  // the tear — wet, ragged, resonant low-mids; the flesh giving way
  noise(c, {
    dur: rnd(0.07, 0.13),
    gain: rnd(0.16, 0.26),
    filterFrom: rnd(1100, 1500) * p,
    filterTo: rnd(200, 320) * p,
    q: rnd(6, 10),
    at: t + rnd(0.01, 0.02),
    sat: true,
  });
  // edge-ring — the blade singing as it leaves; comes and goes
  if (Math.random() < 0.7) {
    noise(c, {
      dur: rnd(0.1, 0.18),
      gain: rnd(0.05, 0.1),
      filterFrom: rnd(5200, 7200) * p,
      q: rnd(16, 26),
      at: t + rnd(0.015, 0.03),
    });
  }
  // only a whisper of weight behind it — enough to feel the arm, no more
  noise(c, {
    dur: rnd(0.04, 0.07),
    gain: rnd(0.06, 0.1),
    filterFrom: rnd(300, 420) * p,
    filterTo: rnd(120, 180) * p,
    filterType: "lowpass",
    at: t + rnd(0.004, 0.01),
  });
}

interface GrowlOpts {
  v: Voice;
  dur: number;
  gain?: number;
  /** fundamental at full pitch=1; scaled by v.pitch */
  base?: number;
  /** fraction of base the pitch falls to across the sound */
  fall?: number;
  /** fraction of base the pitch rises to first (shouts, shrieks) */
  rise?: number;
  at?: number;
}

/**
 * Creature vocal: two detuned saws, amplitude-modulated at the voice's
 * roughness rate, pushed through a three-band formant filter bank and the
 * saturator. Reads as a throat with vocal cords, not an oscillator.
 */
function growl(c: AudioContext, { v, dur, gain = 0.4, base = 82, fall = 0.55, rise, at = 0 }: GrowlOpts): void {
  const t0 = c.currentTime + at;
  const f0 = base * v.pitch * rnd(0.92, 1.08);

  // source: detuned saw pair
  const pre = c.createGain();
  pre.gain.value = 0.5;
  for (const d of [-14, 14]) {
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    osc.detune.value = d;
    if (rise) {
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.exponentialRampToValueAtTime(f0 * rise, t0 + dur * 0.35);
      osc.frequency.exponentialRampToValueAtTime(f0 * fall, t0 + dur);
    } else {
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.exponentialRampToValueAtTime(f0 * fall, t0 + dur);
    }
    osc.connect(pre);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // roughness: amplitude modulation at the family's rate — the vocal-cord flutter
  const am = c.createGain();
  am.gain.value = 0.6;
  const lfo = c.createOscillator();
  lfo.frequency.value = v.rough * rnd(0.85, 1.2);
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 0.4;
  lfo.connect(lfoDepth).connect(am.gain);
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.02);
  pre.connect(am);

  // breath: a little formant-filtered noise mixed in with the buzz
  const breath = c.createBufferSource();
  breath.buffer = noiseBuffer(c, dur + 0.05);
  const breathGain = c.createGain();
  breathGain.gain.value = 0.15;
  breath.connect(breathGain).connect(am);
  breath.start(t0);
  breath.stop(t0 + dur + 0.05);

  // formant bank: three parallel bandpasses shape the throat
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  const formants: Array<[number, number]> = [
    [480 * v.formants, 1],
    [1000 * v.formants, 0.55],
    [2300 * v.formants, 0.22],
  ];
  for (const [freq, fGain] of formants) {
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 5;
    const fg = c.createGain();
    fg.gain.value = fGain;
    am.connect(bp).connect(fg).connect(env);
  }
  // plus a dark direct path so the fundamental keeps its chest
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 260;
  const lpGain = c.createGain();
  lpGain.gain.value = 0.7;
  am.connect(lp).connect(lpGain).connect(env);

  env.connect(satIn!);
}

interface MetalOpts {
  freq: number;
  dur: number;
  gain?: number;
  at?: number;
  /** how many partials; fewer = duller */
  partials?: number;
}

/** Additive inharmonic strike — the stretched partials of real struck metal.
 * Low freq + long dur = dull bell toll; high freq + short dur = coin clink. */
const METAL_RATIOS = [1, 2.01, 2.74, 3.53, 4.28, 5.19, 6.37];
const METAL_GAINS = [1, 0.62, 0.45, 0.3, 0.24, 0.17, 0.12];

function metal(c: AudioContext, { freq, dur, gain = 0.2, at = 0, partials = 6 }: MetalOpts): void {
  const t0 = c.currentTime + at;
  const out = c.createGain();
  out.gain.value = gain;
  out.connect(sfxBus!);
  // strike transient so the ring has a hit at the front
  noise(c, { dur: 0.01, gain: gain * 0.9, filterFrom: freq * 4, q: 2, at });
  for (let i = 0; i < Math.min(partials, METAL_RATIOS.length); i++) {
    const osc = c.createOscillator();
    osc.frequency.value = freq * (METAL_RATIOS[i] ?? 1) * rnd(0.996, 1.004);
    const g = c.createGain();
    // higher partials die faster, like real metal
    const pDur = dur * (1 - i * 0.11);
    g.gain.setValueAtTime((METAL_GAINS[i] ?? 0.1) * 0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + pDur);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + pDur + 0.02);
  }
}

/** A blade through air: a thin, fast whistle — a narrow band sweeping down
 * from the top, with a hair of steel ring — and hardly any low body. */
function swingSharp(c: AudioContext, p: number, at: number, loud: number): void {
  const quick = Math.random() < 0.5;
  noise(c, {
    dur: quick ? rnd(0.06, 0.1) : rnd(0.1, 0.16),
    gain: rnd(0.14, 0.22) * loud,
    filterFrom: rnd(3400, 4600) * p,
    filterTo: rnd(900, 1400) * p,
    q: rnd(2.5, 4.5),
    at,
  });
  // the edge singing: a very narrow band riding just above the whistle
  if (Math.random() < 0.7) {
    noise(c, {
      dur: rnd(0.05, 0.09),
      gain: rnd(0.05, 0.1) * loud,
      filterFrom: rnd(5500, 7500) * p,
      filterTo: rnd(2500, 3500) * p,
      q: rnd(8, 14),
      at: at + rnd(0, 0.015),
    });
  }
  // a whisper of displaced air underneath; never the fat whoosh
  if (Math.random() < 0.4) {
    noise(c, {
      dur: rnd(0.07, 0.11),
      gain: rnd(0.03, 0.06) * loud,
      filterFrom: rnd(900, 1300) * p,
      filterTo: rnd(300, 450) * p,
      filterType: "lowpass",
      at: at + rnd(0, 0.02),
    });
  }
}

/** Mass through air: a slow, dark whoosh with a fat low body and a soft
 * onset — all shoulder, no top end. */
function swingBlunt(c: AudioContext, p: number, at: number, loud: number): void {
  noise(c, {
    dur: rnd(0.16, 0.28),
    gain: rnd(0.16, 0.26) * loud,
    filterFrom: rnd(550, 800) * p,
    filterTo: rnd(110, 170) * p,
    filterType: "lowpass",
    at,
    attack: rnd(0.03, 0.07),
  });
  // the low air body is the sound here, so it's always present
  noise(c, {
    dur: rnd(0.12, 0.2),
    gain: rnd(0.08, 0.14) * loud,
    filterFrom: rnd(280, 420) * p,
    filterTo: rnd(80, 130) * p,
    filterType: "lowpass",
    at: at + rnd(0.01, 0.04),
    attack: rnd(0.02, 0.05),
  });
  // haft creak / grip at the top of the swing
  if (Math.random() < 0.35) {
    noise(c, { dur: 0.05, gain: 0.05 * loud, filterFrom: rnd(500, 800), filterTo: 250, q: 2, at });
  }
}

const RECIPES: Record<SoundName, (c: AudioContext, v?: Voice, edge?: WeaponEdge) => void> = {
  swing: (c, _v, edge) => {
    // Swings fire on a fixed attack cadence, so everything here fights the
    // metronome: a wide timing jitter, three different arc characters, a big
    // dynamic range, and layers that come and go per swing.
    const p = rnd(0.7, 1.35);
    const at = rnd(0, 0.05);
    const loud = rnd(0.6, 1.15); // some swings are half-hearted
    if (edge === "sharp") {
      swingSharp(c, p, at, loud);
      return;
    }
    if (edge === "blunt") {
      swingBlunt(c, p, at, loud);
      return;
    }
    const kind = Math.random();
    if (kind < 0.4) {
      // full arc — long displaced air
      noise(c, {
        dur: rnd(0.12, 0.22),
        gain: rnd(0.12, 0.2) * loud,
        filterFrom: rnd(1200, 1700) * p,
        filterTo: rnd(220, 360) * p,
        q: rnd(0.6, 0.9),
        at,
      });
    } else if (kind < 0.75) {
      // short chop — quicker, brighter cut
      noise(c, {
        dur: rnd(0.07, 0.12),
        gain: rnd(0.13, 0.22) * loud,
        filterFrom: rnd(1900, 2600) * p,
        filterTo: rnd(400, 650) * p,
        q: rnd(0.8, 1.3),
        at,
      });
    } else {
      // heavy haul — dark, slow air with barely any top
      noise(c, {
        dur: rnd(0.14, 0.24),
        gain: rnd(0.14, 0.22) * loud,
        filterFrom: rnd(700, 1000) * p,
        filterTo: rnd(150, 240) * p,
        filterType: "lowpass",
        at,
        attack: rnd(0.02, 0.05),
      });
    }
    // low air body rides along only some of the time
    if (Math.random() < 0.6) {
      noise(c, {
        dur: rnd(0.09, 0.16),
        gain: rnd(0.05, 0.11) * loud,
        filterFrom: rnd(380, 620) * p,
        filterTo: rnd(110, 200) * p,
        filterType: "lowpass",
        at: at + rnd(0, 0.025),
      });
    }
    // occasional grip/cloth rustle at the start of the arc
    if (Math.random() < 0.25) {
      noise(c, { dur: 0.04, gain: 0.06 * loud, filterFrom: rnd(900, 1400), filterTo: 500, q: 1.5, at });
    }
  },
  hit: (c, _v, edge) => {
    if (edge === "sharp") slash(c, rnd(0.85, 1.2));
    else impact(c, { p: rnd(0.85, 1.2), flesh: true, edge });
  },
  hurt: (c, v) => {
    growl(c, { v: v ?? NEUTRAL_VOICE, dur: rnd(0.16, 0.24), gain: rnd(0.3, 0.4), fall: 0.6 });
  },
  aggro: (c, v) => {
    // "I've seen you": a sharp rising challenge in the family's throat,
    // shorter and brighter than the hurt grunt
    const voice = v ?? NEUTRAL_VOICE;
    growl(c, { v: voice, dur: rnd(0.22, 0.32), gain: rnd(0.3, 0.38), rise: 1.5, fall: 0.85 });
  },
  die: (c, v) => {
    const voice = v ?? NEUTRAL_VOICE;
    growl(c, { v: voice, dur: rnd(0.45, 0.6), gain: 0.42, fall: 0.35 });
    // body hitting the ground under the last breath
    impact(c, { size: 0.6, p: 0.8, at: 0.18 });
  },
  // treasure hitting stone: one dull low strike
  drop: (c) => metal(c, { freq: 131, dur: 0.5, gain: 0.14, partials: 5 }),
  drop_rare: (c) => {
    // a slow dark toll, left to ring into the vault
    metal(c, { freq: 98, dur: 1.6, gain: 0.2 });
    metal(c, { freq: 147, dur: 1.3, gain: 0.12, at: 0.16 });
  },
  pickup: (c) => {
    // leather and a faint clink — handling gear, not collecting a powerup
    noise(c, { dur: 0.05, gain: 0.14, filterFrom: 900, filterTo: 350, q: 1.5 });
    metal(c, { freq: 520, dur: 0.09, gain: 0.05, partials: 3, at: 0.01 });
  },
  potion: (c) => {
    // two wet gulps, then a low warm settle
    for (const at of [0, 0.11]) {
      noise(c, { dur: 0.07, gain: 0.2, filterFrom: 700, filterTo: 180, q: 5, at, sat: true });
      sub(c, { from: 260, to: 130, dur: 0.07, gain: 0.15, at });
    }
    metal(c, { freq: 98, dur: 0.5, gain: 0.07, partials: 3, at: 0.24 });
  },
  levelup: (c) => {
    // a deep toll and a dark swell — power granted, not points scored
    metal(c, { freq: 65, dur: 2.2, gain: 0.24 });
    noise(c, { dur: 1.2, gain: 0.12, filterFrom: 150, filterTo: 600, q: 1.5, attack: 0.5 });
    sub(c, { from: 65, to: 42, dur: 0.9, gain: 0.3 });
  },
  skillup: (c) => {
    // a point committed: a chisel striking a rune — one bright metallic tick
    // over a stone tap, then a short dark ring. Kin to levelup, a fraction its size.
    impact(c, { size: 0.5, p: 1.3, at: 0 });
    metal(c, { freq: 392, dur: 0.45, gain: 0.09, partials: 5, at: 0.02 });
    metal(c, { freq: 131, dur: 0.7, gain: 0.08, partials: 4, at: 0.05 });
    noise(c, { dur: 0.25, gain: 0.06, filterFrom: 300, filterTo: 900, q: 2, attack: 0.05, at: 0.05 });
  },
  explode: (c) => {
    impact(c, { size: 1.6, p: 0.7, rumble: true });
    noise(c, { dur: 0.7, gain: 0.4, filterFrom: 1100, filterTo: 50, filterType: "lowpass", sat: true });
  },
  warcry: (c) => {
    // a human roar: rising-falling growl with human formants plus chest weight
    growl(c, { v: { pitch: 1.15, rough: 40, formants: 1.15 }, dur: 0.45, gain: 0.4, base: 110, rise: 1.5, fall: 0.7 });
    sub(c, { from: 150, to: 70, dur: 0.2, gain: 0.3 });
  },
  leap: (c) => {
    noise(c, { dur: 0.3, gain: 0.18, filterFrom: 400, filterTo: 1600, q: 0.7 });
  },
  leapland: (c) => {
    impact(c, { size: 1.2, p: 0.9, rumble: true });
  },
  cleave: (c) => {
    const p = rnd(0.85, 1.15);
    // wider arc of air before a bigger hit
    noise(c, { dur: 0.1, gain: 0.18, filterFrom: 2400 * p, filterTo: 400 * p, q: 0.7 });
    impact(c, { size: 1.2, p, flesh: true, at: 0.04 });
  },
  crush: (c) => {
    impact(c, { size: 1.5, p: rnd(0.75, 0.95), rumble: true });
  },
  spit: (c, v) => {
    const p = (v ?? NEUTRAL_VOICE).pitch;
    // a wet launch, no whistle
    noise(c, { dur: 0.09, gain: 0.16, filterFrom: 1100 * p, filterTo: 300 * p, q: 4, sat: true });
    sub(c, { from: 220 * p, to: 90 * p, dur: 0.08, gain: 0.1 });
  },
  windup: (c) => {
    // gathering weight: a slow dark riser
    noise(c, { dur: 0.7, gain: 0.14, filterFrom: 120, filterTo: 700, filterType: "lowpass", attack: 0.3 });
    growl(c, { v: { pitch: 0.8, rough: 24, formants: 0.8 }, dur: 0.7, gain: 0.16, base: 60, fall: 1.6 });
  },
  coin: (c) => {
    metal(c, { freq: 740, dur: 0.22, gain: 0.06, partials: 4 });
    metal(c, { freq: 990, dur: 0.15, gain: 0.035, partials: 3, at: 0.05 });
  },
  nomana: (c) => {
    // the spell dies in the hand: a damp fizzle and a dull thud
    noise(c, { dur: 0.12, gain: 0.12, filterFrom: 1400, filterTo: 250, q: 3 });
    sub(c, { from: 120, to: 55, dur: 0.14, gain: 0.2 });
  },
  equip: (c) => {
    // leather shifts, then metal seats home on the armor stand of your body
    noise(c, { dur: 0.08, gain: 0.16, filterFrom: 1100, filterTo: 400, q: 1.2 });
    noise(c, { dur: 0.05, gain: 0.2, filterFrom: 500, filterTo: 200, q: 1, at: 0.06, sat: true });
    metal(c, { freq: 310, dur: 0.14, gain: 0.06, partials: 4, at: 0.07 });
    sub(c, { from: 170, to: 90, dur: 0.09, gain: 0.16, at: 0.06 });
  },
  unequip: (c) => {
    // the reverse: metal lifts off, cloth slides away upward
    metal(c, { freq: 260, dur: 0.1, gain: 0.045, partials: 3 });
    noise(c, { dur: 0.1, gain: 0.14, filterFrom: 500, filterTo: 900, q: 1.2, at: 0.03 });
  },
  portal: (c) => {
    // a tear in the air: dark drone swell with a metallic shimmer riding it
    noise(c, { dur: 0.6, gain: 0.14, filterFrom: 300, filterTo: 1800, q: 3, attack: 0.15 });
    growl(c, { v: { pitch: 0.9, rough: 14, formants: 0.9 }, dur: 0.6, gain: 0.18, base: 55, fall: 2.2 });
    metal(c, { freq: 440, dur: 0.7, gain: 0.05, partials: 5, at: 0.2 });
  },
};

/** Sounds that hold their own longer silence window; everything else uses 60ms.
 * Aggro barks throttle hard: one voice speaks for the whole alerted pack. */
const THROTTLE_MS: Partial<Record<SoundName, number>> = { aggro: 900 };

/** Play a named sound; same-name calls within its throttle window collapse into one.
 * Pass the monster's typeId to voice hurt/aggro/die/spit in its family's timbre,
 * and the wielded weapon's edge to shape swing/hit as a cut or a thud. */
export function play(name: SoundName, typeId?: string, edge?: WeaponEdge): void {
  const c = ensure();
  if (!c || c.state !== "running" || !sfxBus) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -1000) < (THROTTLE_MS[name] ?? 60)) return;
  lastPlayed.set(name, now);
  RECIPES[name](c, monsterVoice(typeId), edge);
}

/* --------------------------------------------------------------------------
 * Sample layer — decoded audio files played through the same bus chain as
 * the synths (sfxBus -> compressor -> master, plus the shared stone-reverb
 * send), so sampled material sits in the same room as everything above and
 * can stack with synth layers inside a recipe instead of living in its own
 * disconnected sound world.
 *
 * Usage: registerSamples({ hit_body: ["/sfx/hit1.ogg", "/sfx/hit2.ogg"] })
 * once at startup, preloadSamples() after unlock(), then playSample("hit_body")
 * from game code or from inside a RECIPES entry. A name with several URLs is
 * a variant pool; each play picks one at random.
 *
 * playSample never waits: if the buffer isn't decoded yet it starts the
 * decode and drops this play — a late impact is worse than a missing one.
 * ------------------------------------------------------------------------ */

const sampleUrls = new Map<string, string[]>();
const sampleBuffers = new Map<string, AudioBuffer>(); // keyed by URL
const samplePending = new Set<string>();

export function registerSamples(manifest: Record<string, string | string[]>): void {
  for (const [name, src] of Object.entries(manifest)) {
    sampleUrls.set(name, Array.isArray(src) ? src : [src]);
  }
}

function decodeSample(c: AudioContext, url: string): void {
  if (sampleBuffers.has(url) || samplePending.has(url)) return;
  samplePending.add(url);
  fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${url}`))))
    .then((bytes) => c.decodeAudioData(bytes))
    .then((buf) => sampleBuffers.set(url, buf))
    .catch((e) => console.warn("sample decode failed:", e))
    .finally(() => samplePending.delete(url));
}

/** Fetch and decode every registered sample. Decoding works on a suspended
 * context, so this can run at startup, before the unlock gesture. */
export function preloadSamples(): void {
  const c = ensure();
  if (!c) return;
  for (const urls of sampleUrls.values()) for (const url of urls) decodeSample(c, url);
}

export interface SampleOpts {
  gain?: number; // linear gain, default 1
  at?: number; // start delay in seconds, for layering inside recipes
  jitterCents?: number; // random detune +/- this many cents per play (default 60)
  sat?: boolean; // route through the shared saturator for grit
}

/** Play one variant of a registered sample through the SFX bus. */
export function playSample(name: string, opts: SampleOpts = {}): void {
  const c = ensure();
  if (!c || c.state !== "running" || !sfxBus || !satIn) return;
  const urls = sampleUrls.get(name) ?? [];
  const url = urls[Math.floor(Math.random() * urls.length)];
  if (!url) return;
  const buf = sampleBuffers.get(url);
  if (!buf) {
    decodeSample(c, url); // warm the cache; this play is skipped
    return;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const cents = opts.jitterCents ?? 60;
  src.detune.value = rnd(-cents, cents);
  const g = c.createGain();
  g.gain.value = opts.gain ?? 1;
  src.connect(g).connect(opts.sat ? satIn : sfxBus);
  src.start(c.currentTime + (opts.at ?? 0));
}
