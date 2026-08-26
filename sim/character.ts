import { BASES } from "./items/bases";
import type { Item } from "./items/generate";

export const INV_W = 10;
export const INV_H = 4;
export const BELT_SIZE = 4;
export const POTION_HEAL = 35;

export interface InvEntry {
  id: number;
  item: Item;
  x: number;
  y: number;
}

export interface Inventory {
  entries: InvEntry[];
}

export type EquipSlot = "weapon" | "helm" | "chest" | "boots" | "amulet" | "ring1" | "ring2";

export type Equipment = Record<EquipSlot, Item | null>;

export function createInventory(): Inventory {
  return { entries: [] };
}

export function createEquipment(): Equipment {
  return { weapon: null, helm: null, chest: null, boots: null, amulet: null, ring1: null, ring2: null };
}

export function itemSize(item: Item): { w: number; h: number } {
  const base = BASES[item.baseId]!;
  return { w: base.w, h: base.h };
}

function occupied(inv: Inventory): boolean[] {
  const cells = new Array<boolean>(INV_W * INV_H).fill(false);
  for (const e of inv.entries) {
    const { w, h } = itemSize(e.item);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cells[(e.y + dy) * INV_W + (e.x + dx)] = true;
      }
    }
  }
  return cells;
}

/** First free top-left position where a w x h item fits, scanning row-major. */
export function findSpot(inv: Inventory, w: number, h: number): { x: number; y: number } | null {
  const cells = occupied(inv);
  for (let y = 0; y + h <= INV_H; y++) {
    for (let x = 0; x + w <= INV_W; x++) {
      let fits = true;
      for (let dy = 0; dy < h && fits; dy++) {
        for (let dx = 0; dx < w && fits; dx++) {
          if (cells[(y + dy) * INV_W + (x + dx)]) fits = false;
        }
      }
      if (fits) return { x, y };
    }
  }
  return null;
}

/** Place at the first free spot. Returns false if the grid can't fit it. */
export function placeItem(inv: Inventory, id: number, item: Item): boolean {
  const { w, h } = itemSize(item);
  const spot = findSpot(inv, w, h);
  if (!spot) return false;
  inv.entries.push({ id, item, x: spot.x, y: spot.y });
  return true;
}

export function removeEntry(inv: Inventory, id: number): InvEntry | null {
  const idx = inv.entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  return inv.entries.splice(idx, 1)[0]!;
}

/** Equip slot this item goes to; rings prefer an empty ring slot, else ring1. */
export function slotForItem(item: Item, eq: Equipment): EquipSlot {
  const slot = BASES[item.baseId]!.slot;
  if (slot === "potion") throw new Error("potions go to the belt, not equipment");
  if (slot === "ring") {
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
  moveSpeedPct: number;
  magicFind: number;
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

/** Total xp at which the player becomes `level`. */
export function xpForLevel(level: number): number {
  const n = level - 1;
  return 20 * n + 15 * n * n;
}

/** Broken gear (durability 0) contributes nothing until repaired. */
export function isBroken(item: Item): boolean {
  return item.durability !== undefined && item.durability.cur <= 0;
}

export function computeStats(eq: Equipment, level = 1): DerivedStats {
  const weapon = eq.weapon && !isBroken(eq.weapon) ? eq.weapon : null;
  const weaponBase = weapon ? BASES[weapon.baseId]! : null;
  let dmgMin = weaponBase?.dmgMin ?? BASE_STATS.dmgMin;
  let dmgMax = weaponBase?.dmgMax ?? BASE_STATS.dmgMax;
  let dmgPct = 0;
  let attackRating: number = BASE_STATS.attackRating;
  let defense: number = BASE_STATS.defense;
  let maxLife: number = BASE_STATS.maxLife + (level - 1) * LIFE_PER_LEVEL;
  let maxMana: number = BASE_STATS.maxMana;
  let attackSpeedPct = 0;
  let moveSpeedPct = 0;
  let magicFind = 0;

  for (const item of Object.values(eq)) {
    if (!item || isBroken(item)) continue;
    const base = BASES[item.baseId]!;
    if (base.slot !== "weapon" && base.defense) defense += base.defense;
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
    moveSpeedPct,
    magicFind,
  };
}
