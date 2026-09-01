import { describe, expect, test } from "bun:test";
import { createGame } from "./tick";
import { getZone } from "./state";
import { NPCS, isNpcId, type NpcId } from "./npcs";
import { isWalkable } from "./map";
import { areaRect, inRect } from "./surface";

describe("npcs", () => {
  test("every NPC def spawns on the surface, walkable, inside its area", () => {
    const state = createGame(123);
    const surface = getZone(state, "surface");
    const spawned = [...surface.npcs.values()];
    expect(spawned.length).toBe(Object.keys(NPCS).length);
    for (const npc of spawned) {
      const def = NPCS[npc.npcId];
      expect(isWalkable(surface.map, Math.floor(npc.pos.x), Math.floor(npc.pos.y))).toBe(true);
      expect(inRect(areaRect(def.area), npc.pos)).toBe(true);
    }
  });

  test("npc ids validate", () => {
    expect(isNpcId("maren")).toBe(true);
    expect(isNpcId("bogus")).toBe(false);
  });

  test("same seed spawns npcs at identical spots", () => {
    const a = getZone(createGame(7), "surface");
    const b = getZone(createGame(7), "surface");
    expect([...a.npcs.values()]).toEqual([...b.npcs.values()]);
  });

  test("npc cells are carved walkable across a seed sweep (softlock guard)", () => {
    for (let seed = 0; seed < 300; seed++) {
      const surface = getZone(createGame(seed), "surface");
      for (const npc of surface.npcs.values()) {
        const walkable = isWalkable(surface.map, Math.floor(npc.pos.x), Math.floor(npc.pos.y));
        expect(walkable).toBe(true);
      }
    }
  });

  test("seeds 136 and 209 (previously stranded Betha with no walkable cell) are fixed", () => {
    for (const seed of [136, 209]) {
      const surface = getZone(createGame(seed), "surface");
      for (const npc of surface.npcs.values()) {
        expect(isWalkable(surface.map, Math.floor(npc.pos.x), Math.floor(npc.pos.y))).toBe(true);
      }
    }
  });
});
