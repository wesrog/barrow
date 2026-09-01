import { describe, expect, test } from "bun:test";
import { createGame, joinPlayer } from "./tick";
import {
  QUESTS, isQuestId, questOffered, questReadyToTurnIn, objectiveMet, npcIndicator,
} from "./quests";
import { NPCS } from "./npcs";

const hero = () => joinPlayer(createGame(1), { id: 0 });

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
