import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { createGame, step } from "./tick";
import { computeHitChance, rollDamage } from "./systems/combat";
import { spawnMonster } from "./monsters";
import { createRng } from "./rng";

const arena = () =>
  mapFromStrings([
    "############",
    "#@.........#",
    "#..........#",
    "#..........#",
    "############",
  ]);

describe("hit math", () => {
  test("hit chance is ar/(ar+def) clamped to [0.05, 0.95]", () => {
    expect(computeHitChance(100, 100)).toBeCloseTo(0.5);
    expect(computeHitChance(300, 100)).toBeCloseTo(0.75);
    expect(computeHitChance(1, 100000)).toBe(0.05);
    expect(computeHitChance(100000, 1)).toBe(0.95);
  });

  test("damage roll is an integer within [min, max]", () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const d = rollDamage(rng, 3, 9);
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(3);
      expect(d).toBeLessThanOrEqual(9);
    }
  });
});

describe("monster AI", () => {
  test("far-away monster stays idle; near monster aggros and chases", () => {
    const game = createGame(1, arena());
    const far = spawnMonster(game, "shambler", { x: 10.5, y: 3.5 });
    step(game, {});
    expect(far.ai).toBe("idle");

    const near = spawnMonster(game, "shambler", { x: 4.5, y: 1.5 });
    step(game, {});
    expect(near.ai).toBe("chasing");
  });

  test("chasing monster closes distance and damages the player", () => {
    const game = createGame(1, arena());
    spawnMonster(game, "shambler", { x: 6.5, y: 1.5 });
    const startLife = game.player.life;
    let sawDamageEvent = false;
    for (let i = 0; i < 300; i++) {
      step(game, {});
      if (game.events.some((e) => e.type === "player_hit")) sawDamageEvent = true;
    }
    expect(game.player.life).toBeLessThan(startLife);
    expect(sawDamageEvent).toBe(true);
  });

  test("monster respects its swing cooldown", () => {
    const game = createGame(1, arena());
    const m = spawnMonster(game, "shambler", { x: 2.1, y: 1.5 });
    const hitsAt: number[] = [];
    for (let i = 0; i < 500; i++) {
      step(game, {});
      if (game.events.some((e) => e.type === "player_hit")) hitsAt.push(game.tick);
    }
    expect(hitsAt.length).toBeGreaterThan(1);
    for (let i = 1; i < hitsAt.length; i++) {
      expect(hitsAt[i]! - hitsAt[i - 1]!).toBeGreaterThanOrEqual(m.swingEvery);
    }
  });
});

describe("player attacking", () => {
  test("attacking a monster walks into range and kills it", () => {
    const game = createGame(1, arena());
    const m = spawnMonster(game, "skitter", { x: 8.5, y: 2.5 });
    step(game, { attack: m.id });
    let died = false;
    for (let i = 0; i < 600 && !died; i++) {
      step(game, {});
      if (game.events.some((e) => e.type === "monster_died" && e.id === m.id)) died = true;
    }
    expect(died).toBe(true);
    expect(game.monsters.has(m.id)).toBe(false);
    expect(game.corpses.some((c) => c.typeId === "skitter")).toBe(true);
  });

  test("monster hits emit events with damage amounts", () => {
    const game = createGame(1, arena());
    const m = spawnMonster(game, "skitter", { x: 2.5, y: 1.5 });
    step(game, { attack: m.id });
    const amounts: number[] = [];
    for (let i = 0; i < 200 && game.monsters.has(m.id); i++) {
      step(game, {});
      for (const e of game.events) {
        if (e.type === "monster_hit" && e.id === m.id) amounts.push(e.amount);
      }
    }
    expect(amounts.length).toBeGreaterThan(0);
    for (const a of amounts) expect(a).toBeGreaterThan(0);
  });

  test("player death sets dead flag and stops monster piling on", () => {
    const game = createGame(1, arena());
    game.player.life = 1;
    spawnMonster(game, "shambler", { x: 2.1, y: 1.5 });
    for (let i = 0; i < 200; i++) step(game, {});
    expect(game.player.dead).toBe(true);
    expect(game.player.life).toBe(0);
  });
});

describe("swing events", () => {
  test("a player swing emits player_swing whether or not it hits", () => {
    const game = createGame(1, arena());
    const m = spawnMonster(game, "shambler", { x: 2.2, y: 1.5 });
    let swings = 0;
    for (let i = 0; i < 30; i++) {
      step(game, i === 0 ? { attack: m.id } : {});
      swings += game.events.filter((e) => e.type === "player_swing").length;
    }
    // swingEvery is 12 ticks: at least two swings in 30
    expect(swings).toBeGreaterThanOrEqual(2);
  });

  test("melee monsters emit monster_swing at the player, not flagged ranged", () => {
    const game = createGame(1, arena());
    spawnMonster(game, "shambler", { x: 2.2, y: 1.5 });
    let seen = false;
    for (let i = 0; i < 60 && !seen; i++) {
      step(game, {});
      for (const e of game.events) {
        if (e.type === "monster_swing") {
          seen = true;
          expect(e.ranged).toBe(false);
          expect(e.to).toEqual(game.player.pos);
        }
      }
    }
    expect(seen).toBe(true);
  });

  test("gravespit swings are flagged ranged with a firing origin", () => {
    const game = createGame(1, arena());
    const m = spawnMonster(game, "gravespit", { x: 6.5, y: 1.5 });
    let seen = false;
    for (let i = 0; i < 120 && !seen; i++) {
      step(game, {});
      for (const e of game.events) {
        if (e.type === "monster_swing") {
          seen = true;
          expect(e.ranged).toBe(true);
          expect(e.from).toEqual(m.pos);
        }
      }
    }
    expect(seen).toBe(true);
  });
});
