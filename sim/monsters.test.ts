import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone, soloGame, spawnAt } from "./test-helpers";
import { MONSTER_TYPES, scaledMonsterStats } from "./monsters";
import { MARKER_TYPES } from "./zone";
import { getZone } from "./state";
import { areaRect, inRect } from "./surface";
import { rollDrop } from "./items/treasure";
import { createRng } from "./rng";

const openArena = () =>
  mapFromStrings([
    "############",
    "#@.........#",
    "#..........#",
    "#..........#",
    "############",
  ]);

const walledArena = () =>
  mapFromStrings([
    "############",
    "#@...#.....#",
    "#....#.....#",
    "#..........#",
    "############",
  ]);

describe("gravespit (ranged)", () => {
  test("attacks from range without closing to melee", () => {
    const state = createGameOn(5, openArena());
    const m = spawnAt(state, "gravespit", { x: 6.5, y: 1.5 });
    let hurt = false;
    for (let i = 0; i < 200 && !hurt; i++) {
      stepSolo(state, {});
      if (state.events.some((e) => e.type === "player_hit")) hurt = true;
    }
    expect(hurt).toBe(true);
    // Never walked into melee reach
    expect(Math.hypot(m.pos.x - player(state).pos.x, m.pos.y - player(state).pos.y)).toBeGreaterThan(2);
  });

  test("cannot spit through walls; approaches instead", () => {
    const state = createGameOn(5, walledArena());
    const m = spawnAt(state, "gravespit", { x: 6.5, y: 1.5 });
    const start = { ...m.pos };
    // While still behind the wall it must hold fire (it will flank given time).
    for (let i = 0; i < 10; i++) {
      stepSolo(state, {});
      expect(state.events.some((e) => e.type === "player_hit")).toBe(false);
    }
    // It moved to find an angle rather than firing blind
    expect(m.pos).not.toEqual(start);
  });
});

describe("tomb bloat (exploder)", () => {
  test("death detonates, hurting the player and nearby monsters", () => {
    const state = createGameOn(5, openArena());
    player(state).pos = { x: 2.5, y: 1.5 };
    const bloat = spawnAt(state, "tomb_bloat", { x: 3.2, y: 1.5 });
    const bystander = spawnAt(state, "skitter", { x: 3.8, y: 1.5 });
    const lifeBefore = player(state).life;
    const bystanderLifeBefore = bystander.life;
    bloat.life = 0;
    stepSolo(state, {});
    expect(state.events.some((e) => e.type === "exploded")).toBe(true);
    expect(player(state).life).toBeLessThan(lifeBefore);
    expect(bystander.life).toBeLessThan(bystanderLifeBefore);
  });

  test("explosions can chain into other bloats", () => {
    const state = createGameOn(5, openArena());
    player(state).pos = { x: 9.5, y: 3.5 }; // out of blast range
    const a = spawnAt(state, "tomb_bloat", { x: 2.5, y: 1.5 });
    const b = spawnAt(state, "tomb_bloat", { x: 3.5, y: 1.5 });
    b.life = 3; // one blast will finish it
    a.life = 0;
    stepSolo(state, {});
    expect(playerZone(state).monsters.has(a.id)).toBe(false);
    expect(playerZone(state).monsters.has(b.id)).toBe(false);
    expect(state.events.filter((e) => e.type === "exploded")).toHaveLength(2);
  });
});

describe("barrow lord (boss)", () => {
  test("its treasure class guarantees a magic-or-better drop", () => {
    const rng = createRng(11);
    for (let i = 0; i < 50; i++) {
      const item = rollDrop(rng, "boss", MONSTER_TYPES.barrow_lord!.mlvl, {
        guaranteed: true,
        minRarity: "magic",
      });
      expect(item).not.toBeNull();
      expect(item!.rarity).not.toBe("normal");
    }
  });

  test("killing the boss always leaves a drop", () => {
    const state = createGameOn(5, openArena());
    const boss = spawnAt(state, "barrow_lord", { x: 6.5, y: 2.5 });
    boss.life = 0;
    stepSolo(state, {});
    expect(playerZone(state).groundItems.size).toBeGreaterThanOrEqual(1);
    const rarities = [...playerZone(state).groundItems.values()].map((gi) => gi.item.rarity);
    expect(rarities.some((r) => r !== "normal")).toBe(true);
  });
});

describe("barrow lord telegraph", () => {
  test("winds up visibly before striking, then swings", () => {
    const state = createGameOn(5, openArena());
    player(state).pos = { x: 3.5, y: 1.5 };
    const boss = spawnAt(state, "barrow_lord", { x: 4.3, y: 1.5 });
    let windupTick = -1;
    let swingTick = -1;
    for (let i = 0; i < 120 && swingTick === -1; i++) {
      stepSolo(state, {});
      for (const e of state.events) {
        if (e.type === "monster_windup" && windupTick === -1) windupTick = state.tick;
        if (e.type === "monster_swing" && e.id === boss.id) swingTick = state.tick;
      }
    }
    expect(windupTick).toBeGreaterThan(-1);
    expect(swingTick).toBeGreaterThan(-1);
    expect(swingTick - windupTick).toBeGreaterThanOrEqual(MONSTER_TYPES.barrow_lord!.windup!);
  });

  test("no strike lands if the player escapes during the windup", () => {
    const state = createGameOn(5, openArena());
    player(state).pos = { x: 3.5, y: 1.5 };
    const boss = spawnAt(state, "barrow_lord", { x: 4.3, y: 1.5 });
    let wound = false;
    for (let i = 0; i < 60 && !wound; i++) {
      stepSolo(state, {});
      if (state.events.some((e) => e.type === "monster_windup")) wound = true;
    }
    expect(wound).toBe(true);
    player(state).pos = { x: 9.5, y: 3.5 }; // dodge far away
    for (let i = 0; i < MONSTER_TYPES.barrow_lord!.windup! + 5; i++) {
      stepSolo(state, {});
      expect(state.events.some((e) => e.type === "monster_swing" && e.id === boss.id)).toBe(false);
      expect(state.events.some((e) => e.type === "player_hit")).toBe(false);
    }
  });

  test("a stun interrupts the windup", () => {
    const state = createGameOn(5, openArena());
    player(state).pos = { x: 3.5, y: 1.5 };
    const boss = spawnAt(state, "barrow_lord", { x: 4.3, y: 1.5 });
    let wound = false;
    for (let i = 0; i < 60 && !wound; i++) {
      stepSolo(state, {});
      if (state.events.some((e) => e.type === "monster_windup")) wound = true;
    }
    boss.stunnedUntil = state.tick + 200;
    for (let i = 0; i < MONSTER_TYPES.barrow_lord!.windup! + 5; i++) {
      stepSolo(state, {});
      expect(state.events.some((e) => e.type === "monster_swing" && e.id === boss.id)).toBe(false);
    }
  });
});

describe("crowding", () => {
  test("monsters shoved into the same spot separate instead of stacking", () => {
    const state = createGameOn(5, openArena());
    player(state).pos = { x: 9.5, y: 3.5 };
    const a = spawnAt(state, "shambler", { x: 3.5, y: 1.5 });
    const b = spawnAt(state, "shambler", { x: 3.5, y: 1.5 });
    for (let i = 0; i < 60; i++) stepSolo(state, {});
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
    expect(d).toBeGreaterThan(0.3);
  });
});

describe("depth scaling", () => {
  test("threat compounds but reward grows linearly, mlvl +1 per area level", () => {
    const t = MONSTER_TYPES.cairn_wight!; // xp 30, mlvl 9
    const s = scaledMonsterStats(t, 8);
    expect(s.maxLife).toBeGreaterThan(t.maxLife * 5); // difficulty ladder untouched
    expect(s.mlvl).toBe(16); // 9 + (8 - 1)
    expect(s.xp).toBe(83); // round(30 * (1 + 0.25 * 7))
  });
});

describe("fen and crag monsters", () => {
  test("the new rows exist with their signature behaviors", () => {
    // A fast pack hunter, a ranged lobber, and a heavy telegraphed hitter.
    expect(MONSTER_TYPES.fen_howler!.speed).toBeGreaterThan(MONSTER_TYPES.shambler!.speed);
    expect(MONSTER_TYPES.bog_maw!.ranged).toBeGreaterThan(0);
    expect(MONSTER_TYPES.cairn_wight!.windup).toBeGreaterThan(0);
    // Levels climb past the crypt originals so their loot keeps unlocking.
    expect(MONSTER_TYPES.cairn_wight!.mlvl).toBeGreaterThan(MONSTER_TYPES.shambler!.mlvl);
  });

  test("their marker chars populate zones", () => {
    expect(MARKER_TYPES.h).toBe("fen_howler");
    expect(MARKER_TYPES.m).toBe("bog_maw");
    expect(MARKER_TYPES.w).toBe("cairn_wight");
  });

  test("the redfen prowls with fen monsters", () => {
    const g = soloGame(1);
    const rect = areaRect("redfen");
    const ids = new Set(
      [...getZone(g, "surface").monsters.values()]
        .filter((mo) => inRect(rect, mo.pos))
        .map((mo) => mo.typeId),
    );
    expect(ids.has("fen_howler")).toBe(true);
    expect(ids.has("bog_maw")).toBe(true);
  });
});

describe("ash and hollow monsters", () => {
  test("the new rows exist with their signature behaviors", () => {
    // A fast fragile skirmisher, telegraphed mid hitters, a walking bomb,
    // a long-range shrieker, and an armored elite at the summit.
    expect(MONSTER_TYPES.cinder_shade!.speed).toBeGreaterThan(MONSTER_TYPES.fen_howler!.speed);
    expect(MONSTER_TYPES.ash_revenant!.windup).toBeGreaterThan(0);
    expect(MONSTER_TYPES.ember_hulk!.explode!.radius).toBeGreaterThan(0);
    expect(MONSTER_TYPES.veil_screamer!.ranged).toBeGreaterThan(0);
    expect(MONSTER_TYPES.crown_sentinel!.windup).toBeGreaterThan(0);
    expect(MONSTER_TYPES.crown_sentinel!.defense).toBeGreaterThan(MONSTER_TYPES.cairn_wight!.defense);
    // The ladder keeps climbing past the crag so loot keeps unlocking.
    expect(MONSTER_TYPES.cinder_shade!.mlvl).toBeGreaterThan(MONSTER_TYPES.cairn_wight!.mlvl);
    expect(MONSTER_TYPES.crown_sentinel!.mlvl).toBeGreaterThan(MONSTER_TYPES.veil_screamer!.mlvl);
  });

  test("their marker chars populate zones", () => {
    expect(MARKER_TYPES.c).toBe("cinder_shade");
    expect(MARKER_TYPES.a).toBe("ash_revenant");
    expect(MARKER_TYPES.k).toBe("ember_hulk");
    expect(MARKER_TYPES.v).toBe("veil_screamer");
    expect(MARKER_TYPES.n).toBe("crown_sentinel");
  });

  test("the ashfell burns with ash monsters", () => {
    const g = soloGame(1);
    const rect = areaRect("ashfell");
    const ids = new Set(
      [...getZone(g, "surface").monsters.values()]
        .filter((mo) => inRect(rect, mo.pos))
        .map((mo) => mo.typeId),
    );
    expect(ids.has("cinder_shade")).toBe(true);
    expect(ids.has("ember_hulk")).toBe(true);
  });

  test("the hollowcrown skews hardest", () => {
    const g = soloGame(1);
    const rect = areaRect("hollowcrown");
    const ids = new Set(
      [...getZone(g, "surface").monsters.values()]
        .filter((mo) => inRect(rect, mo.pos))
        .map((mo) => mo.typeId),
    );
    expect(ids.has("veil_screamer")).toBe(true);
    expect(ids.has("crown_sentinel")).toBe(true);
  });

  test("veil screamer attacks from range without closing to melee", () => {
    const state = createGameOn(5, openArena());
    const m = spawnAt(state, "veil_screamer", { x: 6.5, y: 1.5 });
    let hurt = false;
    for (let i = 0; i < 200 && !hurt; i++) {
      stepSolo(state, {});
      if (state.events.some((e) => e.type === "player_hit")) hurt = true;
    }
    expect(hurt).toBe(true);
    expect(
      Math.hypot(m.pos.x - player(state).pos.x, m.pos.y - player(state).pos.y),
    ).toBeGreaterThan(2);
  });

  test("ember hulk detonates on death, hurting the player", () => {
    const state = createGameOn(5, openArena());
    player(state).pos = { x: 2.5, y: 1.5 };
    const hulk = spawnAt(state, "ember_hulk", { x: 3.4, y: 1.5 });
    const lifeBefore = player(state).life;
    hulk.life = 0;
    stepSolo(state, {});
    expect(state.events.some((e) => e.type === "exploded")).toBe(true);
    expect(player(state).life).toBeLessThan(lifeBefore);
  });
});
