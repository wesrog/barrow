import { describe, expect, test } from "bun:test";
import { isWalkable, mapFromStrings } from "./map";
import { createGame, step } from "./tick";
import { collisionSystem, NPC_RADIUS, PLAYER_RADIUS } from "./systems/collision";
import { MONSTER_TYPES, spawnMonster } from "./monsters";
import { cryptZone } from "./zone";

const arena = () =>
  mapFromStrings([
    "############",
    "#@.........#",
    "#..........#",
    "#..........#",
    "############",
  ]);

const corridor = () =>
  mapFromStrings([
    "############",
    "#@.........#",
    "############",
  ]);

describe("collision radii", () => {
  test("every monster type defines a radius", () => {
    for (const t of Object.values(MONSTER_TYPES)) {
      expect(t.radius).toBeGreaterThan(0);
    }
  });

  test("spawned monsters carry their type's radius", () => {
    const game = createGame(1, arena());
    const m = spawnMonster(game, "shambler", { x: 6.5, y: 2.5 });
    expect(m.radius).toBe(MONSTER_TYPES.shambler!.radius);
  });
});

describe("player vs monster", () => {
  test("an overlapping player is pushed out to contact distance", () => {
    const game = createGame(1, arena());
    const m = spawnMonster(game, "shambler", { x: 6.5, y: 2.5 });
    game.player.pos = { x: 6.7, y: 2.5 };
    collisionSystem(game);
    const d = Math.hypot(game.player.pos.x - m.pos.x, game.player.pos.y - m.pos.y);
    expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + m.radius - 1e-6);
  });

  test("the player cannot walk through a monster blocking a corridor", () => {
    const game = createGame(1, corridor());
    const m = spawnMonster(game, "shambler", { x: 6.5, y: 1.5 });
    m.stunnedUntil = Number.MAX_SAFE_INTEGER; // hold still: this test is about walls of meat
    step(game, { moveTo: { x: 10.5, y: 1.5 } });
    for (let i = 0; i < 300; i++) {
      step(game, {});
      const d = Math.hypot(game.player.pos.x - m.pos.x, game.player.pos.y - m.pos.y);
      expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + m.radius - 1e-6);
    }
    // Still on the near side — body-blocked, not squeezed past.
    expect(game.player.pos.x).toBeLessThan(m.pos.x);
  });

  test("a dead player does not body-block", () => {
    const game = createGame(1, arena());
    const m = spawnMonster(game, "shambler", { x: 6.5, y: 2.5 });
    game.player.dead = true;
    game.player.pos = { x: 6.6, y: 2.5 };
    const before = { ...game.player.pos };
    collisionSystem(game);
    expect(game.player.pos).toEqual(before);
    expect(m.pos).toEqual({ x: 6.5, y: 2.5 });
  });
});

describe("player vs town NPC", () => {
  test("the vendor body-blocks: the player cannot stand inside V", () => {
    const game = createGame(1, cryptZone());
    step(game, { townPortal: true });
    const v = game.map.markers.find((m) => m.ch === "V")!;
    game.player.pos = { x: v.x + 0.1, y: v.y };
    collisionSystem(game);
    const d = Math.hypot(game.player.pos.x - v.x, game.player.pos.y - v.y);
    expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + NPC_RADIUS - 1e-6);
  });

  test("the player cannot walk through the vendor", () => {
    const game = createGame(1, cryptZone());
    step(game, { townPortal: true });
    const v = game.map.markers.find((m) => m.ch === "V")!;
    game.player.pos = { x: v.x - 2, y: v.y };
    step(game, { moveTo: { x: v.x + 2, y: v.y } });
    for (let i = 0; i < 200; i++) {
      step(game, {});
      const d = Math.hypot(game.player.pos.x - v.x, game.player.pos.y - v.y);
      expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + NPC_RADIUS - 1e-6);
    }
  });

  test("the portal pad stays walkable — you must stand on P to leave", () => {
    const game = createGame(1, cryptZone());
    step(game, { townPortal: true });
    const pad = game.map.markers.find((m) => m.ch === "P")!;
    game.player.pos = { x: pad.x, y: pad.y };
    collisionSystem(game);
    expect(game.player.pos).toEqual({ x: pad.x, y: pad.y });
  });
});

describe("monster vs monster", () => {
  test("overlapping monsters are fully separated to their radii sum", () => {
    const game = createGame(1, arena());
    const a = spawnMonster(game, "shambler", { x: 6.5, y: 2.5 });
    const b = spawnMonster(game, "shambler", { x: 6.6, y: 2.5 });
    collisionSystem(game);
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
    expect(d).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
  });

  test("perfectly stacked monsters split deterministically", () => {
    const game = createGame(1, arena());
    const a = spawnMonster(game, "shambler", { x: 6.5, y: 2.5 });
    const b = spawnMonster(game, "shambler", { x: 6.5, y: 2.5 });
    collisionSystem(game);
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
    expect(d).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
  });

  test("separation never pushes a monster into a wall", () => {
    const game = createGame(1, corridor());
    // a sits against the left wall; b overlaps from the right.
    const a = spawnMonster(game, "shambler", { x: 1.35, y: 1.5 });
    const b = spawnMonster(game, "shambler", { x: 1.45, y: 1.5 });
    collisionSystem(game);
    for (const m of [a, b]) {
      expect(isWalkable(game.map, Math.floor(m.pos.x), Math.floor(m.pos.y))).toBe(true);
    }
  });
});

describe("integration", () => {
  test("a settled pack leaves no pair overlapping", () => {
    const game = createGame(1, arena());
    const ms = [
      spawnMonster(game, "shambler", { x: 6.5, y: 2.5 }),
      spawnMonster(game, "shambler", { x: 6.6, y: 2.5 }),
      spawnMonster(game, "skitter", { x: 6.5, y: 2.6 }),
      spawnMonster(game, "skitter", { x: 6.6, y: 2.6 }),
    ];
    for (let i = 0; i < 200; i++) step(game, {});
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i]!;
        const b = ms[j]!;
        if (!game.monsters.has(a.id) || !game.monsters.has(b.id)) continue;
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
        expect(d).toBeGreaterThanOrEqual(a.radius + b.radius - 0.05);
      }
    }
  });

  test("chasing monsters still reach the player and connect hits", () => {
    const game = createGame(1, arena());
    spawnMonster(game, "shambler", { x: 6.5, y: 1.5 });
    let sawHit = false;
    for (let i = 0; i < 400; i++) {
      step(game, {});
      if (game.events.some((e) => e.type === "player_hit")) sawHit = true;
    }
    expect(sawHit).toBe(true);
  });
});
