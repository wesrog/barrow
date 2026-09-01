import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { createGame, joinPlayer, stepSolo } from "./tick";
import { createGameOn, player, spawnAt } from "./test-helpers";
import { xpForLevel, LIFE_PER_LEVEL } from "./character";
import { grantXp, highLevelTaper, xpPenalty, xpSystem } from "./systems/xp";
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
  stepSolo(state, {});
}

describe("xp and leveling", () => {
  test("killing a monster grants its xp", () => {
    const state = createGameOn(1, openMap());
    expect(player(state).xp).toBe(0);
    slay(state, "skitter"); // xp 6
    expect(player(state).xp).toBe(6);
    expect(state.events.some((e) => e.type === "monster_died")).toBe(true);
  });

  test("xp thresholds grow with level", () => {
    expect(xpForLevel(2)).toBeGreaterThan(0);
    expect(xpForLevel(3)).toBeGreaterThan(xpForLevel(2));
    expect(xpForLevel(10)).toBeGreaterThan(xpForLevel(9));
  });

  test("per-level price rises geometrically: the late game is a climb", () => {
    expect(xpForLevel(2)).toBe(40);
    for (let l = 3; l <= 40; l++) {
      const cost = xpForLevel(l) - xpForLevel(l - 1);
      const prev = xpForLevel(l - 1) - xpForLevel(l - 2);
      expect(cost).toBeGreaterThan(prev);
    }
    // Level 28 is a many-hours milestone, not an hour-one accident.
    expect(xpForLevel(28)).toBeGreaterThan(30_000);
    expect(xpForLevel(28)).toBeLessThan(60_000);
  });

  test("crossing the threshold levels up: +1 skill point, more life, event", () => {
    const state = createGameOn(1, openMap());
    const before = player(state).maxLife;
    player(state).xp = xpForLevel(2) - 1;
    slay(state, "skitter");
    expect(player(state).level).toBe(2);
    expect(player(state).skillPoints).toBe(1);
    expect(player(state).maxLife).toBe(before + LIFE_PER_LEVEL);
    expect(state.events.some((e) => e.type === "level_up")).toBe(true);
  });

  test("leveling up restores life and mana in full", () => {
    const state = createGameOn(1, openMap());
    player(state).xp = xpForLevel(2) - 1;
    player(state).life = 5;
    player(state).mana = 0;
    slay(state, "skitter");
    expect(player(state).level).toBe(2);
    expect(player(state).life).toBe(player(state).maxLife);
    expect(player(state).mana).toBe(player(state).maxMana);
  });

  test("xp gains without a level-up do not heal", () => {
    const state = createGameOn(1, openMap());
    player(state).life = 5;
    slay(state, "skitter"); // 6 xp, nowhere near level 2
    expect(player(state).level).toBe(1);
    expect(player(state).life).toBe(5);
  });

  test("a single large xp gain can grant multiple levels", () => {
    const state = createGameOn(1, openMap());
    player(state).xp = xpForLevel(3) - 1; // one skitter's 6 xp crosses 2 and 3
    slay(state, "skitter");
    expect(player(state).level).toBe(3);
    expect(player(state).skillPoints).toBe(2);
  });

  test("level bonus life survives equipment recompute", () => {
    const state = createGameOn(1, openMap());
    player(state).xp = xpForLevel(2) - 1;
    slay(state, "skitter");
    const after = player(state).maxLife;
    stepSolo(state, { unequip: "weapon" });
    expect(player(state).maxLife).toBe(after);
  });
});

describe("xp split", () => {
  test("solo killer gets full xp", () => {
    const state = createGame(1);
    const p0 = joinPlayer(state, { id: 0 });
    state.events.push({
      type: "monster_died",
      id: 1,
      typeId: "skitter",
      pos: { ...p0.pos },
      xp: 12,
      zone: p0.zoneId,
      killer: p0.id,
      mlvl: 2,
    });
    xpSystem(state);
    expect(p0.xp).toBe(12);
  });

  test("two players in range split with party bonus", () => {
    const state = createGame(1);
    const p0 = joinPlayer(state, { id: 0 });
    const p1 = joinPlayer(state, { id: 1 });
    p1.pos = { ...p0.pos };
    state.events.push({
      type: "monster_died",
      id: 1,
      typeId: "skitter",
      pos: { ...p0.pos },
      xp: 100,
      zone: p0.zoneId,
      killer: p0.id,
      mlvl: 2,
    });
    xpSystem(state);
    // floor(100 / 2 * 1.35) = 67
    expect(p0.xp).toBe(67);
    expect(p1.xp).toBe(67);
  });

  test("killer is included even when out of radius; distant non-killers are not", () => {
    const state = createGame(1);
    const p0 = joinPlayer(state, { id: 0 }); // killer, far away
    const p1 = joinPlayer(state, { id: 1 }); // bystander, adjacent
    const p2 = joinPlayer(state, { id: 2 }); // far away, not killer
    const killPos = { x: 0, y: 0 };
    p0.pos = { x: 30, y: 0 };
    p1.pos = { x: 1, y: 0 };
    p2.pos = { x: 30, y: 5 };
    state.events.push({
      type: "monster_died",
      id: 1,
      typeId: "skitter",
      pos: killPos,
      xp: 100,
      zone: p0.zoneId,
      killer: p0.id,
      mlvl: 2,
    });
    xpSystem(state);
    // n=2 (killer + bystander): floor(100 / 2 * 1.35) = 67
    expect(p0.xp).toBe(67);
    expect(p1.xp).toBe(67);
    expect(p2.xp).toBe(0);
  });

  test("players in other zones never share", () => {
    const state = createGame(1);
    const p0 = joinPlayer(state, { id: 0 });
    const p1 = joinPlayer(state, { id: 1 });
    p0.zoneId = "floor:1";
    // p1 stays in camp
    state.events.push({
      type: "monster_died",
      id: 1,
      typeId: "skitter",
      pos: { ...p0.pos },
      xp: 50,
      zone: "floor:1",
      killer: p0.id,
      mlvl: 2,
    });
    xpSystem(state);
    expect(p0.xp).toBe(50);
    expect(p1.xp).toBe(0);
  });

  test("null killer (explosion chain): everyone in radius splits", () => {
    const state = createGame(1);
    const p0 = joinPlayer(state, { id: 0 });
    const p1 = joinPlayer(state, { id: 1 });
    p1.pos = { ...p0.pos };
    state.events.push({
      type: "monster_died",
      id: 1,
      typeId: "skitter",
      pos: { ...p0.pos },
      xp: 100,
      zone: p0.zoneId,
      killer: null,
      mlvl: 2,
    });
    xpSystem(state);
    expect(p0.xp).toBe(67);
    expect(p1.xp).toBe(67);
  });
});

describe("xp falloff", () => {
  test("full xp within 5 levels of the kill, in either direction", () => {
    expect(xpPenalty(1, 2)).toBe(1);
    expect(xpPenalty(10, 5)).toBe(1); // gap exactly 5
    expect(xpPenalty(4, 9)).toBe(1); // monster 5 above player
  });

  test("xp fades 15% per level beyond a 5-level gap", () => {
    expect(xpPenalty(12, 5)).toBeCloseTo(0.7); // gap 7
    expect(xpPenalty(14, 5)).toBeCloseTo(0.4); // gap 9
  });

  test("under-leveled kills fade the same way: no rushing the end zones", () => {
    expect(xpPenalty(3, 9)).toBeCloseTo(0.85); // gap 6
    expect(xpPenalty(1, 12)).toBeCloseTo(0.1); // gap 11
    expect(xpPenalty(1, 30)).toBe(0.05);
  });

  test("xp never falls below 5%", () => {
    expect(xpPenalty(30, 2)).toBe(0.05);
  });

  test("an out-leveled kill grants reduced xp", () => {
    const state = createGame(1);
    const p0 = joinPlayer(state, { id: 0 });
    p0.level = 12;
    state.events.push({
      type: "monster_died",
      id: 1,
      typeId: "shambler",
      pos: { ...p0.pos },
      xp: 12,
      zone: p0.zoneId,
      killer: p0.id,
      mlvl: 5,
    });
    xpSystem(state);
    expect(p0.xp).toBe(8); // gap 7: floor(12 * 0.7)
  });

  test("falloff is per recipient: the low-level partner keeps the full share", () => {
    const state = createGame(1);
    const p0 = joinPlayer(state, { id: 0 });
    const p1 = joinPlayer(state, { id: 1 });
    p0.level = 18;
    p1.level = 3;
    p1.pos = { ...p0.pos };
    state.events.push({
      type: "monster_died",
      id: 1,
      typeId: "shambler",
      pos: { ...p0.pos },
      xp: 100,
      zone: p0.zoneId,
      killer: p0.id,
      mlvl: 5,
    });
    xpSystem(state);
    // share = floor(100 / 2 * 1.35) = 67
    expect(p0.xp).toBe(3); // gap 13 -> 5%: floor(67 * 0.05)
    expect(p1.xp).toBe(67); // gap -2 -> full
  });
});

describe("high-level taper", () => {
  test("all xp income diminishes past level 30", () => {
    expect(highLevelTaper(1)).toBe(1);
    expect(highLevelTaper(30)).toBe(1);
    expect(highLevelTaper(31)).toBeCloseTo(0.95);
    expect(highLevelTaper(40)).toBeCloseTo(0.5);
    expect(highLevelTaper(60)).toBe(0.05);
  });

  test("a level-40 player's gains are halved at the grant", () => {
    const state = createGame(1);
    const p0 = joinPlayer(state, { id: 0 });
    p0.level = 40;
    p0.xp = xpForLevel(40);
    grantXp(state, p0, 100);
    expect(p0.xp).toBe(xpForLevel(40) + 50);
  });
});
