import { BASES, potionKind } from "../items/bases";
import { rollItem, type Item, type Rarity } from "../items/generate";
import {
  getZone,
  zoneOf,
  type GameState,
  type Player,
  type PlayerInput,
  type Portal,
  type ZoneId,
  type ZoneState,
} from "../state";
import { placeItem, removeEntry } from "../character";
import { repairAll, stowPotion } from "./inventory";
import { findPath, smoothPath } from "../path";
import { approachPath } from "./movement";
import { isWalkable } from "../map";
import { inRect, worldCampRect } from "../surface";

/** How close you must stand to a portal before it whisks you away. */
const PORTAL_RANGE = 0.6;

/**
 * Standing on the moors camp's safe ground — where trading, healing, and repairs
 * live. The outposts have safe ground too, but no stalls, so the rect is named
 * rather than taken from whichever camp the player happens to be standing in.
 */
export function onCampGround(p: Player): boolean {
  return p.zoneId === "surface" && inRect(worldCampRect("overworld"), p.pos);
}

/** What the vendor thinks an item is worth. Selling pays a quarter of this. */
export function itemValue(item: Item): number {
  const base = BASES[item.baseId]!;
  if (base.slot === "quest") return 0;
  if (base.slot === "potion") return 25;
  const rarityMult: Record<Rarity, number> = { normal: 1, magic: 2.5, rare: 5, unique: 8 };
  return Math.floor((12 + base.levelReq * 8 + item.mods.length * 22) * rarityMult[item.rarity]);
}

const SHOP_BASES = [
  "rusted_blade",
  "hatchet",
  "war_maul",
  "twin_fang",
  "grave_scythe",
  "cracked_helm",
  "bone_visage",
  "rag_tunic",
  "studded_jerkin",
  "grave_plate",
  "worn_boots",
  "chain_greaves",
  "bone_ring",
  "grave_amulet",
  "dire_flail",
  "moon_glaive",
  "kingsbane",
  "iron_barbute",
  "wyrm_skull",
  "lamellar_coat",
  "bogsteel_plate",
  "marsh_striders",
  "cragwalkers",
  "wight_band",
  "howler_charm",
];

/** Refill Maren's stall for the arriving player. Runs when they walk into an
 * empty camp. Gear only — potions are Sera's trade now. */
export function restock(state: GameState, p: Player): void {
  const rng = state.rng;
  const ilvl = Math.max(1, p.level);
  const stock: GameState["shop"] = [];
  // Maren stocks what the buyer can grow into soon — not endgame steel at level 2.
  const pool = SHOP_BASES.filter((id) => BASES[id]!.levelReq <= p.level + 3);
  for (let i = 0; i < 6; i++) {
    const baseId = pool[rng.int(0, pool.length - 1)]!;
    // The last slot always carries something magic — the window-shopping hook.
    const rarity: Rarity = i === 5 || rng.next() < 0.35 ? "magic" : "normal";
    const item = rollItem(rng, baseId, ilvl, rarity);
    stock.push({ item, price: itemValue(item) });
  }
  state.shop = stock;
}

/** Sera's fixed potion prices — her supply never runs dry. */
export const POTION_PRICES = { health: 25, mana: 30 } as const;

/** Buy a potion from Sera: straight onto the belt, or into the pack if the row is full. */
export function applyBuyPotionInput(state: GameState, p: Player, input: PlayerInput): void {
  const kind = input.buyPotion;
  if (!kind || !onCampGround(p)) return;
  const price = POTION_PRICES[kind];
  if (p.gold < price) return;
  const baseId = kind === "mana" ? "minor_mana_potion" : "minor_potion";
  const item = rollItem(state.rng, baseId, 1, "normal");
  if (!stowPotion(p, kind) && !placeItem(p.inventory, state.nextId++, item)) {
    state.events.push({ type: "inventory_full", playerId: p.id });
    return;
  }
  p.gold -= price;
  state.events.push({ type: "bought", playerId: p.id, name: item.name, price });
}

export function applyShopInput(state: GameState, p: Player, input: PlayerInput): void {
  if (!onCampGround(p)) return;

  if (input.buy !== undefined) {
    const entry = state.shop[input.buy];
    if (entry && p.gold >= entry.price) {
      const kind = potionKind(entry.item.baseId);
      let delivered = false;
      if (kind && stowPotion(p, kind)) {
        delivered = true;
      } else {
        delivered = placeItem(p.inventory, state.nextId++, entry.item);
      }
      if (delivered) {
        p.gold -= entry.price;
        state.shop.splice(input.buy, 1);
        state.events.push({
          type: "bought",
          playerId: p.id,
          name: entry.item.name,
          price: entry.price,
        });
      }
    }
  }

  if (input.sell !== undefined) {
    const entry = p.inventory.entries.find((e) => e.id === input.sell);
    if (entry && BASES[entry.item.baseId]!.slot !== "quest") {
      removeEntry(p.inventory, entry.id);
      const price = Math.max(1, Math.floor(itemValue(entry.item) / 4));
      p.gold += price;
      state.events.push({ type: "sold", playerId: p.id, name: entry.item.name, price });
    }
  }

  if (input.repair) {
    repairAll(state, p);
  }
}

/** Remove both ends of every portal pair owned by this player, across all zones. */
export function removePortalsOwnedBy(state: GameState, owner: number): void {
  for (const zone of state.zones.values()) {
    for (const [id, portal] of zone.portals) {
      if (portal.owner === owner) zone.portals.delete(id);
    }
  }
}

/**
 * Deterministic scan for the camp end's cell: spawn, then +x, -x, +y, -y offsets.
 * Only avoids other portals — camp ground has no monsters or breakables to dodge.
 */
function findCampPortalSpot(surface: ZoneState): { x: number; y: number } {
  const spawn = surface.map.spawn; // the moors camp — the surface map's spawn
  const cx = Math.floor(spawn.x);
  const cy = Math.floor(spawn.y);
  const occupied = new Set(
    [...surface.portals.values()].map((p) => `${Math.floor(p.pos.x)},${Math.floor(p.pos.y)}`),
  );
  const candidates: [number, number][] = [
    [cx, cy],
    [cx + 1, cy],
    [cx - 1, cy],
    [cx, cy + 1],
    [cx, cy - 1],
  ];
  for (const [x, y] of candidates) {
    if (!isWalkable(surface.map, x, y)) continue;
    if (occupied.has(`${x},${y}`)) continue;
    return { x, y };
  }
  // Fall back to spawn itself — shouldn't happen on real maps.
  return { x: cx, y: cy };
}

/** `t`: cast a two-way portal pair between here and camp. No-op on camp ground or while dead. */
export function applyCastPortalInput(state: GameState, p: Player, input: PlayerInput): void {
  if (!input.townPortal || p.dead || onCampGround(p)) return;
  removePortalsOwnedBy(state, p.id);

  const here = zoneOf(state, p);
  const camp = getZone(state, "surface");
  const spot = findCampPortalSpot(camp);
  const campPos = { x: spot.x + 0.5, y: spot.y + 0.5 };
  const herePos = { x: Math.floor(p.pos.x) + 0.5, y: Math.floor(p.pos.y) + 0.5 };

  const hereId = state.nextId++;
  const campId = state.nextId++;
  const herePortal: Portal = {
    id: hereId,
    owner: p.id,
    pos: herePos,
    link: { zone: "surface", pos: campPos },
  };
  const campPortal: Portal = {
    id: campId,
    owner: p.id,
    pos: campPos,
    link: { zone: here.id, pos: herePos },
  };
  here.portals.set(hereId, herePortal);
  camp.portals.set(campId, campPortal);
  state.events.push({ type: "portal_cast", playerId: p.id, zone: here.id, pos: herePos });
}

/** Click a portal: start walking over to ride it. */
export function applyUsePortalInput(state: GameState, p: Player, input: PlayerInput): void {
  if (input.usePortal === undefined) return;
  if (!zoneOf(state, p).portals.has(input.usePortal)) return;
  p.portalTarget = input.usePortal;
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.npcTarget = null;
  p.reclaimTarget = null;
  p.castTarget = null;
  p.path = [];
}

/**
 * Walk toward a targeted portal; riding it teleports to the linked end (persistent —
 * not consumed). `travel` is injected by the caller (defined in `tick.ts`, which is
 * also where this system is wired in) so this module never has to import upward from
 * the orchestrator — the same reason `stairsSystem` lives in tick.ts
 * itself rather than here.
 */
export function portalSystem(
  state: GameState,
  zone: ZoneState,
  players: Player[],
  travel: (state: GameState, p: Player, to: ZoneId) => void,
): void {
  for (const p of players) {
    if (p.portalTarget === null) continue;
    const target = zone.portals.get(p.portalTarget);
    if (!target) {
      p.portalTarget = null;
      continue;
    }
    const d = Math.hypot(p.pos.x - target.pos.x, p.pos.y - target.pos.y);
    if (d <= PORTAL_RANGE) {
      p.portalTarget = null;
      p.path = [];
      const link = target.link;
      travel(state, p, link.zone);
      p.pos = { ...link.pos };
    } else if (p.path.length === 0) {
      const path = approachPath(zone.map, p.pos, target.pos);
      if (path === null || path.length === 0) {
        p.portalTarget = null;
        continue;
      }
      p.path = path;
    }
  }
}
