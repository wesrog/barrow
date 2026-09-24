/**
 * The sampled sound effects: Kenney's CC0 Impact Sounds, RPG Audio and
 * Interface Sounds packs, the clips the game uses copied under
 * public/sfx/kenney (with the licence). Each name is a variant pool; audio.ts
 * layers these over its synth recipes, so a hit is a recorded blade over the
 * synth's low thump rather than either alone. Rows, not code: a better clip
 * is a new file name here.
 */

const DIR = "/sfx/kenney";
const one = (...stems: string[]) => stems.map((s) => `${DIR}/${s}.ogg`);
/** Kenney's numbered variants: stem_000 .. stem_004. */
const five = (stem: string) => Array.from({ length: 5 }, (_, i) => `${DIR}/${stem}_00${i}.ogg`);

export const SAMPLES: Record<string, string[]> = {
  // combat
  swing_sharp: one("drawKnife1", "drawKnife2", "drawKnife3"),
  swing_blunt: one("cloth1", "cloth2", "cloth3", "cloth4"),
  // enemy hits: the plate strikes, heavy and light shuffled together, with a blade's slice on top for sharp edges
  hit_plate: [...five("impactPlate_heavy"), ...five("impactPlate_light")],
  hit_sharp: one("knifeSlice", "knifeSlice2", "chop"),
  hit_blunt: five("impactPunch_heavy"),
  body_soft: five("impactSoft_medium"),
  body_heavy: five("impactSoft_heavy"),
  hurt: five("impactPunch_medium"),
  crush: five("impactPlate_heavy"),
  smash: [...five("impactWood_heavy"), ...five("impactPlank_medium")],
  cloth: one("cloth1", "cloth2", "cloth3", "cloth4"),
  // loot and gear
  drop: [...five("impactWood_light"), `${DIR}/dropLeather.ogg`],
  drop_rare: five("impactBell_heavy"),
  pickup: one("handleSmallLeather", "handleSmallLeather2", "clothBelt", "clothBelt2"),
  coin: one("handleCoins", "handleCoins2"),
  equip: one("beltHandle1", "beltHandle2", "metalClick", "metalLatch"),
  unequip: one("cloth1", "cloth2", "clothBelt2", "dropLeather"),
  potion: five("impactGlass_light"),
  // progress and feedback
  levelup: one("confirmation_001", "confirmation_002", "confirmation_003", "confirmation_004"),
  skillup: one("bong_001"),
  nomana: one("error_004", "error_005", "error_006"),
  // the hero's feet: the carpet set reads as soft turf and worn flagstones alike
  step: five("footstep_carpet"),
};
