import { zoneOf, type GameState, type Player, type PlayerInput, type ZoneState } from "../state";
import {
  BELT_SIZE,
  POTION_HEAL,
  computeStats,
  placeItem,
  removeEntry,
  slotForItem,
} from "../character";
import { BASES } from "../items/bases";
import { findPath, smoothPath } from "../path";

const PICKUP_RANGE = 1.0;

/** Re-derive player combat stats from equipment. Current life never exceeds max. */
export function recomputePlayerStats(state: GameState, p: Player): void {
  const s = computeStats(p.equipment, p.level);
  p.dmgMin = s.dmgMin;
  p.dmgMax = s.dmgMax;
  p.attackRating = s.attackRating;
  p.defense = s.defense;
  p.maxLife = s.maxLife;
  p.maxMana = s.maxMana;
  p.swingEvery = s.swingEvery;
  p.magicFind = s.magicFind;
  p.speed = (4.5 / 25) * (1 + s.moveSpeedPct / 100);
  if (p.life > p.maxLife) p.life = p.maxLife;
  if (p.mana > p.maxMana) p.mana = p.maxMana;
}

export function applyDropItemInput(state: GameState, p: Player, input: PlayerInput): void {
  if (input.dropItem === undefined) return;
  const entry = removeEntry(p.inventory, input.dropItem);
  if (!entry) return;
  const pos = {
    x: p.pos.x + (state.rng.next() - 0.5) * 1.2,
    y: p.pos.y + (state.rng.next() - 0.5) * 1.2,
  };
  const id = state.nextId++;
  const zone = zoneOf(state, p);
  zone.groundItems.set(id, { id, item: entry.item, pos });
  state.events.push({
    type: "item_dropped",
    id,
    name: entry.item.name,
    rarity: entry.item.rarity,
    pos,
    zone: zone.id,
  });
}

const WEAR_CHANCE = 0.04;
const REPAIR_PER_POINT = 2;

/**
 * Gear wears with use: swings chew the weapon, taken hits chew the armor.
 * Runs once for the whole world, attributing each event to its own player.
 */
export function durabilitySystem(state: GameState): void {
  const broke = new Set<Player>();
  const wear = (
    p: Player,
    item: { durability?: { cur: number; max: number }; name: string } | null,
  ) => {
    if (!item?.durability || item.durability.cur <= 0) return;
    if (state.rng.next() < WEAR_CHANCE) {
      item.durability.cur--;
      if (item.durability.cur === 0) {
        broke.add(p);
        state.events.push({ type: "item_broke", playerId: p.id, name: item.name });
      }
    }
  };
  // Snapshot: wear pushes item_broke events we must not re-read.
  for (const e of [...state.events]) {
    if (e.type !== "player_swing" && e.type !== "player_hit") continue;
    const p = state.players.get(e.playerId);
    if (!p) continue;
    if (e.type === "player_swing") wear(p, p.equipment.weapon);
    else {
      wear(p, p.equipment.helm);
      wear(p, p.equipment.chest);
      wear(p, p.equipment.boots);
    }
  }
  for (const p of broke) recomputePlayerStats(state, p);
}

export function repairAllCost(state: GameState, p: Player): number {
  let missing = 0;
  for (const item of Object.values(p.equipment)) {
    if (item?.durability) missing += item.durability.max - item.durability.cur;
  }
  for (const entry of p.inventory.entries) {
    if (entry.item.durability) missing += entry.item.durability.max - entry.item.durability.cur;
  }
  return missing * REPAIR_PER_POINT;
}

export function repairAll(state: GameState, p: Player): boolean {
  const cost = repairAllCost(state, p);
  if (cost === 0 || p.gold < cost) return false;
  p.gold -= cost;
  for (const item of Object.values(p.equipment)) {
    if (item?.durability) item.durability.cur = item.durability.max;
  }
  for (const entry of p.inventory.entries) {
    if (entry.item.durability) entry.item.durability.cur = entry.item.durability.max;
  }
  recomputePlayerStats(state, p);
  state.events.push({ type: "repaired", playerId: p.id, cost });
  return true;
}

export function applyDrinkInput(state: GameState, p: Player, input: PlayerInput): void {
  if (!input.drink) return;
  if (p.belt <= 0 || p.life >= p.maxLife) return;
  p.belt--;
  const healed = Math.min(POTION_HEAL, p.maxLife - p.life);
  p.life += healed;
  state.events.push({ type: "potion_drunk", playerId: p.id, healed });
}

export function applyPickupInput(state: GameState, p: Player, input: PlayerInput): void {
  if (input.pickup === undefined) return;
  if (!zoneOf(state, p).groundItems.has(input.pickup)) return;
  p.pickupTarget = input.pickup;
  p.attackTarget = null;
  p.smashTarget = null;
  p.portalTarget = null;
  p.path = [];
}

export function pickupSystem(state: GameState, zone: ZoneState, players: Player[]): void {
  for (const p of players) {
    // Gold is scooped just by walking near it.
    for (const pile of [...zone.goldPiles.values()]) {
      if (Math.hypot(p.pos.x - pile.pos.x, p.pos.y - pile.pos.y) <= 0.7) {
        zone.goldPiles.delete(pile.id);
        p.gold += pile.amount;
        state.events.push({ type: "gold_picked", playerId: p.id, amount: pile.amount });
      }
    }
    if (p.pickupTarget === null) continue;
    const target = zone.groundItems.get(p.pickupTarget);
    if (!target) {
      p.pickupTarget = null;
      continue;
    }
    const d = Math.hypot(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
    if (d <= PICKUP_RANGE) {
      p.pickupTarget = null;
      p.path = [];
      const isPotion = BASES[target.item.baseId]!.slot === "potion";
      if (isPotion && p.belt < BELT_SIZE) {
        p.belt++;
        zone.groundItems.delete(target.id);
        state.events.push({
          type: "item_picked",
          playerId: p.id,
          id: target.id,
          name: target.item.name,
        });
      } else if (placeItem(p.inventory, target.id, target.item)) {
        zone.groundItems.delete(target.id);
        state.events.push({
          type: "item_picked",
          playerId: p.id,
          id: target.id,
          name: target.item.name,
        });
      } else {
        state.events.push({ type: "inventory_full", playerId: p.id });
      }
    } else if (p.path.length === 0) {
      const cells = findPath(
        zone.map,
        { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y) },
        { x: Math.floor(target.pos.x), y: Math.floor(target.pos.y) },
      );
      if (cells === null) {
        p.pickupTarget = null;
        continue;
      }
      p.path = smoothPath(zone.map, p.pos, cells);
      p.path.push({ ...target.pos });
    }
  }
}

export function applyEquipInput(state: GameState, p: Player, input: PlayerInput): void {
  if (input.equip !== undefined) {
    const entry = removeEntry(p.inventory, input.equip);
    if (!entry) return;
    const base = BASES[entry.item.baseId]!;
    if (base.slot === "potion") {
      if (p.belt < BELT_SIZE) p.belt++;
      else placeItem(p.inventory, entry.id, entry.item);
      return;
    }
    if (base.levelReq > p.level) {
      placeItem(p.inventory, entry.id, entry.item);
      return;
    }
    const slot = slotForItem(entry.item, p.equipment);
    const previous = p.equipment[slot];
    p.equipment[slot] = entry.item;
    if (previous) {
      if (!placeItem(p.inventory, state.nextId++, previous)) {
        // No room for the swapped-out item: revert the whole equip.
        p.equipment[slot] = previous;
        placeItem(p.inventory, entry.id, entry.item);
        return;
      }
    }
    recomputePlayerStats(state, p);
    state.events.push({ type: "item_equipped", playerId: p.id, slot });
  }

  if (input.unequip !== undefined) {
    const item = p.equipment[input.unequip];
    if (!item) return;
    if (!placeItem(p.inventory, state.nextId++, item)) return;
    p.equipment[input.unequip] = null;
    recomputePlayerStats(state, p);
    state.events.push({ type: "item_unequipped", playerId: p.id, slot: input.unequip });
  }
}
