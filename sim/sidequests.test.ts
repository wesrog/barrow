import { describe, expect, test } from "bun:test";
import { createGame, joinPlayer, stepSolo } from "./tick";
import { QUESTS, questOffered, objectiveMet } from "./quests";
import { NPCS } from "./npcs";
import { BASES } from "./items/bases";
import { getZone } from "./state";
import { spawnMonster } from "./monsters";
import type { GameState, Player } from "./state";
import type { NpcId } from "./npcs";

const SIDE = ["clearing_roads", "bloat_harvest", "ninth_sigils", "old_bones"] as const;

function nearNpc(state: GameState, p: Player, npcId: NpcId): void {
  const npc = [...getZone(state, "surface").npcs.values()].find((n) => n.npcId === npcId)!;
  p.zoneId = "surface";
  p.pos = { x: npc.pos.x + 0.5, y: npc.pos.y };
}

describe("side quest tables", () => {
  test("each side quest hangs off the main rail and nothing on the rail needs one", () => {
    for (const id of SIDE) {
      const q = QUESTS[id];
      expect(q.requires).toBeDefined();
      expect(SIDE).not.toContain(q.requires!);
    }
    // No main-rail quest requires a side quest — skipping them all stays legal.
    for (const q of Object.values(QUESTS)) {
      if ((SIDE as readonly string[]).includes(q.id)) continue;
      if (q.requires) expect(SIDE).not.toContain(q.requires);
    }
  });

  test("side collect quests drop bases that exist as quest items", () => {
    for (const id of SIDE) {
      const o = QUESTS[id].objective;
      if (o.kind !== "collect") continue;
      expect(BASES[o.itemBaseId]?.slot).toBe("quest");
    }
  });
});

describe("side quest flow", () => {
  test("maren offers the road work only after the redfen is found", () => {
    const state = createGame(2);
    const p = joinPlayer(state, { id: 0 });
    p.quests.moor_wights = { stage: "done", count: 8 };
    p.quests.grave_moss = { stage: "done", count: 0 };
    p.quests.find_redfen = { stage: "active", count: 0 };
    expect(questOffered(p, "maren")).toBe(null); // rail quest still under way
    p.quests.find_redfen = { stage: "done", count: 1 };
    expect(questOffered(p, "maren")).toBe("clearing_roads");
  });

  test("aldous offers the side work while the Barrow Lord hunt is still open", () => {
    const state = createGame(2);
    const p = joinPlayer(state, { id: 0 });
    p.quests.descend_barrow = { stage: "done", count: 1 };
    expect(questOffered(p, "aldous")).toBe("barrow_lord");
    p.quests.barrow_lord = { stage: "active", count: 0 };
    expect(questOffered(p, "aldous")).toBe("old_bones");
  });

  test("old bones counts bloats anywhere — surface or below", () => {
    const state = createGame(2);
    const p = joinPlayer(state, { id: 0 });
    p.quests.old_bones = { stage: "active", count: 0 };
    const zone = getZone(state, "surface");
    for (let i = 0; i < 10; i++) {
      const m = spawnMonster(state, zone, "tomb_bloat", { x: p.pos.x + 3, y: p.pos.y });
      m.life = 0;
      m.explode = undefined; // keep the test's player out of the blast math
      stepSolo(state, {});
    }
    expect(p.quests.old_bones!.count).toBe(10);
    expect(objectiveMet(p, "old_bones")).toBe(true);
  });

  test("ninth sigils accepts, drops from wights, and pays out on turn-in", () => {
    const state = createGame(2);
    const p = joinPlayer(state, { id: 0 });
    p.quests.soldiers_due = { stage: "done", count: 8 };
    nearNpc(state, p, "corvin");
    stepSolo(state, { acceptQuest: "ninth_sigils" });
    expect(p.quests.ninth_sigils).toEqual({ stage: "active", count: 0 });
    // The collection: sidestep drop rng by handing over the goods directly.
    for (let i = 0; i < 3; i++) {
      p.inventory.entries.push({
        id: state.nextId++, x: i, y: 0,
        item: { baseId: "ninth_sigil", rarity: "normal", name: "Sigil of the Ninth", affixIds: [], mods: [], ilvl: 1 },
      });
    }
    expect(objectiveMet(p, "ninth_sigils")).toBe(true);
    const gold = p.gold;
    stepSolo(state, { turnInQuest: "ninth_sigils" });
    expect(p.quests.ninth_sigils!.stage).toBe("done");
    expect(p.gold).toBe(gold + QUESTS.ninth_sigils.reward.gold!);
    // The sigils were handed over with the turn-in.
    expect(p.inventory.entries.filter((e) => e.item.baseId === "ninth_sigil")).toHaveLength(0);
  });
});
