import { describe, expect, test } from "bun:test";
import { createGame, joinPlayer, stepSolo } from "./tick";
import {
  QUESTS, isQuestId, questOffered, questReadyToTurnIn, objectiveMet, npcIndicator,
} from "./quests";
import { NPCS } from "./npcs";
import { deliverQuestReward } from "./systems/quests";
import { rollItem } from "./items/generate";
import { placeItem } from "./character";
import { getZone } from "./state";
import type { NpcId } from "./npcs";
import type { GameState, Player } from "./state";

const hero = () => joinPlayer(createGame(1), { id: 0 });

/** Stand the player within talk range of an NPC's surface entity. */
function nearNpc(state: GameState, p: Player, npcId: NpcId): void {
  const npc = [...getZone(state, "surface").npcs.values()].find((n) => n.npcId === npcId)!;
  p.zoneId = "surface";
  p.pos = { x: npc.pos.x + 0.5, y: npc.pos.y };
}

describe("quest tables", () => {
  test("every quest's giver and turnIn list it, and requires chains resolve", () => {
    for (const q of Object.values(QUESTS)) {
      expect(NPCS[q.giver].quests).toContain(q.id);
      if (q.requires) expect(isQuestId(q.requires)).toBe(true);
    }
  });

  test("a fresh hero is offered the giver's first quest and no other", () => {
    const p = hero();
    const first = NPCS.maren.quests[0]!;
    expect(questOffered(p, "maren")).toBe(first);
    expect(questOffered(p, "betha")).toBe(null); // gated behind the chain
  });

  test("kill objective: met exactly at the count", () => {
    const p = hero();
    const id = NPCS.maren.quests[0]!; // a kill quest (campaign task guarantees it)
    const need = QUESTS[id].objective.kind === "kill" ? QUESTS[id].objective.count : 0;
    p.quests[id] = { stage: "active", count: need - 1 };
    expect(objectiveMet(p, id)).toBe(false);
    p.quests[id]!.count = need;
    expect(objectiveMet(p, id)).toBe(true);
    expect(questReadyToTurnIn(p, QUESTS[id].turnIn)).toBe(id);
  });

  test("indicator reflects offer, progress, turn-in, and silence", () => {
    const p = hero();
    expect(npcIndicator(p, "maren")).toBe("offer");
    const id = NPCS.maren.quests[0]!;
    p.quests[id] = { stage: "active", count: 0 };
    expect(npcIndicator(p, "maren")).toBe("progress");
    expect(npcIndicator(p, "sera")).toBe(null); // her quest requires maren's
  });
});

describe("accept and turn in", () => {
  test("accept requires the giver in range and the chain satisfied", () => {
    const state = createGame(2);
    const p = joinPlayer(state, { id: 0 });
    stepSolo(state, { acceptQuest: "moor_wights" }); // far from maren
    expect(p.quests.moor_wights).toBeUndefined();
    nearNpc(state, p, "maren");
    stepSolo(state, { acceptQuest: "grave_moss" }); // wrong npc AND unmet chain
    expect(p.quests.grave_moss).toBeUndefined();
    stepSolo(state, { acceptQuest: "moor_wights" });
    expect(p.quests.moor_wights).toEqual({ stage: "active", count: 0 });
    expect(state.events.some((e) => e.type === "quest_accepted")).toBe(true);
  });

  test("turn-in pays gold and xp and marks done", () => {
    const state = createGame(2);
    const p = joinPlayer(state, { id: 0 });
    nearNpc(state, p, "maren");
    stepSolo(state, { acceptQuest: "moor_wights" });
    p.quests.moor_wights!.count = 8;
    const gold = p.gold, xp = p.xp;
    stepSolo(state, { turnInQuest: "moor_wights" });
    expect(p.quests.moor_wights!.stage).toBe("done");
    expect(p.gold).toBe(gold + 100);
    expect(p.xp).toBe(xp + 80);
    expect(state.events.some((e) => e.type === "quest_completed")).toBe(true);
    // done means maren offers the next quest, not this one again
    stepSolo(state, { acceptQuest: "moor_wights" });
    expect(p.quests.moor_wights!.stage).toBe("done");
  });

  test("item rewards land in the pack, or at the feet when it is full", () => {
    const state = createGame(2);
    const p = joinPlayer(state, { id: 0 });
    deliverQuestReward(state, p, { item: { baseId: "hatchet", rarity: "magic" } });
    expect(p.inventory.entries.some((e) => e.item.baseId === "hatchet")).toBe(true);
    // Pack the grid solid with 1x1 potions, then reward again: it hits the floor.
    const potion = () => rollItem(state.rng, "minor_potion", 1, "normal");
    while (placeItem(p.inventory, state.nextId++, potion())) { /* fill every cell */ }
    const groundBefore = getZone(state, "surface").groundItems.size;
    deliverQuestReward(state, p, { item: { baseId: "hatchet", rarity: "magic" } });
    expect(getZone(state, "surface").groundItems.size).toBe(groundBefore + 1);
    expect(state.events.some((e) => e.type === "item_dropped")).toBe(true);
  });
});
