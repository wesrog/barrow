import type { Rng } from "./rng";
import type { Vec, ZoneMap } from "./map";
import type { Monster, Corpse } from "./monsters";
import type { Item, Rarity } from "./items/generate";
import type { Breakable, BreakableKind } from "./breakables";
import type { Equipment, EquipSlot, Inventory } from "./character";
import type { SkillId } from "./skills";

export type ZoneId = "camp" | `floor:${number}`;

export const floorZone = (n: number): ZoneId => `floor:${n}`;

/** camp = 0; floor:N = N. Drives monster/loot scaling exactly as old `depth`. */
export function zoneDepth(id: ZoneId): number {
  return id === "camp" ? 0 : Number(id.slice("floor:".length));
}

export interface ZoneState {
  id: ZoneId;
  map: ZoneMap;
  monsters: Map<number, Monster>;
  groundItems: Map<number, GroundItem>;
  goldPiles: Map<number, GoldPile>;
  breakables: Map<number, Breakable>;
  corpses: Corpse[];
}

export function getZone(state: GameState, id: ZoneId): ZoneState {
  const zone = state.zones.get(id);
  if (!zone) throw new Error(`no such zone: ${id}`);
  return zone;
}

export function zoneOf(state: GameState, p: Player): ZoneState {
  return getZone(state, p.zoneId);
}

export interface Player {
  /** Which zone this player is standing in. */
  zoneId: ZoneId;
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
  /** Breakable id being walked to for smashing, if any. */
  smashTarget: number | null;
  /** Walking over to Maren to trade (town only). */
  vendorTarget: boolean;
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
  gold: number;
  inventory: Inventory;
  equipment: Equipment;
  magicFind: number;
}

export interface GroundItem {
  id: number;
  item: Item;
  pos: Vec;
}

export interface GoldPile {
  id: number;
  amount: number;
  pos: Vec;
}

export type SimEvent =
  | { type: "player_swing"; to: Vec; zone: ZoneId }
  | { type: "monster_swing"; id: number; from: Vec; to: Vec; ranged: boolean; zone: ZoneId }
  | { type: "monster_windup"; id: number; ticks: number; pos: Vec; zone: ZoneId }
  | { type: "player_hit"; amount: number }
  | { type: "monster_hit"; id: number; amount: number; pos: Vec; zone: ZoneId }
  | { type: "monster_died"; id: number; typeId: string; pos: Vec; xp: number; zone: ZoneId }
  | { type: "level_up"; level: number }
  | { type: "skill_cast"; skill: SkillId; pos: Vec; zone: ZoneId }
  | { type: "exploded"; pos: Vec; radius: number; zone: ZoneId }
  | { type: "potion_drunk"; healed: number }
  | { type: "traveled"; to: ZoneId }
  | { type: "breakable_broken"; id: number; kind: BreakableKind; pos: Vec; zone: ZoneId }
  | { type: "gold_dropped"; id: number; amount: number; pos: Vec; zone: ZoneId }
  | { type: "gold_picked"; amount: number }
  | { type: "item_broke"; name: string }
  | { type: "repaired"; cost: number }
  | { type: "shop_opened" }
  | { type: "bought"; name: string; price: number }
  | { type: "sold"; name: string; price: number }
  | { type: "item_dropped"; id: number; name: string; rarity: Rarity; pos: Vec; zone: ZoneId }
  | { type: "item_picked"; id: number; name: string }
  | { type: "item_equipped"; slot: EquipSlot }
  | { type: "item_unequipped"; slot: EquipSlot }
  | { type: "inventory_full" };

export interface ShopEntry {
  item: Item;
  price: number;
}

export interface GameState {
  tick: number;
  rng: Rng;
  /** The world: the camp plus every floor generated so far. */
  zones: Map<ZoneId, ZoneState>;
  /** The vendor's current stock; restocked each camp arrival. */
  shop: ShopEntry[];
  player: Player;
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
  /** Breakable id the player clicked to smash open. */
  smash?: number;
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
  /** Start a fresh run: forget the floors, revive, keep the character. */
  newGame?: boolean;
  /** Town portal. Currently a no-op — portal pairs arrive with multiplayer travel. */
  townPortal?: boolean;
  /** Walk to the vendor and open the shop (town only). */
  talkVendor?: boolean;
  /** Buy the shop entry at this index (town only). */
  buy?: number;
  /** Sell this inventory entry to the vendor (town only). */
  sell?: number;
  /** Repair all gear at the vendor (town only). */
  repair?: boolean;
}
