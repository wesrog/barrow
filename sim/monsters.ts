import type { Vec } from "./map";
import type { GameState, ZoneState } from "./state";

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
  /** Body radius in cells, for collision. */
  radius: number;
  /** Ticks between swings. */
  swingEvery: number;
  xp: number;
  /** Treasure class rolled on death. */
  tc: string;
  /** Monster level: caps droppable bases and affix levels. */
  mlvl: number;
  /** Ranged attacker: preferred firing distance (needs line of sight). */
  ranged?: number;
  /** Detonates on death. */
  explode?: { radius: number; dmgMin: number; dmgMax: number };
  /** Always drops, magic or better (boss packs). */
  guaranteedDrop?: boolean;
  /** Telegraphed attack: ticks of visible windup before the strike lands. */
  windup?: number;
}

export const MONSTER_TYPES: Record<string, MonsterType> = {
  shambler: {
    id: "shambler",
    name: "Shambler",
    maxLife: 30,
    speed: 2.2 / 25,
    dmgMin: 2,
    dmgMax: 6,
    attackRating: 40,
    defense: 20,
    aggro: 6,
    range: 1.1,
    radius: 0.3,
    swingEvery: 25,
    xp: 12,
    tc: "standard",
    mlvl: 5,
  },
  skitter: {
    id: "skitter",
    name: "Skitter",
    maxLife: 12,
    speed: 5.5 / 25,
    dmgMin: 1,
    dmgMax: 2,
    attackRating: 30,
    defense: 5,
    aggro: 7,
    range: 1.0,
    radius: 0.25,
    swingEvery: 15,
    xp: 6,
    tc: "trash",
    mlvl: 2,
  },
  gravespit: {
    id: "gravespit",
    name: "Gravespit",
    maxLife: 16,
    speed: 3.0 / 25,
    dmgMin: 2,
    dmgMax: 4,
    attackRating: 45,
    defense: 10,
    aggro: 9,
    range: 1.0,
    radius: 0.3,
    swingEvery: 40,
    xp: 10,
    tc: "standard",
    mlvl: 4,
    ranged: 5.5,
  },
  tomb_bloat: {
    id: "tomb_bloat",
    name: "Tomb Bloat",
    maxLife: 20,
    speed: 1.8 / 25,
    dmgMin: 1,
    dmgMax: 2,
    attackRating: 30,
    defense: 8,
    aggro: 7,
    range: 1.0,
    radius: 0.35,
    swingEvery: 30,
    xp: 8,
    tc: "trash",
    mlvl: 3,
    explode: { radius: 1.8, dmgMin: 6, dmgMax: 12 },
  },
  barrow_lord: {
    id: "barrow_lord",
    name: "The Barrow Lord",
    maxLife: 120,
    speed: 2.6 / 25,
    dmgMin: 4,
    dmgMax: 9,
    attackRating: 70,
    defense: 30,
    aggro: 8,
    range: 1.3,
    radius: 0.5,
    swingEvery: 20,
    xp: 60,
    tc: "boss",
    mlvl: 8,
    guaranteedDrop: true,
    windup: 20,
  },
};

/** Depth 1 uses the table stats; each floor below multiplies threat and reward. */
export function scaledMonsterStats(t: MonsterType, depth: number): MonsterType {
  const d = depth - 1;
  const pow = (b: number) => Math.pow(b, d);
  return {
    ...t,
    maxLife: Math.round(t.maxLife * pow(1.35)),
    dmgMin: Math.round(t.dmgMin * pow(1.22)),
    dmgMax: Math.round(t.dmgMax * pow(1.22)),
    attackRating: Math.round(t.attackRating * pow(1.15)),
    defense: Math.round(t.defense * pow(1.15)),
    xp: Math.round(t.xp * pow(1.4)),
    mlvl: t.mlvl + d * 3,
    explode: t.explode
      ? {
          radius: t.explode.radius,
          dmgMin: Math.round(t.explode.dmgMin * pow(1.22)),
          dmgMax: Math.round(t.explode.dmgMax * pow(1.22)),
        }
      : undefined,
  };
}

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
  radius: number;
  swingEvery: number;
  swingCooldown: number;
  ai: MonsterAi;
  path: Vec[];
  repathIn: number;
  /** Spawn anchor: idle wandering stays leashed to this point. */
  home: Vec;
  /** Ticks until the next idle stroll. */
  wanderIn: number;
  xp: number;
  tc: string;
  mlvl: number;
  ranged?: number;
  explode?: { radius: number; dmgMin: number; dmgMax: number };
  guaranteedDrop?: boolean;
  windup?: number;
  /** Tick when a telegraphed strike lands, or null when not winding up. */
  windingUntil: number | null;
  /** A swing in flight: damage resolves at this tick (contact frame). */
  strikeAt: number | null;
  /** Where a ranged shot was aimed; dodging away from it makes it whiff. */
  strikeTo: Vec | null;
  /** Tick until which this monster is stunned (no moving, no swinging). */
  stunnedUntil: number;
}

export interface Corpse {
  typeId: string;
  pos: Vec;
  /** Tick of death, for renderer fade-out. */
  diedAt: number;
}

export function spawnMonster(
  state: GameState,
  zone: ZoneState,
  typeId: string,
  pos: Vec,
  depth = 1,
): Monster {
  const table = MONSTER_TYPES[typeId];
  if (!table) throw new Error(`unknown monster type: ${typeId}`);
  const t = depth > 1 ? scaledMonsterStats(table, depth) : table;
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
    radius: t.radius,
    swingEvery: t.swingEvery,
    swingCooldown: 0,
    ai: "idle",
    path: [],
    repathIn: 0,
    home: { ...pos },
    wanderIn: 0,
    xp: t.xp,
    tc: t.tc,
    mlvl: t.mlvl,
    ranged: t.ranged,
    explode: t.explode,
    guaranteedDrop: t.guaranteedDrop,
    windup: t.windup,
    windingUntil: null,
    strikeAt: null,
    strikeTo: null,
    stunnedUntil: 0,
  };
  zone.monsters.set(monster.id, monster);
  return monster;
}
