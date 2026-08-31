import type { Slot } from "./bases";

export type ModStat =
  | "dmgMin"
  | "dmgMax"
  | "dmgPct"
  | "attackRating"
  | "defense"
  | "life"
  | "mana"
  | "attackSpeedPct"
  | "moveSpeedPct"
  | "magicFind";

export interface ModRange {
  stat: ModStat;
  min: number;
  max: number;
}

export interface Affix {
  id: string;
  kind: "prefix" | "suffix";
  /** Mutually exclusive family — an item never rolls two affixes of one group. */
  group: string;
  name: string;
  /** Minimum item level. */
  alvl: number;
  slots: Slot[] | "any";
  mods: ModRange[];
}

const WEAPON: Slot[] = ["weapon"];
const ARMOR: Slot[] = ["helm", "chest", "boots"];
const JEWELRY: Slot[] = ["ring", "amulet"];

const a = (x: Affix) => x;

export const AFFIXES: Record<string, Affix> = {
  // --- prefixes ---
  sharp: a({ id: "sharp", kind: "prefix", group: "dmg_pct", name: "Sharp", alvl: 1, slots: WEAPON, mods: [{ stat: "dmgPct", min: 10, max: 20 }] }),
  vicious: a({ id: "vicious", kind: "prefix", group: "dmg_pct", name: "Vicious", alvl: 8, slots: WEAPON, mods: [{ stat: "dmgPct", min: 25, max: 45 }] }),
  savage: a({ id: "savage", kind: "prefix", group: "dmg_pct", name: "Savage", alvl: 16, slots: WEAPON, mods: [{ stat: "dmgPct", min: 50, max: 80 }] }),
  heavy: a({ id: "heavy", kind: "prefix", group: "dmg_flat", name: "Heavy", alvl: 1, slots: WEAPON, mods: [{ stat: "dmgMin", min: 1, max: 2 }, { stat: "dmgMax", min: 2, max: 4 }] }),
  brutal: a({ id: "brutal", kind: "prefix", group: "dmg_flat", name: "Brutal", alvl: 12, slots: WEAPON, mods: [{ stat: "dmgMin", min: 3, max: 5 }, { stat: "dmgMax", min: 5, max: 9 }] }),
  keen: a({ id: "keen", kind: "prefix", group: "ar_pre", name: "Keen", alvl: 1, slots: [...WEAPON, ...JEWELRY], mods: [{ stat: "attackRating", min: 10, max: 30 }] }),
  sighted: a({ id: "sighted", kind: "prefix", group: "ar_pre", name: "Sighted", alvl: 10, slots: [...WEAPON, ...JEWELRY], mods: [{ stat: "attackRating", min: 40, max: 80 }] }),
  sturdy: a({ id: "sturdy", kind: "prefix", group: "def_pre", name: "Sturdy", alvl: 1, slots: ARMOR, mods: [{ stat: "defense", min: 3, max: 8 }] }),
  fortified: a({ id: "fortified", kind: "prefix", group: "def_pre", name: "Fortified", alvl: 10, slots: ARMOR, mods: [{ stat: "defense", min: 12, max: 24 }] }),
  gleaming: a({ id: "gleaming", kind: "prefix", group: "mf_pre", name: "Gleaming", alvl: 5, slots: [...ARMOR, ...JEWELRY], mods: [{ stat: "magicFind", min: 5, max: 12 }] }),
  merciless: a({ id: "merciless", kind: "prefix", group: "dmg_pct", name: "Merciless", alvl: 24, slots: WEAPON, mods: [{ stat: "dmgPct", min: 90, max: 130 }] }),
  grim: a({ id: "grim", kind: "prefix", group: "dmg_flat", name: "Grim", alvl: 22, slots: WEAPON, mods: [{ stat: "dmgMin", min: 6, max: 9 }, { stat: "dmgMax", min: 10, max: 16 }] }),
  hawkeye: a({ id: "hawkeye", kind: "prefix", group: "ar_pre", name: "Hawkeye", alvl: 20, slots: [...WEAPON, ...JEWELRY], mods: [{ stat: "attackRating", min: 100, max: 170 }] }),
  bulwark: a({ id: "bulwark", kind: "prefix", group: "def_pre", name: "Bulwark", alvl: 20, slots: ARMOR, mods: [{ stat: "defense", min: 30, max: 52 }] }),
  radiant: a({ id: "radiant", kind: "prefix", group: "mf_pre", name: "Radiant", alvl: 22, slots: [...ARMOR, ...JEWELRY], mods: [{ stat: "magicFind", min: 14, max: 24 }] }),

  // --- suffixes ---
  of_the_fox: a({ id: "of_the_fox", kind: "suffix", group: "life", name: "of the Fox", alvl: 1, slots: "any", mods: [{ stat: "life", min: 5, max: 15 }] }),
  of_the_bear: a({ id: "of_the_bear", kind: "suffix", group: "life", name: "of the Bear", alvl: 10, slots: "any", mods: [{ stat: "life", min: 20, max: 35 }] }),
  of_the_well: a({ id: "of_the_well", kind: "suffix", group: "mana", name: "of the Well", alvl: 1, slots: "any", mods: [{ stat: "mana", min: 5, max: 15 }] }),
  of_the_deep: a({ id: "of_the_deep", kind: "suffix", group: "mana", name: "of the Deep", alvl: 12, slots: "any", mods: [{ stat: "mana", min: 18, max: 30 }] }),
  of_accuracy: a({ id: "of_accuracy", kind: "suffix", group: "ar_suf", name: "of Accuracy", alvl: 1, slots: WEAPON, mods: [{ stat: "attackRating", min: 10, max: 40 }] }),
  of_ember: a({ id: "of_ember", kind: "suffix", group: "ember", name: "of Ember", alvl: 3, slots: WEAPON, mods: [{ stat: "dmgMin", min: 1, max: 3 }, { stat: "dmgMax", min: 3, max: 6 }] }),
  of_alacrity: a({ id: "of_alacrity", kind: "suffix", group: "ias", name: "of Alacrity", alvl: 8, slots: WEAPON, mods: [{ stat: "attackSpeedPct", min: 8, max: 15 }] }),
  of_the_fortress: a({ id: "of_the_fortress", kind: "suffix", group: "def_suf", name: "of the Fortress", alvl: 12, slots: ARMOR, mods: [{ stat: "defense", min: 15, max: 30 }] }),
  of_winds: a({ id: "of_winds", kind: "suffix", group: "frw", name: "of Winds", alvl: 6, slots: ["boots"], mods: [{ stat: "moveSpeedPct", min: 5, max: 10 }] }),
  of_fortune: a({ id: "of_fortune", kind: "suffix", group: "mf_suf", name: "of Fortune", alvl: 5, slots: "any", mods: [{ stat: "magicFind", min: 5, max: 15 }] }),
  of_plenty: a({ id: "of_plenty", kind: "suffix", group: "mf_suf", name: "of Plenty", alvl: 18, slots: "any", mods: [{ stat: "magicFind", min: 16, max: 30 }] }),
  of_iron: a({ id: "of_iron", kind: "suffix", group: "def_suf", name: "of Iron", alvl: 1, slots: ARMOR, mods: [{ stat: "defense", min: 4, max: 10 }] }),
  of_the_titan: a({ id: "of_the_titan", kind: "suffix", group: "life", name: "of the Titan", alvl: 21, slots: "any", mods: [{ stat: "life", min: 40, max: 70 }] }),
  of_the_maelstrom: a({ id: "of_the_maelstrom", kind: "suffix", group: "mana", name: "of the Maelstrom", alvl: 22, slots: "any", mods: [{ stat: "mana", min: 35, max: 55 }] }),
  of_the_gale: a({ id: "of_the_gale", kind: "suffix", group: "frw", name: "of the Gale", alvl: 18, slots: ["boots"], mods: [{ stat: "moveSpeedPct", min: 11, max: 15 }] }),
  of_the_citadel: a({ id: "of_the_citadel", kind: "suffix", group: "def_suf", name: "of the Citadel", alvl: 24, slots: ARMOR, mods: [{ stat: "defense", min: 35, max: 60 }] }),
  of_cinders: a({ id: "of_cinders", kind: "suffix", group: "ember", name: "of Cinders", alvl: 16, slots: WEAPON, mods: [{ stat: "dmgMin", min: 3, max: 6 }, { stat: "dmgMax", min: 7, max: 12 }] }),
};
