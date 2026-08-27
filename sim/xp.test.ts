import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { step } from "./tick";
import { createGameOn, playerZone, spawnAt } from "./test-helpers";
import { xpForLevel, LIFE_PER_LEVEL } from "./character";
import type { GameState } from "./state";

const openMap = () =>
  mapFromStrings([
    "########",
    "#@.....#",
    "#......#",
    "########",
  ]);

/** Kill a monster instantly by zeroing its life and stepping once. */
function slay(state: GameState, typeId: string): void {
  const m = spawnAt(state, typeId, { x: 5.5, y: 1.5 });
  m.life = 0;
  step(state, {});
}

describe("xp and leveling", () => {
  test("killing a monster grants its xp", () => {
    const state = createGameOn(1, openMap());
    expect(state.player.xp).toBe(0);
    slay(state, "skitter"); // xp 6
    expect(state.player.xp).toBe(6);
    expect(state.events.some((e) => e.type === "monster_died")).toBe(true);
  });

  test("xp thresholds grow with level", () => {
    expect(xpForLevel(2)).toBeGreaterThan(0);
    expect(xpForLevel(3)).toBeGreaterThan(xpForLevel(2));
    expect(xpForLevel(10)).toBeGreaterThan(xpForLevel(9));
  });

  test("crossing the threshold levels up: +1 skill point, more life, event", () => {
    const state = createGameOn(1, openMap());
    const before = state.player.maxLife;
    state.player.xp = xpForLevel(2) - 1;
    slay(state, "skitter");
    expect(state.player.level).toBe(2);
    expect(state.player.skillPoints).toBe(1);
    expect(state.player.maxLife).toBe(before + LIFE_PER_LEVEL);
    expect(state.events.some((e) => e.type === "level_up")).toBe(true);
  });

  test("a single large xp gain can grant multiple levels", () => {
    const state = createGameOn(1, openMap());
    state.player.xp = xpForLevel(3) - 1; // one skitter's 6 xp crosses 2 and 3
    slay(state, "skitter");
    expect(state.player.level).toBe(3);
    expect(state.player.skillPoints).toBe(2);
  });

  test("level bonus life survives equipment recompute", () => {
    const state = createGameOn(1, openMap());
    state.player.xp = xpForLevel(2) - 1;
    slay(state, "skitter");
    const after = state.player.maxLife;
    step(state, { unequip: "weapon" });
    expect(state.player.maxLife).toBe(after);
  });
});
