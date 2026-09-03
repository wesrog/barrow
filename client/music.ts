/**
 * Sparse generative music: a slow minor-mode root drone, occasional motif
 * notes wandering an aeolian scale with long gaps, and a quiet combat pulse
 * that rises while something is hunting the player and decays afterward.
 * Sits well below the SFX in the mix, routes through the shared master gain
 * (so mute covers it), and obeys the ambience/music toggle. Presentation
 * only — Math.random here never touches the sim.
 */

import { audioBus, isAmbienceMuted } from "./audio";

const MUSIC_GAIN = 0.07; // well under the SFX master level
const ROOT = 110; // A2 — the drone's home
// Aeolian degrees over the root, spread across two octaves, in Hz ratios.
const SCALE = [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5, 2, 12 / 5, 3];

let started = false;
let gate: GainNode | null = null;
let pulseGain: GainNode | null = null;
let motifTimer = 0;
let combat = false;
let lastCombatAt = 0;
let scaleIndex = 0;

function startLayers(ctx: AudioContext, master: GainNode): void {
  gate = ctx.createGain();
  gate.gain.value = isAmbienceMuted() ? 0 : 1;
  const level = ctx.createGain();
  level.gain.value = MUSIC_GAIN;
  gate.connect(level).connect(master);

  // Root drone: two slightly detuned sines an octave apart, breathing slowly.
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
    osc.connect(og).connect(gate);
    osc.start();
    trem.start();
  }

  // Combat pulse: a low square ticking at heartbeat rate, gated to silence
  // until combat raises it.
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

  scheduleMotif(ctx);
}

/** One soft motif note, then book the next after a long (shorter in combat) gap. */
function scheduleMotif(ctx: AudioContext): void {
  const gapMs = combat ? 1500 + Math.random() * 3000 : 5000 + Math.random() * 11000;
  motifTimer = window.setTimeout(() => {
    if (gate) {
      // Random walk over the scale: mostly steps, the odd leap, always home-biased.
      const step =
        Math.random() < 0.65
          ? (Math.random() < 0.5 ? -1 : 1)
          : Math.floor(Math.random() * 5) - 2;
      scaleIndex = Math.max(0, Math.min(SCALE.length - 1, scaleIndex + step));
      if (Math.random() < 0.15) scaleIndex = 0; // drift home now and then
      const freq = ROOT * SCALE[scaleIndex]!;
      const t0 = ctx.currentTime;
      const dur = 1.6 + Math.random() * 1.6;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + dur * 0.3); // slow swell
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(gate);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
    scheduleMotif(ctx);
  }, gapMs);
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

/** Test/HMR hygiene: silence pending motif notes. */
export function stopMusic(): void {
  clearTimeout(motifTimer);
  started = false;
}
