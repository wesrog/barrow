import type { BiomeId } from "../../sim/areas";

/** Everything the outdoor scene tints per region: sky, fog, ground, flora. */
export interface BiomePalette {
  bg: number;
  fogNear: number;
  fogFar: number;
  ambient: number;
  ambientIntensity: number;
  ground: number;
  rock: number;
  pine: number;
  trunk: number;
  tuft: number;
}

export const BIOME_PALETTES: Record<BiomeId, BiomePalette> = {
  // The moors' original night-heath look, lifted verbatim from the scene.
  moor: {
    bg: 0x0c1310,
    fogNear: 24,
    fogFar: 52,
    ambient: 0x70806e,
    ambientIntensity: 0.65,
    ground: 0x1f2a1b,
    rock: 0x3c4046,
    pine: 0x17231a,
    trunk: 0x2c2018,
    tuft: 0x2a381f,
  },
  // Rust-red marshland under a closer, warmer murk.
  fen: {
    bg: 0x140d0a,
    fogNear: 20,
    fogFar: 46,
    ambient: 0x8a7258,
    ambientIntensity: 0.6,
    ground: 0x2b2014,
    rock: 0x4a3e34,
    pine: 0x321c11,
    trunk: 0x241a10,
    tuft: 0x44301a,
  },
  // Grey-green strangled channels, cold and drowned.
  mire: {
    bg: 0x0d1112,
    fogNear: 18,
    fogFar: 42,
    ambient: 0x6e7f78,
    ambientIntensity: 0.6,
    ground: 0x212a26,
    rock: 0x39423e,
    pine: 0x16201c,
    trunk: 0x22201c,
    tuft: 0x2c3a2c,
  },
  // Slate and ochre steps, thin dry air.
  crag: {
    bg: 0x100f0d,
    fogNear: 26,
    fogFar: 56,
    ambient: 0x83796a,
    ambientIntensity: 0.7,
    ground: 0x2a2622,
    rock: 0x4e463a,
    pine: 0x201c14,
    trunk: 0x282018,
    tuft: 0x3a3120,
  },
};
