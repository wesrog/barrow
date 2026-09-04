import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone } from "./test-helpers";
import { BASE_STATS, INV_H, INV_W, placeItem, sortInventory } from "./character";
import { BASES } from "./items/bases";
import { recomputePlayerStats } from "./systems/inventory";
import type { Item } from "./items/generate";
import type { GameState } from "./state";

/** New game, but bare-handed: these tests reason about an empty weapon slot. */
function bareGame(seed: number): GameState {
  const state = createGameOn(seed, openMap());
  player(state).equipment.weapon = null;
  recomputePlayerStats(state, player(state));
  return state;
}

const openMap = () =>
  mapFromStrings([
    "##########",
    "#@.......#",
    "#........#",
    "#........#",
    "##########",
  ]);

const plain = (baseId: string, name = baseId): Item => ({
  baseId,
  rarity: "normal",
  name,
  affixIds: [],
  mods: [],
  ilvl: 1,
});

function dropAt(state: GameState, item: Item, x: number, y: number): number {
  const id = state.nextId++;
  playerZone(state).groundItems.set(id, { id, item, pos: { x, y } });
  return id;
}

function run(state: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepSolo(state, {});
}

describe("pickup", () => {
  test("pickup input walks the player to the item and moves it into the inventory", () => {
    const state = createGameOn(42, openMap());
    const id = dropAt(state, plain("rusted_blade"), 7.5, 3.5);
    stepSolo(state, { pickup: id });
    run(state, 120);
    expect(playerZone(state).groundItems.size).toBe(0);
    expect(player(state).inventory.entries).toHaveLength(1);
    expect(player(state).inventory.entries[0]!.item.baseId).toBe("rusted_blade");
  });

  test("item stays on the ground when the inventory is full", () => {
    const state = createGameOn(42, openMap());
    for (let i = 0; i < INV_W * INV_H; i++) {
      placeItem(player(state).inventory, state.nextId++, plain("bone_ring"));
    }
    const id = dropAt(state, plain("rusted_blade"), 2.5, 1.5);
    stepSolo(state, { pickup: id });
    run(state, 120);
    expect(playerZone(state).groundItems.size).toBe(1);
    expect(playerZone(state).groundItems.get(id)).toBeDefined();
  });

  test("a move click cancels a pending pickup", () => {
    const state = createGameOn(42, openMap());
    const id = dropAt(state, plain("rusted_blade"), 7.5, 3.5);
    stepSolo(state, { pickup: id });
    stepSolo(state, { moveTo: { x: 1.5, y: 3.5 } });
    run(state, 120);
    expect(playerZone(state).groundItems.size).toBe(1);
  });
});

describe("equip", () => {
  test("equipping from the inventory applies weapon stats", () => {
    const state = bareGame(1);
    const id = state.nextId++;
    placeItem(player(state).inventory, id, plain("rusted_blade"));
    stepSolo(state, { equip: id });
    expect(player(state).equipment.weapon?.baseId).toBe("rusted_blade");
    expect(player(state).inventory.entries).toHaveLength(0);
    expect(player(state).dmgMin).toBe(1);
    expect(player(state).dmgMax).toBe(6);
  });

  test("equipping over an existing item swaps the old one into the inventory", () => {
    const state = bareGame(1);
    player(state).level = 5; // hatchet needs level 3
    const blade = state.nextId++;
    placeItem(player(state).inventory, blade, plain("rusted_blade"));
    stepSolo(state, { equip: blade });
    const hatchet = state.nextId++;
    placeItem(player(state).inventory, hatchet, plain("hatchet"));
    stepSolo(state, { equip: hatchet });
    expect(player(state).equipment.weapon?.baseId).toBe("hatchet");
    expect(player(state).inventory.entries).toHaveLength(1);
    expect(player(state).inventory.entries[0]!.item.baseId).toBe("rusted_blade");
  });

  test("equip and unequip emit events for the HUD", () => {
    const state = createGameOn(1, openMap());
    const id = state.nextId++;
    placeItem(player(state).inventory, id, plain("rusted_blade"));
    stepSolo(state, { equip: id });
    expect(state.events.some((e) => e.type === "item_equipped")).toBe(true);
    stepSolo(state, { unequip: "weapon" });
    expect(state.events.some((e) => e.type === "item_unequipped")).toBe(true);
  });

  test("equip is rejected below the base's level requirement", () => {
    const state = bareGame(1);
    const id = state.nextId++;
    placeItem(player(state).inventory, id, plain("war_maul")); // levelReq 8
    stepSolo(state, { equip: id });
    expect(player(state).equipment.weapon).toBeNull();
    expect(player(state).inventory.entries).toHaveLength(1);
  });

  test("equip is rejected for another class's weapon", () => {
    const state = bareGame(1); // warrior by default
    const id = state.nextId++;
    placeItem(player(state).inventory, id, plain("gnarled_staff")); // witch-only
    stepSolo(state, { equip: id });
    expect(player(state).equipment.weapon).toBeNull();
    expect(player(state).inventory.entries).toHaveLength(1);
  });

  test("a witch equips her own class's weapon but not a warrior's", () => {
    const state = bareGame(1);
    player(state).klass = "witch";
    player(state).level = 10;
    const maulId = state.nextId++;
    placeItem(player(state).inventory, maulId, plain("war_maul")); // warrior-only
    stepSolo(state, { equip: maulId });
    expect(player(state).equipment.weapon).toBeNull();
    const staffId = state.nextId++;
    placeItem(player(state).inventory, staffId, plain("gnarled_staff"));
    stepSolo(state, { equip: staffId });
    expect(player(state).equipment.weapon?.baseId).toBe("gnarled_staff");
  });

  test("a +life mod raises max life without healing", () => {
    const state = createGameOn(1, openMap());
    player(state).life = 30;
    const id = state.nextId++;
    placeItem(player(state).inventory, id, {
      ...plain("worn_boots"), // levelReq 1
      mods: [{ stat: "life", value: 15 }],
    });
    stepSolo(state, { equip: id });
    expect(player(state).maxLife).toBe(BASE_STATS.maxLife + 15);
    expect(player(state).life).toBe(30);
  });
});

describe("unequip", () => {
  test("unequip returns the item to the inventory and stats revert", () => {
    const state = bareGame(1);
    const id = state.nextId++;
    placeItem(player(state).inventory, id, plain("rusted_blade"));
    stepSolo(state, { equip: id });
    stepSolo(state, { unequip: "weapon" });
    expect(player(state).equipment.weapon).toBeNull();
    expect(player(state).inventory.entries).toHaveLength(1);
    expect(player(state).dmgMin).toBe(BASE_STATS.dmgMin);
  });

  test("unequip is refused when the inventory has no room", () => {
    const state = createGameOn(1, openMap());
    const id = state.nextId++;
    placeItem(player(state).inventory, id, plain("rusted_blade"));
    stepSolo(state, { equip: id });
    for (let i = 0; i < INV_W * INV_H; i++) {
      placeItem(player(state).inventory, state.nextId++, plain("bone_ring"));
    }
    stepSolo(state, { unequip: "weapon" });
    expect(player(state).equipment.weapon?.baseId).toBe("rusted_blade");
  });
});

describe("dropping items", () => {
  test("a dropped inventory item lands on the ground at the player's feet", () => {
    const state = createGameOn(1, openMap());
    const id = state.nextId++;
    placeItem(player(state).inventory, id, plain("rag_tunic"));
    stepSolo(state, { dropItem: id });
    expect(player(state).inventory.entries).toHaveLength(0);
    expect(playerZone(state).groundItems.size).toBe(1);
    const gi = [...playerZone(state).groundItems.values()][0]!;
    expect(gi.item.baseId).toBe("rag_tunic");
    expect(Math.hypot(gi.pos.x - player(state).pos.x, gi.pos.y - player(state).pos.y)).toBeLessThan(1.5);
  });

  test("dropping an unknown entry does nothing", () => {
    const state = createGameOn(1, openMap());
    stepSolo(state, { dropItem: 999 });
    expect(playerZone(state).groundItems.size).toBe(0);
  });
});

describe("sorting", () => {
  const rare = (baseId: string): Item => ({ ...plain(baseId), rarity: "rare", name: `Rare ${baseId}` });

  test("sortInventory packs a scattered pack tight against the top-left, big items first", () => {
    const state = createGameOn(7, openMap());
    const inv = player(state).inventory;
    inv.entries.push({ id: 1, item: plain("bone_ring"), x: 9, y: 3 });
    inv.entries.push({ id: 2, item: plain("cracked_helm"), x: 5, y: 1 });
    inv.entries.push({ id: 3, item: plain("rusted_blade"), x: 2, y: 0 });
    inv.entries.push({ id: 4, item: plain("minor_potion"), x: 0, y: 3 });
    expect(sortInventory(inv)).toBe(true);
    const at = (id: number) => inv.entries.find((e) => e.id === id)!;
    expect({ x: at(3).x, y: at(3).y }).toEqual({ x: 0, y: 0 }); // 1x3 blade leads
    expect({ x: at(2).x, y: at(2).y }).toEqual({ x: 1, y: 0 }); // 2x2 helm beside it
    expect(inv.entries.length).toBe(4);
    // Every entry keeps its id and item; nothing overlaps or leaves the grid.
    const cells = new Set<string>();
    for (const e of inv.entries) {
      const base = BASES[e.item.baseId]!;
      for (let dy = 0; dy < base.h; dy++)
        for (let dx = 0; dx < base.w; dx++) {
          const k = `${e.x + dx},${e.y + dy}`;
          expect(cells.has(k)).toBe(false);
          cells.add(k);
          expect(e.x + dx).toBeLessThan(INV_W);
          expect(e.y + dy).toBeLessThan(INV_H);
        }
    }
  });

  test("within a size, gear groups by slot and the best rarity leads", () => {
    const state = createGameOn(7, openMap());
    const inv = player(state).inventory;
    inv.entries.push({ id: 1, item: plain("worn_boots"), x: 0, y: 0 });
    inv.entries.push({ id: 2, item: rare("cracked_helm"), x: 2, y: 0 });
    inv.entries.push({ id: 3, item: plain("cracked_helm"), x: 4, y: 0 });
    inv.entries.push({ id: 4, item: rare("worn_boots"), x: 6, y: 0 });
    expect(sortInventory(inv)).toBe(true);
    const order = [...inv.entries].sort((a, b) => a.y - b.y || a.x - b.x).map((e) => e.id);
    expect(order).toEqual([2, 3, 4, 1]);
  });

  test("a pack that only fit by luck is left alone rather than spilled", () => {
    const state = createGameOn(7, openMap());
    const inv = player(state).inventory;
    // Fill the whole 10x4 grid with 1x1 rings: any re-pack must still fit all 40.
    for (let i = 0; i < INV_W * INV_H; i++) {
      inv.entries.push({ id: i, item: plain("bone_ring"), x: i % INV_W, y: Math.floor(i / INV_W) });
    }
    const before = inv.entries.map((e) => ({ ...e }));
    expect(sortInventory(inv)).toBe(true);
    expect(inv.entries.length).toBe(INV_W * INV_H);
    // Hand-packed full grid: sort keeps every id, and all still fit.
    expect(new Set(inv.entries.map((e) => e.id)).size).toBe(before.length);
  });

  test("sortPack input tidies the pack through the tick; sortStash the stash", () => {
    const state = createGameOn(7, openMap());
    const p = player(state);
    p.inventory.entries.push({ id: 1, item: plain("bone_ring"), x: 9, y: 3 });
    p.inventory.entries.push({ id: 2, item: plain("rusted_blade"), x: 4, y: 0 });
    p.stash.entries.push({ id: 3, item: plain("bone_ring"), x: 9, y: 7 });
    stepSolo(state, { sortPack: true });
    expect(p.inventory.entries.find((e) => e.id === 2)).toMatchObject({ x: 0, y: 0 });
    expect(p.inventory.entries.find((e) => e.id === 1)).toMatchObject({ x: 1, y: 0 });
    expect(p.stash.entries[0]).toMatchObject({ x: 9, y: 7 });
    stepSolo(state, { sortStash: true });
    expect(p.stash.entries[0]).toMatchObject({ x: 0, y: 0 });
  });

  test("sorting is deterministic: same pack in any entry order lands the same layout", () => {
    const build = (order: number[]) => {
      const state = createGameOn(7, openMap());
      const inv = player(state).inventory;
      const items: Record<number, Item> = {
        1: plain("bone_ring"),
        2: rare("cracked_helm"),
        3: plain("rusted_blade"),
        4: plain("minor_potion"),
        5: plain("rag_tunic"),
      };
      for (const id of order) inv.entries.push({ id, item: items[id]!, x: 0, y: 0 });
      sortInventory(inv);
      return [...inv.entries].sort((a, b) => a.id - b.id).map((e) => [e.id, e.x, e.y]);
    };
    expect(build([1, 2, 3, 4, 5])).toEqual(build([5, 3, 1, 4, 2]));
  });
});
