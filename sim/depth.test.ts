import { describe, expect, test } from "bun:test";
import { mapFromStrings } from "./map";
import { createGame, step } from "./tick";
import { MONSTER_TYPES, scaledMonsterStats } from "./monsters";

const stairsMap = () =>
  mapFromStrings([
    "########",
    "#@..z..#",
    "#......#",
    "#....>.#",
    "########",
  ]);

function walkOnStairs(state: ReturnType<typeof createGame>): void {
  state.player.pos = { x: 5.5, y: 3.5 }; // the > cell
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
  test("walking onto the stairs descends: depth++, fresh scaled spawns, player at entrance", () => {
    const state = createGame(1, stairsMap());
    expect(state.depth).toBe(1);
    const lifeAtD1 = [...state.monsters.values()][0]!.maxLife;
    walkOnStairs(state);
    expect(state.depth).toBe(2);
    expect(state.player.pos).toEqual(state.map.spawn);
    expect(state.monsters.size).toBe(1); // z marker respawned
    const lifeAtD2 = [...state.monsters.values()][0]!.maxLife;
    expect(lifeAtD2).toBeGreaterThan(lifeAtD1);
    expect(state.events.some((e) => e.type === "descended" && e.depth === 2)).toBe(true);
    expect(state.groundItems.size).toBe(0);
  });

  test("monsters on deeper floors grant scaled xp and mlvl", () => {
    const state = createGame(1, stairsMap());
    walkOnStairs(state);
    walkOnStairs(state);
    expect(state.depth).toBe(3);
    const m = [...state.monsters.values()][0]!;
    expect(m.mlvl).toBe(scaledMonsterStats(MONSTER_TYPES.shambler!, 3).mlvl);
  });

  test("a new run (n) returns to depth 1", () => {
    const state = createGame(1, stairsMap());
    walkOnStairs(state);
    expect(state.depth).toBe(2);
    step(state, { newGame: true });
    expect(state.depth).toBe(1);
    const m = [...state.monsters.values()][0]!;
    expect(m.maxLife).toBe(MONSTER_TYPES.shambler!.maxLife);
  });
});
