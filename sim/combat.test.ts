import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { stepSolo } from "./tick";
import { createGameOn, player, playerZone, spawnAt } from "./test-helpers";
import { computeHitChance, rollDamage, PLAYER_STRIKE_TICKS } from "./systems/combat";
import { dropSpot } from "./systems/combat";
import { createRng } from "./rng";
import type { ZoneMap } from "./map";

/** A hand-built map: floor only at the given cells, wall everywhere else. */
function wallMap(width: number, height: number, floor: [number, number][]): ZoneMap {
  const cells = new Uint8Array(width * height);
  for (const [x, y] of floor) cells[y * width + x] = 1;
  return { width, height, cells, spawn: { x: 0.5, y: 0.5 }, markers: [], camps: [] };
}

const arena = () =>
  mapFromStrings([
    "############",
    "#@.........#",
    "#..........#",
    "#..........#",
    "############",
  ]);

const longArena = () =>
  mapFromStrings([
    "####################################",
    "#@.................................#",
    "#..................................#",
    "#..................................#",
    "####################################",
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
    const game = createGameOn(1, arena());
    const far = spawnAt(game, "shambler", { x: 10.5, y: 3.5 });
    stepSolo(game, {});
    expect(far.ai).toBe("idle");

    const near = spawnAt(game, "shambler", { x: 4.5, y: 1.5 });
    stepSolo(game, {});
    expect(near.ai).toBe("chasing");
  });

  test("idle monster shuffles around instead of standing frozen", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 10.5, y: 3.5 });
    let moved = false;
    for (let i = 0; i < 500; i++) {
      stepSolo(game, {});
      expect(m.ai).toBe("idle");
      if (Math.hypot(m.pos.x - 10.5, m.pos.y - 3.5) > 0.3) moved = true;
    }
    expect(moved).toBe(true);
  });

  test("idle wander stays leashed near the spawn point", () => {
    const game = createGameOn(2, arena());
    const m = spawnAt(game, "shambler", { x: 10.5, y: 3.5 });
    for (let i = 0; i < 2000; i++) {
      stepSolo(game, {});
      expect(Math.hypot(m.pos.x - 10.5, m.pos.y - 3.5)).toBeLessThanOrEqual(2.5);
    }
  });

  test("chasing monster closes distance and damages the player", () => {
    const game = createGameOn(1, arena());
    spawnAt(game, "shambler", { x: 6.5, y: 1.5 });
    const startLife = player(game).life;
    let sawDamageEvent = false;
    for (let i = 0; i < 300; i++) {
      stepSolo(game, {});
      if (game.events.some((e) => e.type === "player_hit")) sawDamageEvent = true;
    }
    expect(player(game).life).toBeLessThan(startLife);
    expect(sawDamageEvent).toBe(true);
  });

  test("a hit from beyond aggro range provokes the monster into chasing", () => {
    const game = createGameOn(1, arena());
    const p = player(game);
    p.klass = "witch";
    p.skills.firebolt = 1;
    p.mana = 50;
    // Within firebolt range (8) but outside the shambler's aggro radius (6).
    const m = spawnAt(game, "shambler", { x: 8.5, y: 1.5 });
    stepSolo(game, {});
    expect(m.ai).toBe("idle");
    stepSolo(game, { cast: { skill: "firebolt", target: m.id } });
    expect(m.life).toBeLessThan(m.maxLife);
    expect(m.ai).toBe("chasing");
  });

  test("a chaser dragged too far from home gives up and returns", () => {
    const game = createGameOn(1, longArena());
    const m = spawnAt(game, "shambler", { x: 30.5, y: 2.5 });
    const p = player(game);
    p.pos = { x: 26.5, y: 2.5 };
    stepSolo(game, {});
    expect(m.ai).toBe("chasing");
    // The player sprints off across the zone; the monster shouldn't follow forever.
    p.pos = { x: 2.5, y: 2.5 };
    for (let i = 0; i < 600; i++) stepSolo(game, {});
    expect(m.ai).toBe("idle");
    expect(Math.hypot(m.pos.x - 30.5, m.pos.y - 2.5)).toBeLessThanOrEqual(3);
  });

  test("noticing the player emits a monster_aggro event, once", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 4.5, y: 1.5 });
    stepSolo(game, {});
    const aggros = game.events.filter((e) => e.type === "monster_aggro");
    expect(aggros).toHaveLength(1);
    expect(aggros[0]).toEqual({
      type: "monster_aggro",
      id: m.id,
      typeId: "shambler",
      pos: { x: 4.5, y: 1.5 }, // where it stood when it noticed, not where it is now
      zone: player(game).zoneId,
    });
    // Still chasing on later ticks: no repeat announcements.
    for (let i = 0; i < 20; i++) {
      stepSolo(game, {});
      expect(game.events.filter((e) => e.type === "monster_aggro")).toHaveLength(0);
    }
  });

  test("a provoking hit from beyond aggro range emits monster_aggro", () => {
    const game = createGameOn(1, arena());
    const p = player(game);
    p.klass = "witch";
    p.skills.firebolt = 1;
    p.mana = 50;
    const m = spawnAt(game, "shambler", { x: 8.5, y: 1.5 });
    stepSolo(game, {});
    expect(m.ai).toBe("idle");
    stepSolo(game, { cast: { skill: "firebolt", target: m.id } });
    expect(m.ai).toBe("chasing");
    expect(
      game.events.some((e) => e.type === "monster_aggro" && e.id === m.id),
    ).toBe(true);
  });

  test("idle allies joining a fight each emit monster_aggro", () => {
    const game = createGameOn(1, longArena());
    const p = player(game);
    p.klass = "witch";
    p.skills.firebolt = 1;
    p.mana = 50;
    // Victim beyond its own aggro radius; ally right beside the victim.
    const victim = spawnAt(game, "shambler", { x: 8.5, y: 1.5 });
    const ally = spawnAt(game, "shambler", { x: 10.5, y: 1.5 });
    stepSolo(game, {});
    expect(victim.ai).toBe("idle");
    expect(ally.ai).toBe("idle");
    stepSolo(game, { cast: { skill: "firebolt", target: victim.id } });
    expect(ally.ai).toBe("chasing");
    const ids = game.events.filter((e) => e.type === "monster_aggro").map((e) => (e as any).id);
    expect(ids).toContain(victim.id);
    expect(ids).toContain(ally.id);
  });

  test("monster respects its swing cooldown", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 2.1, y: 1.5 });
    const hitsAt: number[] = [];
    for (let i = 0; i < 500; i++) {
      stepSolo(game, {});
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
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "skitter", { x: 8.5, y: 2.5 });
    let died = false;
    // Hold the click: the client re-sends the attack input every tick.
    for (let i = 0; i < 600 && !died; i++) {
      stepSolo(game, { attack: m.id });
      if (game.events.some((e) => e.type === "monster_died" && e.id === m.id)) died = true;
    }
    expect(died).toBe(true);
    expect(playerZone(game).monsters.has(m.id)).toBe(false);
    expect(playerZone(game).corpses.some((c) => c.typeId === "skitter")).toBe(true);
  });

  test("a single attack input swings once, then disengages", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 2.2, y: 1.5 });
    m.life = 1000000;
    let swings = 0;
    for (let i = 0; i < 60; i++) {
      stepSolo(game, i === 0 ? { attack: m.id } : {});
      swings += game.events.filter((e) => e.type === "player_swing").length;
    }
    expect(swings).toBe(1);
    expect(player(game).attackTarget).toBeNull();
  });

  test("a single click on a distant monster still walks into range for its one swing", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 8.5, y: 2.5 });
    m.life = 1000000;
    let swings = 0;
    for (let i = 0; i < 200; i++) {
      stepSolo(game, i === 0 ? { attack: m.id } : {});
      swings += game.events.filter((e) => e.type === "player_swing").length;
    }
    expect(swings).toBe(1);
  });

  test("holding the attack (input re-sent every tick) keeps swinging", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 2.2, y: 1.5 });
    m.life = 1000000;
    let swings = 0;
    for (let i = 0; i < 60; i++) {
      stepSolo(game, { attack: m.id });
      swings += game.events.filter((e) => e.type === "player_swing").length;
    }
    expect(swings).toBeGreaterThanOrEqual(2);
  });

  test("monster hits emit events with damage amounts", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "skitter", { x: 2.5, y: 1.5 });
    const amounts: number[] = [];
    for (let i = 0; i < 200 && playerZone(game).monsters.has(m.id); i++) {
      stepSolo(game, { attack: m.id });
      for (const e of game.events) {
        if (e.type === "monster_hit" && e.id === m.id) amounts.push(e.amount);
      }
    }
    expect(amounts.length).toBeGreaterThan(0);
    for (const a of amounts) expect(a).toBeGreaterThan(0);
  });

  test("player death respawns in camp at full life instead of piling on", () => {
    const game = createGameOn(1, arena());
    player(game).life = 1;
    spawnAt(game, "shambler", { x: 2.1, y: 1.5 });
    for (let i = 0; i < 200; i++) stepSolo(game, {});
    expect(player(game).dead).toBe(false);
    expect(player(game).zoneId).toBe("surface");
    expect(player(game).life).toBe(player(game).maxLife);
  });
});

describe("swing events", () => {
  test("a player swing emits player_swing whether or not it hits", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 2.2, y: 1.5 });
    let swings = 0;
    for (let i = 0; i < 30; i++) {
      stepSolo(game, { attack: m.id });
      swings += game.events.filter((e) => e.type === "player_swing").length;
    }
    // swingEvery is 12 ticks: at least two swings in 30
    expect(swings).toBeGreaterThanOrEqual(2);
  });

  test("melee monsters emit monster_swing at the player, not flagged ranged", () => {
    const game = createGameOn(1, arena());
    spawnAt(game, "shambler", { x: 2.2, y: 1.5 });
    let seen = false;
    for (let i = 0; i < 60 && !seen; i++) {
      stepSolo(game, {});
      for (const e of game.events) {
        if (e.type === "monster_swing") {
          seen = true;
          expect(e.ranged).toBe(false);
          expect(e.to).toEqual(player(game).pos);
        }
      }
    }
    expect(seen).toBe(true);
  });

  test("gravespit swings are flagged ranged with a firing origin", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "gravespit", { x: 6.5, y: 1.5 });
    let seen = false;
    for (let i = 0; i < 120 && !seen; i++) {
      stepSolo(game, {});
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

describe("attack in place (shift-click)", () => {
  test("swings at a nearby monster without moving", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 2.2, y: 1.5 });
    const start = { ...player(game).pos };
    let hit = false;
    for (let i = 0; i < 40 && !hit; i++) {
      stepSolo(game, { swingAt: { x: 2.2, y: 1.5 } });
      if (game.events.some((e) => e.type === "monster_hit" && (e as any).id === m.id)) hit = true;
      expect(player(game).pos).toEqual(start);
      expect(player(game).path).toHaveLength(0);
    }
    expect(hit).toBe(true);
  });

  test("swinging at empty air still swings, hits nothing, never moves", () => {
    const game = createGameOn(1, arena());
    spawnAt(game, "shambler", { x: 9.5, y: 3.5 }); // far away
    const start = { ...player(game).pos };
    let swings = 0;
    for (let i = 0; i < 30; i++) {
      stepSolo(game, { swingAt: { x: 3.5, y: 1.5 } });
      swings += game.events.filter((e) => e.type === "player_swing").length;
      expect(game.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
    }
    expect(player(game).pos).toEqual(start);
    expect(swings).toBeGreaterThanOrEqual(2);
  });

  test("a swing-in-place cancels a pending move", () => {
    const game = createGameOn(1, arena());
    stepSolo(game, { moveTo: { x: 9.5, y: 3.5 } });
    stepSolo(game, { swingAt: { x: 3.5, y: 1.5 } });
    expect(player(game).path).toHaveLength(0);
  });
});

describe("contact frames", () => {
  test("every hit lands exactly the strike delay after some swing, never instantly", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 2.2, y: 1.5 });
    m.life = 1000000;
    const swingTicks: number[] = [];
    const hitTicks: number[] = [];
    for (let i = 0; i < 120; i++) {
      stepSolo(game, { attack: m.id });
      for (const e of game.events) {
        if (e.type === "player_swing") swingTicks.push(game.tick);
        if (e.type === "monster_hit") hitTicks.push(game.tick);
      }
    }
    expect(swingTicks.length).toBeGreaterThan(3);
    expect(hitTicks.length).toBeGreaterThan(0);
    for (const hit of hitTicks) {
      expect(swingTicks).toContain(hit - PLAYER_STRIKE_TICKS);
      expect(swingTicks).not.toContain(hit);
    }
  });

  test("the strike whiffs when the target escapes mid-swing", () => {
    const game = createGameOn(1, arena());
    const m = spawnAt(game, "shambler", { x: 2.2, y: 1.5 });
    let swung = false;
    for (let i = 0; i < 30 && !swung; i++) {
      stepSolo(game, i === 0 ? { attack: m.id } : {});
      if (game.events.some((e) => e.type === "player_swing")) swung = true;
    }
    expect(swung).toBe(true);
    m.pos = { x: 9.5, y: 3.5 }; // yanked away mid-swing
    for (let i = 0; i < 10; i++) {
      stepSolo(game, {});
      expect(game.events.filter((e) => e.type === "monster_hit")).toHaveLength(0);
    }
  });

  test("monster melee damage trails its swing animation cue", () => {
    const game = createGameOn(1, arena());
    spawnAt(game, "shambler", { x: 2.2, y: 1.5 });
    let swingTick = -1;
    let hurtTick = -1;
    for (let i = 0; i < 120 && hurtTick === -1; i++) {
      stepSolo(game, {});
      for (const e of game.events) {
        // Track the latest swing before the hit: an earlier swing may whiff its
        // to-hit roll, and the contact frame trails the swing that connects.
        if (e.type === "monster_swing" && hurtTick === -1) swingTick = game.tick;
        if (e.type === "player_hit" && hurtTick === -1) hurtTick = game.tick;
      }
    }
    expect(swingTick).toBeGreaterThan(-1);
    expect(hurtTick).toBeGreaterThan(swingTick);
    expect(hurtTick - swingTick).toBeLessThanOrEqual(8);
  });
});

describe("dropSpot", () => {
  test("leaves the scattered point alone when its own cell is walkable", () => {
    const floor: [number, number][] = [];
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) floor.push([x, y]);
    const map = wallMap(12, 12, floor);
    const pos = { x: 5.5, y: 5.5 };
    const rng = createRng(1);
    const result = dropSpot(rng, map, pos);
    const check = createRng(1);
    const expected = {
      x: pos.x + (check.next() - 0.5) * 1.4,
      y: pos.y + (check.next() - 0.5) * 1.4,
    };
    expect(result).toEqual(expected);
    // Confirm the scatter actually moved it off the cell center — this is
    // pinning "unchanged", not a snap that happens to land nearby.
    expect(result).not.toEqual({ x: 5.5, y: 5.5 });
  });

  test("snaps to the nearest walkable cell when the scatter lands in a wall", () => {
    // Seed 1's first two draws scatter (5.5, 5.5) into cell (5, 4), which is
    // wall here; the only floor is (7, 4).
    const map = wallMap(12, 12, [[7, 4]]);
    const pos = { x: 5.5, y: 5.5 };
    const rng = createRng(1);
    const result = dropSpot(rng, map, pos);
    expect(result).toEqual({ x: 7.5, y: 4.5 });
  });

  test("falls back to the origin position when no walkable cell exists nearby", () => {
    const map = wallMap(12, 12, []);
    const pos = { x: 5.5, y: 5.5 };
    const rng = createRng(1);
    const result = dropSpot(rng, map, pos);
    expect(result).toEqual(pos);
  });
});
