import { describe, expect, test } from "bun:test";
import { player, soloGame } from "./test-helpers";
import { ensureDungeonFloor, stepSolo, travel } from "./tick";
import { dungeonZoneId, getZone, zoneFloor } from "./state";
import { DUNGEONS } from "./dungeons";
import { MARKER_TYPES } from "./zone";

describe("marker spawns", () => {
  test("barrow floor 1 fields packs from the barrow's spawn table", () => {
    const state = soloGame(1);
    const zone = ensureDungeonFloor(state, "barrow", 1);
    const wanted = new Set(DUNGEONS.barrow.spawnTable.map((ch) => MARKER_TYPES[ch]!));
    const types = new Set([...zone.monsters.values()].map((m) => m.typeId));
    expect(types.size).toBeGreaterThan(0);
    for (const t of types) expect(wanted.has(t)).toBe(true);
  });

  test("the Barrow Lord keeps his vault on the bottom floor", () => {
    const state = soloGame(1);
    const bottom = ensureDungeonFloor(state, "barrow", DUNGEONS.barrow.floors);
    const types = new Set([...bottom.monsters.values()].map((m) => m.typeId));
    expect(types.has("barrow_lord")).toBe(true);
  });
});

describe("new game reset", () => {
  test("respawns the world, revives the player, keeps the character", () => {
    const state = soloGame(1);
    travel(state, player(state), "dungeon:barrow:1");
    const populated = getZone(state, "dungeon:barrow:1").monsters.size;
    // Progress a character: kill everything cheaply, get hurt, die.
    for (const m of getZone(state, "dungeon:barrow:1").monsters.values()) {
      m.lastHitBy = player(state).id;
      m.life = 0;
    }
    stepSolo(state, {});
    const xpAfterKills = player(state).xp;
    expect(xpAfterKills).toBeGreaterThan(0);
    player(state).life = 0;
    stepSolo(state, {});
    // Death resolves to an immediate camp respawn — dead is never persistent.
    expect(player(state).dead).toBe(false);
    expect(player(state).zoneId).toBe("surface");
    expect(player(state).life).toBe(player(state).maxLife);

    stepSolo(state, { newGame: true });
    expect(player(state).dead).toBe(false);
    expect(player(state).life).toBe(player(state).maxLife);
    expect(player(state).zoneId).toBe("surface");
    expect(player(state).pos).toEqual(getZone(state, "surface").map.spawn);
    expect(player(state).xp).toBe(xpAfterKills); // character persists
    // Floors regenerate lazily: forgotten now, freshly populated on re-entry.
    expect(state.zones.has("dungeon:barrow:1")).toBe(false);
    const fresh = ensureDungeonFloor(state, "barrow", 1);
    expect(fresh.monsters.size).toBe(populated);
    expect(fresh.groundItems.size).toBe(0);
    expect(fresh.corpses).toHaveLength(0);
  });

  test("a reset mid-run clears the field and forgets every floor", () => {
    const state = soloGame(1);
    travel(state, player(state), "dungeon:barrow:1");
    ensureDungeonFloor(state, "barrow", 4);
    stepSolo(state, {});
    stepSolo(state, { newGame: true });
    expect([...state.zones.keys()]).toEqual(["surface"]);
    expect(player(state).dead).toBe(false);
  });
});

describe("zones", () => {
  test("createGame builds only the surface; player starts on camp ground", () => {
    const g = soloGame(1);
    expect([...g.zones.keys()]).toEqual(["surface"]);
    expect(player(g).zoneId).toBe("surface");
  });

  test("ensureDungeonFloor generates lazily, deterministically, and only once", () => {
    const g = soloGame(7);
    expect(g.zones.has("dungeon:barrow:2")).toBe(false);
    const z = ensureDungeonFloor(g, "barrow", 2);
    expect(ensureDungeonFloor(g, "barrow", 2)).toBe(z); // same instance, not regenerated
    // Same seed + same call order ⇒ identical floor (the lockstep contract).
    // Generation draws from the world rng, so peers must materialize floors
    // at the same point in the tick stream — which lockstep guarantees.
    const h = soloGame(7);
    expect([...ensureDungeonFloor(h, "barrow", 2).monsters.values()].map((m) => m.pos))
      .toEqual([...z.monsters.values()].map((m) => m.pos));
  });

  test("deeper floors scale monsters", () => {
    const g = soloGame(3);
    const pick = (floor: number) =>
      [...ensureDungeonFloor(g, "barrow", floor).monsters.values()].reduce(
        (a, b) => (a.mlvl < b.mlvl ? a : b),
      );
    expect(pick(3).mlvl).toBeGreaterThan(pick(1).mlvl);
  });

  test("standing at the barrow mouth travels to floor 1; stairs go one deeper", () => {
    const g = soloGame(1);
    const mouth = getZone(g, "surface").map.markers.find((m) => m.ch === ">")!;
    player(g).pos = { x: mouth.x, y: mouth.y };
    stepSolo(g, {});
    expect(player(g).zoneId).toBe("dungeon:barrow:1");
    expect(g.events.some((e) => e.type === "traveled" && e.to === "dungeon:barrow:1")).toBe(true);
    const stairs = getZone(g, "dungeon:barrow:1").map.markers.find((m) => m.ch === ">")!;
    player(g).pos = { x: stairs.x, y: stairs.y };
    stepSolo(g, {});
    expect(player(g).zoneId).toBe("dungeon:barrow:2");
  });

  test("an idle floor's monsters hold their ground while the player is away", () => {
    const g = soloGame(1);
    ensureDungeonFloor(g, "barrow", 1);
    const before = [...getZone(g, "dungeon:barrow:1").monsters.values()].map((m) => ({ ...m.pos }));
    for (let i = 0; i < 200; i++) stepSolo(g, {});
    const after = [...getZone(g, "dungeon:barrow:1").monsters.values()].map((m) => ({ ...m.pos }));
    expect(after).toEqual(before);
  });

  test("zone identity helpers", () => {
    expect(zoneFloor("surface")).toBe(1);
    expect(zoneFloor(dungeonZoneId("barrow", 4))).toBe(4);
  });
});
