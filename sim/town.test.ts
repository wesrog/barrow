import { describe, expect, test } from "bun:test";
import { createGame, step } from "./tick";
import { cryptZone, townZone } from "./zone";
import { placeItem } from "./character";
import type { GameState } from "./state";

function inTown(state: GameState): boolean {
  return state.town !== null;
}

function goToTown(state: GameState): void {
  step(state, { townPortal: true });
}

function padPos(state: GameState): { x: number; y: number } {
  const pad = state.map.markers.find((m) => m.ch === "P")!;
  return { x: pad.x, y: pad.y };
}

describe("town portal", () => {
  test("t sends you to town; the dungeon is frozen, not lost", () => {
    const state = createGame(1, cryptZone());
    const monstersBefore = [...state.monsters.keys()].sort();
    const posBefore = { ...state.player.pos };
    goToTown(state);
    expect(inTown(state)).toBe(true);
    expect(state.monsters.size).toBe(0); // town is safe
    expect(state.events.some((e) => e.type === "portal" && e.to === "town")).toBe(true);

    // Walk onto the return pad
    state.player.pos = padPos(state);
    step(state, {});
    expect(inTown(state)).toBe(false);
    expect(state.player.pos).toEqual(posBefore);
    expect([...state.monsters.keys()].sort()).toEqual(monstersBefore);
  });

  test("the town map has a vendor and a portal pad and no monster markers", () => {
    const map = townZone();
    expect(map.markers.some((m) => m.ch === "V")).toBe(true);
    expect(map.markers.some((m) => m.ch === "P")).toBe(true);
    const state = createGame(2, map);
    expect(state.monsters.size).toBe(0);
  });

  test("a new run from town lands back in the crypt at depth 1", () => {
    const state = createGame(1, cryptZone());
    goToTown(state);
    step(state, { newGame: true });
    expect(inTown(state)).toBe(false);
    expect(state.depth).toBe(1);
    expect(state.monsters.size).toBeGreaterThan(0);
  });
});

describe("talking to the vendor", () => {
  function vendorPos(state: GameState): { x: number; y: number } {
    const v = state.map.markers.find((m) => m.ch === "V")!;
    return { x: v.x, y: v.y };
  }

  test("clicking Maren walks the hero over and opens the shop on arrival", () => {
    const state = createGame(1, cryptZone());
    goToTown(state);
    step(state, { talkVendor: true });
    expect(state.player.vendorTarget).toBe(true);
    let opened = false;
    for (let i = 0; i < 200 && !opened; i++) {
      step(state, {});
      opened = state.events.some((e) => e.type === "shop_opened");
    }
    expect(opened).toBe(true);
    expect(state.player.vendorTarget).toBe(false);
    const v = vendorPos(state);
    expect(Math.hypot(state.player.pos.x - v.x, state.player.pos.y - v.y)).toBeLessThanOrEqual(1.5);
  });

  test("talkVendor does nothing down in the crypt", () => {
    const state = createGame(1, cryptZone());
    step(state, { talkVendor: true });
    expect(state.player.vendorTarget).toBe(false);
  });

  test("walking somewhere else cancels the approach", () => {
    const state = createGame(1, cryptZone());
    goToTown(state);
    step(state, { talkVendor: true });
    expect(state.player.vendorTarget).toBe(true);
    step(state, { moveTo: { x: state.player.pos.x, y: state.player.pos.y } });
    expect(state.player.vendorTarget).toBe(false);
  });
});

describe("the vendor", () => {
  test("entering town stocks the shop", () => {
    const state = createGame(1, cryptZone());
    goToTown(state);
    expect(state.shop.length).toBeGreaterThanOrEqual(5);
    for (const entry of state.shop) expect(entry.price).toBeGreaterThan(0);
  });

  test("buying deducts gold and delivers the item; broke players are refused", () => {
    const state = createGame(1, cryptZone());
    goToTown(state);
    const first = state.shop[0]!;
    state.player.gold = first.price;
    const invBefore = state.player.inventory.entries.length + state.player.belt;
    step(state, { buy: 0 });
    expect(state.player.gold).toBe(0);
    expect(state.player.inventory.entries.length + state.player.belt).toBe(invBefore + 1);
    const stillCosts = state.shop[0];
    if (stillCosts) {
      step(state, { buy: 0 });
      expect(state.player.inventory.entries.length + state.player.belt).toBe(invBefore + 1);
    }
  });

  test("selling pays out and removes the item", () => {
    const state = createGame(1, cryptZone());
    goToTown(state);
    const id = state.nextId++;
    placeItem(state.player.inventory, id, {
      baseId: "rag_tunic",
      rarity: "magic",
      name: "Sturdy Rag Tunic",
      affixIds: ["sturdy"],
      mods: [{ stat: "defense", value: 5 }],
      ilvl: 3,
    });
    step(state, { sell: id });
    expect(state.player.inventory.entries).toHaveLength(0);
    expect(state.player.gold).toBeGreaterThan(0);
  });

  test("repair only works in town", () => {
    const state = createGame(1, cryptZone());
    state.player.equipment.weapon!.durability!.cur = 1;
    state.player.gold = 1000;
    step(state, { repair: true });
    expect(state.player.equipment.weapon!.durability!.cur).toBe(1); // not in town
    goToTown(state);
    step(state, { repair: true });
    expect(state.player.equipment.weapon!.durability!.cur).toBe(
      state.player.equipment.weapon!.durability!.max,
    );
  });
});
