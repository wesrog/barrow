import type { BiomeId } from "../../sim/areas";
import type { DungeonStyleId } from "../../sim/dungeons";
import type { DressingFamily } from "./cryptDressing";

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
  /**
   * Multiplied into the Viking nature kit's textures when it stands in for the
   * primitives: foliage covers pines, bushes and tufts; stone the standing
   * stones. The albedo is a daylit palette, so these run well under white to
   * keep the night.
   */
  foliageTint: number;
  stoneTint: number;
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
    foliageTint: 0x9cb49a,
    stoneTint: 0x868a94,
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
    foliageTint: 0xb8906a,
    stoneTint: 0x92806c,
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
    foliageTint: 0x8ea69c,
    stoneTint: 0x7c8884,
  },
  // Burnt grey-red waste, ember light under a smoke-choked sky.
  ash: {
    bg: 0x120c0b,
    fogNear: 20,
    fogFar: 44,
    ambient: 0x9a6a52,
    ambientIntensity: 0.62,
    ground: 0x2a201c,
    rock: 0x4a3c34,
    pine: 0x2c1a12,
    trunk: 0x261a14,
    tuft: 0x4a2c1a,
    foliageTint: 0x9c7462,
    stoneTint: 0x887870,
  },
  // Cold violet-black summit ruin, starlit and silent.
  hollow: {
    bg: 0x0c0a12,
    fogNear: 18,
    fogFar: 40,
    ambient: 0x7a6e94,
    ambientIntensity: 0.58,
    ground: 0x201c2a,
    rock: 0x3c3648,
    pine: 0x181424,
    trunk: 0x221c28,
    tuft: 0x322a44,
    foliageTint: 0x8c82ac,
    stoneTint: 0x7e7692,
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
    foliageTint: 0xa89e80,
    stoneTint: 0x948a78,
  },
};

/** Everything the underground scene tints per crypt style: sky, fog, stone, props. */
export interface DungeonPalette {
  bg: number;
  fogNear: number;
  fogFar: number;
  ambient: number;
  ambientIntensity: number;
  /** Multiplied into the wall/floor piece materials; white leaves them as authored. */
  wallTint: number;
  floorTint: number;
  /** Relative weights of the loose-prop families (cryptDressing.ts) scattered along the walls. */
  dressing: Partial<Record<DressingFamily, number>>;
}

export const DUNGEON_PALETTES: Record<DungeonStyleId, DungeonPalette> = {
  // The barrow's original look: dead black, grey stone, coffins everywhere.
  barrow_halls: {
    bg: 0x0a0a0c,
    fogNear: 20,
    fogFar: 40,
    ambient: 0x6a6a80,
    ambientIntensity: 0.5,
    wallTint: 0xffffff,
    floorTint: 0xffffff,
    dressing: { coffins: 3, bones: 2, columns: 2, vases: 2, rubble: 1, remains: 2, candles: 2, chains: 1, banners: 1, cages: 1, furniture: 1, lanterns: 1 },
  },
  // Warm rot-brown warrens, close air, root-choked: no coffins down here.
  root_warren: {
    bg: 0x120e08,
    fogNear: 19,
    fogFar: 37,
    ambient: 0x9a8a62,
    ambientIntensity: 0.6,
    wallTint: 0xd8b48e,
    floorTint: 0xc9b493,
    dressing: { bones: 2, rubble: 3, vases: 1, remains: 1, candles: 1, mushrooms: 4 },
  },
  // Cold grey-green ossuary light, bone everywhere, ranks of columns.
  gallow_ossuary: {
    bg: 0x0c1010,
    fogNear: 21,
    fogFar: 42,
    ambient: 0x8ea399,
    ambientIntensity: 0.55,
    wallTint: 0xd2e0cc,
    floorTint: 0xc4d2be,
    dressing: { coffins: 1, bones: 5, columns: 3, remains: 3, chains: 2, cages: 2, candles: 1 },
  },
  // Raw slate gouges, thin ochre light, bare rock.
  cragmaw_gouge: {
    bg: 0x0e0d0b,
    fogNear: 20,
    fogFar: 40,
    ambient: 0x9a9080,
    ambientIntensity: 0.62,
    wallTint: 0xd9cbb4,
    floorTint: 0xccbfa8,
    dressing: { bones: 1, columns: 1, rubble: 3, mushrooms: 2 },
  },
  // Ember-lit scorched vaults, warm dark, cracked columns.
  ember_catacomb: {
    bg: 0x130b08,
    fogNear: 19,
    fogFar: 38,
    ambient: 0xb07850,
    ambientIntensity: 0.58,
    wallTint: 0xe0b294,
    floorTint: 0xd0a488,
    dressing: { coffins: 1, bones: 2, columns: 3, candles: 3, banners: 2, remains: 1, rubble: 1 },
  },
  // Violet-black cold halls, starlight seeping down.
  violet_undercroft: {
    bg: 0x0b0912,
    fogNear: 21,
    fogFar: 43,
    ambient: 0x9484b4,
    ambientIntensity: 0.56,
    wallTint: 0xd0c4ec,
    floorTint: 0xbfb4da,
    dressing: { coffins: 2, bones: 1, columns: 4, candles: 2, banners: 2, furniture: 2, vases: 1, lanterns: 2 },
  },
};
