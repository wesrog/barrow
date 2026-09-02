// Champion monsters: a rare spawn-time promotion that turns one monster into a
// named, modified elite with a guaranteed drop. Content growth is new rows in
// CHAMPIONS, not new code — the D2 "boss pack modifier" shape with our numbers.

import type { Monster } from "./monsters";
import { MONSTER_TYPES } from "./monsters";
import type { Rng } from "./rng";

export type ChampionId = "swift" | "brutal" | "bulwark" | "volatile" | "dread";

export interface ChampionDef {
  id: ChampionId;
  /** Display prefix: "Swift" + "Fen Howler". */
  prefix: string;
  lifeMult: number;
  dmgMult: number;
  speedMult: number;
  arMult: number;
  defMult: number;
  xpMult: number;
  /** Detonates on death (stamped even onto kinds that never explode). */
  volatile?: boolean;
  /** Spawn weight against the other champion kinds. */
  weight: number;
}

export const CHAMPIONS: Record<ChampionId, ChampionDef> = {
  swift: {
    id: "swift", prefix: "Swift",
    lifeMult: 1.5, dmgMult: 1.1, speedMult: 1.6, arMult: 1.1, defMult: 1, xpMult: 2.5,
    weight: 3,
  },
  brutal: {
    id: "brutal", prefix: "Brutal",
    lifeMult: 1.8, dmgMult: 1.7, speedMult: 1, arMult: 1.2, defMult: 1, xpMult: 3,
    weight: 3,
  },
  bulwark: {
    id: "bulwark", prefix: "Bulwark",
    lifeMult: 2.8, dmgMult: 1.1, speedMult: 0.9, arMult: 1, defMult: 1.8, xpMult: 3,
    weight: 3,
  },
  volatile: {
    id: "volatile", prefix: "Volatile",
    lifeMult: 1.6, dmgMult: 1.2, speedMult: 1.15, arMult: 1, defMult: 1, xpMult: 2.5,
    volatile: true,
    weight: 2,
  },
  dread: {
    id: "dread", prefix: "Dread",
    lifeMult: 2.2, dmgMult: 1.5, speedMult: 1.25, arMult: 1.3, defMult: 1.4, xpMult: 4,
    weight: 1,
  },
};

export const CHAMPION_IDS = Object.keys(CHAMPIONS) as ChampionId[];

/** Chance any eligible wild spawn is promoted. */
export const CHAMPION_CHANCE = 0.06;

/** Roll a spawn's promotion: a champion kind, or null. Consumes exactly one
 * rng draw on a miss so map generation stays stable as kinds are added. */
export function rollChampion(rng: Rng): ChampionId | null {
  const roll = rng.next();
  if (roll >= CHAMPION_CHANCE) return null;
  // Re-scale the winning sliver of the roll into a weighted kind pick.
  const total = CHAMPION_IDS.reduce((s, id) => s + CHAMPIONS[id].weight, 0);
  let pick = (roll / CHAMPION_CHANCE) * total;
  for (const id of CHAMPION_IDS) {
    pick -= CHAMPIONS[id].weight;
    if (pick < 0) return id;
  }
  return CHAMPION_IDS[CHAMPION_IDS.length - 1]!;
}

/** Stamp a champion kind onto a freshly spawned monster (full health assumed). */
export function promoteToChampion(m: Monster, id: ChampionId): void {
  const c = CHAMPIONS[id];
  m.championId = id;
  m.maxLife = Math.round(m.maxLife * c.lifeMult);
  m.life = m.maxLife;
  m.dmgMin = Math.round(m.dmgMin * c.dmgMult);
  m.dmgMax = Math.round(m.dmgMax * c.dmgMult);
  m.speed = m.speed * c.speedMult;
  m.attackRating = Math.round(m.attackRating * c.arMult);
  m.defense = Math.round(m.defense * c.defMult);
  m.xp = Math.round(m.xp * c.xpMult);
  m.guaranteedDrop = true;
  if (c.volatile && !m.explode) {
    m.explode = { radius: 1.8, dmgMin: m.dmgMin * 2, dmgMax: m.dmgMax * 2 };
  }
}

/** "Swift Fen Howler" — what floats over a champion's head. */
export function championName(m: Monster): string {
  const base = MONSTER_TYPES[m.typeId]?.name ?? m.typeId;
  return m.championId ? `${CHAMPIONS[m.championId].prefix} ${base}` : base;
}
