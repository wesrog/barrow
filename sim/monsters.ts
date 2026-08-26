import type { Vec } from "./map";
import type { GameState } from "./state";

export interface MonsterType {
  id: string;
  name: string;
  maxLife: number;
  /** Cells per tick. */
  speed: number;
  dmgMin: number;
  dmgMax: number;
  attackRating: number;
  defense: number;
  /** Aggro radius in cells. */
  aggro: number;
  /** Melee reach in cells. */
  range: number;
  /** Ticks between swings. */
  swingEvery: number;
  xp: number;
}

export const MONSTER_TYPES: Record<string, MonsterType> = {
  shambler: {
    id: "shambler",
    name: "Shambler",
    maxLife: 30,
    speed: 2.2 / 25,
    dmgMin: 3,
    dmgMax: 7,
    attackRating: 60,
    defense: 20,
    aggro: 6,
    range: 1.1,
    swingEvery: 25,
    xp: 12,
  },
  skitter: {
    id: "skitter",
    name: "Skitter",
    maxLife: 12,
    speed: 5.5 / 25,
    dmgMin: 1,
    dmgMax: 3,
    attackRating: 45,
    defense: 5,
    aggro: 7,
    range: 1.0,
    swingEvery: 15,
    xp: 6,
  },
};

export type MonsterAi = "idle" | "chasing";

export interface Monster {
  id: number;
  typeId: string;
  pos: Vec;
  speed: number;
  life: number;
  maxLife: number;
  dmgMin: number;
  dmgMax: number;
  attackRating: number;
  defense: number;
  aggro: number;
  range: number;
  swingEvery: number;
  swingCooldown: number;
  ai: MonsterAi;
  path: Vec[];
  repathIn: number;
  xp: number;
}

export interface Corpse {
  typeId: string;
  pos: Vec;
  /** Tick of death, for renderer fade-out. */
  diedAt: number;
}

export function spawnMonster(state: GameState, typeId: string, pos: Vec): Monster {
  const t = MONSTER_TYPES[typeId];
  if (!t) throw new Error(`unknown monster type: ${typeId}`);
  const monster: Monster = {
    id: state.nextId++,
    typeId,
    pos: { ...pos },
    speed: t.speed,
    life: t.maxLife,
    maxLife: t.maxLife,
    dmgMin: t.dmgMin,
    dmgMax: t.dmgMax,
    attackRating: t.attackRating,
    defense: t.defense,
    aggro: t.aggro,
    range: t.range,
    swingEvery: t.swingEvery,
    swingCooldown: 0,
    ai: "idle",
    path: [],
    repathIn: 0,
    xp: t.xp,
  };
  state.monsters.set(monster.id, monster);
  return monster;
}
