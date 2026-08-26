import type { Rng } from "./rng";
import type { Vec, ZoneMap } from "./map";
import type { Monster, Corpse } from "./monsters";

export interface Player {
  pos: Vec;
  /** Cells per tick. */
  speed: number;
  /** Remaining waypoints (cell centers) toward the current destination. */
  path: Vec[];
  life: number;
  maxLife: number;
  dead: boolean;
  dmgMin: number;
  dmgMax: number;
  attackRating: number;
  defense: number;
  /** Melee reach in cells. */
  range: number;
  /** Ticks between swings. */
  swingEvery: number;
  swingCooldown: number;
  /** Monster id currently being attacked, if any. */
  attackTarget: number | null;
}

export type SimEvent =
  | { type: "player_hit"; amount: number }
  | { type: "monster_hit"; id: number; amount: number; pos: Vec }
  | { type: "monster_died"; id: number; typeId: string; pos: Vec };

export interface GameState {
  tick: number;
  rng: Rng;
  map: ZoneMap;
  player: Player;
  monsters: Map<number, Monster>;
  corpses: Corpse[];
  /** Events emitted during the most recent step; cleared at the start of each. */
  events: SimEvent[];
  nextId: number;
}

export interface PlayerInput {
  /** World position the player clicked to walk to. */
  moveTo?: Vec;
  /** Monster id the player clicked to attack. */
  attack?: number;
}
