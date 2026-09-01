import type { AreaId } from "./areas";
import type { Rng } from "./rng";
import type { Vec, ZoneMap } from "./map";
import type { Monster, Corpse } from "./monsters";
import type { Item, Rarity } from "./items/generate";
import type { Breakable, BreakableKind } from "./breakables";
import type { Equipment, EquipSlot, Inventory } from "./character";
import type { Klass, SkillId } from "./skills";
import type { Npc, NpcId } from "./npcs";
import type { QuestId, QuestLog } from "./quests";

/** The whole open-air world is one zone; the barrow's floors are the rest. */
export type ZoneId = "surface" | `floor:${number}`;

export const floorZone = (n: number): ZoneId => `floor:${n}`;

/** floor:N = N; the surface = 1. Regions take their level from the registry. */
export function zoneDepth(id: ZoneId): number {
  if (!id.startsWith("floor:")) return 1;
  return Number(id.slice("floor:".length));
}

export interface ZoneState {
  id: ZoneId;
  map: ZoneMap;
  monsters: Map<number, Monster>;
  groundItems: Map<number, GroundItem>;
  goldPiles: Map<number, GoldPile>;
  breakables: Map<number, Breakable>;
  corpses: Corpse[];
  portals: Map<number, Portal>;
  playerCorpses: Map<number, PlayerCorpse>;
  npcs: Map<number, Npc>;
}

/** A dead player's stripped gear, waiting to be walked back to and reclaimed. */
export interface PlayerCorpse {
  id: number;
  playerId: PlayerId;
  pos: Vec;
  equipment: Equipment;
}

export interface Portal {
  id: number;
  owner: PlayerId;
  pos: Vec;
  /** The far end. */
  link: { zone: ZoneId; pos: Vec };
}

export function getZone(state: GameState, id: ZoneId): ZoneState {
  const zone = state.zones.get(id);
  if (!zone) throw new Error(`no such zone: ${id}`);
  return zone;
}

export function zoneOf(state: GameState, p: Player): ZoneState {
  return getZone(state, p.zoneId);
}

/** Every player id, ascending — the one iteration order the sim ever uses. */
export function playerIds(state: GameState): PlayerId[] {
  return [...state.players.keys()].sort((a, b) => a - b);
}

/** Every player, ascending by id. */
export function allPlayers(state: GameState): Player[] {
  return playerIds(state).map((id) => state.players.get(id)!);
}

/** 0..3, assigned by the host as players join. */
export type PlayerId = number;

export interface PlayerJoin {
  id: PlayerId;
  /** CharacterSave JSON, when the joiner brings an existing hero. */
  character?: string;
}

/** One tick's worth of the world's input: what every player did, plus roster churn. */
export interface Frame {
  tick: number;
  inputs: Partial<Record<PlayerId, PlayerInput>>;
  joins?: PlayerJoin[];
  leaves?: PlayerId[];
}

export interface Player {
  id: PlayerId;
  /** Display name, chosen at character creation. */
  name: string;
  klass: Klass;
  /** Which zone this player is standing in. */
  zoneId: ZoneId;
  /** Was this player on camp ground last tick? Drives arrival triggers (restock). */
  wasInCamp: boolean;
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
  /** A leap in flight: the player travels from→to and lands (stunning) at endTick. */
  leap: { from: Vec; to: Vec; startTick: number; endTick: number } | null;
  /** Ground item id being walked to for pickup, if any. */
  pickupTarget: number | null;
  /** Breakable id being walked to for smashing, if any. */
  smashTarget: number | null;
  /** NPC entity id being walked to for a word, if any. */
  npcTarget: number | null;
  /** Portal id being walked to for riding, if any. */
  portalTarget: number | null;
  /** Player corpse id being walked to for reclaiming, if any. */
  reclaimTarget: number | null;
  /** Areas whose waypoint this player has touched. Sorted; arrays serialize, Sets don't. */
  waypoints: AreaId[];
  /** Where death and a reload seat this player: last waypoint or safe ground touched. */
  checkpoint: AreaId;
  /** Last surface region this player stood in; kept while below ground. */
  region: AreaId;
  level: number;
  xp: number;
  skillPoints: number;
  skills: Record<SkillId, number>;
  mana: number;
  maxMana: number;
  /** Tick until which the class buff (Warcry / Focus) is active. */
  buffUntil: number;
  /** Healing potions on the belt. */
  belt: number;
  /** Mana potions on the belt's second row. */
  manaBelt: number;
  gold: number;
  inventory: Inventory;
  equipment: Equipment;
  magicFind: number;
  /** Per-hero quest log; absent key = never started. Saves with the character. */
  quests: QuestLog;
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
  | { type: "player_swing"; playerId: PlayerId; to: Vec; zone: ZoneId }
  | { type: "monster_swing"; id: number; from: Vec; to: Vec; ranged: boolean; zone: ZoneId }
  | { type: "monster_windup"; id: number; ticks: number; pos: Vec; zone: ZoneId }
  | { type: "player_hit"; playerId: PlayerId; amount: number }
  | { type: "monster_hit"; id: number; amount: number; pos: Vec; zone: ZoneId }
  | {
      type: "monster_died";
      id: number;
      typeId: string;
      pos: Vec;
      xp: number;
      mlvl: number;
      zone: ZoneId;
      killer: PlayerId | null;
    }
  | { type: "level_up"; playerId: PlayerId; level: number }
  | { type: "waypoint_found"; playerId: PlayerId; area: AreaId }
  | { type: "skill_cast"; playerId: PlayerId; skill: SkillId; pos: Vec; at?: Vec; zone: ZoneId }
  | { type: "cast_failed"; playerId: PlayerId; reason: "mana" }
  | { type: "leap_land"; playerId: PlayerId; pos: Vec; zone: ZoneId }
  | { type: "exploded"; pos: Vec; radius: number; zone: ZoneId }
  | { type: "potion_drunk"; playerId: PlayerId; healed: number; kind: "health" | "mana" }
  | { type: "traveled"; playerId: PlayerId; to: ZoneId }
  | { type: "breakable_broken"; id: number; kind: BreakableKind; pos: Vec; zone: ZoneId }
  | { type: "gold_dropped"; id: number; amount: number; pos: Vec; zone: ZoneId }
  | { type: "gold_picked"; playerId: PlayerId; amount: number }
  | { type: "item_broke"; playerId: PlayerId; name: string }
  | { type: "repaired"; playerId: PlayerId; cost: number }
  | { type: "npc_talk"; playerId: PlayerId; npcId: NpcId }
  | { type: "quest_accepted"; playerId: PlayerId; quest: QuestId }
  | { type: "quest_completed"; playerId: PlayerId; quest: QuestId }
  | { type: "quest_progress"; playerId: PlayerId; quest: QuestId; count: number; needed: number }
  | { type: "healed"; playerId: PlayerId }
  | { type: "bought"; playerId: PlayerId; name: string; price: number }
  | { type: "sold"; playerId: PlayerId; name: string; price: number }
  | { type: "item_dropped"; id: number; name: string; rarity: Rarity; pos: Vec; zone: ZoneId }
  | { type: "item_picked"; playerId: PlayerId; id: number; name: string }
  | { type: "item_equipped"; playerId: PlayerId; slot: EquipSlot }
  | { type: "item_unequipped"; playerId: PlayerId; slot: EquipSlot }
  | { type: "inventory_full"; playerId: PlayerId }
  | { type: "player_joined"; playerId: PlayerId }
  | { type: "player_left"; playerId: PlayerId }
  | { type: "player_died"; playerId: PlayerId; zone: ZoneId; pos: Vec }
  | { type: "corpse_reclaimed"; playerId: PlayerId }
  | { type: "portal_cast"; playerId: PlayerId; zone: ZoneId; pos: Vec }
  | { type: "region_entered"; playerId: PlayerId; area: AreaId };

export interface ShopEntry {
  item: Item;
  price: number;
}

export interface GameState {
  tick: number;
  /** The seed this world was created from; persisted so a hero can come home. */
  seed: number;
  rng: Rng;
  /** The world: the stitched surface (camp included) plus every floor generated so far. */
  zones: Map<ZoneId, ZoneState>;
  /** The vendor's current stock; restocked each arrival on camp ground. */
  shop: ShopEntry[];
  /** Everyone in the game, keyed by host-assigned id. */
  players: Map<PlayerId, Player>;
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
  /** Drink a potion from the belt. Legacy `true` means "health". */
  drink?: "health" | "mana";
  /** Buy a potion straight from Sera's stall (town only). */
  buyPotion?: "health" | "mana";
  /** Start a fresh run: forget the floors, revive, keep the character. */
  newGame?: boolean;
  /** Cast a two-way portal pair between here and camp. */
  townPortal?: boolean;
  /** Standing at a waypoint: jump to this discovered area's waypoint. */
  waypointTo?: AreaId;
  /** Walk to and ride this portal id. */
  usePortal?: number;
  /** Walk to and reclaim this player corpse id. */
  reclaim?: number;
  /** NPC entity id to walk to and talk with. */
  talkNpc?: number;
  /** Accept this quest from its giver (must be in range and offered). */
  acceptQuest?: QuestId;
  /** Turn in this quest at its turn-in npc (must be in range and objective met). */
  turnInQuest?: QuestId;
  /** Buy the shop entry at this index (town only). */
  buy?: number;
  /** Sell this inventory entry to the vendor (town only). */
  sell?: number;
  /** Repair all gear at the vendor (town only). */
  repair?: boolean;
}
