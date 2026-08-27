import { describe, expect, test } from "bun:test";
import { createGame, step, travel } from "./tick";
import { getZone, zoneDepth } from "./state";
import { playerZone } from "./test-helpers";
import { MONSTER_TYPES, scaledMonsterStats } from "./monsters";

function walkOnStairs(state: ReturnType<typeof createGame>): void {
  const stairs = playerZone(state).map.markers.find((m) => m.ch === ">")!;
  state.player.pos = { x: stairs.x, y: stairs.y };
  step(state, {});
}

describe("depth scaling", () => {
  test("deeper monsters hit harder, live longer, and carry higher mlvl", () => {
    const base = MONSTER_TYPES.shambler!;
    const d1 = scaledMonsterStats(base, 1);
    const d3 = scaledMonsterStats(base, 3);
    expect(d1.maxLife).toBe(base.maxLife);
    expect(d1.mlvl).toBe(base.mlvl);
    expect(d3.maxLife).toBeGreaterThan(d1.maxLife);
    expect(d3.dmgMax).toBeGreaterThan(d1.dmgMax);
    expect(d3.mlvl).toBeGreaterThan(d1.mlvl);
    expect(d3.xp).toBeGreaterThan(d1.xp);
  });
});

describe("stairs", () => {
  test("walking onto the stairs descends: next floor, scaled spawns, player at entrance", () => {
    const state = createGame(1);
    travel(state, "floor:1");
    const lifeAtD1 = [...playerZone(state).monsters.values()].find(
      (m) => m.typeId === "shambler",
    )!.maxLife;
    walkOnStairs(state);
    expect(state.player.zoneId).toBe("floor:2");
    expect(state.player.pos).toEqual(playerZone(state).map.spawn);
    expect(playerZone(state).monsters.size).toBeGreaterThan(0);
    const lifeAtD2 = [...playerZone(state).monsters.values()].find(
      (m) => m.typeId === "shambler",
    )!.maxLife;
    expect(lifeAtD2).toBeGreaterThan(lifeAtD1);
    expect(state.events.some((e) => e.type === "traveled" && e.to === "floor:2")).toBe(true);
    expect(playerZone(state).groundItems.size).toBe(0);
  });

  test("monsters on deeper floors grant scaled xp and mlvl", () => {
    const state = createGame(1);
    travel(state, "floor:1");
    walkOnStairs(state);
    walkOnStairs(state);
    expect(zoneDepth(state.player.zoneId)).toBe(3);
    const m = [...playerZone(state).monsters.values()].find((m) => m.typeId === "shambler")!;
    expect(m.mlvl).toBe(scaledMonsterStats(MONSTER_TYPES.shambler!, 3).mlvl);
  });

  test("a new run (n) forgets the floors and regenerates floor 1", () => {
    const state = createGame(1);
    travel(state, "floor:1");
    walkOnStairs(state);
    expect(state.player.zoneId).toBe("floor:2");
    step(state, { newGame: true });
    expect(state.player.zoneId).toBe("camp");
    expect(state.zones.has("floor:2")).toBe(false);
    const m = [...getZone(state, "floor:1").monsters.values()].find(
      (m) => m.typeId === "shambler",
    )!;
    expect(m.maxLife).toBe(MONSTER_TYPES.shambler!.maxLife);
  });
});
