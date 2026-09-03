import { describe, expect, test } from "bun:test";
import { player, soloGame } from "./test-helpers";
import { ensureDungeonFloor, stepSolo, travel } from "./tick";
import { getZone } from "./state";
import { inCamp } from "./map";
import { placeItem } from "./character";
import type { GameState } from "./state";
import { NPC_TALK_RANGE } from "./systems/quests";

/** The solo player back on safe camp ground (where every game begins). */
function goToCamp(state: GameState): void {
  travel(state, player(state), "surface");
}

describe("the camp", () => {
  test("returning to camp leaves the floor persistent, not lost", () => {
    const state = soloGame(1);
    travel(state, player(state), "dungeon:barrow:1");
    const monstersBefore = [...getZone(state, "dungeon:barrow:1").monsters.keys()].sort();
    goToCamp(state);
    expect(player(state).zoneId).toBe("surface");
    expect(inCamp(getZone(state, "surface").map, player(state).pos)).toBe(true);
    expect(state.events.some((e) => e.type === "traveled" && e.to === "surface")).toBe(true);

    // Walk into the barrow mouth: back down to floor 1
    const mouth = getZone(state, "surface").map.markers.find((m) => m.ch === ">")!;
    player(state).pos = { x: mouth.x, y: mouth.y };
    stepSolo(state, {});
    expect(player(state).zoneId).toBe("dungeon:barrow:1");
    expect([...getZone(state, "dungeon:barrow:1").monsters.keys()].sort()).toEqual(monstersBefore);
  });

  test("a new run from camp regenerates floor 1", () => {
    const state = soloGame(1);
    stepSolo(state, { newGame: true });
    expect(player(state).zoneId).toBe("surface");
    expect(inCamp(getZone(state, "surface").map, player(state).pos)).toBe(true);
    // Floors are lazy now: the fresh world regenerates the barrow on entry.
    expect(state.zones.has("dungeon:barrow:1")).toBe(false);
    expect(ensureDungeonFloor(state, "barrow", 1).monsters.size).toBeGreaterThan(0);
  });
});

describe("talking to an npc", () => {
  test("clicking an npc walks over and opens talk", () => {
    const state = soloGame(5);
    const p = player(state);
    const surface = getZone(state, "surface");
    const maren = [...surface.npcs.values()].find((n) => n.npcId === "maren")!;
    p.pos = { x: maren.pos.x + 3, y: maren.pos.y };
    stepSolo(state, { talkNpc: maren.id });
    // walk until within range (bounded loop so a pathing bug fails, not hangs)
    for (let i = 0; i < 200 && !state.events.some((e) => e.type === "npc_talk"); i++) {
      stepSolo(state, {});
    }
    const talk = state.events.find((e) => e.type === "npc_talk");
    expect(talk).toMatchObject({ playerId: 0, npcId: "maren" });
    expect(Math.hypot(p.pos.x - maren.pos.x, p.pos.y - maren.pos.y)).toBeLessThanOrEqual(
      NPC_TALK_RANGE + 0.01,
    );
  });

  test("arriving at sera heals in full", () => {
    const state = soloGame(5);
    const p = player(state);
    const surface = getZone(state, "surface");
    const sera = [...surface.npcs.values()].find((n) => n.npcId === "sera")!;
    p.pos = { x: sera.pos.x + 0.5, y: sera.pos.y };
    p.life = 1;
    stepSolo(state, { talkNpc: sera.id });
    stepSolo(state, {});
    expect(p.life).toBe(p.maxLife);
  });

  test("talkNpc does nothing down in the crypt", () => {
    const state = soloGame(5);
    const surface = getZone(state, "surface");
    const maren = [...surface.npcs.values()].find((n) => n.npcId === "maren")!;
    travel(state, player(state), "dungeon:barrow:1");
    stepSolo(state, { talkNpc: maren.id });
    expect(player(state).npcTarget).toBe(null);
  });

  test("walking somewhere else cancels the approach", () => {
    const state = soloGame(5);
    const surface = getZone(state, "surface");
    const maren = [...surface.npcs.values()].find((n) => n.npcId === "maren")!;
    stepSolo(state, { talkNpc: maren.id });
    expect(player(state).npcTarget).toBe(maren.id);
    stepSolo(state, { moveTo: { x: player(state).pos.x, y: player(state).pos.y } });
    expect(player(state).npcTarget).toBe(null);
  });
});

describe("the healer", () => {
  test("buying potions fills the matching belt row and charges gold", () => {
    const state = soloGame(1);
    player(state).gold = 100;
    stepSolo(state, { buyPotion: "health" });
    expect(player(state).belt).toBe(1);
    expect(player(state).gold).toBe(75);
    stepSolo(state, { buyPotion: "mana" });
    expect(player(state).manaBelt).toBe(1);
    expect(player(state).gold).toBe(45);
    expect(state.events.filter((e) => e.type === "bought")).toHaveLength(1);
  });

  test("a full belt row spills potion purchases into the pack", () => {
    const state = soloGame(1);
    player(state).gold = 1000;
    player(state).belt = 4;
    stepSolo(state, { buyPotion: "health" });
    expect(player(state).belt).toBe(4);
    expect(player(state).inventory.entries).toHaveLength(1);
  });

  test("potion purchases are refused in the crypt and when broke", () => {
    const state = soloGame(1);
    player(state).gold = 5;
    stepSolo(state, { buyPotion: "health" }); // broke
    expect(player(state).belt).toBe(0);
    expect(player(state).gold).toBe(5);
    player(state).gold = 100;
    travel(state, player(state), "dungeon:barrow:1");
    stepSolo(state, { buyPotion: "health" }); // not in camp
    expect(player(state).belt).toBe(0);
    expect(player(state).gold).toBe(100);
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
    travel(state, player(state), "dungeon:barrow:1");
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
    travel(state, player(state), "dungeon:barrow:1");
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
    const map = getZone(state, "surface").map;
    player(state).equipment.weapon!.durability!.cur = 1;
    player(state).pos = { x: map.camps[0]!.x1 + 2.5, y: player(state).pos.y };
    stepSolo(state, { repair: true });
    expect(player(state).equipment.weapon!.durability!.cur).toBe(1);
  });
});
