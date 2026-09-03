import { describe, expect, test } from "bun:test";
import { DUNGEONS, DUNGEON_ORDER, DUNGEON_STYLES, isDungeonId } from "./dungeons";
import { AREAS } from "./areas";
import { MONSTER_TYPES } from "./monsters";
import { MARKER_TYPES } from "./zone";
import { dungeonZoneId, zoneDungeon, zoneFloor } from "./state";
import { ensureDungeonFloor } from "./world";
import { soloGame } from "./test-helpers";

describe("dungeon registry", () => {
  test("six dungeons, one per surface area, each area used exactly once", () => {
    expect(DUNGEON_ORDER.length).toBe(6);
    const areas = DUNGEON_ORDER.map((id) => DUNGEONS[id].area);
    expect(new Set(areas).size).toBe(6);
  });

  test("every row is internally valid", () => {
    for (const id of DUNGEON_ORDER) {
      const d = DUNGEONS[id];
      expect(d.id).toBe(id);
      expect(d.floors).toBeGreaterThanOrEqual(1);
      expect(d.floors).toBeLessThanOrEqual(5);
      expect(AREAS[d.area]).toBeDefined();
      expect(DUNGEON_STYLES[d.style]).toBeDefined();
      expect(MONSTER_TYPES[d.boss.typeId]).toBeDefined();
      for (const ch of d.spawnTable) expect(MARKER_TYPES[ch]).toBeDefined();
      // Entrance sits inside its host area's bounds, off the 2-cell rim.
      const a = AREAS[d.area];
      expect(d.entrance.x).toBeGreaterThan(2);
      expect(d.entrance.x).toBeLessThan(a.width - 2);
      expect(d.entrance.y).toBeGreaterThan(2);
      expect(d.entrance.y).toBeLessThan(a.height - 2);
    }
  });

  test("barrow keeps its historic mouth and lord", () => {
    expect(DUNGEONS.barrow.area).toBe("overworld");
    expect(DUNGEONS.barrow.entrance).toEqual({ x: 58.5, y: 56.5 });
    expect(DUNGEONS.barrow.floors).toBe(5);
    expect(DUNGEONS.barrow.boss.typeId).toBe("barrow_lord");
  });

  test("zone id helpers round-trip", () => {
    const id = dungeonZoneId("fen_hollow", 2);
    expect(id).toBe("dungeon:fen_hollow:2");
    expect(zoneDungeon(id)).toBe("fen_hollow");
    expect(zoneFloor(id)).toBe(2);
    expect(zoneDungeon("surface")).toBe(null);
    expect(zoneFloor("surface")).toBe(1);
    expect(isDungeonId("barrow")).toBe(true);
    expect(isDungeonId("surface")).toBe(false);
  });
});

describe("ensureDungeonFloor", () => {
  test("bottom floor holds the boss (champion where modified) and a vault chest", () => {
    const state = soloGame(1);
    const zone = ensureDungeonFloor(state, "fen_hollow", DUNGEONS.fen_hollow.floors);
    const boss = [...zone.monsters.values()].find(
      (m) => m.typeId === "bog_maw" && m.rank === "champion",
    );
    expect(boss).toBeDefined();
    expect(boss!.modifier).toBe("brutal");
    const bossMarker = zone.map.markers.find((m) => m.ch === "!")!;
    expect(Math.hypot(boss!.pos.x - bossMarker.x, boss!.pos.y - bossMarker.y)).toBeLessThan(0.01);
    const chestMarker = zone.map.markers.find((m) => m.ch === "$")!;
    const chest = [...zone.breakables.values()].find(
      (b) => b.kind === "chest" && Math.hypot(b.pos.x - chestMarker.x, b.pos.y - chestMarker.y) < 0.01,
    );
    expect(chest).toBeDefined();
  });

  test("the barrow's lord spawns unmodified on floor 5", () => {
    const state = soloGame(2);
    const zone = ensureDungeonFloor(state, "barrow", 5);
    const lord = [...zone.monsters.values()].find((m) => m.typeId === "barrow_lord");
    expect(lord).toBeDefined();
    expect(lord!.rank).toBeUndefined();
  });

  test("pack monsters scale with levelBase + floor - 1", () => {
    const state = soloGame(3);
    const zone = ensureDungeonFloor(state, "crown_undercroft", 2); // levelBase 12 -> level 13
    const pack = [...zone.monsters.values()].find((m) => m.rank !== "champion");
    expect(pack!.mlvl).toBeGreaterThanOrEqual(13);
  });

  test("idempotent: second call returns the same zone", () => {
    const state = soloGame(4);
    const a = ensureDungeonFloor(state, "barrow", 1);
    const b = ensureDungeonFloor(state, "barrow", 1);
    expect(a).toBe(b);
  });
});
