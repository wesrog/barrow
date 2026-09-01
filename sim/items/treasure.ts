import type { Rng } from "../rng";
import { BASES } from "./bases";
import { rollItem, type Item, type Rarity } from "./generate";

export interface TreasureClass {
  id: string;
  /** Weight of dropping nothing, against the sum of entry weights. */
  nodrop: number;
  entries: { baseIds: string[]; weight: number }[];
  /** Multiplies the magic/rare/unique weights of the rarity roll. */
  rarityBonus: number;
}

const LOW_WEAPONS = ["rusted_blade", "hatchet"];
const MID_WEAPONS = ["war_maul", "twin_fang", "grave_scythe"];
const HIGH_WEAPONS = ["dire_flail", "moon_glaive", "kingsbane"];
const LOW_ARMOR = ["cracked_helm", "rag_tunic", "worn_boots"];
const MID_ARMOR = ["bone_visage", "studded_jerkin", "grave_plate", "chain_greaves"];
const HIGH_ARMOR = ["iron_barbute", "wyrm_skull", "lamellar_coat", "bogsteel_plate", "marsh_striders", "cragwalkers"];
const JEWELRY = ["bone_ring", "grave_amulet"];
const HIGH_JEWELRY = ["wight_band", "howler_charm"];

export const TREASURE_CLASSES: Record<string, TreasureClass> = {
  trash: {
    id: "trash",
    nodrop: 70,
    entries: [
      { baseIds: LOW_WEAPONS, weight: 12 },
      { baseIds: LOW_ARMOR, weight: 14 },
      { baseIds: JEWELRY, weight: 4 },
      { baseIds: [...HIGH_WEAPONS, ...HIGH_ARMOR], weight: 4 },
      { baseIds: ["minor_potion"], weight: 14 },
      { baseIds: ["minor_mana_potion"], weight: 7 },
    ],
    rarityBonus: 1,
  },
  standard: {
    id: "standard",
    nodrop: 45,
    entries: [
      { baseIds: LOW_WEAPONS, weight: 10 },
      { baseIds: MID_WEAPONS, weight: 8 },
      { baseIds: HIGH_WEAPONS, weight: 6 },
      { baseIds: LOW_ARMOR, weight: 10 },
      { baseIds: MID_ARMOR, weight: 8 },
      { baseIds: HIGH_ARMOR, weight: 6 },
      { baseIds: JEWELRY, weight: 5 },
      { baseIds: HIGH_JEWELRY, weight: 2 },
      { baseIds: ["minor_potion"], weight: 12 },
      { baseIds: ["minor_mana_potion"], weight: 6 },
    ],
    rarityBonus: 1.5,
  },
  boss: {
    id: "boss",
    nodrop: 10,
    entries: [
      { baseIds: MID_WEAPONS, weight: 12 },
      { baseIds: MID_ARMOR, weight: 12 },
      { baseIds: HIGH_WEAPONS, weight: 10 },
      { baseIds: HIGH_ARMOR, weight: 10 },
      { baseIds: LOW_WEAPONS, weight: 6 },
      { baseIds: LOW_ARMOR, weight: 6 },
      { baseIds: JEWELRY, weight: 8 },
      { baseIds: HIGH_JEWELRY, weight: 4 },
    ],
    rarityBonus: 4,
  },
};

const RARITY_WEIGHTS: { rarity: Rarity; weight: number; boostable: boolean }[] = [
  { rarity: "normal", weight: 55, boostable: false },
  { rarity: "magic", weight: 35, boostable: true },
  { rarity: "rare", weight: 9, boostable: true },
  { rarity: "unique", weight: 1, boostable: true },
];

function rollRarity(rng: Rng, bonus: number): Rarity {
  const weights = RARITY_WEIGHTS.map((r) => ({
    rarity: r.rarity,
    weight: r.boostable ? r.weight * bonus : r.weight,
  }));
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let roll = rng.next() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll < 0) return w.rarity;
  }
  return "normal";
}

export interface DropOpts {
  /** Skip the NoDrop roll — something always falls. */
  guaranteed?: boolean;
  /** Floor for the rarity roll (boss packs drop magic or better). */
  minRarity?: Rarity;
}

const RARITY_ORDER: Rarity[] = ["normal", "magic", "rare", "unique"];

/** Roll a monster's drop: an item, or null (NoDrop). mlvl caps base levelReq and affix alvl. */
export function rollDrop(rng: Rng, tcId: string, mlvl: number, opts: DropOpts = {}): Item | null {
  const tc = TREASURE_CLASSES[tcId];
  if (!tc) throw new Error(`unknown treasure class: ${tcId}`);

  // Filter each entry to bases the monster level can drop.
  const entries = tc.entries
    .map((e) => ({
      weight: e.weight,
      baseIds: e.baseIds.filter((id) => BASES[id]!.levelReq <= mlvl),
    }))
    .filter((e) => e.baseIds.length > 0);

  const totalEntryWeight = tc.entries.reduce((s, e) => s + e.weight, 0);
  if (entries.length === 0) return null;
  if (!opts.guaranteed) {
    const roll = rng.next() * (totalEntryWeight + tc.nodrop);
    if (roll < tc.nodrop) return null;
  }

  let pick = rng.next() * entries.reduce((s, e) => s + e.weight, 0);
  let chosen = entries[entries.length - 1]!;
  for (const e of entries) {
    pick -= e.weight;
    if (pick < 0) {
      chosen = e;
      break;
    }
  }
  const baseId = chosen.baseIds[rng.int(0, chosen.baseIds.length - 1)]!;
  let rarity = rollRarity(rng, tc.rarityBonus);
  if (opts.minRarity && RARITY_ORDER.indexOf(rarity) < RARITY_ORDER.indexOf(opts.minRarity)) {
    rarity = opts.minRarity;
  }
  return rollItem(rng, baseId, mlvl, rarity);
}
