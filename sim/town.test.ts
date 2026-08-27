import { describe, expect, test } from "bun:test";
import { player, soloGame } from "./test-helpers";
import { stepSolo, travel } from "./tick";
import { getZone } from "./state";
import { inCamp } from "./map";
import { placeItem } from "./character";
import type { GameState } from "./state";

/** The solo player back on safe camp ground (where every game begins). */
function goToCamp(state: GameState): void {
  travel(state, player(state), "overworld");
}

describe("the camp", () => {
  test("returning to camp leaves the floor persistent, not lost", () => {
    const state = soloGame(1);
    travel(state, player(state), "floor:1");
    const monstersBefore = [...getZone(state, "floor:1").monsters.keys()].sort();
    goToCamp(state);
    expect(player(state).zoneId).toBe("overworld");
    expect(inCamp(getZone(state, "overworld").map, player(state).pos)).toBe(true);
    expect(state.events.some((e) => e.type === "traveled" && e.to === "overworld")).toBe(true);

    // Walk onto the travel pad: back down to floor 1
    const pad = getZone(state, "overworld").map.markers.find((m) => m.ch === "P")!;
    player(state).pos = { x: pad.x, y: pad.y };
    stepSolo(state, {});
    expect(player(state).zoneId).toBe("floor:1");
    expect([...getZone(state, "floor:1").monsters.keys()].sort()).toEqual(monstersBefore);
  });

  test("a new run from camp regenerates floor 1", () => {
    const state = soloGame(1);
    stepSolo(state, { newGame: true });
    expect(player(state).zoneId).toBe("overworld");
    expect(inCamp(getZone(state, "overworld").map, player(state).pos)).toBe(true);
    expect(getZone(state, "floor:1").monsters.size).toBeGreaterThan(0);
  });
});

describe("talking to the vendor", () => {
  function vendorPos(state: GameState): { x: number; y: number } {
    const v = getZone(state, "overworld").map.markers.find((m) => m.ch === "V")!;
    return { x: v.x, y: v.y };
  }

  test("clicking Maren walks the hero over and opens the shop on arrival", () => {
    const state = soloGame(1);
    stepSolo(state, { talkVendor: true });
    expect(player(state).vendorTarget).toBe(true);
    let opened = false;
    for (let i = 0; i < 200 && !opened; i++) {
      stepSolo(state, {});
      opened = state.events.some((e) => e.type === "shop_opened");
    }
    expect(opened).toBe(true);
    expect(player(state).vendorTarget).toBe(false);
    const v = vendorPos(state);
    expect(Math.hypot(player(state).pos.x - v.x, player(state).pos.y - v.y)).toBeLessThanOrEqual(1.5);
  });

  test("talkVendor does nothing down in the crypt", () => {
    const state = soloGame(1);
    travel(state, player(state), "floor:1");
    stepSolo(state, { talkVendor: true });
    expect(player(state).vendorTarget).toBe(false);
  });

  test("walking somewhere else cancels the approach", () => {
    const state = soloGame(1);
    stepSolo(state, { talkVendor: true });
    expect(player(state).vendorTarget).toBe(true);
    stepSolo(state, { moveTo: { x: player(state).pos.x, y: player(state).pos.y } });
    expect(player(state).vendorTarget).toBe(false);
  });
});

describe("the healer", () => {
  function healerPos(state: GameState): { x: number; y: number } {
    const h = getZone(state, "overworld").map.markers.find((m) => m.ch === "H")!;
    return { x: h.x, y: h.y };
  }

  test("clicking Sera walks the hero over; arrival restores life and mana", () => {
    const state = soloGame(1);
    player(state).life = 1;
    player(state).mana = 0;
    stepSolo(state, { talkHealer: true });
    expect(player(state).healerTarget).toBe(true);
    let healed = false;
    for (let i = 0; i < 200 && !healed; i++) {
      stepSolo(state, {});
      healed = state.events.some((e) => e.type === "healed");
    }
    expect(healed).toBe(true);
    expect(player(state).life).toBe(player(state).maxLife);
    expect(player(state).mana).toBe(player(state).maxMana);
    expect(player(state).healerTarget).toBe(false);
    const h = healerPos(state);
    expect(Math.hypot(player(state).pos.x - h.x, player(state).pos.y - h.y)).toBeLessThanOrEqual(
      1.5,
    );
  });

  test("talkHealer does nothing down in the crypt", () => {
    const state = soloGame(1);
    travel(state, player(state), "floor:1");
    stepSolo(state, { talkHealer: true });
    expect(player(state).healerTarget).toBe(false);
  });

  test("walking somewhere else cancels the approach", () => {
    const state = soloGame(1);
    stepSolo(state, { talkHealer: true });
    expect(player(state).healerTarget).toBe(true);
    stepSolo(state, { moveTo: { x: player(state).pos.x, y: player(state).pos.y } });
    expect(player(state).healerTarget).toBe(false);
  });
});

describe("the vendor", () => {
  test("a fresh game stocks the stall for the first arrival", () => {
    const state = soloGame(1);
    stepSolo(state, {});
    expect(state.shop.length).toBeGreaterThanOrEqual(5);
    for (const entry of state.shop) expect(entry.price).toBeGreaterThan(0);
  });

  test("walking back into an empty camp restocks; an occupied camp keeps its stock", () => {
    const state = soloGame(1);
    stepSolo(state, {});
    travel(state, player(state), "floor:1");
    state.shop = [];
    goToCamp(state);
    stepSolo(state, {});
    expect(state.shop.length).toBeGreaterThanOrEqual(5);
  });

  test("buying deducts gold and delivers the item; broke players are refused", () => {
    const state = soloGame(1);
    stepSolo(state, {});
    const first = state.shop[0]!;
    player(state).gold = first.price;
    const invBefore = player(state).inventory.entries.length + player(state).belt;
    stepSolo(state, { buy: 0 });
    expect(player(state).gold).toBe(0);
    expect(player(state).inventory.entries.length + player(state).belt).toBe(invBefore + 1);
    const stillCosts = state.shop[0];
    if (stillCosts) {
      stepSolo(state, { buy: 0 });
      expect(player(state).inventory.entries.length + player(state).belt).toBe(invBefore + 1);
    }
  });

  test("selling pays out and removes the item", () => {
    const state = soloGame(1);
    const id = state.nextId++;
    placeItem(player(state).inventory, id, {
      baseId: "rag_tunic",
      rarity: "magic",
      name: "Sturdy Rag Tunic",
      affixIds: ["sturdy"],
      mods: [{ stat: "defense", value: 5 }],
      ilvl: 3,
    });
    stepSolo(state, { sell: id });
    expect(player(state).inventory.entries).toHaveLength(0);
    expect(player(state).gold).toBeGreaterThan(0);
  });

  test("repair only works on camp ground", () => {
    const state = soloGame(1);
    travel(state, player(state), "floor:1");
    player(state).equipment.weapon!.durability!.cur = 1;
    player(state).gold = 1000;
    stepSolo(state, { repair: true });
    expect(player(state).equipment.weapon!.durability!.cur).toBe(1); // not in camp
    goToCamp(state);
    stepSolo(state, { repair: true });
    expect(player(state).equipment.weapon!.durability!.cur).toBe(
      player(state).equipment.weapon!.durability!.max,
    );

    // Standing on the moors outside the palisade is not camp ground either.
    const map = getZone(state, "overworld").map;
    player(state).equipment.weapon!.durability!.cur = 1;
    player(state).pos = { x: map.camp!.x1 + 2.5, y: player(state).pos.y };
    stepSolo(state, { repair: true });
    expect(player(state).equipment.weapon!.durability!.cur).toBe(1);
  });
});
