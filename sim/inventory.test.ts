import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { step } from "./tick";
import { createGameOn, playerZone, spawnAt } from "./test-helpers";
import { BASE_STATS, INV_H, INV_W, placeItem } from "./character";
import { recomputePlayerStats } from "./systems/inventory";
import type { Item } from "./items/generate";
import type { GameState } from "./state";

/** New game, but bare-handed: these tests reason about an empty weapon slot. */
function bareGame(seed: number): GameState {
  const state = createGameOn(seed, openMap());
  state.player.equipment.weapon = null;
  recomputePlayerStats(state);
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
  for (let i = 0; i < ticks; i++) step(state, {});
}

describe("pickup", () => {
  test("pickup input walks the player to the item and moves it into the inventory", () => {
    const state = createGameOn(42, openMap());
    const id = dropAt(state, plain("rusted_blade"), 7.5, 3.5);
    step(state, { pickup: id });
    run(state, 120);
    expect(playerZone(state).groundItems.size).toBe(0);
    expect(state.player.inventory.entries).toHaveLength(1);
    expect(state.player.inventory.entries[0]!.item.baseId).toBe("rusted_blade");
  });

  test("item stays on the ground when the inventory is full", () => {
    const state = createGameOn(42, openMap());
    for (let i = 0; i < INV_W * INV_H; i++) {
      placeItem(state.player.inventory, state.nextId++, plain("bone_ring"));
    }
    const id = dropAt(state, plain("rusted_blade"), 2.5, 1.5);
    step(state, { pickup: id });
    run(state, 120);
    expect(playerZone(state).groundItems.size).toBe(1);
    expect(playerZone(state).groundItems.get(id)).toBeDefined();
  });

  test("a move click cancels a pending pickup", () => {
    const state = createGameOn(42, openMap());
    const id = dropAt(state, plain("rusted_blade"), 7.5, 3.5);
    step(state, { pickup: id });
    step(state, { moveTo: { x: 1.5, y: 3.5 } });
    run(state, 120);
    expect(playerZone(state).groundItems.size).toBe(1);
  });
});

describe("equip", () => {
  test("equipping from the inventory applies weapon stats", () => {
    const state = bareGame(1);
    const id = state.nextId++;
    placeItem(state.player.inventory, id, plain("rusted_blade"));
    step(state, { equip: id });
    expect(state.player.equipment.weapon?.baseId).toBe("rusted_blade");
    expect(state.player.inventory.entries).toHaveLength(0);
    expect(state.player.dmgMin).toBe(1);
    expect(state.player.dmgMax).toBe(6);
  });

  test("equipping over an existing item swaps the old one into the inventory", () => {
    const state = bareGame(1);
    state.player.level = 5; // hatchet needs level 3
    const blade = state.nextId++;
    placeItem(state.player.inventory, blade, plain("rusted_blade"));
    step(state, { equip: blade });
    const hatchet = state.nextId++;
    placeItem(state.player.inventory, hatchet, plain("hatchet"));
    step(state, { equip: hatchet });
    expect(state.player.equipment.weapon?.baseId).toBe("hatchet");
    expect(state.player.inventory.entries).toHaveLength(1);
    expect(state.player.inventory.entries[0]!.item.baseId).toBe("rusted_blade");
  });

  test("equip and unequip emit events for the HUD", () => {
    const state = createGameOn(1, openMap());
    const id = state.nextId++;
    placeItem(state.player.inventory, id, plain("rusted_blade"));
    step(state, { equip: id });
    expect(state.events.some((e) => e.type === "item_equipped")).toBe(true);
    step(state, { unequip: "weapon" });
    expect(state.events.some((e) => e.type === "item_unequipped")).toBe(true);
  });

  test("equip is rejected below the base's level requirement", () => {
    const state = bareGame(1);
    const id = state.nextId++;
    placeItem(state.player.inventory, id, plain("war_maul")); // levelReq 8
    step(state, { equip: id });
    expect(state.player.equipment.weapon).toBeNull();
    expect(state.player.inventory.entries).toHaveLength(1);
  });

  test("a +life mod raises max life without healing", () => {
    const state = createGameOn(1, openMap());
    state.player.life = 30;
    const id = state.nextId++;
    placeItem(state.player.inventory, id, {
      ...plain("worn_boots"), // levelReq 1
      mods: [{ stat: "life", value: 15 }],
    });
    step(state, { equip: id });
    expect(state.player.maxLife).toBe(BASE_STATS.maxLife + 15);
    expect(state.player.life).toBe(30);
  });
});

describe("unequip", () => {
  test("unequip returns the item to the inventory and stats revert", () => {
    const state = bareGame(1);
    const id = state.nextId++;
    placeItem(state.player.inventory, id, plain("rusted_blade"));
    step(state, { equip: id });
    step(state, { unequip: "weapon" });
    expect(state.player.equipment.weapon).toBeNull();
    expect(state.player.inventory.entries).toHaveLength(1);
    expect(state.player.dmgMin).toBe(BASE_STATS.dmgMin);
  });

  test("unequip is refused when the inventory has no room", () => {
    const state = createGameOn(1, openMap());
    const id = state.nextId++;
    placeItem(state.player.inventory, id, plain("rusted_blade"));
    step(state, { equip: id });
    for (let i = 0; i < INV_W * INV_H; i++) {
      placeItem(state.player.inventory, state.nextId++, plain("bone_ring"));
    }
    step(state, { unequip: "weapon" });
    expect(state.player.equipment.weapon?.baseId).toBe("rusted_blade");
  });
});

describe("dropping items", () => {
  test("a dropped inventory item lands on the ground at the player's feet", () => {
    const state = createGameOn(1, openMap());
    const id = state.nextId++;
    placeItem(state.player.inventory, id, plain("rag_tunic"));
    step(state, { dropItem: id });
    expect(state.player.inventory.entries).toHaveLength(0);
    expect(playerZone(state).groundItems.size).toBe(1);
    const gi = [...playerZone(state).groundItems.values()][0]!;
    expect(gi.item.baseId).toBe("rag_tunic");
    expect(Math.hypot(gi.pos.x - state.player.pos.x, gi.pos.y - state.player.pos.y)).toBeLessThan(1.5);
  });

  test("dropping an unknown entry does nothing", () => {
    const state = createGameOn(1, openMap());
    step(state, { dropItem: 999 });
    expect(playerZone(state).groundItems.size).toBe(0);
  });
});
