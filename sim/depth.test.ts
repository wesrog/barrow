import { describe, expect, test } from "bun:test";
import { DUNGEONS } from "./dungeons";
import { ensureDungeonFloor, stepSolo, travel } from "./tick";
import { dungeonZoneId, zoneDungeon, zoneFloor, type GameState } from "./state";
import { worldDungeonEntrance } from "./surface";
import { player, playerZone, soloGame } from "./test-helpers";
import { MONSTER_TYPES, scaledMonsterStats } from "./monsters";

/** Stand the solo player on this floor's marker and step once. */
function walkOnto(state: GameState, ch: string): void {
  const m = playerZone(state).map.markers.find((mk) => mk.ch === ch)!;
  player(state).pos = { x: m.x, y: m.y };
  stepSolo(state, {});
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

describe("dungeon travel", () => {
  test("standing on a surface mouth enters that dungeon's floor 1", () => {
    const state = soloGame(1);
    const at = worldDungeonEntrance("fen_hollow");
    player(state).pos = { ...at };
    stepSolo(state, {});
    expect(player(state).zoneId).toBe("dungeon:fen_hollow:1");
    expect(player(state).pos).toEqual(playerZone(state).map.spawn);
    expect(playerZone(state).monsters.size).toBeGreaterThan(0);
  });

  test("descending stops at the bottom: bottom floor generates no '>'", () => {
    const state = soloGame(1);
    const zone = ensureDungeonFloor(state, "cragmaw_delve", DUNGEONS.cragmaw_delve.floors);
    expect(zone.map.markers.some((m) => m.ch === ">")).toBe(false);
  });

  test("climbing out of floor 1 lands beside the right entrance", () => {
    const state = soloGame(1);
    travel(state, player(state), dungeonZoneId("cinder_catacomb", 1));
    walkOnto(state, "<");
    expect(player(state).zoneId).toBe("surface");
    const at = worldDungeonEntrance("cinder_catacomb");
    expect(Math.hypot(player(state).pos.x - at.x, player(state).pos.y - at.y)).toBeLessThan(2);
  });

  test("descending '>' below ground goes one floor deeper in the same dungeon", () => {
    const state = soloGame(1);
    travel(state, player(state), dungeonZoneId("barrow", 2));
    const lifeAt2 = [...playerZone(state).monsters.values()].find(
      (m) => m.typeId === "shambler",
    )?.maxLife;
    walkOnto(state, ">");
    expect(player(state).zoneId).toBe("dungeon:barrow:3");
    expect(zoneDungeon(player(state).zoneId)).toBe("barrow");
    expect(zoneFloor(player(state).zoneId)).toBe(3);
    // Barrow levelBase is 1: floor N spawns level-N monsters, as depth once did.
    const m = [...playerZone(state).monsters.values()].find((m) => m.typeId === "shambler");
    if (m && lifeAt2 !== undefined) expect(m.maxLife).toBeGreaterThan(lifeAt2);
    if (m) expect(m.mlvl).toBe(scaledMonsterStats(MONSTER_TYPES.shambler!, 3).mlvl);
  });

  test("a new run (n) forgets the floors; they regenerate lazily on entry", () => {
    const state = soloGame(1);
    travel(state, player(state), dungeonZoneId("barrow", 2));
    expect(player(state).zoneId).toBe("dungeon:barrow:2");
    stepSolo(state, { newGame: true });
    expect(player(state).zoneId).toBe("surface");
    expect(state.zones.has("dungeon:barrow:2")).toBe(false);
    const m = [...ensureDungeonFloor(state, "barrow", 1).monsters.values()].find(
      (m) => m.typeId === "shambler",
    );
    if (m) expect(m.maxLife).toBe(MONSTER_TYPES.shambler!.maxLife);
  });
});
