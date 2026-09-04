import { BASES, type Slot } from "./items/bases";
import type { Item, Rarity } from "./items/generate";
import type { Klass } from "./skills";

export const INV_W = 10;
export const INV_H = 4;
export const STASH_W = 10;
export const STASH_H = 8;
export const BELT_SIZE = 4;
export const POTION_HEAL = 35;
export const POTION_MANA = 25;

export interface InvEntry {
  id: number;
  item: Item;
  x: number;
  y: number;
}

export interface Inventory {
  entries: InvEntry[];
}

export type EquipSlot = "weapon" | "shield" | "helm" | "chest" | "boots" | "amulet" | "ring1" | "ring2";

export type Equipment = Record<EquipSlot, Item | null>;

export function createInventory(): Inventory {
  return { entries: [] };
}

export function createEquipment(): Equipment {
  return { weapon: null, shield: null, helm: null, chest: null, boots: null, amulet: null, ring1: null, ring2: null };
}

export function itemSize(item: Item): { w: number; h: number } {
  const base = BASES[item.baseId]!;
  return { w: base.w, h: base.h };
}

function occupied(inv: Inventory, gridW: number, gridH: number): boolean[] {
  const cells = new Array<boolean>(gridW * gridH).fill(false);
  for (const e of inv.entries) {
    const { w, h } = itemSize(e.item);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells[(e.y + dy) * gridW + (e.x + dx)] = true;
      }
    }
  }
  return cells;
}

/** First free top-left position where a w x h item fits, scanning row-major.
 * Grid dims default to the pack; the stash passes its own. */
export function findSpot(
  inv: Inventory,
  w: number,
  h: number,
  gridW = INV_W,
  gridH = INV_H,
): { x: number; y: number } | null {
  const cells = occupied(inv, gridW, gridH);
  for (let y = 0; y + h <= gridH; y++) {
    for (let x = 0; x + w <= gridW; x++) {
      let fits = true;
      for (let dy = 0; dy < h && fits; dy++) {
        for (let dx = 0; dx < w && fits; dx++) {
          if (cells[(y + dy) * gridW + (x + dx)]) fits = false;
        }
      }
      if (fits) return { x, y };
    }
  }
  return null;
}

/** Place at the first free spot. Returns false if the grid can't fit it. */
export function placeItem(
  inv: Inventory,
  id: number,
  item: Item,
  gridW = INV_W,
  gridH = INV_H,
): boolean {
  const { w, h } = itemSize(item);
  const spot = findSpot(inv, w, h, gridW, gridH);
  if (!spot) return false;
  inv.entries.push({ id, item, x: spot.x, y: spot.y });
  return true;
}

// Pack order for "organize": tall-then-wide first so big gear packs the
// left edge and the 1x1s fill the leftovers; within a size, gear groups by
// slot, best rarity leads, then higher level, then name. Entry id is the final
// tiebreak so any entry order yields the same layout.
const SORT_SLOT_ORDER: Record<Slot, number> = {
  weapon: 0,
  shield: 1,
  helm: 2,
  chest: 3,
  boots: 4,
  amulet: 5,
  ring: 6,
  potion: 7,
  quest: 8,
};
const SORT_RARITY_ORDER: Record<Rarity, number> = { unique: 0, rare: 1, magic: 2, normal: 3 };

function compareForSort(a: InvEntry, b: InvEntry): number {
  const ba = BASES[a.item.baseId]!;
  const bb = BASES[b.item.baseId]!;
  return (
    bb.h - ba.h ||
    bb.w - ba.w ||
    SORT_SLOT_ORDER[ba.slot] - SORT_SLOT_ORDER[bb.slot] ||
    SORT_RARITY_ORDER[a.item.rarity] - SORT_RARITY_ORDER[b.item.rarity] ||
    bb.levelReq - ba.levelReq ||
    (a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0) ||
    a.id - b.id
  );
}

/**
 * Re-pack every entry top-left, biggest first. Ids and items are untouched, only
 * positions move. If the re-pack can't seat everything (a hand-packed grid the
 * greedy pass can't reproduce), the inventory is left exactly as it was and
 * false is returned.
 */
export function sortInventory(inv: Inventory, gridW = INV_W, gridH = INV_H): boolean {
  const ordered = [...inv.entries].sort(compareForSort);
  const packed: Inventory = { entries: [] };
  for (const e of ordered) {
    if (!placeItem(packed, e.id, e.item, gridW, gridH)) return false;
  }
  inv.entries = packed.entries;
  return true;
}

export function removeEntry(inv: Inventory, id: number): InvEntry | null {
  const idx = inv.entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  return inv.entries.splice(idx, 1)[0]!;
}

/** Equip slot this item goes to; rings prefer an empty ring slot, else ring1.
 *  `prefer` names a ring slot explicitly (shift-click) and only applies to rings. */
export function slotForItem(item: Item, eq: Equipment, prefer?: EquipSlot): EquipSlot {
  const slot = BASES[item.baseId]!.slot;
  if (slot === "potion") throw new Error("potions go to the belt, not equipment");
  if (slot === "quest") throw new Error("quest items don't equip");
  if (slot === "ring") {
    if (prefer === "ring1" || prefer === "ring2") return prefer;
    if (!eq.ring1) return "ring1";
    if (!eq.ring2) return "ring2";
    return "ring1";
  }
  return slot;
}

export interface DerivedStats {
  dmgMin: number;
  dmgMax: number;
  attackRating: number;
  defense: number;
  maxLife: number;
  maxMana: number;
  swingEvery: number;
  attackSpeedPct: number;
  moveSpeedPct: number;
  magicFind: number;
  lifeRegen: number;
}

/** Naked lvl-1 bruiser. Gear is meant to matter: unarmed hits are feeble. */
export const BASE_STATS = {
  dmgMin: 1,
  dmgMax: 3,
  attackRating: 100,
  defense: 20,
  maxLife: 100,
  maxMana: 30,
  swingEvery: 12,
} as const;

export const LIFE_PER_LEVEL = 8;

/** Life/mana pools per class: the warrior is the sturdy baseline, the witch
 * trades life for the mana her spells run on. */
export const CLASS_STATS: Record<
  Klass,
  { maxLife: number; maxMana: number; lifePerLevel: number; manaPerLevel: number }
> = {
  warrior: { maxLife: 100, maxMana: 30, lifePerLevel: LIFE_PER_LEVEL, manaPerLevel: 0 },
  witch: { maxLife: 75, maxMana: 60, lifePerLevel: 5, manaPerLevel: 4 },
};

/** Each level's price grows this much over the last — the slope that makes
 * early levels quick and the late game a genuine climb. */
const XP_LEVEL_BASE = 40;
const XP_LEVEL_GROWTH = 1.22;

/** Cumulative thresholds, extended on demand; grantXp probes this in a loop. */
const xpTable: number[] = [0, 0];

/** Total xp at which the player becomes `level`. */
export function xpForLevel(level: number): number {
  while (xpTable.length <= level) {
    const l = xpTable.length;
    xpTable.push(xpTable[l - 1]! + Math.round(XP_LEVEL_BASE * Math.pow(XP_LEVEL_GROWTH, l - 2)));
  }
  return xpTable[level]!;
}

/** Broken gear (durability 0) contributes nothing until repaired. */
export function isBroken(item: Item): boolean {
  return item.durability !== undefined && item.durability.cur <= 0;
}

/** Two-handers fill both hands: equipping one empties the shield slot, and a shield
 * that sneaks in beside one (a stale save, a reclaimed corpse) is inert. */
export function isTwoHanded(item: Item): boolean {
  return BASES[item.baseId]!.twoHanded === true;
}

export function computeStats(eq: Equipment, level = 1, klass: Klass = "warrior"): DerivedStats {
  const cls = CLASS_STATS[klass];
  const weapon = eq.weapon && !isBroken(eq.weapon) ? eq.weapon : null;
  const weaponBase = weapon ? BASES[weapon.baseId]! : null;
  let dmgMin = weaponBase?.dmgMin ?? BASE_STATS.dmgMin;
  let dmgMax = weaponBase?.dmgMax ?? BASE_STATS.dmgMax;
  let dmgPct = 0;
  let attackRating: number = BASE_STATS.attackRating;
  let defense: number = BASE_STATS.defense;
  let maxLife: number = cls.maxLife + (level - 1) * cls.lifePerLevel;
  let maxMana: number = cls.maxMana + (level - 1) * cls.manaPerLevel;
  let attackSpeedPct = 0;
  let moveSpeedPct = 0;
  let magicFind = 0;
  let lifeRegen = 0;

  const bothHandsFull = eq.weapon !== null && isTwoHanded(eq.weapon);
  for (const [slot, item] of Object.entries(eq) as [EquipSlot, Item | null][]) {
    if (!item || isBroken(item)) continue;
    if (slot === "shield" && bothHandsFull) continue;
    const base = BASES[item.baseId]!;
    if (base.slot !== "weapon" && base.defense) defense += base.defense;
    // Off-hand orbs carry base damage that stacks with the main hand.
    if (base.slot !== "weapon" && base.dmgMin !== undefined) {
      dmgMin += base.dmgMin;
      dmgMax += base.dmgMax ?? base.dmgMin;
    }
    for (const mod of item.mods) {
      switch (mod.stat) {
        case "dmgMin": dmgMin += mod.value; break;
        case "dmgMax": dmgMax += mod.value; break;
        case "dmgPct": dmgPct += mod.value; break;
        case "attackRating": attackRating += mod.value; break;
        case "defense": defense += mod.value; break;
        case "life": maxLife += mod.value; break;
        case "mana": maxMana += mod.value; break;
        case "attackSpeedPct": attackSpeedPct += mod.value; break;
        case "moveSpeedPct": moveSpeedPct += mod.value; break;
        case "magicFind": magicFind += mod.value; break;
        case "lifeRegen": lifeRegen += mod.value; break;
      }
    }
  }

  dmgMin = Math.floor(dmgMin * (1 + dmgPct / 100));
  dmgMax = Math.floor(dmgMax * (1 + dmgPct / 100));
  if (dmgMax < dmgMin) dmgMax = dmgMin;

  return {
    dmgMin,
    dmgMax,
    attackRating,
    defense,
    maxLife,
    maxMana,
    swingEvery: Math.max(4, Math.round(BASE_STATS.swingEvery / (1 + attackSpeedPct / 100))),
    attackSpeedPct,
    moveSpeedPct,
    magicFind,
    lifeRegen,
  };
}
