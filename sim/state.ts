import type { Rng } from "./rng";
import type { Vec, ZoneMap } from "./map";
import type { Monster, Corpse } from "./monsters";
import type { Item, Rarity } from "./items/generate";
import type { Equipment, EquipSlot, Inventory } from "./character";
import type { SkillId } from "./skills";

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
  /** A swing in flight: damage resolves at this tick (contact frame). */
  pendingStrike: { at: number; target: number | null } | null;
  /** Ground item id being walked to for pickup, if any. */
  pickupTarget: number | null;
  level: number;
  xp: number;
  skillPoints: number;
  skills: Record<SkillId, number>;
  mana: number;
  maxMana: number;
  /** Tick until which the Warcry buff is active. */
  warcryUntil: number;
  /** Healing potions on the belt. */
  belt: number;
  inventory: Inventory;
  equipment: Equipment;
  magicFind: number;
}

export interface GroundItem {
  id: number;
  item: Item;
  pos: Vec;
}

export type SimEvent =
  | { type: "player_swing"; to: Vec }
  | { type: "monster_swing"; id: number; from: Vec; to: Vec; ranged: boolean }
  | { type: "monster_windup"; id: number; ticks: number; pos: Vec }
  | { type: "player_hit"; amount: number }
  | { type: "monster_hit"; id: number; amount: number; pos: Vec }
  | { type: "monster_died"; id: number; typeId: string; pos: Vec; xp: number }
  | { type: "level_up"; level: number }
  | { type: "skill_cast"; skill: SkillId; pos: Vec }
  | { type: "exploded"; pos: Vec; radius: number }
  | { type: "potion_drunk"; healed: number }
  | { type: "descended"; depth: number }
  | { type: "item_dropped"; id: number; name: string; rarity: Rarity; pos: Vec }
  | { type: "item_picked"; id: number; name: string }
  | { type: "item_equipped"; slot: EquipSlot }
  | { type: "item_unequipped"; slot: EquipSlot }
  | { type: "inventory_full" };

export interface GameState {
  tick: number;
  rng: Rng;
  map: ZoneMap;
  /** Crypt floor, 1-based; deeper floors scale monsters and loot. */
  depth: number;
  player: Player;
  monsters: Map<number, Monster>;
  corpses: Corpse[];
  groundItems: Map<number, GroundItem>;
  /** Events emitted during the most recent step; cleared at the start of each. */
  events: SimEvent[];
  nextId: number;
}

export interface PlayerInput {
  /** World position the player clicked to walk to. */
  moveTo?: Vec;
  /** Monster id the player clicked to attack. */
  attack?: number;
  /** Shift-click: swing toward this point without moving (hits whatever is in reach). */
  swingAt?: Vec;
  /** Ground item id the player clicked to pick up. */
  pickup?: number;
  /** Inventory entry id to equip. */
  equip?: number;
  /** Equipment slot to unequip back into the inventory. */
  unequip?: EquipSlot;
  /** Inventory entry id to toss on the ground at the player's feet. */
  dropItem?: number;
  /** Spend a skill point on this skill. */
  spendSkill?: SkillId;
  /** Cast a skill, optionally at a ground position or monster target. */
  cast?: { skill: SkillId; at?: Vec; target?: number };
  /** Drink a healing potion from the belt. */
  drink?: boolean;
  /** Start a fresh run: respawn the zone, revive, keep the character. */
  newGame?: boolean;
}
