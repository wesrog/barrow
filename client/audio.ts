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
  | "cleave"
  | "crush"
  | "spit"
  | "windup";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const lastPlayed = new Map<SoundName, number>();

function ensure(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function unlock(): void {
  const c = ensure();
  if (c && c.state === "suspended") void c.resume();
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

const RECIPES: Record<SoundName, (c: AudioContext) => void> = {
  swing: (c) => noise(c, { dur: 0.09, gain: 0.16, filterFrom: 2600, filterTo: 600 }),
  hit: (c) => {
    noise(c, { dur: 0.07, gain: 0.3, filterFrom: 1800, filterTo: 500 });
    tone(c, { type: "sine", from: 160, to: 70, dur: 0.09, gain: 0.4 });
  },
  hurt: (c) => {
    tone(c, { type: "sine", from: 110, to: 50, dur: 0.16, gain: 0.5 });
    noise(c, { dur: 0.1, gain: 0.2, filterFrom: 900, filterTo: 300 });
  },
  die: (c) => {
    tone(c, { type: "sine", from: 130, to: 35, dur: 0.3, gain: 0.45 });
    noise(c, { dur: 0.22, gain: 0.25, filterFrom: 1200, filterTo: 200 });
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
    tone(c, { type: "sawtooth", from: 90, to: 180, dur: 0.35, gain: 0.3 });
    tone(c, { type: "sawtooth", from: 92, to: 178, dur: 0.35, gain: 0.2 });
  },
  leap: (c) => {
    noise(c, { dur: 0.16, gain: 0.2, filterFrom: 500, filterTo: 2400 });
    tone(c, { type: "sine", from: 140, to: 60, dur: 0.14, gain: 0.4, at: 0.16 });
  },
  cleave: (c) => {
    noise(c, { dur: 0.14, gain: 0.28, filterFrom: 3200, filterTo: 500 });
    tone(c, { type: "sine", from: 180, to: 80, dur: 0.1, gain: 0.3, at: 0.03 });
  },
  crush: (c) => {
    tone(c, { type: "sine", from: 120, to: 40, dur: 0.22, gain: 0.6 });
    noise(c, { dur: 0.12, gain: 0.3, filterFrom: 1000, filterTo: 200 });
  },
  spit: (c) => tone(c, { type: "sine", from: 700, to: 240, dur: 0.12, gain: 0.14 }),
  windup: (c) => {
    tone(c, { type: "sawtooth", from: 55, to: 110, dur: 0.7, gain: 0.3 });
    noise(c, { dur: 0.7, gain: 0.1, filterFrom: 300, filterTo: 900 });
  },
};

/** Play a named sound; same-name calls within 60ms collapse into one. */
export function play(name: SoundName): void {
  const c = ensure();
  if (!c || c.state !== "running" || !master) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -1000) < 60) return;
  lastPlayed.set(name, now);
  RECIPES[name](c);
}
