import { describe, expect, test } from "bun:test";
import { createGame, joinPlayer, stepSolo } from "./tick";
import {
  QUESTS, isQuestId, questOffered, questReadyToTurnIn, objectiveMet, npcIndicator,
} from "./quests";
import { NPCS } from "./npcs";
import { deliverQuestReward } from "./systems/quests";
import { itemValue } from "./systems/town";
import { rollItem } from "./items/generate";
import { placeItem } from "./character";
import { getZone } from "./state";
import { spawnMonster } from "./monsters";
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

describe("objective progress off the event stream", () => {
  test("kill quests count party kills in your zone, not elsewhere", () => {
    const state = createGame(3);
    const p0 = joinPlayer(state, { id: 0 });
    const p1 = joinPlayer(state, { id: 1 });
    p0.quests.moor_wights = { stage: "active", count: 0 };
    p1.quests.moor_wights = { stage: "active", count: 0 };
    const surface = getZone(state, "surface");
    const m = spawnMonster(state, surface, "shambler", { x: p0.pos.x + 1, y: p0.pos.y });
    m.life = 0;
    m.lastHitBy = 1; // the OTHER player lands the kill
    p1.zoneId = "floor:1"; // ...but p1 has left the zone: no credit for them
    stepSolo(state, {});
    expect(p0.quests.moor_wights!.count).toBe(1); // in-zone: shared credit
    expect(p1.quests.moor_wights!.count).toBe(0); // out of zone: none
    expect(state.events.some((e) => e.type === "quest_progress" && e.playerId === 0)).toBe(true);
  });

  test("kill counts cap at the objective and only tick while active", () => {
    const state = createGame(3);
    const p = joinPlayer(state, { id: 0 });
    p.quests.moor_wights = { stage: "active", count: 8 };
    const surface = getZone(state, "surface");
    const m = spawnMonster(state, surface, "shambler", { x: p.pos.x + 1, y: p.pos.y });
    m.life = 0;
    stepSolo(state, {});
    expect(p.quests.moor_wights!.count).toBe(8); // capped, no event
  });

  test("reach objectives complete from where the player stands", () => {
    const state = createGame(3);
    const p = joinPlayer(state, { id: 0 });
    p.quests.find_redfen = { stage: "active", count: 0 };
    p.pos = { x: 64.5, y: 45.5 }; // inside the redfen boundary
    p.region = "redfen"; // as regionSystem would stamp on crossing
    stepSolo(state, {});
    expect(p.quests.find_redfen!.count).toBe(1);
  });

  test("talk objectives complete on npc_talk", () => {
    const state = createGame(3);
    const p = joinPlayer(state, { id: 0 });
    p.quests.meet_betha = { stage: "active", count: 0 };
    nearNpc(state, p, "betha");
    const betha = [...getZone(state, "surface").npcs.values()].find((n) => n.npcId === "betha")!;
    stepSolo(state, { talkNpc: betha.id });
    stepSolo(state, {});
    expect(p.quests.meet_betha!.count).toBe(1);
  });

  test("active collect quests make matching kills drop the quest item", () => {
    const state = createGame(4);
    const p = joinPlayer(state, { id: 0 });
    p.quests.grave_moss = { stage: "active", count: 0 };
    const surface = getZone(state, "surface");
    // chance is 0.5 — kill until one drops; bounded so a broken roll fails loudly
    let dropped = false;
    for (let i = 0; i < 40 && !dropped; i++) {
      const m = spawnMonster(state, surface, "shambler", { x: p.pos.x + 2, y: p.pos.y });
      m.life = 0;
      stepSolo(state, {});
      dropped = [...surface.groundItems.values()].some((g) => g.item.baseId === "grave_moss");
    }
    expect(dropped).toBe(true);
  });

  test("no quest, no moss — and a full collection stops dropping more", () => {
    const state = createGame(4);
    const p = joinPlayer(state, { id: 0 });
    const surface = getZone(state, "surface");
    for (let i = 0; i < 40; i++) {
      const m = spawnMonster(state, surface, "shambler", { x: p.pos.x + 2, y: p.pos.y });
      m.life = 0;
      stepSolo(state, {});
    }
    expect([...surface.groundItems.values()].some((g) => g.item.baseId === "grave_moss")).toBe(false);
  });

  test("quest items cannot be sold or equipped and are worth nothing", () => {
    const state = createGame(4);
    const p = joinPlayer(state, { id: 0 });
    const item = rollItem(state.rng, "grave_moss", 1, "normal");
    expect(itemValue(item)).toBe(0);
    placeItem(p.inventory, state.nextId++, item);
    const entryId = p.inventory.entries[p.inventory.entries.length - 1]!.id;
    p.pos = { ...getZone(state, "surface").map.spawn }; // on camp ground
    p.wasInCamp = true;
    const before = p.inventory.entries.length;
    stepSolo(state, { sell: entryId });
    expect(p.inventory.entries.length).toBe(before); // still in the pack
    stepSolo(state, { equip: entryId });
    expect(p.inventory.entries.length).toBe(before); // not equipped either
  });
});
