import { describe, expect, test } from "bun:test";
import { createGame, stepSolo } from "./tick";
import { getZone } from "./state";
import { NPCS, isNpcId, type NpcId, type Npc } from "./npcs";
import { isWalkable } from "./map";
import { areaRect, inRect } from "./surface";
import { player, soloGame } from "./test-helpers";
import { NPC_HOLD_RANGE, NPC_WANDER_RADIUS } from "./systems/npcs";

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

describe("npc wander", () => {
  /** The named NPC's live entity on the surface. */
  function npcOf(state: ReturnType<typeof soloGame>, npcId: NpcId): Npc {
    return [...getZone(state, "surface").npcs.values()].find((n) => n.npcId === npcId)!;
  }

  test("an unattended npc strolls rather than standing frozen", () => {
    const state = soloGame(5);
    // Betha is out in the redfen, far from the camp where the player spawns.
    const betha = npcOf(state, "betha");
    const start = { ...betha.pos };
    let moved = false;
    for (let i = 0; i < 25 * 30 && !moved; i++) {
      stepSolo(state, {});
      moved = betha.pos.x !== start.x || betha.pos.y !== start.y;
    }
    expect(moved).toBe(true);
  });

  test("a wandering npc stays near home and on walkable ground", () => {
    const state = soloGame(9);
    const surface = getZone(state, "surface");
    const betha = npcOf(state, "betha");
    const maxDist = NPC_WANDER_RADIUS * Math.SQRT2 + 0.01;
    for (let i = 0; i < 25 * 60; i++) {
      stepSolo(state, {});
      expect(Math.hypot(betha.pos.x - betha.home.x, betha.pos.y - betha.home.y))
        .toBeLessThanOrEqual(maxDist);
      expect(isWalkable(surface.map, Math.floor(betha.pos.x), Math.floor(betha.pos.y))).toBe(true);
    }
  });

  test("an npc holds still while a player stands close", () => {
    const state = soloGame(3);
    const maren = npcOf(state, "maren");
    const p = player(state);
    p.pos = { x: maren.pos.x + 1, y: maren.pos.y };
    expect(Math.hypot(p.pos.x - maren.pos.x, p.pos.y - maren.pos.y))
      .toBeLessThanOrEqual(NPC_HOLD_RANGE);
    const before = { ...maren.pos };
    for (let i = 0; i < 25 * 20; i++) stepSolo(state, {});
    expect(maren.pos).toEqual(before);
  });
});
