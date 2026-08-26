import type { GameState, PlayerInput } from "../state";
import {
  computeStats,
  placeItem,
  removeEntry,
  slotForItem,
} from "../character";
import { BASES } from "../items/bases";
import { findPath } from "../path";

const PICKUP_RANGE = 1.0;

/** Re-derive player combat stats from equipment. Current life never exceeds max. */
export function recomputePlayerStats(state: GameState): void {
  const p = state.player;
  const s = computeStats(p.equipment);
  p.dmgMin = s.dmgMin;
  p.dmgMax = s.dmgMax;
  p.attackRating = s.attackRating;
  p.defense = s.defense;
  p.maxLife = s.maxLife;
  p.swingEvery = s.swingEvery;
  p.magicFind = s.magicFind;
  p.speed = (4.5 / 25) * (1 + s.moveSpeedPct / 100);
  if (p.life > p.maxLife) p.life = p.maxLife;
}

export function applyPickupInput(state: GameState, input: PlayerInput): void {
  if (input.pickup === undefined) return;
  if (!state.groundItems.has(input.pickup)) return;
  state.player.pickupTarget = input.pickup;
  state.player.attackTarget = null;
  state.player.path = [];
}

export function pickupSystem(state: GameState): void {
  const p = state.player;
  if (p.pickupTarget === null) return;
  const target = state.groundItems.get(p.pickupTarget);
  if (!target) {
    p.pickupTarget = null;
    return;
  }
  const d = Math.hypot(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
  if (d <= PICKUP_RANGE) {
    p.pickupTarget = null;
    p.path = [];
    if (placeItem(p.inventory, target.id, target.item)) {
      state.groundItems.delete(target.id);
      state.events.push({ type: "item_picked", id: target.id, name: target.item.name });
    } else {
      state.events.push({ type: "inventory_full" });
    }
  } else if (p.path.length === 0) {
    const cells = findPath(
      state.map,
      { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y) },
      { x: Math.floor(target.pos.x), y: Math.floor(target.pos.y) },
    );
    if (cells === null) {
      p.pickupTarget = null;
      return;
    }
    p.path = cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
    p.path.push({ ...target.pos });
  }
}

export function applyEquipInput(state: GameState, input: PlayerInput): void {
  const p = state.player;
  if (input.equip !== undefined) {
    const entry = removeEntry(p.inventory, input.equip);
    if (!entry) return;
    const base = BASES[entry.item.baseId]!;
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
    recomputePlayerStats(state);
    state.events.push({ type: "item_equipped", slot });
  }

  if (input.unequip !== undefined) {
    const item = p.equipment[input.unequip];
    if (!item) return;
    if (!placeItem(p.inventory, state.nextId++, item)) return;
    p.equipment[input.unequip] = null;
    recomputePlayerStats(state);
    state.events.push({ type: "item_unequipped", slot: input.unequip });
  }
}
