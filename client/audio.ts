/**
 * Procedural sound: every effect is synthesized on the fly with Web Audio.
 * No samples, no assets. Call unlock() from a user gesture once.
 */

type SoundName =
  | "swing"
  | "hit"
  | "hurt"
  | "die"
  | "drop"
  | "drop_rare"
  | "pickup"
  | "potion"
  | "levelup"
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
  | "nomana";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const lastPlayed = new Map<SoundName, number>();

const MASTER_GAIN = 0.4;
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

function ensure(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
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

/** A monster family's vocal timbre: pitch multiplier and oscillator shape. */
export interface Voice {
  pitch: number;
  wave: OscillatorType;
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
  skitter: { pitch: 2.2, wave: "square" }, // high chitter
  bloat: { pitch: 0.7, wave: "sine" }, // wet gurgle
  shambler: { pitch: 1.0, wave: "sine" },
  wight: { pitch: 0.55, wave: "sine" }, // low moan
  howler: { pitch: 1.5, wave: "sawtooth" }, // yelp
  screamer: { pitch: 2.0, wave: "sawtooth" }, // shriek
  caster: { pitch: 1.2, wave: "triangle" },
};

/** The vocal timbre for a monster type, or undefined for the neutral voice. */
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

interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  gain?: number;
  at?: number;
}

function tone(c: AudioContext, { type = "sine", from, to, dur, gain = 0.5, at = 0 }: ToneOpts): void {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  filterFrom?: number;
  filterTo?: number;
  filterType?: BiquadFilterType;
  at?: number;
}

function noise(
  c: AudioContext,
  { dur, gain = 0.4, filterFrom = 2000, filterTo, filterType = "bandpass", at = 0 }: NoiseOpts,
): void {
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur + 0.05);
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFrom, t0);
  if (filterTo !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(1, filterTo), t0 + dur);
  filter.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(master!);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const RECIPES: Record<SoundName, (c: AudioContext, v?: Voice) => void> = {
  swing: (c) => {
    const p = rnd(0.8, 1.25);
    noise(c, { dur: rnd(0.07, 0.12), gain: rnd(0.12, 0.2), filterFrom: 2600 * p, filterTo: 600 * p });
  },
  hit: (c) => {
    const p = rnd(0.85, 1.2);
    // sharp attack transient so the impact has snap instead of just thud
    noise(c, { dur: 0.02, gain: rnd(0.18, 0.3), filterFrom: 5200 * p, filterType: "highpass" });
    noise(c, { dur: rnd(0.05, 0.09), gain: rnd(0.25, 0.36), filterFrom: 1800 * p, filterTo: 480 * p });
    tone(c, { type: "sine", from: 160 * p, to: 70 * p, dur: rnd(0.07, 0.11), gain: rnd(0.32, 0.46) });
    tone(c, { type: "square", from: 340 * p, to: 140 * p, dur: 0.035, gain: 0.07 });
  },
  hurt: (c, v) => {
    const p = rnd(0.88, 1.15) * (v?.pitch ?? 1);
    tone(c, { type: v?.wave ?? "sine", from: 110 * p, to: 50 * p, dur: rnd(0.13, 0.19), gain: rnd(0.4, 0.55) });
    noise(c, { dur: 0.1, gain: rnd(0.15, 0.25), filterFrom: 900 * p, filterTo: 300 * p });
  },
  die: (c, v) => {
    const p = rnd(0.9, 1.12) * (v?.pitch ?? 1);
    tone(c, { type: v?.wave ?? "sine", from: 130 * p, to: 35 * p, dur: 0.3, gain: 0.45 });
    // Voiced throats get a second cry a fifth up — the family's last word.
    if (v) tone(c, { type: v.wave, from: 195 * p, to: 50 * p, dur: 0.22, gain: 0.14, at: 0.04 });
    noise(c, { dur: 0.22, gain: 0.25, filterFrom: 1200 * p, filterTo: 200 * p });
  },
  drop: (c) => tone(c, { type: "triangle", from: 660, to: 440, dur: 0.1, gain: 0.18 }),
  drop_rare: (c) => {
    tone(c, { type: "triangle", from: 523, dur: 0.12, gain: 0.2 });
    tone(c, { type: "triangle", from: 659, dur: 0.12, gain: 0.2, at: 0.09 });
    tone(c, { type: "triangle", from: 880, dur: 0.2, gain: 0.22, at: 0.18 });
  },
  pickup: (c) => tone(c, { type: "triangle", from: 440, to: 560, dur: 0.08, gain: 0.16 }),
  potion: (c) => {
    tone(c, { type: "sine", from: 420, to: 260, dur: 0.09, gain: 0.25 });
    tone(c, { type: "sine", from: 380, to: 220, dur: 0.1, gain: 0.25, at: 0.1 });
    tone(c, { type: "sine", from: 500, to: 640, dur: 0.14, gain: 0.14, at: 0.22 });
  },
  levelup: (c) => {
    [392, 523, 659, 784].forEach((f, i) =>
      tone(c, { type: "triangle", from: f, dur: 0.26, gain: 0.2, at: i * 0.09 }),
    );
  },
  explode: (c) => {
    tone(c, { type: "sine", from: 90, to: 28, dur: 0.5, gain: 0.7 });
    noise(c, { dur: 0.45, gain: 0.4, filterFrom: 1400, filterTo: 80, filterType: "lowpass" });
  },
  warcry: (c) => {
    // breath transient — the "H" of the shout
    noise(c, { dur: 0.07, gain: 0.16, filterFrom: 1400, filterTo: 2800 });
    // rising call an octave up from the old version, with a fifth stacked on top
    tone(c, { type: "square", from: 165, to: 290, dur: 0.3, gain: 0.2 });
    tone(c, { type: "square", from: 248, to: 435, dur: 0.3, gain: 0.1, at: 0.02 });
    // low sine thump for chest weight (a saw down here reads as flatulence)
    tone(c, { type: "sine", from: 170, to: 85, dur: 0.16, gain: 0.32 });
  },
  leap: (c) => {
    noise(c, { dur: 0.3, gain: 0.2, filterFrom: 500, filterTo: 2400 });
  },
  leapland: (c) => {
    tone(c, { type: "sine", from: 140, to: 60, dur: 0.14, gain: 0.4 });
    noise(c, { dur: 0.12, gain: 0.22, filterFrom: 900, filterTo: 150 });
  },
  cleave: (c) => {
    const p = rnd(0.85, 1.18);
    noise(c, { dur: 0.02, gain: rnd(0.15, 0.25), filterFrom: 6000 * p, filterType: "highpass" });
    noise(c, { dur: rnd(0.11, 0.17), gain: rnd(0.24, 0.32), filterFrom: 3200 * p, filterTo: 500 * p });
    tone(c, { type: "sine", from: 180 * p, to: 80 * p, dur: 0.1, gain: rnd(0.25, 0.35), at: 0.03 });
  },
  crush: (c) => {
    const p = rnd(0.88, 1.15);
    tone(c, { type: "sine", from: 120 * p, to: 40 * p, dur: rnd(0.18, 0.26), gain: rnd(0.5, 0.68) });
    noise(c, { dur: 0.12, gain: rnd(0.24, 0.36), filterFrom: 1000 * p, filterTo: 200 * p });
  },
  spit: (c, v) => {
    const p = v?.pitch ?? 1;
    tone(c, { type: v?.wave ?? "sine", from: 700 * p, to: 240 * p, dur: 0.12, gain: 0.14 });
  },
  windup: (c) => {
    tone(c, { type: "sawtooth", from: 55, to: 110, dur: 0.7, gain: 0.3 });
    noise(c, { dur: 0.7, gain: 0.1, filterFrom: 300, filterTo: 900 });
  },
  coin: (c) => {
    tone(c, { type: "triangle", from: 988, dur: 0.06, gain: 0.14 });
    tone(c, { type: "triangle", from: 1319, dur: 0.14, gain: 0.14, at: 0.05 });
  },
  nomana: (c) => {
    // A dry, deflating fizzle — the spell sputters out instead of firing.
    tone(c, { type: "square", from: 220, to: 110, dur: 0.09, gain: 0.12 });
    tone(c, { type: "sine", from: 180, to: 70, dur: 0.16, gain: 0.22, at: 0.03 });
    noise(c, { dur: 0.08, gain: 0.06, filterFrom: 1200, filterTo: 300 });
  },
  portal: (c) => {
    tone(c, { type: "sine", from: 220, to: 880, dur: 0.5, gain: 0.25 });
    tone(c, { type: "sine", from: 227, to: 900, dur: 0.5, gain: 0.15 });
    noise(c, { dur: 0.5, gain: 0.12, filterFrom: 600, filterTo: 2400 });
  },
};

/** Play a named sound; same-name calls within 60ms collapse into one.
 * Pass the monster's typeId to voice hurt/die/spit in its family's timbre. */
export function play(name: SoundName, typeId?: string): void {
  const c = ensure();
  if (!c || c.state !== "running" || !master) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -1000) < 60) return;
  lastPlayed.set(name, now);
  RECIPES[name](c, monsterVoice(typeId));
}
