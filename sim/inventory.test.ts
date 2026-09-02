import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone } from "./test-helpers";
import { BASE_STATS, INV_H, INV_W, placeItem } from "./character";
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
