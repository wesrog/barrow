import { describe, expect, test } from "bun:test";
import { NPCS, NPC_IDS, npcIdleLines } from "./npcs";
import { QUESTS } from "./quests";
import type { QuestLog } from "./quests";

describe("reactive idle dialogue", () => {
  test("reactive rows reference real quests and carry lines", () => {
    for (const id of NPC_IDS) {
      for (const r of NPCS[id].reactive ?? []) {
        const q = r.when.questDone ?? r.when.questActive;
        expect(q && q in QUESTS).toBe(true);
        expect(r.lines.length).toBeGreaterThan(0);
      }
    }
  });

  test("a fresh hero hears plain idle chatter", () => {
    const log: QuestLog = {};
    expect(npcIdleLines(log, "maren")).toEqual(NPCS.maren.idle);
  });

  test("the world reacts: a slain Barrow Lord changes the camp's talk", () => {
    const log: QuestLog = { barrow_lord: { stage: "done", count: 1 } };
    for (const id of ["maren", "aldous"] as const) {
      const lines = npcIdleLines(log, id);
      expect(lines).not.toEqual(NPCS[id].idle);
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  test("an active quest condition matches only while active", () => {
    const active: QuestLog = { barrow_lord: { stage: "active", count: 0 } };
    const done: QuestLog = { barrow_lord: { stage: "done", count: 1 } };
    const whileHunting = npcIdleLines(active, "aldous");
    const afterKill = npcIdleLines(done, "aldous");
    expect(whileHunting).not.toEqual(afterKill);
  });

  test("the first matching row wins, so late-game lines outrank early ones", () => {
    for (const id of NPC_IDS) {
      const rows = NPCS[id].reactive ?? [];
      if (rows.length < 2) continue;
      // Satisfy as many rows as one log can (two rows may key opposite states
      // of the same quest — the earlier row's state stands); the helper must
      // still return the first row's lines.
      const log: QuestLog = {};
      for (const r of rows) {
        const q = r.when.questDone ?? r.when.questActive!;
        if (log[q]) continue;
        log[q] = { stage: r.when.questDone ? "done" : "active", count: 0 };
      }
      expect(npcIdleLines(log, id)).toEqual(rows[0]!.lines);
    }
  });
});
