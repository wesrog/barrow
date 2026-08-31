import { describe, expect, test } from "bun:test";
import { isWalkable, mapFromStrings } from "./map";
import { stepSolo, travel } from "./tick";
import { createGameOn, player, playerZone, spawnAt } from "./test-helpers";
import { collisionSystem, NPC_RADIUS, PLAYER_RADIUS } from "./systems/collision";
import { MONSTER_TYPES } from "./monsters";
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
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 6.5, y: 2.5 });
    expect(m.radius).toBe(MONSTER_TYPES.shambler!.radius);
  });
});

describe("player vs monster", () => {
  test("an overlapping player is pushed out to contact distance", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 6.5, y: 2.5 });
    player(game).pos = { x: 6.7, y: 2.5 };
    collisionSystem(game, playerZone(game), [player(game)]);
    const d = Math.hypot(player(game).pos.x - m.pos.x, player(game).pos.y - m.pos.y);
    expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + m.radius - 1e-6);
  });

  test("the player cannot walk through a monster blocking a corridor", () => {
    const game = createGameOn(1, corridor());
    const m = spawnAt(game, "shambler", { x: 6.5, y: 1.5 });
    m.stunnedUntil = Number.MAX_SAFE_INTEGER; // hold still: this test is about walls of meat
    stepSolo(game, { moveTo: { x: 10.5, y: 1.5 } });
    for (let i = 0; i < 300; i++) {
      stepSolo(game, {});
      const d = Math.hypot(player(game).pos.x - m.pos.x, player(game).pos.y - m.pos.y);
      expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + m.radius - 1e-6);
    }
    // Still on the near side — body-blocked, not squeezed past.
    expect(player(game).pos.x).toBeLessThan(m.pos.x);
  });

  test("a dead player does not body-block", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 6.5, y: 2.5 });
    player(game).dead = true;
    player(game).pos = { x: 6.6, y: 2.5 };
    const before = { ...player(game).pos };
    collisionSystem(game, playerZone(game), [player(game)]);
    expect(player(game).pos).toEqual(before);
    expect(m.pos).toEqual({ x: 6.5, y: 2.5 });
  });
});

describe("player vs camp NPC", () => {
  test("the vendor body-blocks: the player cannot stand inside V", () => {
    const game = createGameOn(1, cryptZone());
    travel(game, player(game), "overworld");
    const v = playerZone(game).map.markers.find((m) => m.ch === "V")!;
    player(game).pos = { x: v.x + 0.1, y: v.y };
    collisionSystem(game, playerZone(game), [player(game)]);
    const d = Math.hypot(player(game).pos.x - v.x, player(game).pos.y - v.y);
    expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + NPC_RADIUS - 1e-6);
  });

  test("the player cannot walk through the vendor", () => {
    const game = createGameOn(1, cryptZone());
    travel(game, player(game), "overworld");
    const v = playerZone(game).map.markers.find((m) => m.ch === "V")!;
    player(game).pos = { x: v.x - 2, y: v.y };
    stepSolo(game, { moveTo: { x: v.x + 2, y: v.y } });
    for (let i = 0; i < 200; i++) {
      stepSolo(game, {});
      const d = Math.hypot(player(game).pos.x - v.x, player(game).pos.y - v.y);
      expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + NPC_RADIUS - 1e-6);
    }
  });

  test("the campfire is solid — a player in the flames is pushed out", () => {
    const game = createGameOn(1, cryptZone());
    travel(game, player(game), "overworld");
    const fire = playerZone(game).map.markers.find((m) => m.ch === "F")!;
    player(game).pos = { x: fire.x, y: fire.y };
    collisionSystem(game, playerZone(game), [player(game)]);
    const d = Math.hypot(player(game).pos.x - fire.x, player(game).pos.y - fire.y);
    expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS + NPC_RADIUS - 1e-6);
  });
});

describe("monster vs monster", () => {
  test("overlapping monsters are fully separated to their radii sum", () => {
    const game = createGameOn(1, arena());
    const a = spawnAt(game, "shambler", { x: 6.5, y: 2.5 });
    const b = spawnAt(game, "shambler", { x: 6.6, y: 2.5 });
    collisionSystem(game, playerZone(game), [player(game)]);
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
    expect(d).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
  });

  test("perfectly stacked monsters split deterministically", () => {
    const game = createGameOn(1, arena());
    const a = spawnAt(game, "shambler", { x: 6.5, y: 2.5 });
    const b = spawnAt(game, "shambler", { x: 6.5, y: 2.5 });
    collisionSystem(game, playerZone(game), [player(game)]);
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
    expect(d).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
  });

  test("separation never pushes a monster into a wall", () => {
    const game = createGameOn(1, corridor());
    // a sits against the left wall; b overlaps from the right.
    const a = spawnAt(game, "shambler", { x: 1.35, y: 1.5 });
    const b = spawnAt(game, "shambler", { x: 1.45, y: 1.5 });
    collisionSystem(game, playerZone(game), [player(game)]);
    for (const m of [a, b]) {
      expect(isWalkable(playerZone(game).map, Math.floor(m.pos.x), Math.floor(m.pos.y))).toBe(true);
    }
  });
});

describe("integration", () => {
  test("a settled pack leaves no pair overlapping", () => {
    const game = createGameOn(1, arena());
    const ms = [
      spawnAt(game, "shambler", { x: 6.5, y: 2.5 }),
      spawnAt(game, "shambler", { x: 6.6, y: 2.5 }),
      spawnAt(game, "skitter", { x: 6.5, y: 2.6 }),
      spawnAt(game, "skitter", { x: 6.6, y: 2.6 }),
    ];
    for (let i = 0; i < 200; i++) stepSolo(game, {});
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i]!;
        const b = ms[j]!;
        if (!playerZone(game).monsters.has(a.id) || !playerZone(game).monsters.has(b.id)) continue;
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
        expect(d).toBeGreaterThanOrEqual(a.radius + b.radius - 0.05);
      }
    }
  });

  test("chasing monsters still reach the player and connect hits", () => {
    const game = createGameOn(1, arena());
    spawnAt(game, "shambler", { x: 6.5, y: 1.5 });
    let sawHit = false;
    for (let i = 0; i < 400; i++) {
      stepSolo(game, {});
      if (game.events.some((e) => e.type === "player_hit")) sawHit = true;
    }
    expect(sawHit).toBe(true);
  });
});
