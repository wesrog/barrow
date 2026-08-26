import type { ModRange } from "./affixes";

export interface UniqueItem {
  id: string;
  name: string;
  baseId: string;
  /** Minimum item level for this unique to drop. */
  lvl: number;
  mods: ModRange[];
}

const u = (x: UniqueItem) => x;

export const UNIQUES: Record<string, UniqueItem> = {
  gravelight: u({
    id: "gravelight",
    name: "Gravelight",
    baseId: "grave_scythe",
    lvl: 16,
    mods: [
      { stat: "dmgPct", min: 80, max: 110 },
      { stat: "magicFind", min: 20, max: 20 },
      { stat: "life", min: 25, max: 40 },
    ],
  }),
  oathkeeper: u({
    id: "oathkeeper",
    name: "Oathkeeper",
    baseId: "hatchet",
    lvl: 3,
    mods: [
      { stat: "dmgPct", min: 40, max: 60 },
      { stat: "attackRating", min: 40, max: 60 },
      { stat: "attackSpeedPct", min: 10, max: 10 },
    ],
  }),
  thorn_husk: u({
    id: "thorn_husk",
    name: "Thorn Husk",
    baseId: "studded_jerkin",
    lvl: 6,
    mods: [
      { stat: "defense", min: 25, max: 40 },
      { stat: "life", min: 15, max: 25 },
    ],
  }),
  seven_sorrows: u({
    id: "seven_sorrows",
    name: "Seven Sorrows",
    baseId: "bone_ring",
    lvl: 4,
    mods: [
      { stat: "life", min: 10, max: 20 },
      { stat: "mana", min: 10, max: 20 },
      { stat: "magicFind", min: 15, max: 25 },
    ],
  }),
  hushfoot: u({
    id: "hushfoot",
    name: "Hushfoot",
    baseId: "chain_greaves",
    lvl: 9,
    mods: [
      { stat: "moveSpeedPct", min: 10, max: 15 },
      { stat: "defense", min: 10, max: 20 },
    ],
  }),
};
