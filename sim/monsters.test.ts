import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { createGame, step } from "./tick";
import { spawnMonster, MONSTER_TYPES } from "./monsters";
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
    const state = createGame(5, openArena());
    const m = spawnMonster(state, "gravespit", { x: 6.5, y: 1.5 });
    let hurt = false;
    for (let i = 0; i < 200 && !hurt; i++) {
      step(state, {});
      if (state.events.some((e) => e.type === "player_hit")) hurt = true;
    }
    expect(hurt).toBe(true);
    // Never walked into melee reach
    expect(Math.hypot(m.pos.x - state.player.pos.x, m.pos.y - state.player.pos.y)).toBeGreaterThan(2);
  });

  test("cannot spit through walls; approaches instead", () => {
    const state = createGame(5, walledArena());
    const m = spawnMonster(state, "gravespit", { x: 6.5, y: 1.5 });
    const start = { ...m.pos };
    // While still behind the wall it must hold fire (it will flank given time).
    for (let i = 0; i < 10; i++) {
      step(state, {});
      expect(state.events.some((e) => e.type === "player_hit")).toBe(false);
    }
    // It moved to find an angle rather than firing blind
    expect(m.pos).not.toEqual(start);
  });
});

describe("tomb bloat (exploder)", () => {
  test("death detonates, hurting the player and nearby monsters", () => {
    const state = createGame(5, openArena());
    state.player.pos = { x: 2.5, y: 1.5 };
    const bloat = spawnMonster(state, "tomb_bloat", { x: 3.2, y: 1.5 });
    const bystander = spawnMonster(state, "skitter", { x: 3.8, y: 1.5 });
    const lifeBefore = state.player.life;
    const bystanderLifeBefore = bystander.life;
    bloat.life = 0;
    step(state, {});
    expect(state.events.some((e) => e.type === "exploded")).toBe(true);
    expect(state.player.life).toBeLessThan(lifeBefore);
    expect(bystander.life).toBeLessThan(bystanderLifeBefore);
  });

  test("explosions can chain into other bloats", () => {
    const state = createGame(5, openArena());
    state.player.pos = { x: 9.5, y: 3.5 }; // out of blast range
    const a = spawnMonster(state, "tomb_bloat", { x: 2.5, y: 1.5 });
    const b = spawnMonster(state, "tomb_bloat", { x: 3.5, y: 1.5 });
    b.life = 3; // one blast will finish it
    a.life = 0;
    step(state, {});
    expect(state.monsters.has(a.id)).toBe(false);
    expect(state.monsters.has(b.id)).toBe(false);
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
    const state = createGame(5, openArena());
    const boss = spawnMonster(state, "barrow_lord", { x: 6.5, y: 2.5 });
    boss.life = 0;
    step(state, {});
    expect(state.groundItems.size).toBeGreaterThanOrEqual(1);
    const rarities = [...state.groundItems.values()].map((gi) => gi.item.rarity);
    expect(rarities.some((r) => r !== "normal")).toBe(true);
  });
});

describe("barrow lord telegraph", () => {
  test("winds up visibly before striking, then swings", () => {
    const state = createGame(5, openArena());
    state.player.pos = { x: 3.5, y: 1.5 };
    const boss = spawnMonster(state, "barrow_lord", { x: 4.3, y: 1.5 });
    let windupTick = -1;
    let swingTick = -1;
    for (let i = 0; i < 120 && swingTick === -1; i++) {
      step(state, {});
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
    const state = createGame(5, openArena());
    state.player.pos = { x: 3.5, y: 1.5 };
    const boss = spawnMonster(state, "barrow_lord", { x: 4.3, y: 1.5 });
    let wound = false;
    for (let i = 0; i < 60 && !wound; i++) {
      step(state, {});
      if (state.events.some((e) => e.type === "monster_windup")) wound = true;
    }
    expect(wound).toBe(true);
    state.player.pos = { x: 9.5, y: 3.5 }; // dodge far away
    for (let i = 0; i < MONSTER_TYPES.barrow_lord!.windup! + 5; i++) {
      step(state, {});
      expect(state.events.some((e) => e.type === "monster_swing" && e.id === boss.id)).toBe(false);
      expect(state.events.some((e) => e.type === "player_hit")).toBe(false);
    }
  });

  test("a stun interrupts the windup", () => {
    const state = createGame(5, openArena());
    state.player.pos = { x: 3.5, y: 1.5 };
    const boss = spawnMonster(state, "barrow_lord", { x: 4.3, y: 1.5 });
    let wound = false;
    for (let i = 0; i < 60 && !wound; i++) {
      step(state, {});
      if (state.events.some((e) => e.type === "monster_windup")) wound = true;
    }
    boss.stunnedUntil = state.tick + 200;
    for (let i = 0; i < MONSTER_TYPES.barrow_lord!.windup! + 5; i++) {
      step(state, {});
      expect(state.events.some((e) => e.type === "monster_swing" && e.id === boss.id)).toBe(false);
    }
  });
});
