import { BASES } from "../items/bases";
import { rollItem, type Item, type Rarity } from "../items/generate";
import { zoneOf, type GameState, type PlayerInput } from "../state";
import { BELT_SIZE, placeItem, removeEntry } from "../character";
import { repairAll } from "./inventory";
import { findPath, smoothPath } from "../path";

/** How close you must stand to Maren before he'll talk shop. */
const TALK_RANGE = 1.4;

/** What the vendor thinks an item is worth. Selling pays a quarter of this. */
export function itemValue(item: Item): number {
  const base = BASES[item.baseId]!;
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
];

/** Refill Maren's stall. Runs when a player arrives in an empty camp. */
export function restock(state: GameState): void {
  const rng = state.rng;
  const ilvl = Math.max(1, state.player.level);
  const stock: GameState["shop"] = [];
  for (let i = 0; i < 2; i++) {
    stock.push({ item: rollItem(rng, "minor_potion", 1, "normal"), price: 25 });
  }
  for (let i = 0; i < 4; i++) {
    const baseId = SHOP_BASES[rng.int(0, SHOP_BASES.length - 1)]!;
    // The last slot always carries something magic — the window-shopping hook.
    const rarity: Rarity = i === 3 || rng.next() < 0.35 ? "magic" : "normal";
    const item = rollItem(rng, baseId, ilvl, rarity);
    stock.push({ item, price: itemValue(item) });
  }
  state.shop = stock;
}

/** Click on Maren: start walking over to trade. */
export function applyTalkVendorInput(state: GameState, input: PlayerInput): void {
  if (!input.talkVendor || state.player.zoneId !== "camp") return;
  const p = state.player;
  p.vendorTarget = true;
  p.attackTarget = null;
  p.pickupTarget = null;
  p.smashTarget = null;
  p.path = [];
}

/** Walk toward the V marker; within talking range, the shop opens. */
export function vendorSystem(state: GameState): void {
  const p = state.player;
  if (!p.vendorTarget) return;
  const map = zoneOf(state, p).map;
  const marker = map.markers.find((m) => m.ch === "V");
  if (p.zoneId !== "camp" || !marker) {
    p.vendorTarget = false;
    return;
  }
  const d = Math.hypot(p.pos.x - marker.x, p.pos.y - marker.y);
  if (d <= TALK_RANGE) {
    p.vendorTarget = false;
    p.path = [];
    state.events.push({ type: "shop_opened" });
  } else if (p.path.length === 0) {
    const cells = findPath(
      map,
      { x: Math.floor(p.pos.x), y: Math.floor(p.pos.y) },
      { x: Math.floor(marker.x), y: Math.floor(marker.y) },
    );
    if (cells === null) {
      p.vendorTarget = false;
      return;
    }
    p.path = smoothPath(map, p.pos, cells);
    p.path.push({ x: marker.x, y: marker.y });
  }
}

export function applyShopInput(state: GameState, input: PlayerInput): void {
  if (state.player.zoneId !== "camp") return;
  const p = state.player;

  if (input.buy !== undefined) {
    const entry = state.shop[input.buy];
    if (entry && p.gold >= entry.price) {
      const isPotion = BASES[entry.item.baseId]!.slot === "potion";
      let delivered = false;
      if (isPotion && p.belt < BELT_SIZE) {
        p.belt++;
        delivered = true;
      } else {
        delivered = placeItem(p.inventory, state.nextId++, entry.item);
      }
      if (delivered) {
        p.gold -= entry.price;
        state.shop.splice(input.buy, 1);
        state.events.push({ type: "bought", name: entry.item.name, price: entry.price });
      }
    }
  }

  if (input.sell !== undefined) {
    const entry = removeEntry(p.inventory, input.sell);
    if (entry) {
      const price = Math.max(1, Math.floor(itemValue(entry.item) / 4));
      p.gold += price;
      state.events.push({ type: "sold", name: entry.item.name, price });
    }
  }

  if (input.repair) {
    repairAll(state);
  }
}
