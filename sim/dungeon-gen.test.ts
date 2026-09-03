import { describe, expect, test } from "bun:test";
import { createRng } from "./rng";
import { generateDungeonFloor } from "./dungeon-gen";
import { DUNGEONS, DUNGEON_ORDER, DUNGEON_STYLES } from "./dungeons";
import { isWalkable, type ZoneMap } from "./map";

/** Flood-fill from spawn; returns the set of reachable cell keys "x,y". */
function reachableFrom(map: ZoneMap): Set<string> {
  const seen = new Set<string>();
  const queue = [{ x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) }];
  seen.add(`${queue[0]!.x},${queue[0]!.y}`);
  while (queue.length > 0) {
    const { x, y } = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = `${x + dx},${y + dy}`;
      if (seen.has(k) || !isWalkable(map, x + dx, y + dy)) continue;
      seen.add(k);
      queue.push({ x: x + dx, y: y + dy });
    }
  }
  return seen;
}

describe("generateDungeonFloor", () => {
  test("every floor of every dungeon across seeds: markers present and reachable", () => {
    for (const seed of [1, 7, 1234, 99999]) {
      for (const id of DUNGEON_ORDER) {
        const def = DUNGEONS[id];
        for (let floor = 1; floor <= def.floors; floor++) {
          const map = generateDungeonFloor(createRng(seed), def, floor);
          const style = DUNGEON_STYLES[def.style];
          expect(map.width).toBe(style.width);
          expect(map.height).toBe(style.height);
          const reach = reachableFrom(map);
          const chars = map.markers.map((m) => m.ch);
          expect(chars).toContain("<");
          if (floor < def.floors) {
            expect(chars).toContain(">");
            expect(chars).not.toContain("!");
          } else {
            expect(chars).not.toContain(">");
            expect(chars).toContain("!");
            expect(chars).toContain("$");
          }
          for (const m of map.markers) {
            expect(reach.has(`${Math.floor(m.x)},${Math.floor(m.y)}`)).toBe(true);
          }
          // Spawn is walkable and beside the up-stairs, not on them.
          const up = map.markers.find((m) => m.ch === "<")!;
          expect(isWalkable(map, Math.floor(map.spawn.x), Math.floor(map.spawn.y))).toBe(true);
          expect(Math.hypot(map.spawn.x - up.x, map.spawn.y - up.y)).toBeGreaterThan(0.5);
          expect(Math.hypot(map.spawn.x - up.x, map.spawn.y - up.y)).toBeLessThan(3);
        }
      }
    }
  });

  test("deterministic: same seed, same map", () => {
    const a = generateDungeonFloor(createRng(42), DUNGEONS.barrow, 2);
    const b = generateDungeonFloor(createRng(42), DUNGEONS.barrow, 2);
    expect(a.cells).toEqual(b.cells);
    expect(a.markers).toEqual(b.markers);
  });

  test("pack budget respected and drawn from the spawn table", () => {
    const def = DUNGEONS.barrow;
    const map = generateDungeonFloor(createRng(3), def, 1);
    const packs = map.markers.filter((m) => def.spawnTable.includes(m.ch));
    expect(packs.length).toBeGreaterThan(0);
    expect(packs.length).toBeLessThanOrEqual(DUNGEON_STYLES[def.style].packs);
  });
});
