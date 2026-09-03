/**
 * Looping ambient beds, one per biome plus the crypt — all synthesized:
 * looped filtered noise for air/wind/rumble, slow LFO-modulated drones for
 * ground tone, and (where a bed calls for it) a sparse drip/croak scheduler.
 * Everything routes through audio.ts's master gain, so the one mute switch
 * covers ambience too. Presentation-only: Math.random never touches the sim.
 */

import type { BiomeId } from "../sim/areas";
import type { DungeonStyleId } from "../sim/dungeons";
import { audioBus, isAmbienceMuted } from "./audio";

export type AmbienceBed = BiomeId | DungeonStyleId;

const CROSSFADE_S = 2;
const BED_GAIN = 0.11; // well under the SFX master level

interface BedSpec {
  /** Noise layer: filter shape, base frequency, LFO depth/rate on the filter. */
  noise: {
    type: BiquadFilterType;
    freq: number;
    q?: number;
    gain: number;
    lfoRate: number;
    lfoDepth: number;
  };
  /** Drone oscillators: frequency and level, with a slow shared tremolo. */
  drones: { freq: number; type: OscillatorType; gain: number }[];
  /** Sparse one-shot blips (drips, croaks, crackle pops), if any. */
  blips?: { minGapMs: number; maxGapMs: number; from: number; to: number; dur: number; gain: number };
}

const BEDS: Record<AmbienceBed, BedSpec> = {
  // Moor wind: broad low rush, slowly breathing.
  moor: {
    noise: { type: "lowpass", freq: 420, gain: 0.5, lfoRate: 0.07, lfoDepth: 180 },
    drones: [{ freq: 55, type: "sine", gain: 0.16 }],
  },
  // Fen: closer, wetter air with sparse croaks and drips.
  fen: {
    noise: { type: "bandpass", freq: 320, q: 0.8, gain: 0.42, lfoRate: 0.11, lfoDepth: 90 },
    drones: [{ freq: 62, type: "sine", gain: 0.14 }],
    blips: { minGapMs: 2500, maxGapMs: 9000, from: 180, to: 90, dur: 0.16, gain: 0.1 },
  },
  // Mire: drowned murk, darker and stiller than the fen.
  mire: {
    noise: { type: "lowpass", freq: 260, gain: 0.5, lfoRate: 0.05, lfoDepth: 80 },
    drones: [
      { freq: 49, type: "sine", gain: 0.16 },
      { freq: 98, type: "sine", gain: 0.05 },
    ],
    blips: { minGapMs: 4000, maxGapMs: 14000, from: 500, to: 240, dur: 0.1, gain: 0.06 },
  },
  // Crag: deep dry rumble off the stone.
  crag: {
    noise: { type: "lowpass", freq: 140, gain: 0.62, lfoRate: 0.04, lfoDepth: 50 },
    drones: [{ freq: 41, type: "sine", gain: 0.2 }],
  },
  // Ashfell: ember crackle riding a warm low smolder.
  ash: {
    noise: { type: "lowpass", freq: 300, gain: 0.42, lfoRate: 0.09, lfoDepth: 120 },
    drones: [{ freq: 58, type: "sine", gain: 0.14 }],
    blips: { minGapMs: 350, maxGapMs: 1800, from: 3200, to: 1400, dur: 0.03, gain: 0.05 },
  },
  // Hollowcrown: a thin high whistle over cold emptiness.
  hollow: {
    noise: { type: "bandpass", freq: 1250, q: 6, gain: 0.16, lfoRate: 0.13, lfoDepth: 260 },
    drones: [
      { freq: 55, type: "sine", gain: 0.12 },
      { freq: 82.5, type: "sine", gain: 0.05 },
    ],
  },
  // The barrow's halls: dead air and patient drips.
  barrow_halls: {
    noise: { type: "lowpass", freq: 180, gain: 0.5, lfoRate: 0.03, lfoDepth: 40 },
    drones: [{ freq: 46, type: "sine", gain: 0.16 }],
    blips: { minGapMs: 3000, maxGapMs: 11000, from: 1100, to: 700, dur: 0.09, gain: 0.09 },
  },
  // The root warren: close wet earth, faster drips through the peat.
  root_warren: {
    noise: { type: "bandpass", freq: 240, q: 1.2, gain: 0.46, lfoRate: 0.08, lfoDepth: 70 },
    drones: [{ freq: 52, type: "sine", gain: 0.15 }],
    blips: { minGapMs: 1400, maxGapMs: 5000, from: 900, to: 500, dur: 0.11, gain: 0.1 },
  },
  // The ossuary: bone-dry stillness, rare hollow knocks.
  gallow_ossuary: {
    noise: { type: "lowpass", freq: 150, gain: 0.44, lfoRate: 0.03, lfoDepth: 30 },
    drones: [
      { freq: 44, type: "sine", gain: 0.15 },
      { freq: 88, type: "sine", gain: 0.04 },
    ],
    blips: { minGapMs: 6000, maxGapMs: 18000, from: 600, to: 350, dur: 0.07, gain: 0.08 },
  },
  // The gouge: dry stone rumble, thin air whistling through cracks.
  cragmaw_gouge: {
    noise: { type: "lowpass", freq: 120, gain: 0.58, lfoRate: 0.04, lfoDepth: 45 },
    drones: [{ freq: 39, type: "sine", gain: 0.18 }],
  },
  // The catacomb: warm smolder below, ember pops echoing off the vaults.
  ember_catacomb: {
    noise: { type: "lowpass", freq: 260, gain: 0.44, lfoRate: 0.07, lfoDepth: 100 },
    drones: [{ freq: 50, type: "sine", gain: 0.16 }],
    blips: { minGapMs: 500, maxGapMs: 2400, from: 2800, to: 1200, dur: 0.04, gain: 0.05 },
  },
  // The undercroft: cold shimmer seeping down from the crown.
  violet_undercroft: {
    noise: { type: "bandpass", freq: 1050, q: 5, gain: 0.15, lfoRate: 0.1, lfoDepth: 220 },
    drones: [
      { freq: 47, type: "sine", gain: 0.13 },
      { freq: 70.5, type: "sine", gain: 0.05 },
    ],
    blips: { minGapMs: 5000, maxGapMs: 15000, from: 1400, to: 900, dur: 0.09, gain: 0.07 },
  },
};

interface ActiveBed {
  key: AmbienceBed;
  gain: GainNode;
  stops: (() => void)[];
}

let active: ActiveBed | null = null;
let ambienceGate: GainNode | null = null; // the ambience/music toggle's switch

function loopedNoiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  // Soften the seam so the loop doesn't click.
  const fade = Math.min(2000, data.length >> 2);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    data[i]! *= k;
    data[data.length - 1 - i]! *= k;
  }
  return buf;
}

function buildBed(c: AudioContext, out: GainNode, key: AmbienceBed): ActiveBed {
  const spec = BEDS[key];
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(out);
  const stops: (() => void)[] = [];

  // Noise layer with a slow LFO wandering the filter cutoff.
  const src = c.createBufferSource();
  src.buffer = loopedNoiseBuffer(c, 3);
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = spec.noise.type;
  filter.frequency.value = spec.noise.freq;
  filter.Q.value = spec.noise.q ?? 1;
  const nGain = c.createGain();
  nGain.gain.value = spec.noise.gain;
  const lfo = c.createOscillator();
  lfo.frequency.value = spec.noise.lfoRate;
  const lfoGain = c.createGain();
  lfoGain.gain.value = spec.noise.lfoDepth;
  lfo.connect(lfoGain).connect(filter.frequency);
  src.connect(filter).connect(nGain).connect(gain);
  src.start();
  lfo.start();
  stops.push(() => {
    src.stop();
    lfo.stop();
  });

  // Drones under a shared slow tremolo, so the ground tone breathes.
  const trem = c.createOscillator();
  trem.frequency.value = 0.06;
  const tremGain = c.createGain();
  tremGain.gain.value = 0.25;
  trem.start();
  stops.push(() => trem.stop());
  for (const d of spec.drones) {
    const osc = c.createOscillator();
    osc.type = d.type;
    osc.frequency.value = d.freq;
    const g = c.createGain();
    g.gain.value = d.gain;
    trem.connect(tremGain).connect(g.gain);
    osc.connect(g).connect(gain);
    osc.start();
    stops.push(() => osc.stop());
  }

  // Sparse blips: drips, croaks, or ember pops on a random timer.
  if (spec.blips) {
    const b = spec.blips;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        const t0 = c.currentTime;
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(b.from * (0.85 + Math.random() * 0.3), t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, b.to), t0 + b.dur);
        const g = c.createGain();
        g.gain.setValueAtTime(b.gain, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + b.dur);
        osc.connect(g).connect(gain);
        osc.start(t0);
        osc.stop(t0 + b.dur + 0.02);
        schedule();
      }, b.minGapMs + Math.random() * (b.maxGapMs - b.minGapMs));
    };
    schedule();
    stops.push(() => clearTimeout(timer));
  }

  return { key, gain, stops };
}

/**
 * Keep the ambience matched to where the player stands. Call every frame —
 * cheap when nothing changed; on a bed change the old layer fades out over
 * ~2s while the new one fades in. Starts lazily once the AudioContext is
 * unlocked (the same user-gesture unlock as the SFX engine).
 */
export function setAmbience(key: AmbienceBed): void {
  const bus = audioBus();
  if (!bus || bus.ctx.state !== "running") return;
  const { ctx, master } = bus;
  if (!ambienceGate) {
    ambienceGate = ctx.createGain();
    ambienceGate.connect(master);
  }
  // Called every frame, so the toggle takes effect immediately.
  ambienceGate.gain.value = isAmbienceMuted() ? 0 : 1;
  if (active?.key === key) return;
  const t = ctx.currentTime;
  if (active) {
    const old = active;
    old.gain.gain.cancelScheduledValues(t);
    old.gain.gain.setValueAtTime(old.gain.gain.value, t);
    old.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_S);
    setTimeout(() => {
      for (const stop of old.stops) stop();
      old.gain.disconnect();
    }, CROSSFADE_S * 1000 + 100);
  }
  active = buildBed(ctx, ambienceGate, key);
  active.gain.gain.setValueAtTime(0, t);
  active.gain.gain.linearRampToValueAtTime(BED_GAIN, t + CROSSFADE_S);
}

