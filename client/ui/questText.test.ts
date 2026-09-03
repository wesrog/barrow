import { describe, expect, test } from "bun:test";
import { objectiveText, progressText, rewardText } from "./questText";
import { QUESTS } from "../../sim/quests";
import { soloGame, player } from "../../sim/test-helpers";

describe("objectiveText", () => {
  test("kill quests name the monster and count", () => {
    expect(objectiveText(QUESTS.moor_wights)).toBe("Slay 8 Shamblers on the surface");
    expect(objectiveText(QUESTS.barrow_lord)).toBe("Slay The Barrow Lord in The Barrow Crypt");
  });

  test("collect quests name the item and its source", () => {
    expect(objectiveText(QUESTS.grave_moss)).toBe("Gather 5 Grave-Moss from Shamblers");
  });

  test("reach quests name the area or floor", () => {
    expect(objectiveText(QUESTS.find_redfen)).toBe("Find The Redfen");
    expect(objectiveText(QUESTS.descend_barrow)).toBe("Descend to floor 3 of The Barrow Crypt");
  });

  test("talk quests name the NPC", () => {
    expect(objectiveText(QUESTS.meet_betha)).toBe("Speak with Odd Betha");
  });
});

describe("rewardText", () => {
  test("lists gold, xp, and any item", () => {
    expect(rewardText(QUESTS.moor_wights)).toBe("100 gold, 80 xp");
    expect(rewardText(QUESTS.howler_cull)).toBe("200 gold, 220 xp, magic Hatchet");
  });
});

describe("progressText", () => {
  test("counts kills for an active kill quest", () => {
    const p = player(soloGame(1));
    p.quests.moor_wights = { stage: "active", count: 3 };
    expect(progressText(p, "moor_wights")).toBe("3 / 8");
  });

  test("done quests read as complete", () => {
    const p = player(soloGame(1));
    p.quests.moor_wights = { stage: "done", count: 8 };
    expect(progressText(p, "moor_wights")).toBe("complete");
  });
});
