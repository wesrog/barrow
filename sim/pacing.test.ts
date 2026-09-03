import { describe, expect, test } from "bun:test";
import { AREAS } from "./areas";
import { xpForLevel } from "./character";
import { MONSTER_TYPES, scaledMonsterStats } from "./monsters";
import { QUESTS } from "./quests";
import { MARKER_TYPES } from "./zone";

/** Level a character holding `totalXp` has reached. */
function levelAt(totalXp: number): number {
  let level = 1;
  while (totalXp >= xpForLevel(level + 1)) level++;
  return level;
}

/**
 * The surface never respawns monsters, so its regions plus quests are the
 * campaign's fixed xp pool. Estimate it from the data tables: every pack
 * marker spawns one monster drawn evenly from the region's spawn table, at a
 * band level between areaLevel and areaLevel + bandCap.
 */
function surfacePool(band: "near" | "far"): number {
  let total = 0;
  for (const def of Object.values(AREAS)) {
    const depth = def.areaLevel + (band === "far" ? def.bandCap : 0);
    const avg =
      def.spawnTable.reduce((sum, ch) => {
        const t = MONSTER_TYPES[MARKER_TYPES[ch]!]!;
        return sum + scaledMonsterStats(t, depth).xp;
      }, 0) / def.spawnTable.length;
    total += avg * def.gen.packs;
  }
  return total;
}

const questXp = Object.values(QUESTS).reduce((sum, q) => sum + (q.reward.xp ?? 0), 0);

// The guardrail for the whole rebalance: if new content or retuned numbers
// push these bands, pacing has changed — decide on purpose, not by accident.
describe("campaign pacing", () => {
  // Rebanded on purpose when the ashfell and hollowcrown extended the surface
  // east: two more level 10-13 regions grow the fixed pool by a few levels.
  test("clearing every surface region lands in the low-to-mid twenties", () => {
    const clear = levelAt(surfacePool("near"));
    expect(clear).toBeGreaterThanOrEqual(20);
    expect(clear).toBeLessThanOrEqual(25);
  });

  test("even a maximal clear plus every quest stays mid twenties", () => {
    expect(levelAt(surfacePool("far") + questXp)).toBeLessThanOrEqual(27);
  });

  test("level 31 demands crypt grinding beyond the fixed pool", () => {
    expect(xpForLevel(31)).toBeGreaterThan(surfacePool("far") + questXp);
  });

  test("quests fund a meaningful but minority share of the campaign", () => {
    expect(questXp).toBeGreaterThan(xpForLevel(8)); // worth several early levels
    expect(questXp).toBeLessThan(surfacePool("near") / 2); // kills stay the main course
  });
});
